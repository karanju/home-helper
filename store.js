import crypto from 'crypto';
import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

// Firestore is only reachable from the server (firestore.rules denies clients), so every rule lives here.
// Credentials come from Application Default Credentials: GOOGLE_APPLICATION_CREDENTIALS locally,
// the service's own identity on Cloud Run.
export const isFirebaseConfigured = Boolean(process.env.FIREBASE_PROJECT_ID);

let firestore = null;
let auth = null;

if (isFirebaseConfigured) {
  if (!getApps().length) {
    initializeApp({ credential: applicationDefault(), projectId: process.env.FIREBASE_PROJECT_ID });
  }
  firestore = getFirestore();
  auth = getAuth();
} else {
  console.warn('[Store] FIREBASE_PROJECT_ID is not set: sign-in, families and synced chores are disabled.');
}

// Thrown for rule violations (e.g. "last admin can't leave"); routes turn it into an HTTP response
export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function requireFirestore() {
  if (!firestore) throw new HttpError(503, 'Sign-in is not configured on this server.');
  return firestore;
}

export function verifyIdToken(idToken) {
  if (!auth) throw new HttpError(503, 'Sign-in is not configured on this server.');
  return auth.verifyIdToken(idToken);
}

const users = () => requireFirestore().collection('users');
const families = () => requireFirestore().collection('families');
const invites = () => requireFirestore().collection('invites');
const chores = (familyId) => families().doc(familyId).collection('chores');

const withId = (snap) => (snap.exists ? { id: snap.id, ...snap.data() } : null);

export function randomToken() {
  return crypto.randomBytes(32).toString('base64url');
}

// Users

export async function getUser(uid) {
  return withId(await users().doc(uid).get());
}

// Create the user on first sign-in; afterwards keep name/email/photo in step with their Google account
export async function upsertUserFromToken(decoded) {
  const ref = users().doc(decoded.uid);
  const profile = {
    displayName: decoded.name || decoded.email?.split('@')[0] || 'Family member',
    email: decoded.email || null,
    photoURL: decoded.picture || null
  };

  const existing = await ref.get();
  if (!existing.exists) {
    const user = {
      ...profile,
      kidSessionId: null,
      kidChallengeId: null,
      settingsChallengeId: null,
      adultVerified: false,
      invitedBy: null,
      createdAt: new Date().toISOString()
    };
    await ref.set(user);
    return { id: decoded.uid, ...user };
  }

  const current = existing.data();
  const changed = Object.keys(profile).some((key) => current[key] !== profile[key]);
  if (changed) await ref.update(profile);
  return { id: decoded.uid, ...current, ...profile };
}

export async function saveUser(user, updates) {
  await users().doc(user.id).update(updates);
  return { ...user, ...updates };
}

// Families

export async function getFamilyForUser(uid) {
  const snap = await families().where('memberIds', 'array-contains', uid).limit(1).get();
  return snap.empty ? null : withId(snap.docs[0]);
}

export function isFamilyAdmin(family, uid) {
  return family?.members?.[uid]?.role === 'admin';
}

export async function createFamily(uid, name) {
  const db = requireFirestore();
  const ref = families().doc();

  await db.runTransaction(async (tx) => {
    const existing = await tx.get(families().where('memberIds', 'array-contains', uid).limit(1));
    if (!existing.empty) throw new HttpError(409, 'You are already in a family.');

    const now = new Date().toISOString();
    tx.set(ref, {
      name,
      createdAt: now,
      memberIds: [uid],
      members: { [uid]: { role: 'admin', invitedBy: null, joinedAt: now } }
    });
  });

  return withId(await ref.get());
}

// Change a family's members atomically. `mutate(family)` returns the new members map or throws HttpError.
// An empty map deletes the family along with its pending invites. Returns the updated family, or null if deleted.
export async function updateFamilyMembers(familyId, mutate) {
  const db = requireFirestore();
  const ref = families().doc(familyId);

  const result = await db.runTransaction(async (tx) => {
    const family = withId(await tx.get(ref));
    if (!family) throw new HttpError(404, 'That family no longer exists.');

    const members = mutate(family);
    if (Object.keys(members).length === 0) {
      tx.delete(ref);
      return null;
    }
    tx.update(ref, { members, memberIds: Object.keys(members) });
    return { ...family, members, memberIds: Object.keys(members) };
  });

  if (result === null) {
    const pending = await invites().where('familyId', '==', familyId).get();
    await Promise.all(pending.docs.map((doc) => doc.ref.delete()));
  }
  return result;
}

// Invites

export async function createInvite(familyId, invitedBy, ttlMs) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  await invites().doc(token).set({ familyId, invitedBy, expiresAt });
  return { token, expiresAt };
}

export async function getValidInvite(token) {
  const invite = withId(await invites().doc(token).get());
  if (!invite || new Date(invite.expiresAt) < new Date()) return null;
  const family = withId(await families().doc(invite.familyId).get());
  return family ? { ...invite, family } : null;
}

// Join a family with a one-time invite; the invite is consumed in the same transaction
export async function acceptInvite(token, user) {
  const db = requireFirestore();
  const inviteRef = invites().doc(token);

  const familyId = await db.runTransaction(async (tx) => {
    const invite = withId(await tx.get(inviteRef));
    if (!invite || new Date(invite.expiresAt) < new Date()) {
      throw new HttpError(404, 'This invite link is invalid or has expired.');
    }

    const current = await tx.get(families().where('memberIds', 'array-contains', user.id).limit(1));
    if (!current.empty) {
      throw new HttpError(409, `You are already in ${current.docs[0].data().name}. Leave it first to join another family.`);
    }

    const familyRef = families().doc(invite.familyId);
    const family = withId(await tx.get(familyRef));
    if (!family) throw new HttpError(404, 'This invite link is invalid or has expired.');

    const members = {
      ...family.members,
      [user.id]: { role: 'member', invitedBy: invite.invitedBy, joinedAt: new Date().toISOString() }
    };
    tx.update(familyRef, { members, memberIds: Object.keys(members) });
    tx.delete(inviteRef);
    tx.update(users().doc(user.id), { invitedBy: invite.invitedBy });
    return invite.familyId;
  });

  return withId(await families().doc(familyId).get());
}

// Chores (families/{id}/chores)

export async function listChores(familyId) {
  const snap = await chores(familyId).orderBy('createdAt').get();
  return snap.docs.map(withId);
}

export async function getChore(familyId, choreId) {
  return withId(await chores(familyId).doc(choreId).get());
}

export async function createChore(familyId, chore) {
  const now = new Date().toISOString();
  const ref = await chores(familyId).add({ ...chore, createdAt: now, updatedAt: now });
  return withId(await ref.get());
}

export async function updateChore(familyId, choreId, updates) {
  const ref = chores(familyId).doc(choreId);
  await ref.update({ ...updates, updatedAt: new Date().toISOString() });
  return withId(await ref.get());
}

export async function deleteChore(familyId, choreId) {
  await chores(familyId).doc(choreId).delete();
}

// Drop chores assigned to someone who left, so they don't linger unassignable
export async function deleteChoresAssignedTo(familyId, uid) {
  const snap = await chores(familyId).where('assigneeId', '==', uid).get();
  await Promise.all(snap.docs.map((doc) => doc.ref.delete()));
}
