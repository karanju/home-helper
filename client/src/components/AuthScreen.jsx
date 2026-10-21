import React, { useEffect, useState } from 'react';
import { Users, LogIn, UserPlus } from 'lucide-react';
import { apiFetch, setAuthToken } from '../auth';

export default function AuthScreen({ inviteToken, onAuthed }) {
  const [mode, setMode] = useState(inviteToken ? 'signup' : 'login');
  const [invite, setInvite] = useState(null);
  const [inviteError, setInviteError] = useState(null);
  const [form, setForm] = useState({ displayName: '', email: '', username: '', identifier: '', password: '' });
  const [error, setError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!inviteToken) return;
    apiFetch(`/api/invites/${encodeURIComponent(inviteToken)}`)
      .then(setInvite)
      .catch((err) => setInviteError(err.message));
  }, [inviteToken]);

  const update = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const { token } = mode === 'signup'
        ? await apiFetch('/api/auth/signup', {
            method: 'POST',
            body: {
              displayName: form.displayName,
              email: form.email || undefined,
              username: form.username || undefined,
              password: form.password
            }
          })
        : await apiFetch('/api/auth/login', {
            method: 'POST',
            body: { identifier: form.identifier, password: form.password }
          });
      setAuthToken(token);

      // Join before the k-ID age gate starts, so a minor's consent request goes to the inviting admin
      if (invite) {
        try {
          await apiFetch(`/api/invites/${encodeURIComponent(inviteToken)}/accept`, { method: 'POST' });
        } catch (err) {
          console.warn('[Family] Could not accept invite:', err.message);
        }
      }
      onAuthed();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main style={styles.main}>
      <div style={styles.card}>
        {invite && (
          <div style={styles.inviteBanner}>
            <Users size={18} color="#a5b4fc" />
            <span>
              <strong>{invite.invitedByName}</strong> invited you to join <strong>{invite.familyName}</strong>
            </span>
          </div>
        )}
        {inviteError && <p style={styles.error}>{inviteError}</p>}

        <div style={styles.tabs}>
          <button
            style={{ ...styles.tab, ...(mode === 'login' ? styles.tabActive : {}) }}
            onClick={() => setMode('login')}
          >
            <LogIn size={14} /> Log in
          </button>
          <button
            style={{ ...styles.tab, ...(mode === 'signup' ? styles.tabActive : {}) }}
            onClick={() => setMode('signup')}
          >
            <UserPlus size={14} /> Create account
          </button>
        </div>

        <form onSubmit={handleSubmit} style={styles.form}>
          {mode === 'signup' ? (
            <>
              <label style={styles.label}>
                Your name
                <input style={styles.input} value={form.displayName} onChange={update('displayName')} required />
              </label>
              <label style={styles.label}>
                Email <span style={styles.hint}>(needed to create or run a family)</span>
                <input style={styles.input} type="email" value={form.email} onChange={update('email')} />
              </label>
              <label style={styles.label}>
                Username <span style={styles.hint}>(if you don't have an email)</span>
                <input style={styles.input} value={form.username} onChange={update('username')} />
              </label>
            </>
          ) : (
            <label style={styles.label}>
              Email or username
              <input style={styles.input} value={form.identifier} onChange={update('identifier')} required />
            </label>
          )}
          <label style={styles.label}>
            Password
            <input
              style={styles.input}
              type="password"
              minLength={mode === 'signup' ? 8 : undefined}
              value={form.password}
              onChange={update('password')}
              required
            />
          </label>

          {error && <p style={styles.error}>{error}</p>}

          <button type="submit" style={styles.submitBtn} disabled={isSubmitting}>
            {isSubmitting ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Log in'}
          </button>
        </form>

        <p style={styles.footnote}>
          After signing in, everyone goes through a quick k-ID age check so Home Helper fits their age.
        </p>
      </div>
    </main>
  );
}

const styles = {
  main: {
    maxWidth: '440px',
    margin: '36px auto',
    padding: '0 20px 80px',
    width: '100%',
  },
  card: {
    backgroundColor: '#131c2e',
    border: '1px solid #1e293b',
    borderRadius: '18px',
    padding: '24px',
    boxShadow: '0 20px 40px -15px rgba(0, 0, 0, 0.7)',
  },
  inviteBanner: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    fontSize: '14px',
    color: '#e2e8f0',
    background: 'rgba(99, 102, 241, 0.12)',
    border: '1px solid rgba(99, 102, 241, 0.3)',
    borderRadius: '12px',
    padding: '12px 14px',
    marginBottom: '18px',
  },
  tabs: {
    display: 'flex',
    gap: '8px',
    marginBottom: '18px',
  },
  tab: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    backgroundColor: '#0f172a',
    border: '1px solid #1e293b',
    color: '#94a3b8',
    padding: '10px',
    borderRadius: '10px',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  tabActive: {
    backgroundColor: '#1e293b',
    borderColor: '#6366f1',
    color: '#ffffff',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
  },
  label: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    fontSize: '13px',
    fontWeight: '600',
    color: '#cbd5e1',
  },
  hint: {
    fontWeight: '400',
    color: '#64748b',
  },
  input: {
    backgroundColor: '#0f172a',
    border: '1px solid #334155',
    borderRadius: '10px',
    padding: '10px 12px',
    fontSize: '14px',
    color: '#f8fafc',
  },
  error: {
    fontSize: '13px',
    color: '#f87171',
    margin: 0,
  },
  submitBtn: {
    backgroundColor: '#6366f1',
    border: 'none',
    color: '#ffffff',
    padding: '12px',
    borderRadius: '10px',
    fontSize: '14px',
    fontWeight: '700',
    cursor: 'pointer',
    marginTop: '4px',
  },
  footnote: {
    fontSize: '12px',
    color: '#64748b',
    lineHeight: 1.5,
    marginTop: '18px',
    textAlign: 'center',
  }
};
