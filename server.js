import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { db, persist, getUser, findUserByLogin, getFamilyForUser, isFamilyAdmin } from './store.js';
import { callGemini, candidateText, GeminiUnavailableError } from './ai/gemini.js';
import { AGE_MODES, SYSTEM_PROMPTS, chatGenerationConfig } from './ai/prompts.js';
import { InputError } from './ai/validate.js';
import { generateInstructions, parseInstructionsInput } from './ai/instructions.js';
import { generateChorePoster, parseImageInput, ImageError, IMAGES_DIR, IMAGES_URL_PREFIX } from './ai/images.js';
import { parseTaskChatInput, runTaskChat } from './ai/taskChat.js';
import { parseParentAssistantInput, runParentAssistant } from './ai/parentAssistant.js';
import { SEED_CHORES } from './client/src/household.js';
import {
  hashPassword,
  verifyPassword,
  randomToken,
  issueToken,
  revokeToken,
  userFromRequest,
  requireAuth
} from './auth.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// In-memory player accounts and claim store (no database per demo requirements)
const playerAccounts = {
  // Map of sessionId/challengeId -> { type, status, sessionId, challengeId, unlocked, updatedAt }
  records: new Map(),
  latestChallengeId: null,
  latestSessionId: null
};

// Read a k-ID session with the secret key. Returns { ok, status, session }.
async function fetchKidSession(sessionId) {
  const sessionRes = await fetch(
    `https://kai-api.test.k-id.com/api/v1/session/get?sessionId=${encodeURIComponent(sessionId)}`,
    {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${process.env.KID_SECRET_KEY}`
      }
    }
  );
  const data = await sessionRes.json().catch(() => ({}));
  return { ok: sessionRes.ok, status: sessionRes.status, session: data.session ?? data };
}

// Map a k-ID session to an age mode. A proven age wins; otherwise the age status decides.
// Anything unrecognised falls back to the most restrictive mode.
function deriveAgeMode(session) {
  const verifiedAge = session?.ageVerification?.verifiedAge;
  if (typeof verifiedAge === 'number') {
    if (verifiedAge < 13) return 'kid';
    if (verifiedAge < 18) return 'teen';
    return 'adult';
  }
  const status = String(session?.ageStatus || '').toUpperCase();
  if (status.includes('ADULT')) return 'adult';
  if (status.includes('YOUTH') || status.includes('TEEN')) return 'teen';
  return 'kid';
}

// sessionId -> { mode, permissions, fetchedAt }, so chat messages don't each hit k-ID
const ageModeCache = new Map();
const AGE_MODE_CACHE_TTL = 5 * 60 * 1000;

// The user's age mode and k-ID permissions ({ name: enabled }) from their own session,
// or null when it can't be determined
async function resolveKidProfile(user) {
  if (!process.env.KID_SECRET_KEY || !user?.kidSessionId) return null;

  const cached = ageModeCache.get(user.kidSessionId);
  if (cached && Date.now() - cached.fetchedAt < AGE_MODE_CACHE_TTL) return cached;

  try {
    const { ok, session } = await fetchKidSession(user.kidSessionId);
    if (!ok) return null;
    const permissions = Object.fromEntries((session?.permissions || []).map(p => [p.name, p.enabled === true]));
    const profile = { mode: deriveAgeMode(session), permissions, fetchedAt: Date.now() };
    ageModeCache.set(user.kidSessionId, profile);
    return profile;
  } catch (err) {
    console.warn('[k-ID Server] Age mode lookup error:', err.message);
    return null;
  }
}

async function resolveAgeMode(user) {
  return (await resolveKidProfile(user))?.mode ?? null;
}

function saveUser(user, updates) {
  db.users[user.id] = { ...user, ...updates };
  persist();
  return db.users[user.id];
}

function publicUser(user) {
  return {
    id: user.id,
    displayName: user.displayName,
    email: user.email,
    username: user.username,
    adultVerified: user.adultVerified,
    kidSessionId: user.kidSessionId,
    kidChallengeId: user.kidChallengeId,
    settingsChallengeId: user.settingsChallengeId
  };
}

function publicFamily(family) {
  return {
    id: family.id,
    name: family.name,
    members: Object.entries(family.members).map(([userId, member]) => {
      const user = getUser(userId);
      return {
        userId,
        displayName: user?.displayName || 'Unknown',
        role: member.role,
        adultVerified: Boolean(user?.adultVerified),
        joinedAt: member.joinedAt
      };
    })
  };
}

function adminCount(family) {
  return Object.values(family.members).filter((m) => m.role === 'admin').length;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_PATTERN = /^[a-z0-9_.-]{3,30}$/;
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function getValidInvite(token) {
  const invite = db.invites[token];
  if (!invite || new Date(invite.expiresAt) < new Date() || !db.families[invite.familyId]) return null;
  return invite;
}

// 1. Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    service: 'home-helper',
    hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
    hasKidSecretKey: Boolean(process.env.KID_SECRET_KEY)
  });
});

// 2. k-ID Server Claim Endpoint
// POST {"claimToken": "..."} to https://kai-api.test.k-id.com/api/v1/client/claim with Authorization: Bearer <KID_SECRET_KEY>
app.post('/api/claim', async (req, res) => {
  try {
    const { claimToken } = req.body || {};
    if (!claimToken) {
      return res.status(400).json({ error: 'claimToken is required' });
    }

    const secretKey = process.env.KID_SECRET_KEY;
    if (!secretKey) {
      console.warn('[k-ID Server] KID_SECRET_KEY is not set in environment.');
      return res.status(503).json({
        error: 'KID_SECRET_KEY is not configured on the server. Please add KID_SECRET_KEY (starts with kgs_test_) to your .env file or Cloud Run environment variables.'
      });
    }

    console.log('[k-ID Server] Claiming age gate token via secret key...');
    const claimRes = await fetch('https://kai-api.test.k-id.com/api/v1/client/claim', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${secretKey}`
      },
      body: JSON.stringify({ claimToken })
    });

    const claimData = await claimRes.json();
    console.log('[k-ID Server] Claim response status:', claimRes.status, claimData);

    if (!claimRes.ok) {
      return res.status(claimRes.status).json({
        error: 'k-ID claim request failed',
        details: claimData
      });
    }

    // Answer has type ('session' or 'challenge'), status, and sessionId or challengeId
    const { type, status, sessionId, challengeId } = claimData;

    if (challengeId) {
      playerAccounts.latestChallengeId = challengeId;
      playerAccounts.records.set(challengeId, {
        type,
        status,
        challengeId,
        unlocked: false,
        updatedAt: Date.now()
      });
    }

    if (sessionId) {
      playerAccounts.latestSessionId = sessionId;
      playerAccounts.records.set(sessionId, {
        type,
        status,
        sessionId,
        unlocked: status === 'PASS' || status === 'SUCCESS',
        updatedAt: Date.now()
      });
    }

    // Link the claimed session to the logged-in account. A challengeId is only saved from onChallenge,
    // which fires once its email is sent; an unsent challenge is not safe to resume.
    const user = userFromRequest(req);
    if (user && sessionId) {
      saveUser(user, { kidSessionId: sessionId });
    }

    res.json({
      success: true,
      type,
      status,
      sessionId,
      challengeId
    });
  } catch (err) {
    console.error('[k-ID Server] Error during claim:', err);
    res.status(500).json({ error: 'Internal server error claiming token', details: err.message });
  }
});

