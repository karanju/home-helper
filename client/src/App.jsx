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
import { Shield, Clock, AlertTriangle, XCircle } from 'lucide-react';

const K_ID_CONFIG = {
  publishableKey: 'kgp_test_gdx5ffioppaaaeysyjxri3esr7ckgmkpgjy3pgsf3m5swco7op5u55oa5r4u3ji',
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

const SESSION_KEY = 'kid_session_id';
const CHALLENGE_KEY = 'kid_challenge_id';

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
    console.log('[k-ID] Signing out and resetting session...');
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(CHALLENGE_KEY);
    sessionStorage.clear();
    setSessionId(undefined);
    setChallengeId(undefined);
    setForcedAgeMode(null);
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

  // Full k-ID SDK Age Gate Provider flow
  return (
    <KidCoreProvider
      publishableKey={K_ID_CONFIG.publishableKey}
      baseUrl={K_ID_CONFIG.baseUrl}
      declare={K_ID_CONFIG.declare}
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
