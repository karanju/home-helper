import React, { useEffect, useRef, useState } from 'react';
import {
  KidSessionVerifyAge,
  KidSessionVerifyAgePass,
  KidSessionVerifyAgePending,
  KidSessionVerifyAgeFail,
  KidSessionVerifyAgeError,
  useKidAgeGate
} from '@k-id/core';
import { X, Users, Crown, ShieldCheck, Link2, Copy, Check } from 'lucide-react';
import { apiFetch } from '../auth';

// Rendered once k-ID reports the session as a verified adult; the server re-checks before trusting it
function AdultVerifiedSync({ onVerified }) {
  const [error, setError] = useState(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    apiFetch('/api/me/verify-adult', { method: 'POST' })
      .then((data) => {
        if (data.adultVerified) onVerified();
        else setError('k-ID could not confirm you are an adult yet.');
      })
      .catch((err) => setError(err.message));
  }, [onVerified]);

  return <p style={error ? styles.error : styles.muted}>{error || 'Confirming your verification…'}</p>;
}

// k-ID adult verification: k-ID emails the player a link to prove their age
function AdultVerification({ intro, onChanged }) {
  const { status: gateStatus } = useKidAgeGate();

  if (gateStatus !== 'pass') {
    return <p style={styles.muted}>Finish the k-ID age check first, then come back here.</p>;
  }
  return (
    <>
      <p style={styles.muted}>{intro} k-ID will email you a link to confirm your age.</p>
      <KidSessionVerifyAge>
        <KidSessionVerifyAgePass>
          <AdultVerifiedSync onVerified={onChanged} />
        </KidSessionVerifyAgePass>
        <KidSessionVerifyAgePending>
          <p style={styles.muted}>Check your email and follow k-ID's link to verify your age.</p>
        </KidSessionVerifyAgePending>
        <KidSessionVerifyAgeFail>
          <p style={styles.error}>k-ID could not verify that you are an adult.</p>
        </KidSessionVerifyAgeFail>
        <KidSessionVerifyAgeError>
          <p style={styles.error}>Could not reach k-ID. Close this panel and try again.</p>
        </KidSessionVerifyAgeError>
      </KidSessionVerifyAge>
    </>
  );
}

function CreateFamily({ me, onChanged }) {
  const [name, setName] = useState('');
  const [error, setError] = useState(null);

  if (!me.user.adultVerified) {
    return <AdultVerification intro="Only verified adults can create a family." onChanged={onChanged} />;
  }

  const handleCreate = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await apiFetch('/api/families', { method: 'POST', body: { name } });
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <form onSubmit={handleCreate} style={styles.row}>
      <input
        style={styles.input}
        placeholder="Family name, e.g. The Cohens"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />
      <button type="submit" style={styles.primaryBtn}>Create family</button>
      {error && <p style={styles.error}>{error}</p>}
    </form>
  );
}