// 3. onSession notification & challenge verification endpoint
// When onSession fires in the app, the backend calls GET https://kai-api.test.k-id.com/api/v1/challenge/get-status
app.post('/api/session-sync', async (req, res) => {
  try {
    const { sessionId } = req.body || {};
    const secretKey = process.env.KID_SECRET_KEY;

    if (!secretKey) {
      return res.status(503).json({
        error: 'KID_SECRET_KEY is not configured on the server.'
      });
    }

    const savedChallengeId = playerAccounts.latestChallengeId;

    if (savedChallengeId) {
      console.log(`[k-ID Server] Checking status for saved challengeId: ${savedChallengeId}`);
      const statusRes = await fetch(
        `https://kai-api.test.k-id.com/api/v1/challenge/get-status?challengeId=${encodeURIComponent(savedChallengeId)}`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${secretKey}`
          }
        }
      );

      if (statusRes.ok) {
        const statusData = await statusRes.json();
        console.log('[k-ID Server] Challenge get-status response:', statusData);

        // On PASS, save the sessionId it returns and unlock server features
        if (statusData.status === 'PASS' && statusData.sessionId) {
          playerAccounts.records.set(statusData.sessionId, {
            ...statusData,
            unlocked: true,
            updatedAt: Date.now()
          });
          playerAccounts.latestSessionId = statusData.sessionId;
          return res.json({ success: true, status: 'PASS', sessionId: statusData.sessionId });
        }

        // On anything else, keep waiting for the app's next signal
        return res.json({ success: false, status: statusData.status || 'WAITING' });
      }
    }

    // If session was already directly claimed and passed
    if (sessionId && playerAccounts.records.has(sessionId)) {
      const rec = playerAccounts.records.get(sessionId);
      return res.json({ success: true, status: rec.status, sessionId });
    }

    res.json({ success: true, status: 'RECEIVED', sessionId });
  } catch (err) {
    console.error('[k-ID Server] Error during session sync:', err);
    res.status(500).json({ error: 'Internal server error syncing session', details: err.message });
  }
});

// 4. Session info retrieval endpoint
// GET https://kai-api.test.k-id.com/api/v1/session/get?sessionId=...
app.get('/api/session', async (req, res) => {
  try {
    const { sessionId } = req.query;
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId query parameter is required' });
    }

    const secretKey = process.env.KID_SECRET_KEY;
    if (!secretKey) {
      return res.status(503).json({ error: 'KID_SECRET_KEY is not configured on the server.' });
    }

    const sessionRes = await fetch(
      `https://kai-api.test.k-id.com/api/v1/session/get?sessionId=${encodeURIComponent(sessionId)}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${secretKey}`
        }
      }
    );

    const sessionData = await sessionRes.json();
    res.status(sessionRes.status).json(sessionData);
  } catch (err) {
    console.error('[k-ID Server] Error retrieving session:', err);
    res.status(500).json({ error: 'Failed to retrieve session from k-ID', details: err.message });
  }
});

