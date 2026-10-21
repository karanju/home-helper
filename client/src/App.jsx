import React, { useState, useEffect } from 'react';
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
import { DemoModeContext } from './components/FeatureGate';
import { Shield, Sparkles, Clock, AlertTriangle, XCircle, Sliders } from 'lucide-react';

const K_ID_CONFIG = {
  publishableKey: 'kgp_test_cq2f3o2kppaaaeytaxu23c5fxiopr2av6pu6ujtclxg7hczzxl7jlakai2km2wy',
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
    supportEmail: 'dlin0505@berkeley.edu',
    // null = use k-ID's default links (fine for test mode; a live key needs real ones)
    privacyPolicyUrl: null,
    termsOfServiceUrl: null,
    iconUrl: '/icon.png'
  },
  // Dark theme for the k-ID widgets so they match the app instead of rendering as white boxes
  appearance: {
    variables: {
      colorPrimary: '#6366f1',
      colorOnPrimary: '#ffffff',
      colorText: '#f8fafc',
      colorTextMuted: '#94a3b8',
      colorSurface: '#131c2e',
      colorSurfaceMuted: '#1e293b',
      colorBorder: '#334155',
      colorDanger: '#f87171',
      fontFamily: 'inherit',
      radius: '12px'
    },
    // index.css resets padding on every element, so restore the widgets' spacing here
    elements: {
      card: { padding: '16px' },
      title: { marginBottom: '8px' },
      row: { padding: '10px 0', gap: '12px' },
      input: { padding: '10px 12px', fontSize: '16px' },
      button: { padding: '12px 16px', fontSize: '15px', marginTop: '8px' }
    }
  }
};

// Saved IDs belong to one k-ID project; scoping them to the key means a key change starts fresh
// instead of resuming a session/challenge the new project has never seen
const SESSION_KEY = `kid_session_id:${K_ID_CONFIG.publishableKey}`;
const CHALLENGE_KEY = `kid_challenge_id:${K_ID_CONFIG.publishableKey}`;
localStorage.removeItem('kid_session_id');
localStorage.removeItem('kid_challenge_id');

// Brand header + centered card while the gate is running; full-width app once it passes
function GateFrame({ children }) {
  const { status } = useKidAgeGate();
  if (status === 'pass') return <>{children}</>;

  return (
    <>
      <header style={styles.topHeader}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '26px' }}>🏠</span>
          <span style={styles.brandTitle}>Home Helper</span>
        </div>
        <div style={styles.badge}>
          <Shield size={14} color="#818cf8" />
          <span>k-ID Verified Gate</span>
        </div>
      </header>
      <main style={styles.gateMain}>
        <div style={styles.gateWrapper}>{children}</div>
      </main>
    </>
  );
}

// Inner component rendered once the player passes the k-ID age gate
function VerifiedApp({ sessionId, forcedMode, onSignOut, onOpenSettings }) {
  const { session, ageVerification } = useKidSession();

  // The player passed, so any parent request is finished; don't resume it next launch
  useEffect(() => {
    localStorage.removeItem(CHALLENGE_KEY);
  }, []);

  useEffect(() => {
    if (session) console.log('[k-ID] Session ageStatus:', session.ageStatus, 'ageVerification:', ageVerification);
  }, [session?.ageStatus, ageVerification]);

  // Determine age mode from verified age or fallback
  let resolvedMode = forcedMode;
  if (!resolvedMode) {
    if (ageVerification?.verifiedAge != null) {
      const age = ageVerification.verifiedAge;
      if (age < 13) resolvedMode = 'kid';
      else if (age < 18) resolvedMode = 'teen';
      else resolvedMode = 'adult';
    } else if (session?.ageStatus) {
      const status = session.ageStatus.toUpperCase();
      if (status.includes('CHILD') || status.includes('UNDER')) resolvedMode = 'kid';
      else if (status.includes('TEEN')) resolvedMode = 'teen';
      else resolvedMode = 'adult';
    } else {
      resolvedMode = 'teen'; // Default fallback
    }
  }

  return (
    <HouseholdApp
      key={resolvedMode}
      ageMode={resolvedMode}
      sessionId={sessionId}
      onSignOut={onSignOut}
      onOpenSettings={onOpenSettings}
    />
  );
}

