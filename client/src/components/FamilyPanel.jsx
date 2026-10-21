import React, { useEffect, useRef, useState } from 'react';
import {
  KidSessionVerifyAge,
  KidSessionVerifyAgePass,
  KidSessionVerifyAgePending,
  KidSessionVerifyAgeFail,
  KidSessionVerifyAgeError,
  useKidAgeGate
} from '@k-id/core';
import { Users, Crown, ShieldCheck, Link2, Copy, Check } from 'lucide-react';
import { apiFetch } from '../auth';
import Sheet from './Sheet';

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

  return <p className={error ? 'footnote text-danger' : 'footnote'}>{error || 'Confirming your verification…'}</p>;
}

// k-ID adult verification: k-ID emails the player a link to prove their age
function AdultVerification({ intro, onChanged }) {
  const { status: gateStatus } = useKidAgeGate();

  if (gateStatus !== 'pass') {
    return <p className="footnote">Finish the k-ID age check first, then come back here.</p>;
  }
  return (
    <>
      <p className="footnote">{intro} k-ID will email you a link to confirm your age.</p>
      <KidSessionVerifyAge>
        <KidSessionVerifyAgePass>
          <AdultVerifiedSync onVerified={onChanged} />
        </KidSessionVerifyAgePass>
        <KidSessionVerifyAgePending>
          <p className="footnote">Check your email and follow k-ID's link to verify your age.</p>
        </KidSessionVerifyAgePending>
        <KidSessionVerifyAgeFail>
          <p className="footnote text-danger">k-ID could not verify that you are an adult.</p>
        </KidSessionVerifyAgeFail>
        <KidSessionVerifyAgeError>
          <p className="footnote text-danger">Could not reach k-ID. Close this panel and try again.</p>
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
    <form onSubmit={handleCreate} className="panel-row">
      <input
        className="field"
        placeholder="Family name, e.g. The Cohens"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />
      <button type="submit" className="btn btn-primary">Create</button>
      {error && <p className="footnote text-danger">{error}</p>}
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
    <section className="panel-section">
      <h3 className="panel-section-title"><Link2 size={15} /> Invite someone</h3>
      <p className="footnote">
        Each link works once and expires in 7 days. Everyone who joins goes through the k-ID age check on their own.
      </p>
      {invite && (
        <div className="panel-row">
          <input className="field" value={invite} readOnly onFocus={(e) => e.target.select()} aria-label="Invite link" />
          <button type="button" className="btn btn-tinted" onClick={copy}>
            {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}
      <button type="button" className="btn btn-gray panel-start" onClick={createInvite}>
        {invite ? 'Create another link' : 'Create invite link'}
      </button>
      {error && <p className="footnote text-danger">{error}</p>}
    </section>
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
    <section className="panel-section">
      <h3 className="panel-section-title"><Users size={15} /> Members</h3>
      <div className="grouped panel-grouped">
        {me.family.members.map((member) => {
          const isSelf = member.userId === me.user.id;
          return (
            <div key={member.userId} className="grouped-row member-row">
              {member.photoURL ? (
                <img src={member.photoURL} alt="" referrerPolicy="no-referrer" className="avatar avatar-lg" />
              ) : (
                <span className="avatar avatar-lg" data-age={member.ageMode || undefined} aria-hidden="true">
                  {member.displayName.charAt(0).toUpperCase()}
                </span>
              )}
              <div className="member-info">
                <span className="member-name">{member.displayName}{isSelf ? ' (you)' : ''}</span>
                <span className="member-badges">
                  {member.role === 'admin' && <span className="badge"><Crown size={11} /> Admin</span>}
                  {member.adultVerified && <span className="badge is-neutral"><ShieldCheck size={11} /> Verified adult</span>}
                </span>
              </div>
              <div className="member-actions">
                {me.isAdmin && !isSelf && member.role === 'member' && member.adultVerified && (
                  <button type="button" className="btn btn-plain" onClick={() => setRole(member.userId, 'admin')}>Make admin</button>
                )}
                {me.isAdmin && !isSelf && member.role === 'admin' && (
                  <button type="button" className="btn btn-plain" onClick={() => setRole(member.userId, 'member')}>Remove admin</button>
                )}
                {me.isAdmin && !isSelf && (
                  <button type="button" className="btn btn-plain is-danger" onClick={() => remove(member.userId)}>Remove</button>
                )}
                {isSelf && (
                  <button type="button" className="btn btn-plain is-danger" onClick={() => remove(member.userId)}>Leave</button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {error && <p className="footnote text-danger">{error}</p>}
    </section>
  );
}

export default function FamilyPanel({ me, isOpen, onClose, onChanged, inviteToken, onInviteHandled }) {
  const [joinError, setJoinError] = useState(null);

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
    <Sheet open={isOpen} onClose={onClose} eyebrow="Family" title={me.family ? me.family.name : 'Your family'}>
      <div className="panel-stack">
        {me.family ? (
          <>
            <MemberList me={me} onChanged={onChanged} />
            {me.isAdmin && <InviteLink />}
            {!me.user.adultVerified && (
              <section className="panel-section">
                <h3 className="panel-section-title"><ShieldCheck size={15} /> Verify you're an adult</h3>
                <AdultVerification intro="Adults who verify can be made family admins." onChanged={onChanged} />
              </section>
            )}
          </>
        ) : (
          <>
            {inviteToken && (
              <section className="panel-section">
                <h3 className="panel-section-title">You have an invite</h3>
                <button type="button" className="btn btn-primary panel-start" onClick={joinFamily}>Join the family</button>
                {joinError && <p className="footnote text-danger">{joinError}</p>}
              </section>
            )}
            <section className="panel-section">
              <h3 className="panel-section-title">Create a family</h3>
              <CreateFamily me={me} onChanged={onChanged} />
            </section>
          </>
        )}
      </div>
    </Sheet>
  );
}