// 5. Session deletion endpoint
// POST {"sessionId": "..."} to https://kai-api.test.k-id.com/api/v1/session/delete
app.post('/api/session/delete', async (req, res) => {
  try {
    const { sessionId } = req.body || {};
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const secretKey = process.env.KID_SECRET_KEY;
    if (!secretKey) {
      return res.status(503).json({ error: 'KID_SECRET_KEY is not configured on the server.' });
    }

    const deleteRes = await fetch('https://kai-api.test.k-id.com/api/v1/session/delete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${secretKey}`
      },
      body: JSON.stringify({ sessionId })
    });

    // Remove from in-memory records
    playerAccounts.records.delete(sessionId);
    if (playerAccounts.latestSessionId === sessionId) {
      playerAccounts.latestSessionId = null;
    }

    const deleteData = await deleteRes.json().catch(() => ({}));
    res.json({ success: true, message: 'Session deleted successfully', data: deleteData });
  } catch (err) {
    console.error('[k-ID Server] Error deleting session:', err);
    res.status(500).json({ error: 'Failed to delete session', details: err.message });
  }
});

// 6. Accounts
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { displayName, email, username, password } = req.body || {};
    const name = String(displayName || '').trim();
    const normalizedEmail = email ? String(email).trim().toLowerCase() : null;
    const normalizedUsername = username ? String(username).trim().toLowerCase() : null;

    if (!name || name.length > 40) {
      return res.status(400).json({ error: 'Please enter a name (up to 40 characters).' });
    }
    if (!normalizedEmail && !normalizedUsername) {
      return res.status(400).json({ error: 'Please enter an email or a username.' });
    }
    if (normalizedEmail && !EMAIL_PATTERN.test(normalizedEmail)) {
      return res.status(400).json({ error: 'That email address does not look right.' });
    }
    if (normalizedUsername && !USERNAME_PATTERN.test(normalizedUsername)) {
      return res.status(400).json({ error: 'Usernames are 3-30 letters, numbers, dots, dashes or underscores.' });
    }
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'Passwords need at least 8 characters.' });
    }
    if (findUserByLogin(normalizedEmail) || findUserByLogin(normalizedUsername)) {
      return res.status(409).json({ error: 'An account with that email or username already exists.' });
    }

    const { salt, passwordHash } = await hashPassword(password);
    const user = {
      id: randomUUID(),
      displayName: name,
      email: normalizedEmail,
      username: normalizedUsername,
      passwordHash,
      salt,
      kidSessionId: null,
      kidChallengeId: null,
      settingsChallengeId: null,
      adultVerified: false,
      invitedBy: null,
      createdAt: new Date().toISOString()
    };
    db.users[user.id] = user;
    persist();

    res.status(201).json({ token: issueToken(user.id) });
  } catch (err) {
    console.error('[Auth] Signup error:', err);
    res.status(500).json({ error: 'Could not create the account.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { identifier, password } = req.body || {};
    const user = findUserByLogin(identifier);
    if (!user || typeof password !== 'string' || !(await verifyPassword(password, user))) {
      return res.status(401).json({ error: 'Wrong email/username or password.' });
    }
    res.json({ token: issueToken(user.id) });
  } catch (err) {
    console.error('[Auth] Login error:', err);
    res.status(500).json({ error: 'Could not log in.' });
  }
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  revokeToken(req.authToken);
  res.json({ success: true });
});

app.get('/api/me', requireAuth, async (req, res) => {
  const { user } = req;
  const family = getFamilyForUser(user.id);

  res.json({
    user: publicUser(user),
    family: family ? publicFamily(family) : null,
    isAdmin: isFamilyAdmin(family, user.id),
    ageMode: await resolveAgeMode(user)
  });
});

