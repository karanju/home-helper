import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { callGemini, candidateText, GeminiUnavailableError } from './ai/gemini.js';
import { AGE_MODES, SYSTEM_PROMPTS, chatGenerationConfig } from './ai/prompts.js';
import { InputError } from './ai/validate.js';
import { generateInstructions, parseInstructionsInput } from './ai/instructions.js';
import { generateChorePoster, parseImageInput, ImageError } from './ai/images.js';
import { parseTaskChatInput, runTaskChat } from './ai/taskChat.js';
import { parseParentAssistantInput, runParentAssistant } from './ai/parentAssistant.js';

// Load .env before store.js reads FIREBASE_* at import time
dotenv.config();

const {
  isFirebaseConfigured,
  HttpError,
  getUser,
  saveUser,
  getFamilyForUser,
  isFamilyAdmin,
  createFamily,
  updateFamilyMembers,
  createInvite,
  getValidInvite,
  acceptInvite,
  listChores,
  getChore,
  createChore,
  updateChore,
  deleteChore,
  deleteChoresAssignedTo
} = await import('./store.js');
const { userFromRequest, requireAuth } = await import('./auth.js');

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

function publicUser(user) {
  return {
    id: user.id,
    displayName: user.displayName,
    email: user.email,
    photoURL: user.photoURL,
    adultVerified: user.adultVerified,
    kidSessionId: user.kidSessionId,
    kidChallengeId: user.kidChallengeId,
    settingsChallengeId: user.settingsChallengeId
  };
}

// Each member's age mode comes from their own k-ID session, so the chore list can show and filter by person
async function publicFamily(family) {
  const members = await Promise.all(
    Object.entries(family.members).map(async ([userId, member]) => {
      const user = await getUser(userId);
      return {
        userId,
        displayName: user?.displayName || 'Unknown',
        photoURL: user?.photoURL || null,
        role: member.role,
        adultVerified: Boolean(user?.adultVerified),
        ageMode: user ? await resolveAgeMode(user) : null,
        joinedAt: member.joinedAt
      };
    })
  );
  return { id: family.id, name: family.name, members };
}

function adminCount(members) {
  return Object.values(members).filter((m) => m.role === 'admin').length;
}

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Express 4 doesn't forward rejected promises to the error handler on its own
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

