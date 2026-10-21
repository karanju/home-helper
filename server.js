import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { db, persist, getUser, findUserByLogin, getFamilyForUser, isFamilyAdmin } from './store.js';
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

// Cache for list of candidate Flash models
let cachedFlashCandidates = [];
let lastCandidatesFetch = 0;
const CANDIDATES_CACHE_TTL = 30 * 60 * 1000; // 30 minutes
let lastWorkingModel = null;

// Helper to retrieve and sort current Flash models dynamically
async function getFlashModelCandidates(apiKey) {
  const now = Date.now();
  if (cachedFlashCandidates.length > 0 && (now - lastCandidatesFetch < CANDIDATES_CACHE_TTL)) {
    return cachedFlashCandidates;
  }

  try {
    const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    const response = await fetch(listUrl);
    if (!response.ok) {
      throw new Error(`Failed to list models: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    const models = data.models || [];

    // Filter for text generation Flash models
    const flashList = models
      .filter(m => {
        const name = (m.name || '').toLowerCase();
        const supportsGen = (m.supportedGenerationMethods || []).includes('generateContent');
        return supportsGen && name.includes('flash') && !name.includes('tts') && !name.includes('image');
      })
      .map(m => m.name.replace(/^models\//, ''));

    // Priority ordering: latest flash models, falling back to flash-lite-latest and earlier versions
    const preferredOrder = [
      'gemini-3.8-flash',
      'gemini-3.7-flash',
      'gemini-3.6-flash',
      'gemini-flash-latest',
      'gemini-flash-lite-latest',
      'gemini-3.5-flash',
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite',
      'gemini-2.5-flash-lite',
      'gemini-2.0-flash',
      'gemini-1.5-flash'
    ];

    flashList.sort((a, b) => {
      const idxA = preferredOrder.indexOf(a);
      const idxB = preferredOrder.indexOf(b);
      const rankA = idxA === -1 ? 999 : idxA;
      const rankB = idxB === -1 ? 999 : idxB;
      return rankA - rankB;
    });

    if (flashList.length > 0) {
      if (lastWorkingModel && flashList.includes(lastWorkingModel)) {
        flashList = [lastWorkingModel, ...flashList.filter(m => m !== lastWorkingModel)];
      }
      cachedFlashCandidates = flashList;
      lastCandidatesFetch = now;
      console.log(`[Gemini] Discovered ${flashList.length} dynamic Flash models. Active target: ${flashList[0]}`);
      return cachedFlashCandidates;
    }
  } catch (err) {
    console.warn(`[Gemini] Error fetching dynamic model list: ${err.message}`);
  }

  return ['gemini-flash-lite-latest', 'gemini-flash-latest', 'gemini-1.5-flash'];
}

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

// sessionId -> { mode, fetchedAt }, so chat messages don't each hit k-ID
const ageModeCache = new Map();
const AGE_MODE_CACHE_TTL = 5 * 60 * 1000;

// The user's age mode from their own k-ID session, or null when it can't be determined
async function resolveAgeMode(user) {
  if (!process.env.KID_SECRET_KEY || !user?.kidSessionId) return null;

  const cached = ageModeCache.get(user.kidSessionId);
  if (cached && Date.now() - cached.fetchedAt < AGE_MODE_CACHE_TTL) return cached.mode;

  try {
    const { ok, session } = await fetchKidSession(user.kidSessionId);
    if (!ok) return null;
    const mode = deriveAgeMode(session);
    ageModeCache.set(user.kidSessionId, { mode, fetchedAt: Date.now() });
    return mode;
  } catch (err) {
    console.warn('[k-ID Server] Age mode lookup error:', err.message);
    return null;
  }
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

// System prompts per age mode
const SYSTEM_PROMPTS = {
  kid: `You are "Buddy", a cheerful, encouraging household assistant for kids (ages 6-12).
Rules:
- Keep all answers short (1 to 3 sentences maximum), enthusiastic, and simple.
- Focus ONLY on simple life skills: putting toys away, making the bed, packing a backpack, washing hands.
- NEVER suggest using sharp knives, stoves, ovens, boiling water, electrical tools, or harsh cleaning chemicals.
- If the child asks an open-ended or non-chore question, gently guide them back to kid-friendly household activities or ask an adult.
- Use friendly emojis!`,

  teen: `You are "Chef & Home Guide", a supportive, practical household mentor for teenagers (ages 13-17).
Rules:
- Focus on teen culinary autonomy and household self-reliance: easy cooking, snack prep, basic laundry, meal planning.
- Always include clear SAFETY REMINDERS whenever heat, stoves, ovens, or knives are involved (e.g. "Remember to turn off the burner when done", "Use an oven mitt").
- Maintain healthy boundaries: no dangerous culinary experiments, alcohol, or unsafe kitchen practices.
- Tone: encouraging, step-by-step, realistic, and respectful.`,

  adult: `You are "Home Commander", an expert household management and culinary assistant for adults.
Rules:
- Full capability: advanced recipe ideas, meal planning, inventory management, chore scheduling, time management, and household tips.
- Provide comprehensive, well-structured, clear answers.
- Offer actionable advice, substitutions, and proactive tips.`
};

// 3. Gemini API ask endpoint (gated by k-ID server-side claim verification)
app.post('/api/ask', async (req, res) => {
  try {
    const { message, ageMode = 'adult', sessionId, mockBypass } = req.body;

    if (!message || typeof message !== 'string' || message.trim() === '') {
      return res.status(400).json({ error: 'Message is required' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: 'GEMINI_API_KEY is not configured on the server. Please set GEMINI_API_KEY in .env or Cloud Run environment variables.'
      });
    }

    // k-ID Server-side lock enforcement:
    // Unlock nothing on the server until the logged-in user's own k-ID session checks out,
    // and take the age mode from that session rather than from the request body
    let resolvedAgeMode = ageMode;
    if (!mockBypass && !sessionId?.startsWith('demo_')) {
      const user = userFromRequest(req);
      if (!user) {
        return res.status(401).json({ error: 'Please log in to continue.' });
      }

      if (process.env.KID_SECRET_KEY) {
        const sessionMode = await resolveAgeMode(user);
        if (!sessionMode) {
          return res.status(403).json({
            error: 'Access locked: This action requires a verified k-ID session with a completed server claim.',
            status: 'LOCKED'
          });
        }
        resolvedAgeMode = sessionMode;
      }
    }

    const validAgeMode = ['kid', 'teen', 'adult'].includes(resolvedAgeMode) ? resolvedAgeMode : 'adult';
    const systemPrompt = SYSTEM_PROMPTS[validAgeMode];

    // Discover dynamic Flash models list
    const candidates = await getFlashModelCandidates(apiKey);

    const geminiPayload = {
      systemInstruction: {
        parts: [{ text: systemPrompt }]
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: message.trim() }]
        }
      ],
      generationConfig: {
        temperature: validAgeMode === 'kid' ? 0.3 : 0.7,
        maxOutputTokens: validAgeMode === 'kid' ? 150 : 800
      }
    };

    let replyText = null;
    let modelUsed = null;
    let lastError = null;

    // Try candidates in priority order with graceful failover (e.g., if one returns 503 spike or 404)
    for (const model of candidates) {
      try {
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const geminiRes = await fetch(geminiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(geminiPayload)
        });

        if (geminiRes.ok) {
          const geminiData = await geminiRes.json();
          replyText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
          if (replyText) {
            modelUsed = model;
            lastWorkingModel = model;
            break;
          }
        } else {
          const errText = await geminiRes.text();
          console.warn(`[Gemini] Candidate ${model} returned ${geminiRes.status}: ${errText.substring(0, 100)}`);
          lastError = `${geminiRes.status}: ${errText}`;
        }
      } catch (err) {
        console.warn(`[Gemini] Candidate ${model} fetch error: ${err.message}`);
        lastError = err.message;
      }
    }

    if (!replyText) {
      return res.status(502).json({
        error: 'All Gemini Flash models are currently busy or unavailable.',
        details: lastError
      });
    }

    res.json({
      reply: replyText,
      ageMode: validAgeMode,
      modelUsed: modelUsed
    });
  } catch (error) {
    console.error('Error in /api/ask:', error);
    res.status(500).json({ error: 'Internal server error processing request', details: error.message });
  }
});

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