// Persist the k-ID ids from onSession / onChallenge on the account, so they follow the user across devices
app.post('/api/me/kid-session', requireAuth, (req, res) => {
  const fields = { sessionId: 'kidSessionId', challengeId: 'kidChallengeId', settingsChallengeId: 'settingsChallengeId' };
  const updates = {};

  for (const [bodyKey, userKey] of Object.entries(fields)) {
    const value = req.body?.[bodyKey];
    if (value === undefined) continue;
    if (value !== null && typeof value !== 'string') {
      return res.status(400).json({ error: `${bodyKey} must be a string or null` });
    }
    updates[userKey] = value;
  }

  const user = saveUser(req.user, updates);
  res.json({ user: publicUser(user) });
});

// Confirm k-ID adult verification server-side; the client's word is never enough
app.post('/api/me/verify-adult', requireAuth, async (req, res) => {
  try {
    if (!process.env.KID_SECRET_KEY) {
      return res.status(503).json({ error: 'KID_SECRET_KEY is not configured on the server.' });
    }
    if (!req.user.kidSessionId) {
      return res.status(409).json({ error: 'Finish the k-ID age check first.' });
    }

    const { ok, status, session } = await fetchKidSession(req.user.kidSessionId);
    if (!ok) {
      return res.status(502).json({ error: 'Could not read your k-ID session.', status });
    }

    const verifiedAge = session?.ageVerification?.verifiedAge;
    const adultVerified = typeof verifiedAge === 'number' && verifiedAge >= 18;
    const user = saveUser(req.user, { adultVerified });
    ageModeCache.delete(user.kidSessionId);

    res.json({ adultVerified, user: publicUser(user) });
  } catch (err) {
    console.error('[k-ID Server] Adult verification check failed:', err);
    res.status(500).json({ error: 'Could not confirm adult verification.' });
  }
});

// 7. Families
app.post('/api/families', requireAuth, (req, res) => {
  const { user } = req;
  const name = String(req.body?.name || '').trim();

  if (getFamilyForUser(user.id)) {
    return res.status(409).json({ error: 'You are already in a family.' });
  }
  if (!user.adultVerified) {
    return res.status(403).json({ error: 'Only k-ID verified adults can create a family.', code: 'ADULT_VERIFICATION_REQUIRED' });
  }
  if (!user.email) {
    return res.status(400).json({ error: 'Family admins need an email address so k-ID consent requests can reach them.' });
  }
  if (!name || name.length > 50) {
    return res.status(400).json({ error: 'Please enter a family name (up to 50 characters).' });
  }

  const now = new Date().toISOString();
  const family = {
    id: randomUUID(),
    name,
    createdAt: now,
    members: { [user.id]: { role: 'admin', invitedBy: null, joinedAt: now } }
  };
  db.families[family.id] = family;
  persist();

  res.status(201).json({ family: publicFamily(family) });
});

app.post('/api/families/invites', requireAuth, (req, res) => {
  const family = getFamilyForUser(req.user.id);
  if (!isFamilyAdmin(family, req.user.id)) {
    return res.status(403).json({ error: 'Only family admins can invite people.' });
  }
  if (!req.user.email) {
    return res.status(400).json({ error: 'Add an email to your account before inviting, so consent requests can reach you.' });
  }

  const token = randomToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();
  db.invites[token] = { familyId: family.id, invitedBy: req.user.id, expiresAt };
  persist();

  res.status(201).json({ token, expiresAt });
});

app.get('/api/invites/:token', (req, res) => {
  const invite = getValidInvite(req.params.token);
  if (!invite) {
    return res.status(404).json({ error: 'This invite link is invalid or has expired.' });
  }
  res.json({
    familyName: db.families[invite.familyId].name,
    invitedByName: getUser(invite.invitedBy)?.displayName || 'A family admin'
  });
});

app.post('/api/invites/:token/accept', requireAuth, (req, res) => {
  const invite = getValidInvite(req.params.token);
  if (!invite) {
    return res.status(404).json({ error: 'This invite link is invalid or has expired.' });
  }

  const currentFamily = getFamilyForUser(req.user.id);
  if (currentFamily) {
    return res.status(409).json({ error: `You are already in ${currentFamily.name}. Leave it first to join another family.` });
  }

  const family = db.families[invite.familyId];
  db.families[family.id] = {
    ...family,
    members: {
      ...family.members,
      [req.user.id]: { role: 'member', invitedBy: invite.invitedBy, joinedAt: new Date().toISOString() }
    }
  };
  delete db.invites[req.params.token];
  saveUser(req.user, { invitedBy: invite.invitedBy });

  res.json({ family: publicFamily(db.families[family.id]) });
});

