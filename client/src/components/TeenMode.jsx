import React, { useState } from 'react';
import './teen-layout.css';
import { ChefHat, Flame, ShieldAlert, Send, Sparkles, AlertTriangle, LogOut, Clock, Check, Shield } from 'lucide-react';
import { KidPermission } from '@k-id/core';

export default function TeenMode({ onSignOut, sessionId, onOpenSettings }) {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      text: 'Hey! I am your kitchen and household assistant. Need an easy after-school snack, quick dinner recipe, or microwave hack? Ask me below! (Kitchen safety reminders are always included.)'
    }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const quickPrompts = [
    'How do I make a crispy grilled cheese without burning it?',
    'What easy snacks can I make in 5 minutes with eggs?',
    'How do I safely boil pasta and know when it is done?'
  ];

  const handleSend = async (textToSend) => {
    const userMsg = textToSend || input;
    if (!userMsg.trim() || loading) return;

    setInput('');
    const newMessages = [...messages, { role: 'user', text: userMsg }];
    setMessages(newMessages);
    setLoading(true);

    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg, ageMode: 'teen', sessionId })
      });

      const data = await res.json();
      if (res.ok) {
        setMessages([...newMessages, { role: 'assistant', text: data.reply, model: data.modelUsed }]);
      } else {
        setMessages([...newMessages, { role: 'assistant', text: `⚠️ ${data.error || 'Failed to get answer. Please check Gemini API configuration.'}` }]);
      }
    } catch (err) {
      setMessages([...newMessages, { role: 'assistant', text: `⚠️ Network error: ${err.message}` }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="teen-site" style={styles.container}>
      {/* Header */}
      <header className="teen-header" style={styles.header}>
        <div className="teen-header-left" style={styles.headerLeft}>
          <div className="teen-avatar" style={styles.avatar}>🧑</div>
          <div>
            <div className="teen-title-row" style={styles.titleRow}>
              <h1 className="teen-title" style={styles.title}>Teen Culinary & Home Hub</h1>
              <span style={styles.verifiedTag}>🛡️ k-ID Verified 13–17</span>
            </div>
            <p className="teen-subtitle" style={styles.subtitle}>Cooking independence + smart safety guardrails</p>
          </div>
        </div>

        <div className="teen-header-actions" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {onOpenSettings && (
            <button onClick={onOpenSettings} style={styles.settingsHeaderBtn} title="Manage k-ID Permissions">
              <Shield size={16} color="#06b6d4" />
              <span>Permissions</span>
            </button>
          )}
          <button onClick={onSignOut} style={styles.signOutBtn}>
            <LogOut size={16} />
            <span>Exit</span>
          </button>
        </div>
      </header>

      {/* Safety Guardrails Banner */}
      <div className="teen-guardrails" style={styles.guardrailCard}>
        <div style={styles.guardrailHeader}>
          <ShieldAlert size={18} color="#06b6d4" />
          <span style={styles.guardrailTitle}>Active Kitchen Safety Guardrails</span>
        </div>
        <div className="teen-safety-badges" style={styles.safetyBadges}>
          <span style={styles.safetyPill}><Check size={14} color="#06b6d4" /> Stove/Oven shutoff checks</span>
          <span style={styles.safetyPill}><Check size={14} color="#06b6d4" /> Safe knife grip reminders</span>
          <span style={styles.safetyPill}><Check size={14} color="#06b6d4" /> Microwave metal prevention</span>
        </div>
      </div>

      <div className="teen-main-layout" style={styles.mainLayout}>
        {/* Quick Safety Cards Sidebar */}
        <aside className="teen-sidebar" style={styles.sidebar}>
          <h2 style={styles.sidebarTitle}>🔥 Kitchen Rules</h2>
          <div style={styles.ruleCard}>
            <div style={styles.ruleHeader}>
              <Flame size={16} color="#f97316" />
              <span>Stove & Heat</span>
            </div>
            <p style={styles.ruleText}>Never leave a pan unattended on the burner. Turn pan handles inward.</p>
          </div>

          <div style={styles.ruleCard}>
            <div style={styles.ruleHeader}>
              <AlertTriangle size={16} color="#eab308" />
              <span>Knife Handling</span>
            </div>
            <p style={styles.ruleText}>Curl non-knife fingers into a "claw" when slicing vegetables.</p>
          </div>

          <h3 style={{ ...styles.sidebarTitle, marginTop: '20px' }}>⚡ Quick Ideas</h3>
          <div className="teen-quick-prompts-list" style={styles.quickPromptsList}>
            {quickPrompts.map((q, idx) => (
              <button
                key={idx}
                onClick={() => handleSend(q)}
                style={styles.quickBtn}
              >
                {q}
              </button>
            ))}
          </div>
        </aside>

        {/* AI Chat Area with k-ID Permission Guard */}
        <div className="teen-chat-column">
        <KidPermission
          name="ai-chat"
          fallback={
            <section style={{ ...styles.chatSection, padding: '40px 24px', textAlign: 'center', justifyContent: 'center', alignItems: 'center' }}>
              <ShieldAlert size={44} color="#06b6d4" style={{ marginBottom: 16 }} />
              <h2 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '8px', color: '#ffffff' }}>
                AI Chat Feature Restricted
              </h2>
              <p style={{ color: '#94a3b8', fontSize: '13px', maxWidth: '380px', lineHeight: 1.5, marginBottom: '20px' }}>
                The <code>ai-chat</code> capability is managed by your k-ID safety profile. It can be enabled by a guardian in permissions.
              </p>
              {onOpenSettings && (
                <button onClick={onOpenSettings} style={styles.settingsHeaderBtn}>
                  <Shield size={16} />
                  <span>Open Permission Settings</span>
                </button>
              )}
            </section>
          }
        >
          <section style={styles.chatSection}>
            <div style={styles.chatHeader}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <ChefHat size={20} color="#06b6d4" />
                <h2 style={{ fontSize: '16px', fontWeight: '700' }}>Teen Chef & Home Assistant</h2>
              </div>
              <span style={styles.geminiTag}>Powered by Gemini Flash</span>
            </div>

            <div style={styles.messagesContainer}>
              {messages.map((msg, idx) => (
                <div
                  key={idx}
                  style={{
                    ...styles.messageWrapper,
                    justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start'
                  }}
                >
                  <div
                    style={{
                      ...styles.messageBubble,
                      backgroundColor: msg.role === 'user' ? '#0891b2' : '#1e293b',
                      borderColor: msg.role === 'user' ? '#06b6d4' : '#334155'
                    }}
                  >
                    <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{msg.text}</p>
                    {msg.model && (
                      <span style={styles.modelTag}>{msg.model}</span>
                    )}
                  </div>
                </div>
              ))}
              {loading && (
                <div style={styles.loadingBubble}>
                  <Sparkles size={16} color="#06b6d4" className="spin-icon" />
                  <span>Chef Assistant is formulating recipe & safety checks...</span>
                </div>
              )}
            </div>

            {/* Chat Input */}
            <form
              onSubmit={(e) => { e.preventDefault(); handleSend(); }}
              style={styles.inputForm}
            >
              <input
                type="text"
                placeholder="Ask for recipe ideas, cooking times, or safe prep..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                style={styles.inputField}
                disabled={loading}
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                style={{
                  ...styles.sendBtn,
                  opacity: (loading || !input.trim()) ? 0.5 : 1
                }}
              >
                <Send size={16} />
                <span>Ask</span>
              </button>
            </form>
          </section>
        </KidPermission>
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#090e17',
    color: '#f8fafc',
    paddingBottom: '80px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '20px 32px',
    backgroundColor: '#0f172a',
    borderBottom: '1px solid #1e293b',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '14px',
  },
  avatar: {
    fontSize: '36px',
    backgroundColor: '#1e293b',
    padding: '8px',
    borderRadius: '14px',
    border: '2px solid #06b6d4',
  },
  titleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  title: {
    fontSize: '22px',
    fontWeight: '800',
    color: '#e2e8f0',
  },
  verifiedTag: {
    fontSize: '11px',
    fontWeight: '700',
    backgroundColor: 'rgba(6, 182, 212, 0.15)',
    color: '#22d3ee',
    padding: '3px 10px',
    borderRadius: '9999px',
    border: '1px solid rgba(6, 182, 212, 0.3)',
  },
  subtitle: {
    fontSize: '13px',
    color: '#94a3b8',
    marginTop: '2px',
  },
  signOutBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    backgroundColor: '#1e293b',
    border: '1px solid #334155',
    color: '#cbd5e1',
    padding: '8px 14px',
    borderRadius: '10px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: '600',
  },
  settingsHeaderBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    backgroundColor: 'rgba(6, 182, 212, 0.15)',
    border: '1px solid rgba(6, 182, 212, 0.4)',
    color: '#22d3ee',
    padding: '8px 14px',
    borderRadius: '10px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: '600',
  },
  guardrailCard: {
    maxWidth: '1100px',
    margin: '18px auto 0',
    backgroundColor: 'rgba(6, 182, 212, 0.08)',
    border: '1px solid rgba(6, 182, 212, 0.25)',
    borderRadius: '14px',
    padding: '12px 20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: '12px',
    width: '92%',
  },
  guardrailHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  guardrailTitle: {
    fontSize: '13px',
    fontWeight: '700',
    color: '#22d3ee',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  safetyBadges: {
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap',
  },
  safetyPill: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    fontSize: '12px',
    backgroundColor: '#0f172a',
    padding: '4px 10px',
    borderRadius: '9999px',
    color: '#cbd5e1',
    border: '1px solid #1e293b',
  },
  mainLayout: {
    maxWidth: '1100px',
    margin: '20px auto',
    padding: '0 20px',
    display: 'grid',
    gridTemplateColumns: '300px 1fr',
    gap: '20px',
    width: '100%',
  },
  sidebar: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  sidebarTitle: {
    fontSize: '14px',
    fontWeight: '700',
    color: '#cbd5e1',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  ruleCard: {
    backgroundColor: '#131c2e',
    border: '1px solid #1e293b',
    borderRadius: '12px',
    padding: '12px 14px',
  },
  ruleHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '13px',
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: '4px',
  },
  ruleText: {
    fontSize: '12px',
    color: '#94a3b8',
    lineHeight: 1.4,
  },
  quickPromptsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  quickBtn: {
    backgroundColor: '#131c2e',
    border: '1px solid #1e293b',
    color: '#94a3b8',
    padding: '10px 12px',
    borderRadius: '10px',
    textAlign: 'left',
    fontSize: '12px',
    cursor: 'pointer',
    lineHeight: 1.4,
    transition: 'all 0.15s ease',
  },
  chatSection: {
    backgroundColor: '#131c2e',
    border: '1px solid #1e293b',
    borderRadius: '16px',
    display: 'flex',
    flexDirection: 'column',
    height: '600px',
    overflow: 'hidden',
  },
  chatHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 20px',
    borderBottom: '1px solid #1e293b',
    backgroundColor: '#0f172a',
  },
  geminiTag: {
    fontSize: '11px',
    color: '#94a3b8',
    backgroundColor: '#1e293b',
    padding: '3px 8px',
    borderRadius: '6px',
  },
  messagesContainer: {
    flex: 1,
    overflowY: 'auto',
    padding: '20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
  },
  messageWrapper: {
    display: 'flex',
    width: '100%',
  },
  messageBubble: {
    maxWidth: '80%',
    padding: '12px 16px',
    borderRadius: '14px',
    border: '1px solid',
    fontSize: '14px',
  },
  modelTag: {
    display: 'block',
    marginTop: '6px',
    fontSize: '10px',
    color: '#94a3b8',
    fontStyle: 'italic',
  },
  loadingBubble: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '13px',
    color: '#22d3ee',
    backgroundColor: '#0f172a',
    padding: '10px 16px',
    borderRadius: '12px',
    width: 'fit-content',
  },
  inputForm: {
    display: 'flex',
    gap: '10px',
    padding: '16px 20px',
    backgroundColor: '#0f172a',
    borderTop: '1px solid #1e293b',
  },
  inputField: {
    flex: 1,
    backgroundColor: '#1e293b',
    border: '1px solid #334155',
    color: '#ffffff',
    padding: '12px 16px',
    borderRadius: '10px',
    fontSize: '14px',
    outline: 'none',
  },
  sendBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    backgroundColor: '#0891b2',
    color: '#ffffff',
    border: 'none',
    padding: '0 18px',
    borderRadius: '10px',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
  }
};

