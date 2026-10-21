import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  KidCoreProvider,
  KidSessionProvider,
  KidAgeGate,
  KidAgeGatePass,
  KidAgeGatePending,
  KidAgeGateFail,
  KidAgeGateProhibited,
  KidAgeGateError,
  useKidSession,
  useKidAgeGate
} from '@k-id/core';
import HouseholdApp from './components/HouseholdApp';
import SettingsModal from './components/SettingsModal';
import AuthScreen from './components/AuthScreen';
import FamilyPanel from './components/FamilyPanel';
import { DemoModeContext } from './components/FeatureGate';
import { apiFetch, authHeaders, initAuth, onAuthChange, signOutUser } from './auth';
import { Clock, House, ShieldCheck, TriangleAlert, CircleX } from 'lucide-react';

// k-ID widgets take their colors from our tokens, so they follow light/dark and the age accent
const K_ID_APPEARANCE = {
  variables: {
    colorPrimary: 'var(--accent)',
    colorOnPrimary: 'var(--on-accent)',
    colorText: 'var(--label)',
    colorTextMuted: 'var(--label-2)',
    colorSurface: 'var(--surface)',
    colorSurfaceMuted: 'var(--fill)',
    colorBorder: 'var(--separator)',
    colorDanger: 'var(--danger)',
    fontFamily: 'var(--font-text)',
    radius: 'var(--radius-control)'
  }
};

const K_ID_CONFIG = {
  publishableKey: 'kgp_test_ckcqom36ppaaaeytysmy4puoznneommzdbrfljfiheuwewt4aiulgxeqf3q77xy',
  baseUrl: 'https://kai-api.test.k-id.com/fapi/v1',
  declare: {
    permissions: [
      { name: 'ai-chat' },
      { name: 'ai-voice-mode' },
      { name: 'ai-memory' },
      { name: 'ai-media-upload' },
      { name: 'ai-media-generation' },
      { name: 'ai-companion-chatbot' }
    ],
    supportEmail: 'support@homehelper.app',
    privacyPolicyUrl: 'https://homehelper.app/privacy',
    termsOfServiceUrl: 'https://homehelper.app/terms',
    iconUrl: '/icon.png'
  }
};

// Brand header + centered card while the gate is running; full-width app once it passes
function GateFrame({ children }) {
  const { status } = useKidAgeGate();
  if (status === 'pass') return <>{children}</>;

  return (
    <>
      <BrandBar>
        <span className="badge is-neutral"><ShieldCheck size={12} strokeWidth={2.5} /> Age check by k-ID</span>
      </BrandBar>
      <main className="gate-main">
        <div className="card gate-card">{children}</div>
      </main>
    </>
  );
}

function BrandBar({ children }) {
  return (
    <header className="gate-bar">
      <div className="brand">
        <span className="brand-mark"><House size={16} strokeWidth={2.25} /></span>
        <span className="brand-name">Home Helper</span>
      </div>
      {children}
    </header>
  );
}

function SlotCard({ icon: Icon, tone, title, children, action }) {
  return (
    <div className="slot-card">
      <span className={`slot-icon is-${tone}`}><Icon size={26} /></span>
      <h2 className="title">{title}</h2>
      <p className="subhead">{children}</p>
      {action}
    </div>
  );
}