app.patch('/api/families/members/:userId', requireAuth, (req, res) => {
  const family = getFamilyForUser(req.user.id);
  const targetId = req.params.userId;
  const { role } = req.body || {};

  if (!isFamilyAdmin(family, req.user.id)) {
    return res.status(403).json({ error: 'Only family admins can change roles.' });
  }
  if (!family.members[targetId]) {
    return res.status(404).json({ error: 'That person is not in your family.' });
  }
  if (!['admin', 'member'].includes(role)) {
    return res.status(400).json({ error: 'role must be "admin" or "member"' });
  }
  if (role === 'admin' && !getUser(targetId)?.adultVerified) {
    return res.status(400).json({ error: 'Only k-ID verified adults can be family admins.' });
  }
  if (role === 'member' && family.members[targetId].role === 'admin' && adminCount(family) === 1) {
    return res.status(400).json({ error: 'A family needs at least one admin. Make someone else admin first.' });
  }

  db.families[family.id] = {
    ...family,
    members: { ...family.members, [targetId]: { ...family.members[targetId], role } }
  };
  persist();

  res.json({ family: publicFamily(db.families[family.id]) });
});

// Admins can remove anyone; anyone can remove themselves (leave)
app.delete('/api/families/members/:userId', requireAuth, (req, res) => {
  const family = getFamilyForUser(req.user.id);
  const targetId = req.params.userId;

  if (!family || !family.members[targetId]) {
    return res.status(404).json({ error: 'That person is not in your family.' });
  }
  if (targetId !== req.user.id && !isFamilyAdmin(family, req.user.id)) {
    return res.status(403).json({ error: 'Only family admins can remove people.' });
  }

  const remaining = { ...family.members };
  delete remaining[targetId];

  if (Object.keys(remaining).length === 0) {
    // Last one out: drop the family and its pending invites
    delete db.families[family.id];
    delete db.chores[family.id];
    for (const [token, invite] of Object.entries(db.invites)) {
      if (invite.familyId === family.id) delete db.invites[token];
    }
    persist();
    return res.json({ family: null });
  }

  if (family.members[targetId].role === 'admin' && adminCount(family) === 1) {
    return res.status(400).json({ error: 'A family needs at least one admin. Make someone else admin first.' });
  }

  db.families[family.id] = { ...family, members: remaining };
  persist();

  res.json({ family: targetId === req.user.id ? null : publicFamily(db.families[family.id]) });
});

// 8. Shared family chores: one list per family in the local store, so every member sees the same board

// The family's chores; a family's first read starts it with the built-in chores
function familyChores(family) {
  if (!db.chores[family.id]) {
    db.chores[family.id] = structuredClone(SEED_CHORES);
    persist();
  }
  return db.chores[family.id];
}

function saveFamilyChores(family, chores) {
  db.chores[family.id] = chores;
  persist();
  return chores;
}

// Change one stored chore, if it is still on the board (it may have been deleted meanwhile)
function updateStoredChore(familyId, choreId, updates) {
  const chores = db.chores[familyId];
  if (!chores?.some(c => c.id === choreId)) return;
  db.chores[familyId] = chores.map(c => (c.id === choreId ? { ...c, ...updates } : c));
  persist();
}

// Background AI for a new chore: steps for its age group, then a kid picture guide when a kid in the
// family has AI Media Generation on. Results land on the stored chore; clients pick them up when they sync.
async function generateChoreGuide(user, familyId, chore) {
  try {
    const { byAge } = await generateInstructions({ title: chore.title, assignees: [chore.assignee], notes: null });
    const set = byAge[chore.assignee];
    if (!set) throw new Error('Gemini did not return instructions');
    updateStoredChore(familyId, chore.id, { steps: set.steps, tip: set.tip, safety: set.safety, instructionsStatus: 'ready' });

    if (chore.assignee === 'kid' && await familyKidHasPermission(user, 'ai-media-generation')) {
      updateStoredChore(familyId, chore.id, { posterStatus: 'pending' });
      try {
        const { imageUrl } = await generateChorePoster({ title: chore.title, steps: set.steps.slice(0, 5) });
        updateStoredChore(familyId, chore.id, { posterUrl: imageUrl, posterStatus: 'ready' });
      } catch (err) {
        console.warn(`[AI] Poster for chore ${chore.id} failed: ${err.message}`);
        updateStoredChore(familyId, chore.id, { posterStatus: 'failed' });
      }
    }
  } catch (err) {
    console.warn(`[AI] Instructions for chore ${chore.id} failed: ${err.message}`);
    updateStoredChore(familyId, chore.id, { instructionsStatus: 'failed' });
  }
}

