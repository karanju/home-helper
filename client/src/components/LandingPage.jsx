import React, { useState, useEffect } from 'react';
import { ShieldCheck, Sparkles, AlertCircle, ArrowRight } from 'lucide-react';

export default function LandingPage({ onVerified, mockAgeParam }) {
  const [widgetUrl, setWidgetUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Fetch widget URL from backend endpoint: POST /widget/generate-e2e-url
  useEffect(() => {
    async function loadWidgetUrl() {
      try {
        setLoading(true);
        const res = await fetch('/widget/generate-e2e-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ redirectUrl: window.location.origin, flowType: 'age_gate' })
        });
        if (!res.ok) {
          throw new Error(`Server returned ${res.status}`);
        }
        const data = await res.json();
        // Use provided URL or fallback to local widget sandbox
        setWidgetUrl(data.url || '/widget-sandbox.html');
      } catch (err) {
        console.warn('Failed to fetch widget URL from backend, using local sandbox fallback:', err);
        setWidgetUrl('/widget-sandbox.html');
      } finally {
        setLoading(false);
      }
    }

    loadWidgetUrl();
  }, []);

  // Listen for the Widget.AgeGate.Result postMessage event
  useEffect(() => {
    function handlePostMessage(event) {
      const data = event.data;
      if (!data) return;

      console.log('[Parent Window] Received postMessage:', data);

      // Check for k-ID Widget.AgeGate.Result event
      const isKidEvent = data.type === 'Widget.AgeGate.Result' || data.event === 'Widget.AgeGate.Result';
      const isPassed = data.status === 'PASS' || data.result === 'PASS';

      if (isKidEvent && isPassed) {
        const sessionId = data.sessionId || 'kid_sess_verified';
        // Extract age bracket or default to kid/teen/adult
        let verifiedAge = data.ageMode || data.ageBracket;
        if (!['kid', 'teen', 'adult'].includes(verifiedAge)) {
          // If age is a number, map it
          if (typeof verifiedAge === 'number') {
            if (verifiedAge < 13) verifiedAge = 'kid';
            else if (verifiedAge < 18) verifiedAge = 'teen';
            else verifiedAge = 'adult';
          } else {
            verifiedAge = 'teen'; // sensible default if unspecified
          }
        }

        console.log(`[k-ID] Age Gate PASSED. Session: ${sessionId}, Mode: ${verifiedAge}`);
        onVerified({ sessionId, ageMode: verifiedAge });
      }
    }

    window.addEventListener('message', handlePostMessage);
    return () => window.removeEventListener('message', handlePostMessage);
  }, [onVerified]);

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <div style={styles.brand}>
          <span style={styles.brandIcon}>🏠</span>
          <span style={styles.brandTitle}>Home Helper</span>
        </div>
        <div style={styles.hackathonBadge}>
          Google + k-ID Hackathon
        </div>
      </header>

      <main style={styles.main}>
        <div style={styles.heroText}>
          <h1 style={styles.headline}>One Household, Three Ages</h1>
          <p style={styles.subheadline}>
            An age-aware smart home assistant that safely reshapes its interface, capabilities, and AI guardrails to match whoever is using it.
          </p>
        </div>

        {/* Demo Fast-Track Banner */}
        <div style={styles.demoBox}>
          <div style={styles.demoBoxHeader}>
            <Sparkles size={16} color="#fbbf24" />
            <span style={styles.demoBoxTitle}>Judges & Live Demo Fallback</span>
          </div>
          <p style={styles.demoBoxText}>
            Test without waiting or use the URL parameter <code>?mock-age=kid|teen|adult</code>:
          </p>
          <div style={styles.demoButtons}>
            <button
              onClick={() => onVerified({ sessionId: 'demo_kid', ageMode: 'kid' })}
              style={{ ...styles.bypassBtn, borderColor: '#f59e0b', color: '#fef3c7' }}
            >
              🧒 Kid Mode (&lt;13)
            </button>
            <button
              onClick={() => onVerified({ sessionId: 'demo_teen', ageMode: 'teen' })}
              style={{ ...styles.bypassBtn, borderColor: '#06b6d4', color: '#cffafe' }}
            >
              🧑 Teen Mode (13-17)
            </button>
            <button
              onClick={() => onVerified({ sessionId: 'demo_adult', ageMode: 'adult' })}
              style={{ ...styles.bypassBtn, borderColor: '#10b981', color: '#d1fae5' }}
            >
              👤 Adult Mode (18+)
            </button>
          </div>
        </div>

        {/* k-ID Iframe Container */}
        <div style={styles.iframeCard}>
          <div style={styles.iframeCardHeader}>
            <ShieldCheck size={18} color="#818cf8" />
            <span style={styles.iframeTitle}>k-ID Age Verification Gate</span>
          </div>

          <div style={styles.iframeWrapper}>
            {loading ? (
              <div style={styles.loadingContainer}>
                <div style={styles.spinner}></div>
                <p style={{ marginTop: 12, color: '#94a3b8', fontSize: 14 }}>Connecting to k-ID verification session...</p>
              </div>
            ) : error ? (
              <div style={styles.errorContainer}>
                <AlertCircle size={24} color="#f87171" />
                <p style={{ marginTop: 8, color: '#f87171' }}>{error}</p>
              </div>
            ) : (
              /* ========================================================================= */
              /* k-ID WIDGET EMBED SLOT                                                    */
              /* Contract: Renders iframe slot for k-ID widget.                            */
              /* Listens for postMessage: { type: 'Widget.AgeGate.Result', status: 'PASS' }*/
              /* When official snippet arrives, it drops in here with zero other changes.  */
              /* ========================================================================= */
              <iframe
                id="kid-agegate-iframe"
                src={widgetUrl}
                title="k-ID Age Verification"
                style={styles.iframe}
                allow="camera; microphone"
              />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

const styles = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: '#090d16',
    color: '#f8fafc',
    paddingBottom: '80px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '20px 32px',
    borderBottom: '1px solid #1e293b',
  },
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  brandIcon: {
    fontSize: '26px',
  },
  brandTitle: {
    fontSize: '20px',
    fontWeight: '800',
    letterSpacing: '-0.5px',
    background: 'linear-gradient(135deg, #ffffff 0%, #cbd5e1 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  hackathonBadge: {
    fontSize: '11px',
    fontWeight: '700',
    letterSpacing: '0.5px',
    textTransform: 'uppercase',
    background: 'rgba(99, 102, 241, 0.15)',
    color: '#a5b4fc',
    border: '1px solid rgba(99, 102, 241, 0.3)',
    padding: '6px 14px',
    borderRadius: '9999px',
  },
  main: {
    maxWidth: '840px',
    margin: '0 auto',
    padding: '36px 20px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    width: '100%',
  },
  heroText: {
    textAlign: 'center',
    marginBottom: '28px',
  },
  headline: {
    fontSize: '36px',
    fontWeight: '800',
    letterSpacing: '-1px',
    marginBottom: '12px',
    background: 'linear-gradient(135deg, #ffffff 0%, #94a3b8 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  subheadline: {
    color: '#94a3b8',
    fontSize: '16px',
    maxWidth: '580px',
    lineHeight: 1.6,
    margin: '0 auto',
  },
  demoBox: {
    width: '100%',
    maxWidth: '560px',
    background: 'rgba(30, 41, 59, 0.7)',
    border: '1px dashed #475569',
    borderRadius: '14px',
    padding: '16px 20px',
    marginBottom: '24px',
  },
  demoBoxHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '6px',
  },
  demoBoxTitle: {
    fontSize: '13px',
    fontWeight: '700',
    color: '#fbbf24',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  demoBoxText: {
    fontSize: '13px',
    color: '#cbd5e1',
    marginBottom: '12px',
  },
  demoButtons: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
    gap: '10px',
  },
  bypassBtn: {
    background: '#0f172a',
    border: '1px solid',
    padding: '9px 12px',
    borderRadius: '10px',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'transform 0.15s, background 0.15s',
  },
  iframeCard: {
    width: '100%',
    maxWidth: '560px',
    background: '#131c2e',
    border: '1px solid #1e293b',
    borderRadius: '18px',
    overflow: 'hidden',
    boxShadow: '0 20px 40px -15px rgba(0, 0, 0, 0.7)',
  },
  iframeCardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '14px 20px',
    background: '#1a233a',
    borderBottom: '1px solid #273552',
  },
  iframeTitle: {
    fontSize: '13px',
    fontWeight: '600',
    color: '#cbd5e1',
  },
  iframeWrapper: {
    width: '100%',
    minHeight: '460px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#0f172a',
  },
  iframe: {
    width: '100%',
    height: '480px',
    border: 'none',
    display: 'block',
  },
  loadingContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '400px',
  },
  spinner: {
    width: '36px',
    height: '36px',
    border: '3px solid #334155',
    borderTopColor: '#6366f1',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },
  errorContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '24px',
  }
};

