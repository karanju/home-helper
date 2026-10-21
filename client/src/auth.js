import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, onIdTokenChanged, signInWithPopup, signOut } from 'firebase/auth';

// Google sign-in through Firebase Auth. The web config comes from the server (/api/firebase-config),
// so it isn't baked into the build. The Firebase ID token is our API bearer token.
let auth = null;
let initPromise = null;

// Resolves to true when sign-in is configured on the server, false otherwise
export function initAuth() {
  initPromise ??= fetch('/api/firebase-config')
    .then((res) => res.json())
    .then(({ configured, config }) => {
      if (!configured) return false;
      auth = getAuth(initializeApp(config));
      return true;
    })
    .catch((err) => {
      console.error('[Auth] Could not load the sign-in config:', err);
      return false;
    });
  return initPromise;
}

// Calls back with the Firebase user (or null) now and whenever sign-in state or the token changes
export function onAuthChange(callback) {
  if (!auth) {
    callback(null);
    return () => {};
  }
  return onIdTokenChanged(auth, callback);
}

export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  await signInWithPopup(auth, provider);
}

export function signOutUser() {
  return auth ? signOut(auth) : Promise.resolve();
}

export async function authHeaders() {
  const token = await auth?.currentUser?.getIdToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// JSON request to our backend with the sign-in token attached. Throws an Error carrying `status` on failure.
export async function apiFetch(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || `Request failed (${res.status})`);
    error.status = res.status;
    error.code = data.code;
    throw error;
  }
  return data;
}