// The caller's family and age mode for chore rules. Without a k-ID secret (local dev) everyone counts as an adult.
async function choreContext(req, res) {
  const family = getFamilyForUser(req.user.id);
  if (!family) {
    res.status(404).json({ error: 'Join or create a family to share chores.' });
    return null;
  }
  const ageMode = (await resolveAgeMode(req.user)) ?? (process.env.KID_SECRET_KEY ? null : 'adult');
  if (!ageMode) {
    res.status(403).json({ error: 'Finish the k-ID age check to use the family chores.', status: 'LOCKED' });
    return null;
  }
  return { family, ageMode };
}

app.get('/api/chores', requireAuth, async (req, res) => {
  const ctx = await choreContext(req, res);
  if (!ctx) return;
  res.json({ chores: familyChores(ctx.family) });
});

// Same rules as the app: adults add chores for anyone, teens only for themselves, kids don't add chores
app.post('/api/chores', requireAuth, async (req, res) => {
  const ctx = await choreContext(req, res);
  if (!ctx) return;

  const title = String(req.body?.title || '').trim();
  const { assignee, emoji, points } = req.body || {};
  if (!title || title.length > 100) {
    return res.status(400).json({ error: 'Please enter a chore title (up to 100 characters).' });
  }
  if (!AGE_MODES.includes(assignee)) {
    return res.status(400).json({ error: `assignee must be one of ${AGE_MODES.join(', ')}.` });
  }
  if (!(ctx.ageMode === 'adult' || (ctx.ageMode === 'teen' && assignee === 'teen'))) {
    return res.status(403).json({ error: 'You can\'t add chores for this family member.' });
  }

  const chore = {
    id: randomUUID(),
    emoji: typeof emoji === 'string' && emoji.trim() && emoji.trim().length <= 8 ? emoji.trim() : '📝',
    title,
    assignee,
    points: assignee === 'adult' ? 0 : Number.isInteger(points) ? Math.min(Math.max(points, 0), 100) : 15,
    done: false,
    steps: [],
    instructionsStatus: 'pending',
    createdBy: req.user.id,
    createdAt: new Date().toISOString()
  };
  saveFamilyChores(ctx.family, [...familyChores(ctx.family), chore]);
  res.status(201).json({ chore });

  generateChoreGuide(req.user, ctx.family.id, chore);
});

// Try the AI instructions again after a failure (Gemini is often busy). Same people who could add the chore.
app.post('/api/chores/:id/instructions', requireAuth, async (req, res) => {
  const ctx = await choreContext(req, res);
  if (!ctx) return;

  const chore = familyChores(ctx.family).find(c => String(c.id) === req.params.id);
  if (!chore) {
    return res.status(404).json({ error: 'That chore is no longer on the board.' });
  }
  if (!(ctx.ageMode === 'adult' || (ctx.ageMode === 'teen' && chore.assignee === 'teen'))) {
    return res.status(403).json({ error: 'You can\'t change this chore.' });
  }
  if (chore.instructionsStatus === 'pending') {
    return res.json({ chore });
  }

  updateStoredChore(ctx.family.id, chore.id, { instructionsStatus: 'pending', posterStatus: null });
  res.json({ chore: { ...chore, instructionsStatus: 'pending', posterStatus: null } });

  generateChoreGuide(req.user, ctx.family.id, chore);
});

// Ticking a chore off: adults can tick any chore, everyone else only their own age group's
app.patch('/api/chores/:id', requireAuth, async (req, res) => {
  const ctx = await choreContext(req, res);
  if (!ctx) return;

  const { done } = req.body || {};
  if (typeof done !== 'boolean') {
    return res.status(400).json({ error: 'done must be true or false.' });
  }
  const chores = familyChores(ctx.family);
  const chore = chores.find(c => String(c.id) === req.params.id);
  if (!chore) {
    return res.status(404).json({ error: 'That chore is no longer on the board.' });
  }
  if (ctx.ageMode !== 'adult' && chore.assignee !== ctx.ageMode) {
    return res.status(403).json({ error: 'That chore belongs to someone else.' });
  }

  const updated = { ...chore, done };
  saveFamilyChores(ctx.family, chores.map(c => (c === chore ? updated : c)));
  res.json({ chore: updated });
});

app.delete('/api/chores/:id', requireAuth, async (req, res) => {
  const ctx = await choreContext(req, res);
  if (!ctx) return;
  if (ctx.ageMode !== 'adult') {
    return res.status(403).json({ error: 'Only adults can remove chores.' });
  }
  const chores = familyChores(ctx.family);
  saveFamilyChores(ctx.family, chores.filter(c => String(c.id) !== req.params.id));
  res.json({ success: true });
});