// 1. Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    service: 'home-helper',
    hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
    hasKidSecretKey: Boolean(process.env.KID_SECRET_KEY),
    hasFirebase: isFirebaseConfigured
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
    const user = await userFromRequest(req);
    if (user && sessionId) {
      await saveUser(user, { kidSessionId: sessionId });
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

// 6. Accounts: Google sign-in through Firebase Auth. Signing out happens in the browser only.
app.get('/api/firebase-config', (req, res) => {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!isFirebaseConfigured || !process.env.FIREBASE_API_KEY || !process.env.FIREBASE_APP_ID) {
    return res.json({ configured: false });
  }
  // These values are public by design; access is enforced by ID-token checks on this server
  res.json({
    configured: true,
    config: {
      apiKey: process.env.FIREBASE_API_KEY,
      authDomain: process.env.FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com`,
      projectId,
      appId: process.env.FIREBASE_APP_ID
    }
  });
});

app.get('/api/me', requireAuth, asyncRoute(async (req, res) => {
  const { user } = req;
  const family = await getFamilyForUser(user.id);

  res.json({
    user: publicUser(user),
    family: family ? await publicFamily(family) : null,
    isAdmin: isFamilyAdmin(family, user.id),
    ageMode: await resolveAgeMode(user)
  });
}));

// Persist the k-ID ids from onSession / onChallenge on the account, so they follow the user across devices
app.post('/api/me/kid-session', requireAuth, asyncRoute(async (req, res) => {
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

  const user = Object.keys(updates).length ? await saveUser(req.user, updates) : req.user;
  res.json({ user: publicUser(user) });
}));

// Confirm k-ID adult verification server-side; the client's word is never enough
app.post('/api/me/verify-adult', requireAuth, asyncRoute(async (req, res) => {
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
  const user = await saveUser(req.user, { adultVerified });
  ageModeCache.delete(user.kidSessionId);

  res.json({ adultVerified, user: publicUser(user) });
}));

// 7. Families
app.post('/api/families', requireAuth, asyncRoute(async (req, res) => {
  const name = String(req.body?.name || '').trim();

  if (!req.user.adultVerified) {
    return res.status(403).json({ error: 'Only k-ID verified adults can create a family.', code: 'ADULT_VERIFICATION_REQUIRED' });
  }
  if (!name || name.length > 50) {
    return res.status(400).json({ error: 'Please enter a family name (up to 50 characters).' });
  }

  const family = await createFamily(req.user.id, name);
  res.status(201).json({ family: await publicFamily(family) });
}));

app.post('/api/families/invites', requireAuth, asyncRoute(async (req, res) => {
  const family = await getFamilyForUser(req.user.id);
  if (!isFamilyAdmin(family, req.user.id)) {
    return res.status(403).json({ error: 'Only family admins can invite people.' });
  }

  const { token, expiresAt } = await createInvite(family.id, req.user.id, INVITE_TTL_MS);
  res.status(201).json({ token, expiresAt });
}));

app.get('/api/invites/:token', asyncRoute(async (req, res) => {
  const invite = await getValidInvite(req.params.token);
  if (!invite) {
    return res.status(404).json({ error: 'This invite link is invalid or has expired.' });
  }
  const inviter = await getUser(invite.invitedBy);
  res.json({
    familyName: invite.family.name,
    invitedByName: inviter?.displayName || 'A family admin'
  });
}));

app.post('/api/invites/:token/accept', requireAuth, asyncRoute(async (req, res) => {
  const family = await acceptInvite(req.params.token, req.user);
  res.json({ family: await publicFamily(family) });
}));

app.patch('/api/families/members/:userId', requireAuth, asyncRoute(async (req, res) => {
  const family = await getFamilyForUser(req.user.id);
  const targetId = req.params.userId;
  const { role } = req.body || {};

  if (!isFamilyAdmin(family, req.user.id)) {
    return res.status(403).json({ error: 'Only family admins can change roles.' });
  }
  if (!['admin', 'member'].includes(role)) {
    return res.status(400).json({ error: 'role must be "admin" or "member"' });
  }
  if (role === 'admin' && !(await getUser(targetId))?.adultVerified) {
    return res.status(400).json({ error: 'Only k-ID verified adults can be family admins.' });
  }

  const updated = await updateFamilyMembers(family.id, (current) => {
    if (!isFamilyAdmin(current, req.user.id)) throw new HttpError(403, 'Only family admins can change roles.');
    const target = current.members[targetId];
    if (!target) throw new HttpError(404, 'That person is not in your family.');
    if (role === 'member' && target.role === 'admin' && adminCount(current.members) === 1) {
      throw new HttpError(400, 'A family needs at least one admin. Make someone else admin first.');
    }
    return { ...current.members, [targetId]: { ...target, role } };
  });

  res.json({ family: await publicFamily(updated) });
}));

// Admins can remove anyone; anyone can remove themselves (leave). The last one out deletes the family.
app.delete('/api/families/members/:userId', requireAuth, asyncRoute(async (req, res) => {
  const family = await getFamilyForUser(req.user.id);
  const targetId = req.params.userId;

  if (!family) {
    return res.status(404).json({ error: 'That person is not in your family.' });
  }
  if (targetId !== req.user.id && !isFamilyAdmin(family, req.user.id)) {
    return res.status(403).json({ error: 'Only family admins can remove people.' });
  }

  const updated = await updateFamilyMembers(family.id, (current) => {
    const target = current.members[targetId];
    if (!target) throw new HttpError(404, 'That person is not in your family.');

    const remaining = { ...current.members };
    delete remaining[targetId];
    if (Object.keys(remaining).length > 0 && target.role === 'admin' && adminCount(current.members) === 1) {
      throw new HttpError(400, 'A family needs at least one admin. Make someone else admin first.');
    }
    return remaining;
  });

  if (updated) await deleteChoresAssignedTo(family.id, targetId);
  res.json({ family: updated && targetId !== req.user.id ? await publicFamily(updated) : null });
}));

// 8. Family chores (families/{id}/chores in Firestore)
// Adults manage everything; teens add chores for themselves; everyone ticks off their own.
async function choreContext(req) {
  const family = await getFamilyForUser(req.user.id);
  if (!family) throw new HttpError(404, 'Join or create a family first.');
  // No age mode yet (k-ID check unfinished) means the most restrictive rules
  const ageMode = (await resolveAgeMode(req.user)) || 'kid';
  return { family, ageMode, isAdult: ageMode === 'adult' };
}

// A guide still "pending" after this long was cut off (e.g. a restart) and may be retried
const GUIDE_STALE_MS = 5 * 60 * 1000;

// Background AI for a new chore: steps for the assignee's age, then a kid picture guide when a kid in the
// family has AI Media Generation on. Results land on the stored chore; clients pick them up when they refresh.
async function generateChoreGuide(family, chore) {
  // The chore may be deleted while Gemini works; then there is nothing left to update
  const update = (fields) => updateChore(family.id, chore.id, fields).catch(err => {
    console.warn(`[AI] Could not update chore ${chore.id}: ${err.message}`);
  });

  try {
    const assignee = await getUser(chore.assigneeId);
    // No age yet (k-ID check unfinished) means the most restrictive instructions
    const ageMode = (assignee && await resolveAgeMode(assignee)) || 'kid';
    const { byAge } = await generateInstructions({ title: chore.title, assignees: [ageMode], notes: null });
    const set = byAge[ageMode];
    if (!set) throw new Error('Gemini did not return instructions');
    await update({ steps: set.steps, tip: set.tip, safety: set.safety, instructionsStatus: 'ready' });

    // A failed permission lookup only skips the picture; the instructions are already saved
    const allowPoster = ageMode === 'kid' && await familyKidHasPermission(family, 'ai-media-generation').catch(() => false);
    if (allowPoster) {
      await update({ posterStatus: 'pending' });
      try {
        const { imageUrl } = await generateChorePoster({ title: chore.title, steps: set.steps.slice(0, 5) });
        await update({ posterUrl: imageUrl, posterStatus: 'ready' });
      } catch (err) {
        console.warn(`[AI] Poster for chore ${chore.id} failed: ${err.message}`);
        await update({ posterStatus: 'failed' });
      }
    }
  } catch (err) {
    console.warn(`[AI] Instructions for chore ${chore.id} failed: ${err.message}`);
    await update({ instructionsStatus: 'failed' });
  }
}

// Validates the editable chore fields present in `body`; returns only those, or throws HttpError
function readChoreFields(body, family) {
  const fields = {};
  if (body.title !== undefined) {
    const title = String(body.title).trim();
    if (!title || title.length > 80) throw new HttpError(400, 'Chore names are 1-80 characters.');
    fields.title = title;
  }
  if (body.assigneeId !== undefined) {
    if (!family.memberIds.includes(body.assigneeId)) throw new HttpError(400, 'Chores can only be assigned to family members.');
    fields.assigneeId = body.assigneeId;
  }
  if (body.emoji !== undefined) fields.emoji = String(body.emoji).slice(0, 8) || '📝';
  if (body.points !== undefined) {
    const points = Number(body.points);
    if (!Number.isInteger(points) || points < 0 || points > 100) throw new HttpError(400, 'Points must be a whole number from 0 to 100.');
    fields.points = points;
  }
  if (body.steps !== undefined) {
    if (!Array.isArray(body.steps)) throw new HttpError(400, 'steps must be a list.');
    fields.steps = body.steps.slice(0, 10).map((step) => String(step).slice(0, 200));
  }
  if (body.guideImage !== undefined) {
    // Only the app's own bundled illustrations
    fields.guideImage = typeof body.guideImage === 'string' && /^\/images\/[\w.-]+$/.test(body.guideImage) ? body.guideImage : null;
  }
  if (body.done !== undefined) fields.done = Boolean(body.done);
  return fields;
}

function publicChore(chore) {
  return {
    id: chore.id,
    title: chore.title,
    emoji: chore.emoji,
    assigneeId: chore.assigneeId,
    points: chore.points,
    done: chore.done,
    steps: chore.steps || [],
    guideImage: chore.guideImage || null,
    tip: chore.tip || null,
    safety: chore.safety || null,
    instructionsStatus: chore.instructionsStatus || null,
    posterUrl: chore.posterUrl || null,
    posterStatus: chore.posterStatus || null,
    createdBy: chore.createdBy,
    updatedAt: chore.updatedAt
  };
}

app.get('/api/families/chores', requireAuth, asyncRoute(async (req, res) => {
  const { family } = await choreContext(req);
  res.json({ chores: (await listChores(family.id)).map(publicChore) });
}));

app.post('/api/families/chores', requireAuth, asyncRoute(async (req, res) => {
  const { family, ageMode, isAdult } = await choreContext(req);
  if (!isAdult && ageMode !== 'teen') {
    return res.status(403).json({ error: 'Ask a grown-up to add chores.' });
  }

  const fields = readChoreFields({ assigneeId: req.user.id, ...req.body, done: false }, family);
  if (!fields.title) throw new HttpError(400, 'Chore names are 1-80 characters.');
  if (!isAdult && fields.assigneeId !== req.user.id) {
    return res.status(403).json({ error: 'Teens can only add chores for themselves.' });
  }

  // Chores picked from the ready-made ideas already have steps; the rest get AI instructions in the background
  const needsGuide = !fields.steps?.length;
  const chore = await createChore(family.id, {
    emoji: '📝',
    points: 15,
    steps: [],
    guideImage: null,
    ...fields,
    ...(needsGuide && { instructionsStatus: 'pending' }),
    createdBy: req.user.id
  });
  res.status(201).json({ chore: publicChore(chore) });

  if (needsGuide) generateChoreGuide(family, chore);
}));

// Try the AI instructions again after a failure (Gemini is often busy): adults, or the teen it belongs to
app.post('/api/families/chores/:id/instructions', requireAuth, asyncRoute(async (req, res) => {
  const { family, ageMode, isAdult } = await choreContext(req);
  const chore = await getChore(family.id, req.params.id);
  if (!chore) return res.status(404).json({ error: 'That chore no longer exists.' });
  if (!isAdult && !(ageMode === 'teen' && chore.assigneeId === req.user.id)) {
    return res.status(403).json({ error: 'You can\'t change this chore.' });
  }
  const stillWorking = chore.instructionsStatus === 'pending' && Date.now() - Date.parse(chore.updatedAt) < GUIDE_STALE_MS;
  if (stillWorking) return res.json({ chore: publicChore(chore) });

  const updated = await updateChore(family.id, chore.id, { instructionsStatus: 'pending', posterStatus: null });
  res.json({ chore: publicChore(updated) });

  generateChoreGuide(family, updated);
}));

app.patch('/api/families/chores/:id', requireAuth, asyncRoute(async (req, res) => {
  const { family, isAdult } = await choreContext(req);
  const chore = await getChore(family.id, req.params.id);
  if (!chore) return res.status(404).json({ error: 'That chore no longer exists.' });

  const fields = readChoreFields(req.body || {}, family);
  const onlyTogglingDone = Object.keys(fields).every((key) => key === 'done');
  if (!isAdult && !(onlyTogglingDone && chore.assigneeId === req.user.id)) {
    return res.status(403).json({ error: 'You can only tick off your own chores.' });
  }

  res.json({ chore: publicChore(await updateChore(family.id, chore.id, fields)) });
}));

app.delete('/api/families/chores/:id', requireAuth, asyncRoute(async (req, res) => {
  const { family, isAdult } = await choreContext(req);
  if (!isAdult) return res.status(403).json({ error: 'Only adults can remove chores.' });
  await deleteChore(family.id, req.params.id);
  res.json({ success: true });
}));

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

  const user = await userFromRequest(req);
  if (!user) {
    return { error: { status: 401, body: { error: 'Please sign in to continue.' } } };
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

// Whether any kid in the family has a k-ID permission on, read from each kid's own session
async function familyKidHasPermission(family, name) {
  const profiles = await Promise.all(family.memberIds.map(async (userId) => resolveKidProfile(await getUser(userId))));
  return profiles.some(profile => profile?.mode === 'kid' && profile.permissions[name] === true);
}

// Who the parent assistant can give chores to: the family's members, or the three age groups without a family
async function choreRoster(user) {
  const family = user && await getFamilyForUser(user.id);
  if (!family) {
    return AGE_MODES.map(mode => ({ id: mode, name: mode[0].toUpperCase() + mode.slice(1), ageMode: mode }));
  }
  const { members } = await publicFamily(family);
  return members.map(m => ({ id: m.userId, name: m.displayName.split(' ')[0], ageMode: m.ageMode || 'kid' }));
}

// Shared tail for the AI routes: bad input is a 400, a Gemini outage a 502
function sendAiError(res, err, label) {
  if (err instanceof InputError) return res.status(400).json({ error: err.message });
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
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

    const family = access.user && await getFamilyForUser(access.user.id);
    if (access.user && !(family && await familyKidHasPermission(family, 'ai-media-generation'))) {
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

    res.json(await runParentAssistant(input, await choreRoster(access.user)));
  } catch (err) {
    sendAiError(res, err, '/api/ai/parent-assistant');
  }
});

// Picture guides saved on disk before posters moved to Firebase Storage
app.use('/generated', express.static(path.join(__dirname, 'data', 'images')));

// Rule violations from the store (HttpError) become their own status; anything else is a 500
app.use((err, req, res, next) => {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, ...(err.code && { code: err.code }) });
  }
  console.error(`[Server] ${req.method} ${req.path} failed:`, err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
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
