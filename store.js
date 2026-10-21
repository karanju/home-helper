import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'families.json');

const EMPTY_DB = { users: {}, families: {}, invites: {}, authTokens: {} };

function load() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return { ...EMPTY_DB, ...parsed };
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('[Store] Could not read families.json, starting empty:', err.message);
    }
    return structuredClone(EMPTY_DB);
  }
}

// Single-process JSON store: everything lives in memory and is flushed to disk on each change
export const db = load();

// Write to a temp file then rename, so a crash mid-write never leaves a half-written file
export function persist() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmpFile = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(db, null, 2));
  fs.renameSync(tmpFile, DATA_FILE);
}

export function getUser(userId) {
  return db.users[userId] || null;
}

export function findUserByLogin(identifier) {
  const needle = String(identifier || '').trim().toLowerCase();
  if (!needle) return null;
  return Object.values(db.users).find((u) => u.email === needle || u.username === needle) || null;
}

export function getFamilyForUser(userId) {
  return Object.values(db.families).find((f) => f.members[userId]) || null;
}

export function isFamilyAdmin(family, userId) {
  return family?.members[userId]?.role === 'admin';
}