// "New day": uncheck every chore for the family
app.post('/api/chores/new-day', requireAuth, async (req, res) => {
  const ctx = await choreContext(req, res);
  if (!ctx) return;
  if (ctx.ageMode !== 'adult') {
    return res.status(403).json({ error: 'Only adults can start a new day.' });
  }
  res.json({ chores: saveFamilyChores(ctx.family, familyChores(ctx.family).map(c => ({ ...c, done: false }))) });
});

// 2. k-ID widget URL generation endpoint (Modular Placeholder Slot)
app.post('/widget/generate-e2e-url', async (req, res) => {
  try {
    const { redirectUrl, flowType } = req.body || {};
    
    // Check if custom k-ID credentials / API URL are provided in environment
    const kidApiUrl = process.env.KID_API_URL;
    const kidClientId = process.env.KID_CLIENT_ID;
    const kidClientSecret = process.env.KID_CLIENT_SECRET;

    if (kidApiUrl && kidClientId && kidClientSecret) {
      const kidResponse = await fetch(`${kidApiUrl}/v1/age-gate/e2e-url`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${kidClientSecret}`,
          'X-Client-Id': kidClientId
        },
        body: JSON.stringify({
          redirect_url: redirectUrl,
          flow: flowType || 'age_gate'
        })
      });

      if (kidResponse.ok) {
        const kidData = await kidResponse.json();
        return res.json(kidData);
      }
    }

    // Default Sandbox / Mock URL for k-ID widget iframe slot
    const mockSessionId = 'kid_sess_' + Math.random().toString(36).substring(2, 10);
    const sandboxUrl = process.env.KID_SANDBOX_URL || `/widget-sandbox.html?session=${mockSessionId}`;

    res.json({
      url: sandboxUrl,
      sessionId: mockSessionId,
      status: 'success',
      isSandbox: true
    });
  } catch (error) {
    console.error('Error in /widget/generate-e2e-url:', error);
    res.status(500).json({ error: 'Failed to generate k-ID widget URL', details: error.message });
  }
});

// Who is asking and at what age. Unlock nothing on the server until the logged-in user's own k-ID
// session checks out, and take the age mode from that session rather than from the request body.
// The demo bypass (mockBypass or a demo_ session id) keeps the body's age mode and allows every permission.
async function resolveRequestAgeMode(req) {
  const { ageMode = 'adult', sessionId, mockBypass } = req.body || {};
  const asMode = (mode) => (AGE_MODES.includes(mode) ? mode : 'adult');

  if (mockBypass || (typeof sessionId === 'string' && sessionId.startsWith('demo_'))) {
    return { ageMode: asMode(ageMode), can: () => true, user: null };
  }

  const user = userFromRequest(req);
  if (!user) {
    return { error: { status: 401, body: { error: 'Please log in to continue.' } } };
  }
  if (!process.env.KID_SECRET_KEY) {
    return { ageMode: asMode(ageMode), can: () => true, user };
  }

  const profile = await resolveKidProfile(user);
  if (!profile) {
    return {
      error: {
        status: 403,
        body: { error: 'Access locked: This action requires a verified k-ID session with a completed server claim.', status: 'LOCKED' }
      }
    };
  }
  // k-ID permissions are parental controls for minors; adults can use every AI feature
  return { ageMode: profile.mode, can: (name) => profile.mode === 'adult' || profile.permissions[name] === true, user };
}

// Whether any kid in the user's family has a k-ID permission on, read from each kid's own session
async function familyKidHasPermission(user, name) {
  const family = getFamilyForUser(user.id);
  if (!family) return false;
  const profiles = await Promise.all(Object.keys(family.members).map(userId => resolveKidProfile(getUser(userId))));
  return profiles.some(profile => profile?.mode === 'kid' && profile.permissions[name] === true);
}

// Shared tail for the AI routes: bad input is a 400, a Gemini outage a 502
function sendAiError(res, err, label) {
  if (err instanceof InputError) return res.status(400).json({ error: err.message });
  if (err instanceof ImageError) return res.status(err.status).json({ error: err.message });
  if (err instanceof GeminiUnavailableError) return res.status(502).json({ error: err.message, details: err.details });
  console.error(`Error in ${label}:`, err);
  res.status(500).json({ error: 'Internal server error processing request', details: err.message });
}

// 3. Gemini API ask endpoint (gated by k-ID server-side claim verification)
app.post('/api/ask', async (req, res) => {
  try {
    const { message } = req.body;

    if (!message || typeof message !== 'string' || message.trim() === '') {
      return res.status(400).json({ error: 'Message is required' });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({
        error: 'GEMINI_API_KEY is not configured on the server. Please set GEMINI_API_KEY in .env or Cloud Run environment variables.'
      });
    }

    const access = await resolveRequestAgeMode(req);
    if (access.error) return res.status(access.error.status).json(access.error.body);
    if (!access.can('ai-chat')) {
      return res.status(403).json({ error: 'AI chat is turned off for this account.', code: 'PERMISSION_REQUIRED' });
    }
    const validAgeMode = access.ageMode;

    const { candidate, model } = await callGemini({
      systemInstruction: {
        parts: [{ text: SYSTEM_PROMPTS[validAgeMode] }]
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: message.trim() }]
        }
      ],
      generationConfig: chatGenerationConfig(validAgeMode)
    });

    const replyText = candidateText(candidate);
    if (!replyText) {
      throw new GeminiUnavailableError(`${model} returned no text`);
    }

    res.json({
      reply: replyText,
      ageMode: validAgeMode,
      modelUsed: model
    });
  } catch (error) {
    sendAiError(res, error, '/api/ask');
  }
});

// 4. AI chore instructions: one set of steps per assigned age group, generated in the background on add
app.post('/api/ai/chore-instructions', async (req, res) => {
  try {
    const input = parseInstructionsInput(req.body);
    const access = await resolveRequestAgeMode(req);
    if (access.error) return res.status(access.error.status).json(access.error.body);

    // Same rules as adding a chore: adults assign anyone, teens only themselves, kids don't add chores
    const allowed = access.ageMode === 'adult' || (access.ageMode === 'teen' && input.assignees.every(mode => mode === 'teen'));
    if (!allowed) {
      return res.status(403).json({ error: 'You can\'t add chores for these family members.' });
    }

    const result = await generateInstructions(input);
    if (Object.keys(result.byAge).length === 0) {
      return res.status(502).json({ error: 'Could not write instructions right now.', failed: result.failed });
    }
    res.json(result);
  } catch (err) {
    sendAiError(res, err, '/api/ai/chore-instructions');
  }
});

// 5. AI kid poster: a picture guide made from the kid steps, only when a kid in the family has AI Media Generation on
app.post('/api/ai/chore-image', async (req, res) => {
  try {
    const input = parseImageInput(req.body);
    const access = await resolveRequestAgeMode(req);
    if (access.error) return res.status(access.error.status).json(access.error.body);

    if (access.user && !(await familyKidHasPermission(access.user, 'ai-media-generation'))) {
      return res.status(403).json({ error: 'No kid in this family has AI pictures turned on.', code: 'PERMISSION_REQUIRED' });
    }

    res.json(await generateChorePoster(input));
  } catch (err) {
    sendAiError(res, err, '/api/ai/chore-image');
  }
});

// 6. AI task chat: questions and tips about one chore, only with the AI Chat permission
app.post('/api/ai/task-chat', async (req, res) => {
  try {
    const input = parseTaskChatInput(req.body);
    const access = await resolveRequestAgeMode(req);
    if (access.error) return res.status(access.error.status).json(access.error.body);

    if (!access.can('ai-chat')) {
      return res.status(403).json({ error: 'AI chat is turned off for this account.', code: 'PERMISSION_REQUIRED' });
    }

    res.json(await runTaskChat(access.ageMode, input));
  } catch (err) {
    sendAiError(res, err, '/api/ai/task-chat');
  }
});

// 7. AI parent assistant: adult chat that can propose chores; the client asks the parent before adding them
app.post('/api/ai/parent-assistant', async (req, res) => {
  try {
    const input = parseParentAssistantInput(req.body);
    const access = await resolveRequestAgeMode(req);
    if (access.error) return res.status(access.error.status).json(access.error.body);

    if (access.ageMode !== 'adult') {
      return res.status(403).json({ error: 'Only adults can add chores from the chat.' });
    }

    res.json(await runParentAssistant(input));
  } catch (err) {
    sendAiError(res, err, '/api/ai/parent-assistant');
  }
});

// Generated picture guides (data/images until Firebase Storage takes over)
app.use(IMAGES_URL_PREFIX, express.static(IMAGES_DIR));

// Serve static frontend files from client/dist
const clientDistPath = path.join(__dirname, 'client', 'dist');
if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));

  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
} else {
  app.get('/', (req, res) => {
    res.send(`<h1>Backend running. Run npm run build to compile frontend.</h1>`);
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`===============================================`);
  console.log(`🏠 Home Helper server running on http://0.0.0.0:${PORT}`);
  console.log(`🚀 Ready for Cloud Run & Local Demo`);
  console.log(`===============================================`);
});
