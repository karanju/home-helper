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
  useKidSession
} from '@k-id/core';
import KidMode from './components/KidMode';
import TeenMode from './components/TeenMode';
import AdultMode from './components/AdultMode';
import SettingsModal from './components/SettingsModal';
import { Shield, Sparkles, Clock, AlertTriangle, XCircle, Sliders } from 'lucide-react';

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

// Inner component rendered once the player passes the k-ID age gate
function VerifiedApp({ sessionId, forcedMode, onSignOut, onOpenSettings }) {
  const { session, ageVerification } = useKidSession();

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
    <>
      {resolvedMode === 'kid' ? (
        <KidMode onSignOut={onSignOut} sessionId={sessionId} onOpenSettings={onOpenSettings} />
      ) : resolvedMode === 'teen' ? (
        <TeenMode onSignOut={onSignOut} sessionId={sessionId} onOpenSettings={onOpenSettings} />
      ) : (
        <AdultMode onSignOut={onSignOut} sessionId={sessionId} onOpenSettings={onOpenSettings} />
      )}
    </>
  );
}

export default function App() {
  // Session persistence across launches
  const [sessionId, setSessionId] = useState(() => localStorage.getItem('kid_session_id') || undefined);
  const [challengeId, setChallengeId] = useState(() => localStorage.getItem('kid_challenge_id') || undefined);
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
      localStorage.setItem('kid_session_id', newSessionId);

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
      localStorage.setItem('kid_challenge_id', newChallengeId);
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
    localStorage.removeItem('kid_session_id');
    localStorage.removeItem('kid_challenge_id');
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

  // If ?mock-age bypass is active, render immediately to guarantee demo uptime
  if (forcedAgeMode) {
    return (
      <KidCoreProvider
        publishableKey={K_ID_CONFIG.publishableKey}
        baseUrl={K_ID_CONFIG.baseUrl}
        declare={K_ID_CONFIG.declare}
      >
        <div className="app-container">
          <VerifiedApp
            sessionId={sessionId || 'demo_session'}
            forcedMode={forcedAgeMode}
            onSignOut={handleSignOut}
            onOpenSettings={() => setIsSettingsOpen(true)}
          />

          <SettingsModal
            sessionId={sessionId || 'demo_session'}
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
              className="demo-btn"
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
      </KidCoreProvider>
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
          {/* Top Brand Header */}
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

          {/* k-ID All-In-One Age Gate Container */}
          <main style={styles.gateMain}>
            <div style={styles.gateWrapper}>
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
            </div>
          </main>

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
            <button className="demo-btn" onClick={() => setIsSettingsOpen(true)}>
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
    padding: '18px 32px',
    borderBottom: '1px solid #1e293b',
    backgroundColor: '#0c1220',
  },
  brandTitle: {
    fontSize: '20px',
    fontWeight: '800',
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
  },
  gateMain: {
    maxWidth: '520px',
    margin: '36px auto',
    padding: '0 20px 80px',
    width: '100%',
  },
  gateWrapper: {
    backgroundColor: '#131c2e',
    border: '1px solid #1e293b',
    borderRadius: '18px',
    padding: '24px',
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