// Inner component rendered once the player passes the k-ID age gate
function VerifiedApp({ sessionId, forcedMode, serverAgeMode, family, myUserId, familyName, onSignOut, onOpenSettings, onOpenFamily }) {
  const { session, ageVerification } = useKidSession();

  useEffect(() => {
    if (session) console.log('[k-ID] Session ageStatus:', session.ageStatus, 'ageVerification:', ageVerification);
  }, [session?.ageStatus, ageVerification]);

  // The server's mode (read from this user's own k-ID session) wins; the SDK's view covers the moment before it loads
  let resolvedMode = forcedMode || serverAgeMode;
  if (!resolvedMode) {
    if (ageVerification?.verifiedAge != null) {
      const age = ageVerification.verifiedAge;
      if (age < 13) resolvedMode = 'kid';
      else if (age < 18) resolvedMode = 'teen';
      else resolvedMode = 'adult';
    } else if (session?.ageStatus) {
      const status = String(session.ageStatus).toUpperCase();
      const ageValues = status.match(/\d+/g)?.map(Number) ?? [];
      if (status.includes('CHILD') || status.includes('UNDER_13') || ageValues.some(age => age < 13)) {
        resolvedMode = 'kid';
      } else if (
        status.includes('TEEN') ||
        status.includes('ADOLESCENT') ||
        status.includes('MINOR') ||
        ageValues.some(age => age >= 13 && age < 18)
      ) {
        resolvedMode = 'teen';
      } else if (status.includes('ADULT') || status.includes('18+') || status.includes('18_PLUS')) {
        resolvedMode = 'adult';
      } else {
        resolvedMode = 'teen';
      }
    } else {
      resolvedMode = 'teen'; // Avoid granting adult mode without an adult age result
    }
  }

  console.info('[Home Helper] Age-mode routing', {
    verifiedAge: ageVerification?.verifiedAge ?? null,
    ageStatus: session?.ageStatus ?? null,
    resolvedMode,
  });

  return (
    <HouseholdApp
      key={resolvedMode}
      ageMode={resolvedMode}
      sessionId={sessionId}
      family={family}
      myUserId={myUserId}
      familyName={familyName}
      onSignOut={onSignOut}
      onOpenSettings={onOpenSettings}
      onOpenFamily={onOpenFamily}
    />
  );
}

