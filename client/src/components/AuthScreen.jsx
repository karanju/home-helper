import React, { useEffect, useState } from 'react';
import { House, Users } from 'lucide-react';
import { apiFetch, signInWithGoogle } from '../auth';

// Popup errors that just mean "the person closed it" don't deserve an error message
const DISMISSED_CODES = ['auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/user-cancelled'];

function GoogleMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export default function AuthScreen({ inviteToken, isConfigured }) {
  const [invite, setInvite] = useState(null);
  const [inviteError, setInviteError] = useState(null);
  const [error, setError] = useState(null);
  const [isSigningIn, setIsSigningIn] = useState(false);

  useEffect(() => {
    if (!inviteToken) return;
    apiFetch(`/api/invites/${encodeURIComponent(inviteToken)}`)
      .then(setInvite)
      .catch((err) => setInviteError(err.message));
  }, [inviteToken]);

  // App.jsx picks up the signed-in user (and accepts the invite) from the auth state change
  const handleSignIn = async () => {
    setError(null);
    setIsSigningIn(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      if (!DISMISSED_CODES.includes(err.code)) {
        console.error('[Auth] Google sign-in failed:', err);
        setError(err.code === 'auth/popup-blocked'
          ? 'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.'
          : 'Could not sign in with Google. Please try again.');
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  return (
    <main className="auth">
      <div className="auth-content">
        <span className="auth-icon"><House size={34} strokeWidth={2} /></span>
        <h1 className="large-title">Homebase</h1>
        <p className="auth-subtitle">Your family's chores, with help that fits every age.</p>

        {invite && (
          <div className="auth-invite">
            <Users size={18} />
            <span>
              <strong>{invite.invitedByName}</strong> invited you to join <strong>{invite.familyName}</strong>
            </span>
          </div>
        )}
        {inviteError && <p className="footnote text-danger">{inviteError}</p>}

        {isConfigured ? (
          <button type="button" onClick={handleSignIn} className="google-btn" disabled={isSigningIn}>
            <GoogleMark />
            <span>{isSigningIn ? 'Signing in…' : 'Continue with Google'}</span>
          </button>
        ) : (
          <p className="auth-notice footnote">
            Sign-in isn't configured on this server yet. You can still try the app with <code>?mock-age=kid</code>, <code>teen</code> or <code>adult</code>.
          </p>
        )}

        {error && <p className="footnote text-danger">{error}</p>}

        <p className="footnote auth-footnote">
          After signing in, everyone goes through a quick k-ID age check so Homebase fits their age.
        </p>
      </div>
    </main>
  );
}
