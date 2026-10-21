import { verifyIdToken, upsertUserFromToken, HttpError } from './store.js';

// Sign-in is Google via Firebase Auth: the client sends its Firebase ID token as the bearer token
function readBearer(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

// Resolves the signed-in user (creating their record on first sign-in), or null
export async function userFromRequest(req) {
  const idToken = readBearer(req);
  if (!idToken) return null;
  try {
    return await upsertUserFromToken(await verifyIdToken(idToken));
  } catch (err) {
    if (err instanceof HttpError) throw err;
    return null; // expired, revoked or malformed token
  }
}

export async function requireAuth(req, res, next) {
  try {
    const user = await userFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Please sign in to continue.' });
    }
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}