export default function App() {
  // The signed-in account from /api/me; its k-ID ids persist the session across launches and devices
  const [me, setMe] = useState(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isSignInConfigured, setIsSignInConfigured] = useState(true);
  const [inviteToken, setInviteToken] = useState(() => new URLSearchParams(window.location.search).get('invite'));
  const inviteTokenRef = useRef(inviteToken);
  inviteTokenRef.current = inviteToken;
  const [forcedAgeMode, setForcedAgeMode] = useState(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isFamilyOpen, setIsFamilyOpen] = useState(false);
  // Bumped to remount <KidSessionProvider>, which is how the k-ID flow resets
  const [flowKey, setFlowKey] = useState(0);

  const sessionId = me?.user.kidSessionId || undefined;
  const challengeId = me?.user.kidChallengeId || undefined;

  const refreshMe = useCallback(async () => {
    try {
      setMe(await apiFetch('/api/me'));
    } catch (err) {
      console.error('[Auth] Could not load account:', err);
      if (err.status === 401) {
        await signOutUser();
        setMe(null);
      }
    } finally {
      setIsAuthLoading(false);
    }
  }, []);

  // Follow Firebase's sign-in state. The token also refreshes hourly, so only reload when the user changes.
  useEffect(() => {
    let unsubscribe = () => {};
    let currentUid = null;

    initAuth().then((configured) => {
      setIsSignInConfigured(configured);
      unsubscribe = onAuthChange(async (firebaseUser) => {
        const uid = firebaseUser?.uid ?? null;
        if (uid === currentUid && uid !== null) return;
        currentUid = uid;

        if (!firebaseUser) {
          setMe(null);
          setIsAuthLoading(false);
          return;
        }
        // Join before the k-ID age gate starts, so a minor's consent request goes to the inviting admin
        if (inviteTokenRef.current) {
          try {
            await apiFetch(`/api/invites/${encodeURIComponent(inviteTokenRef.current)}/accept`, { method: 'POST' });
          } catch (err) {
            console.warn('[Family] Could not accept invite:', err.message);
          }
        }
        refreshMe();
      });
    });

    return () => unsubscribe();
  }, [refreshMe]);

  const clearInvite = useCallback(() => {
    setInviteToken(null);
    const url = new URL(window.location);
    url.searchParams.delete('invite');
    window.history.replaceState({}, '', url);
  }, []);

  // A logged-in user who opens an invite link without a family gets the join prompt
  useEffect(() => {
    if (!me || !inviteToken) return;
    if (me.family) clearInvite();
    else setIsFamilyOpen(true);
  }, [me, inviteToken, clearInvite]);

  const saveKidIds = async (ids) => {
    try {
      await apiFetch('/api/me/kid-session', { method: 'POST', body: ids });
    } catch (err) {
      console.error('[k-ID] Failed to save k-ID ids on the account:', err);
    }
  };

  // Check ?mock-age=kid|teen|adult query parameter
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const mockParam = params.get('mock-age');
    if (mockParam && ['kid', 'teen', 'adult'].includes(mockParam.toLowerCase())) {
      console.log(`[k-ID Demo Bypass] Detected ?mock-age=${mockParam}`);
      setForcedAgeMode(mockParam.toLowerCase());
    }
  }, []);

  // k-ID Handlers
  const handleSession = async (newSessionId) => {
    console.log('[k-ID] onSession established:', newSessionId);
    if (newSessionId) {
      await saveKidIds({ sessionId: newSessionId });
      refreshMe();

      // Tell backend that onSession fired so it checks the challengeId with secret key
      try {
        const syncRes = await fetch('/api/session-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: newSessionId })
        });
        const syncData = await syncRes.json();
        console.log('[k-ID Server onSession Sync]:', syncData);
      } catch (err) {
        console.error('[k-ID] Failed to notify backend of onSession:', err);
      }
    }
  };

  const handleChallenge = (newChallengeId) => {
    console.log('[k-ID] onChallenge issued:', newChallengeId);
    if (newChallengeId) {
      saveKidIds({ challengeId: newChallengeId });
    }
  };

  const handleSettingsChallenge = (newChallengeId) => {
    saveKidIds({ settingsChallengeId: newChallengeId });
  };

  // Forget this account's k-ID flow and start the age check over
  const handleRestartAgeCheck = async () => {
    await saveKidIds({ sessionId: null, challengeId: null });
    await refreshMe();
    setFlowKey((k) => k + 1);
  };

  const handleClaim = async (claimToken) => {
    console.log('[k-ID] onClaim received claimToken. Forwarding to backend...');
    try {
      const res = await fetch('/api/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ claimToken })
      });
      const data = await res.json();
      console.log('[k-ID Backend Claim Response]:', data);
    } catch (err) {
      console.error('[k-ID] Failed to send claimToken to backend:', err);
    }
  };

  const handleSignOut = async () => {
    console.log('[k-ID] Signing out and resetting session...');
    // The k-ID ids live on the account, so only the Google sign-in and session storage need clearing here
    await signOutUser();
    sessionStorage.clear();

    // Clean URL and perform a hard navigation to wipe in-memory device session
    window.location.href = '/';
  };

  // If ?mock-age bypass is active, render immediately to guarantee demo uptime.
  // There is no KidSessionProvider here; DemoModeContext tells the app to skip k-ID permission checks.
  if (forcedAgeMode) {
    return (
      <DemoModeContext.Provider value={true}>
        <div className="app-container">
          <HouseholdApp
            key={forcedAgeMode}
            ageMode={forcedAgeMode}
            sessionId="demo_session"
            onSignOut={handleSignOut}
            onOpenSettings={() => setIsSettingsOpen(true)}
          />

          <SettingsModal
            sessionId="demo_session"
            isOpen={isSettingsOpen}
            onClose={() => setIsSettingsOpen(false)}
          />
        </div>
      </DemoModeContext.Provider>
    );
  }

  if (isAuthLoading) {
    return (
      <div className="app-container app-loading" aria-busy="true">
        <div className="spinner" />
        <span className="visually-hidden">Loading</span>
      </div>
    );
  }

  if (!me) {
    return (
      <div className="app-container">
        <AuthScreen inviteToken={inviteToken} isConfigured={isSignInConfigured} />
      </div>
    );
  }

  // Full k-ID SDK Age Gate Provider flow
  return (
    <KidCoreProvider
      publishableKey={K_ID_CONFIG.publishableKey}
      baseUrl={K_ID_CONFIG.baseUrl}
      declare={K_ID_CONFIG.declare}
      appearance={K_ID_APPEARANCE}
    >
      {/* Keyed by account so switching users starts a fresh k-ID flow */}
      <KidSessionProvider
        key={`${me.user.id}-${flowKey}`}
        jurisdiction="auto"
        sessionId={sessionId}
        challengeId={challengeId}
        onSession={handleSession}
        onChallenge={handleChallenge}
        onClaim={handleClaim}
      >
        <div className="app-container">
          {/* k-ID All-In-One Age Gate Container */}
          <GateFrame>
              <KidAgeGate>
                {/* 1. Pending slot: Waiting on parent email consent */}
                <KidAgeGatePending>
                  <SlotCard icon={Clock} tone="waiting" title="Waiting for a grown-up">
                    We sent an approval link to your parent or guardian. Home Helper unlocks as soon as they approve.
                  </SlotCard>
                </KidAgeGatePending>

                {/* 2. Prohibited slot: Under jurisdiction minimum age */}
                <KidAgeGateProhibited>
                  <SlotCard
                    icon={CircleX}
                    tone="danger"
                    title="Not available yet"
                    action={<button type="button" className="btn btn-gray" onClick={handleRestartAgeCheck}>Try again</button>}
                  >
                    Local rules don't allow people under the minimum age to use Home Helper.
                  </SlotCard>
                </KidAgeGateProhibited>

                {/* 3. Fail slot: Consent denied or challenge expired */}
                <KidAgeGateFail>
                  <SlotCard
                    icon={TriangleAlert}
                    tone="danger"
                    title="Verification incomplete"
                    action={<button type="button" className="btn btn-gray" onClick={handleRestartAgeCheck}>Start over</button>}
                  >
                    The age check wasn't finished, or consent was declined.
                  </SlotCard>
                </KidAgeGateFail>

                {/* 4. Error slot: Coarse SDK / network failure */}
                <KidAgeGateError>
                  <SlotCard
                    icon={TriangleAlert}
                    tone="waiting"
                    title="Can't reach k-ID"
                    action={<button type="button" className="btn btn-gray" onClick={() => setFlowKey((k) => k + 1)}>Retry</button>}
                  >
                    Check your connection and try again.
                  </SlotCard>
                </KidAgeGateError>

                {/* 5. Pass slot: Verified and unlocked! */}
                <KidAgeGatePass>
                  <VerifiedApp
                    sessionId={sessionId}
                    forcedMode={forcedAgeMode}
                    serverAgeMode={me.ageMode}
                    family={me.family}
                    myUserId={me.user.id}
                    familyName={me.family?.name}
                    onSignOut={handleSignOut}
                    onOpenSettings={() => setIsSettingsOpen(true)}
                    onOpenFamily={() => setIsFamilyOpen(true)}
                  />
                </KidAgeGatePass>
              </KidAgeGate>
          </GateFrame>

          {/* Settings Modal */}
          <SettingsModal
            sessionId={sessionId}
            challengeId={me.user.settingsChallengeId || undefined}
            onChallenge={handleSettingsChallenge}
            isOpen={isSettingsOpen}
            onClose={() => setIsSettingsOpen(false)}
          />

          {/* Family Panel: create/join a family, invite, manage admins */}
          <FamilyPanel
            me={me}
            isOpen={isFamilyOpen}
            onClose={() => setIsFamilyOpen(false)}
            onChanged={refreshMe}
            inviteToken={inviteToken}
            onInviteHandled={clearInvite}
          />
        </div>
      </KidSessionProvider>
    </KidCoreProvider>
  );
}