export default function App() {
  // Session persistence across launches
  const [sessionId, setSessionId] = useState(() => localStorage.getItem(SESSION_KEY) || undefined);
  const [challengeId, setChallengeId] = useState(() => localStorage.getItem(CHALLENGE_KEY) || undefined);
  const [forcedAgeMode, setForcedAgeMode] = useState(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

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
    setSessionId(newSessionId);
    if (newSessionId) {
      localStorage.setItem(SESSION_KEY, newSessionId);

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
    setChallengeId(newChallengeId);
    if (newChallengeId) {
      localStorage.setItem(CHALLENGE_KEY, newChallengeId);
    }
  };

  const handleClaim = async (claimToken) => {
    console.log('[k-ID] onClaim received claimToken. Forwarding to backend...');
    try {
      const res = await fetch('/api/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claimToken })
      });
      const data = await res.json();
      console.log('[k-ID Backend Claim Response]:', data);
    } catch (err) {
      console.error('[k-ID] Failed to send claimToken to backend:', err);
    }
  };

  const handleSignOut = () => {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(CHALLENGE_KEY);
    setSessionId(undefined);
    setChallengeId(undefined);
    setForcedAgeMode(null);

    const url = new URL(window.location);
    url.searchParams.delete('mock-age');
    window.history.replaceState({}, '', url);
  };

  const handleForceMode = (mode) => {
    setForcedAgeMode(mode);
    const url = new URL(window.location);
    url.searchParams.set('mock-age', mode);
    window.history.replaceState({}, '', url);
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

          {/* Floating Demo Bar */}
          <div className="demo-bar">
            <span className="label">Demo Mode:</span>
            <button
              className={`demo-btn ${forcedAgeMode === 'kid' ? 'active' : ''}`}
              onClick={() => handleForceMode('kid')}
            >
              🧒 Kid
            </button>
            <button
              className={`demo-btn ${forcedAgeMode === 'teen' ? 'active' : ''}`}
              onClick={() => handleForceMode('teen')}
            >
              🧑 Teen
            </button>
            <button
              className={`demo-btn ${forcedAgeMode === 'adult' ? 'active' : ''}`}
              onClick={() => handleForceMode('adult')}
            >
              👤 Adult
            </button>
            <button
              className="demo-btn demo-perm"
              onClick={() => setIsSettingsOpen(true)}
            >
              ⚙️ Permissions
            </button>
            <button
              className="demo-btn reset"
              onClick={handleSignOut}
            >
              🔒 Re-lock
            </button>
          </div>
        </div>
      </DemoModeContext.Provider>
    );
  }

  // Full k-ID SDK Age Gate Provider flow
  return (
    <KidCoreProvider
      publishableKey={K_ID_CONFIG.publishableKey}
      baseUrl={K_ID_CONFIG.baseUrl}
      declare={K_ID_CONFIG.declare}
      appearance={K_ID_CONFIG.appearance}
    >
      <KidSessionProvider
        jurisdiction="auto"
        sessionId={sessionId}
        challengeId={challengeId}
        onSession={handleSession}
        onChallenge={handleChallenge}
        onClaim={handleClaim}
      >
        <div className="app-container" style={{ minHeight: '100vh', backgroundColor: '#090d16', color: '#f8fafc' }}>
          {/* k-ID All-In-One Age Gate Container */}
          <GateFrame>
              <KidAgeGate>
                {/* 1. Pending slot: Waiting on parent email consent */}
                <KidAgeGatePending>
                  <div style={styles.slotCard}>
                    <Clock size={40} color="#f59e0b" style={{ marginBottom: 16 }} />
                    <h2 style={styles.slotTitle}>Parental Consent Requested</h2>
                    <p style={styles.slotDesc}>
                      We have sent an approval link to your parent or guardian. As soon as they approve, Home Helper will automatically unlock!
                    </p>
                  </div>
                </KidAgeGatePending>

                {/* 2. Prohibited slot: Under jurisdiction minimum age */}
                <KidAgeGateProhibited>
                  <div style={styles.slotCard}>
                    <XCircle size={40} color="#ef4444" style={{ marginBottom: 16 }} />
                    <h2 style={styles.slotTitle}>Age Requirement Notice</h2>
                    <p style={styles.slotDesc}>
                      Under local safety regulations, users under the required minimum age cannot access this application.
                    </p>
                    <button onClick={handleSignOut} style={styles.retryBtn}>
                      Try Again
                    </button>
                  </div>
                </KidAgeGateProhibited>

                {/* 3. Fail slot: Consent denied or challenge expired */}
                <KidAgeGateFail>
                  <div style={styles.slotCard}>
                    <AlertTriangle size={40} color="#f87171" style={{ marginBottom: 16 }} />
                    <h2 style={styles.slotTitle}>Verification Incomplete</h2>
                    <p style={styles.slotDesc}>
                      The age verification request was not completed or consent was declined.
                    </p>
                    <button onClick={handleSignOut} style={styles.retryBtn}>
                      Start Over
                    </button>
                  </div>
                </KidAgeGateFail>

                {/* 4. Error slot: Coarse SDK / network failure */}
                <KidAgeGateError>
                  <div style={styles.slotCard}>
                    <AlertTriangle size={40} color="#f59e0b" style={{ marginBottom: 16 }} />
                    <h2 style={styles.slotTitle}>Connection Notice</h2>
                    <p style={styles.slotDesc}>
                      Could not reach k-ID authentication service. Please check your connection.
                    </p>
                    <button onClick={handleSignOut} style={styles.retryBtn}>
                      Retry Connection
                    </button>
                  </div>
                </KidAgeGateError>

                {/* 5. Pass slot: Verified and unlocked! */}
                <KidAgeGatePass>
                  <VerifiedApp
                    sessionId={sessionId}
                    forcedMode={forcedAgeMode}
                    onSignOut={handleSignOut}
                    onOpenSettings={() => setIsSettingsOpen(true)}
                  />
                </KidAgeGatePass>
              </KidAgeGate>
          </GateFrame>

          {/* Settings Modal */}
          <SettingsModal
            sessionId={sessionId}
            isOpen={isSettingsOpen}
            onClose={() => setIsSettingsOpen(false)}
          />

          {/* Floating Demo Bar for judges and live testing */}
          <div className="demo-bar">
            <span className="label">Live Demo Fast-Track:</span>
            <button className="demo-btn" onClick={() => handleForceMode('kid')}>
              🧒 Kid
            </button>
            <button className="demo-btn" onClick={() => handleForceMode('teen')}>
              🧑 Teen
            </button>
            <button className="demo-btn" onClick={() => handleForceMode('adult')}>
              👤 Adult
            </button>
            <button className="demo-btn demo-perm" onClick={() => setIsSettingsOpen(true)}>
              ⚙️ Permissions
            </button>
          </div>
        </div>
      </KidSessionProvider>
    </KidCoreProvider>
  );
}