function InviteLink() {
  const [invite, setInvite] = useState(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);

  const createInvite = async () => {
    setError(null);
    setCopied(false);
    try {
      const { token } = await apiFetch('/api/families/invites', { method: 'POST' });
      setInvite(`${window.location.origin}/?invite=${token}`);
    } catch (err) {
      setError(err.message);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(invite);
      setCopied(true);
    } catch {
      setError('Could not copy. Select the link and copy it manually.');
    }
  };

  return (
    <div style={styles.section}>
      <h3 style={styles.sectionTitle}><Link2 size={15} /> Invite someone</h3>
      <p style={styles.muted}>
        Each link works once and expires in 7 days. Everyone who joins goes through the k-ID age check on their own.
      </p>
      {invite ? (
        <div style={styles.row}>
          <input style={styles.input} value={invite} readOnly onFocus={(e) => e.target.select()} />
          <button style={styles.secondaryBtn} onClick={copy}>
            {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      ) : null}
      <button style={styles.secondaryBtn} onClick={createInvite}>
        {invite ? 'Create another link' : 'Create invite link'}
      </button>
      {error && <p style={styles.error}>{error}</p>}
    </div>
  );
}

function MemberList({ me, onChanged }) {
  const [error, setError] = useState(null);

  const act = async (request) => {
    setError(null);
    try {
      await request();
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  };

  const setRole = (userId, role) => act(() =>
    apiFetch(`/api/families/members/${userId}`, { method: 'PATCH', body: { role } })
  );
  const remove = (userId) => act(() =>
    apiFetch(`/api/families/members/${userId}`, { method: 'DELETE' })
  );

  return (
    <div style={styles.section}>
      <h3 style={styles.sectionTitle}><Users size={15} /> Members</h3>
      {me.family.members.map((member) => {
        const isSelf = member.userId === me.user.id;
        return (
          <div key={member.userId} style={styles.memberRow}>
            {member.photoURL ? (
              <img src={member.photoURL} alt="" referrerPolicy="no-referrer" style={styles.memberPhoto} />
            ) : (
              <span style={styles.memberInitial} aria-hidden="true">{member.displayName.charAt(0).toUpperCase()}</span>
            )}
            <div style={{ ...styles.memberInfo, flex: 1, minWidth: 0 }}>
              <span style={styles.memberName}>{member.displayName}{isSelf ? ' (you)' : ''}</span>
              <span style={styles.badges}>
                {member.role === 'admin' && <span style={styles.badge}><Crown size={11} /> Admin</span>}
                {member.adultVerified && <span style={styles.badge}><ShieldCheck size={11} /> Verified adult</span>}
              </span>
            </div>
            <div style={styles.memberActions}>
              {me.isAdmin && !isSelf && member.role === 'member' && member.adultVerified && (
                <button style={styles.linkBtn} onClick={() => setRole(member.userId, 'admin')}>Make admin</button>
              )}
              {me.isAdmin && !isSelf && member.role === 'admin' && (
                <button style={styles.linkBtn} onClick={() => setRole(member.userId, 'member')}>Remove admin</button>
              )}
              {me.isAdmin && !isSelf && (
                <button style={styles.dangerLinkBtn} onClick={() => remove(member.userId)}>Remove</button>
              )}
              {isSelf && (
                <button style={styles.dangerLinkBtn} onClick={() => remove(member.userId)}>Leave</button>
              )}
            </div>
          </div>
        );
      })}
      {error && <p style={styles.error}>{error}</p>}
    </div>
  );
}

export default function FamilyPanel({ me, isOpen, onClose, onChanged, inviteToken, onInviteHandled }) {
  const [joinError, setJoinError] = useState(null);

  if (!isOpen) return null;

  const joinFamily = async () => {
    setJoinError(null);
    try {
      await apiFetch(`/api/invites/${encodeURIComponent(inviteToken)}/accept`, { method: 'POST' });
      onInviteHandled();
      onChanged();
    } catch (err) {
      setJoinError(err.message);
    }
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Users size={20} color="#818cf8" />
            <h2 style={styles.title}>{me.family ? me.family.name : 'Your family'}</h2>
          </div>
          <button style={styles.closeBtn} onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div style={styles.content}>
          {me.family ? (
            <>
              <MemberList me={me} onChanged={onChanged} />
              {me.isAdmin && <InviteLink />}
              {!me.user.adultVerified && (
                <div style={styles.section}>
                  <h3 style={styles.sectionTitle}><ShieldCheck size={15} /> Verify you're an adult</h3>
                  <AdultVerification intro="Adults who verify can be made family admins." onChanged={onChanged} />
                </div>
              )}
            </>
          ) : (
            <>
              {inviteToken && (
                <div style={styles.section}>
                  <h3 style={styles.sectionTitle}>You have an invite</h3>
                  <button style={styles.primaryBtn} onClick={joinFamily}>Join the family</button>
                  {joinError && <p style={styles.error}>{joinError}</p>}
                </div>
              )}
              <div style={styles.section}>
                <h3 style={styles.sectionTitle}>Create a family</h3>
                <CreateFamily me={me} onChanged={onChanged} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    backdropFilter: 'blur(4px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    padding: '20px',
  },
  modal: {
    backgroundColor: '#1e293b',
    border: '1px solid #334155',
    borderRadius: '16px',
    width: '100%',
    maxWidth: '520px',
    maxHeight: '85vh',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.6)',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '18px 24px',
    borderBottom: '1px solid #334155',
    backgroundColor: '#0f172a',
  },
  title: {
    fontSize: '17px',
    fontWeight: '700',
    color: '#ffffff',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: '#94a3b8',
    cursor: 'pointer',
    padding: '4px',
    borderRadius: '6px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    padding: '20px 24px',
    overflowY: 'auto',
    flex: 1,
    color: '#f8fafc',
    display: 'flex',
    flexDirection: 'column',
    gap: '22px',
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  sectionTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '14px',
    fontWeight: '700',
    color: '#e2e8f0',
  },
  row: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
  },
  input: {
    flex: 1,
    minWidth: '180px',
    backgroundColor: '#0f172a',
    border: '1px solid #334155',
    borderRadius: '10px',
    padding: '10px 12px',
    fontSize: '13px',
    color: '#f8fafc',
  },
  primaryBtn: {
    backgroundColor: '#6366f1',
    border: 'none',
    color: '#ffffff',
    padding: '10px 16px',
    borderRadius: '10px',
    fontSize: '13px',
    fontWeight: '700',
    cursor: 'pointer',
  },
  secondaryBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    backgroundColor: '#0f172a',
    border: '1px solid #334155',
    color: '#ffffff',
    padding: '10px 14px',
    borderRadius: '10px',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  memberRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '8px',
    padding: '10px 12px',
    backgroundColor: '#0f172a',
    border: '1px solid #1e293b',
    borderRadius: '10px',
  },
  memberPhoto: {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    flexShrink: 0,
  },
  memberInitial: {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1e293b',
    color: '#cbd5e1',
    fontSize: '14px',
    fontWeight: '700',
  },
  memberInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  memberName: {
    fontSize: '14px',
    fontWeight: '600',
  },
  badges: {
    display: 'flex',
    gap: '6px',
  },
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    fontSize: '11px',
    fontWeight: '600',
    color: '#a5b4fc',
    background: 'rgba(99, 102, 241, 0.15)',
    borderRadius: '9999px',
    padding: '2px 8px',
  },
  memberActions: {
    display: 'flex',
    gap: '10px',
  },
  linkBtn: {
    background: 'none',
    border: 'none',
    color: '#a5b4fc',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  dangerLinkBtn: {
    background: 'none',
    border: 'none',
    color: '#f87171',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  muted: {
    fontSize: '13px',
    color: '#94a3b8',
    lineHeight: 1.5,
  },
  error: {
    fontSize: '13px',
    color: '#f87171',
    width: '100%',
  }
};
