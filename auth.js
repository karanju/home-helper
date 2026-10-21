import crypto from 'crypto';
import { promisify } from 'util';
import { db, persist, getUser } from './store.js';

const scrypt = promisify(crypto.scrypt);
const KEY_LENGTH = 64;
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, KEY_LENGTH);
  return { salt, passwordHash: hash.toString('hex') };
}

export async function verifyPassword(password, user) {
  const expected = Buffer.from(user.passwordHash, 'hex');
  const actual = await scrypt(password, user.salt, KEY_LENGTH);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export function randomToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function issueToken(userId) {
  const token = randomToken();
  db.authTokens[token] = { userId, expiresAt: new Date(Date.now() + TOKEN_TTL_MS).toISOString() };
  persist();
  return token;
}

export function revokeToken(token) {
  if (db.authTokens[token]) {
    delete db.authTokens[token];
    persist();
  }
}

function readBearer(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

// Resolves the logged-in user, or null. Expired tokens are dropped on sight.
export function userFromRequest(req) {
  const token = readBearer(req);
  const record = token && db.authTokens[token];
  if (!record) return null;
  if (new Date(record.expiresAt) < new Date()) {
    revokeToken(token);
    return null;
  }
  return getUser(record.userId);
}

export function requireAuth(req, res, next) {
  const user = userFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Please log in to continue.' });
  }
  req.user = user;
  req.authToken = readBearer(req);
  next();
}