const styles = {
  topHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '14px 16px',
    gap: '12px',
    borderBottom: '1px solid #1e293b',
    backgroundColor: '#0c1220',
  },
  brandTitle: {
    fontSize: '20px',
    fontWeight: '800',
    whiteSpace: 'nowrap',
    background: 'linear-gradient(135deg, #ffffff 0%, #cbd5e1 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  badge: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '11px',
    fontWeight: '700',
    letterSpacing: '0.5px',
    textTransform: 'uppercase',
    background: 'rgba(99, 102, 241, 0.15)',
    color: '#a5b4fc',
    border: '1px solid rgba(99, 102, 241, 0.3)',
    padding: '6px 12px',
    borderRadius: '9999px',
    whiteSpace: 'nowrap',
  },
  gateMain: {
    maxWidth: '520px',
    margin: '24px auto',
    padding: '0 16px 80px',
    width: '100%',
  },
  gateWrapper: {
    backgroundColor: '#131c2e',
    border: '1px solid #1e293b',
    borderRadius: '18px',
    padding: '12px',
    boxShadow: '0 20px 40px -15px rgba(0, 0, 0, 0.7)',
  },
  slotCard: {
    textAlign: 'center',
    padding: '32px 16px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  slotTitle: {
    fontSize: '20px',
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: '10px',
  },
  slotDesc: {
    fontSize: '14px',
    color: '#94a3b8',
    lineHeight: 1.6,
    maxWidth: '380px',
    marginBottom: '20px',
  },
  retryBtn: {
    backgroundColor: '#1e293b',
    border: '1px solid #334155',
    color: '#ffffff',
    padding: '10px 20px',
    borderRadius: '10px',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
  }
};
