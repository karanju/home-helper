import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Circle, HelpCircle, ListChecks, LogOut, Plus, RotateCcw, Send, Shield, ShieldAlert, Sparkles, Trash2, Users, X } from 'lucide-react';
import { useFeature } from './FeatureGate';
import { authHeaders } from '../auth';
import { AGE_CONFIG, MEMBERS, SEED_CHORES } from '../household';
import './kid-mode.css';

const STORAGE_KEY = 'home_helper_chores_v1';
const MOBILE_QUERY = '(max-width: 720px)';

function loadChores() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (Array.isArray(saved)) {
      const savedIds = new Set(saved.map(chore => chore.id));
      return [...saved, ...SEED_CHORES.filter(chore => !savedIds.has(chore.id))];
    }
  } catch {}
  return SEED_CHORES;
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const onChange = () => setIsMobile(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return isMobile;
}

// Gemini replies use light markdown; render headings, bullets and **bold** without a library
function RichText({ text }) {
  const inline = (line) =>
    line.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part
    );

  return text.split('\n').map((raw, i) => {
    const line = raw.trimEnd();
    if (!line.trim() || /^-{3,}$/.test(line.trim())) return <div key={i} style={{ height: 6 }} />;
    const heading = line.match(/^#{1,6}\s+(.*)/);
    if (heading) return <div key={i} style={{ fontWeight: 700, marginTop: 6 }}>{inline(heading[1])}</div>;
    const bullet = line.match(/^\s*[*-]\s+(.*)/);
    if (bullet) return <div key={i} style={{ paddingLeft: 14, textIndent: -10 }}>• {inline(bullet[1])}</div>;
    return <div key={i}>{inline(line)}</div>;
  });
}

export default function HouseholdApp({ ageMode, sessionId, familyName, onSignOut, onOpenSettings, onOpenFamily }) {
  const config = AGE_CONFIG[ageMode];
  const canUseAi = useFeature('ai-chat');
  const isMobile = useIsMobile();

  const [chores, setChores] = useState(loadChores);
  const [memberFilter, setMemberFilter] = useState('all');
  const [newTitle, setNewTitle] = useState('');
  const [newAssignee, setNewAssignee] = useState(ageMode);
  const [selectedChoreId, setSelectedChoreId] = useState(null);

  const [messages, setMessages] = useState([{ role: 'assistant', text: config.helperIntro }]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesRef = useRef(null);

  // On phones the list and the helper are two tabs instead of two columns
  const [mobileTab, setMobileTab] = useState('chores');
  const [helperUnread, setHelperUnread] = useState(false);
  const mobileTabRef = useRef(mobileTab);
  mobileTabRef.current = mobileTab;

  useEffect(() => {
    if (!selectedChoreId) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setSelectedChoreId(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [selectedChoreId]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(chores));
    } catch {}
  }, [chores]);

  // Scroll only the message list, never the page (scrollIntoView would jump the page on load)
  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, loading, mobileTab]);

  const visibleChores = config.seesWholeFamily
    ? chores.filter(c => memberFilter === 'all' || c.assignee === memberFilter)
    : chores.filter(c => c.assignee === ageMode);
  const doneCount = visibleChores.filter(c => c.done).length;
  const earned = visibleChores.filter(c => c.done).reduce((sum, c) => sum + (c.points || 0), 0);
  const selectedChore = chores.find(c => c.id === selectedChoreId);

  const toggleChore = (id) => setChores(prev => prev.map(c => (c.id === id ? { ...c, done: !c.done } : c)));
  const removeChore = (id) => setChores(prev => prev.filter(c => c.id !== id));
  const startNewDay = () => setChores(prev => prev.map(c => ({ ...c, done: false })));

  const showTab = (tab) => {
    setMobileTab(tab);
    if (tab === 'helper') setHelperUnread(false);
    window.scrollTo({ top: 0 });
  };

  const addChore = (e) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    const assignee = config.canAssignOthers ? newAssignee : ageMode;
    setChores(prev => [
      ...prev,
      { id: Date.now(), emoji: '📝', title: newTitle.trim(), assignee, points: assignee === 'adult' ? 0 : 15, done: false, steps: [] }
    ]);
    setNewTitle('');
  };

  const askHelper = async (text) => {
    const question = (text ?? input).trim();
    if (!question || loading) return;

    setInput('');
    const next = [...messages, { role: 'user', text: question }];
    setMessages(next);
    setLoading(true);

    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ message: question, ageMode, sessionId })
      });
      const data = await res.json();
      setMessages([...next, { role: 'assistant', text: res.ok ? data.reply : `⚠️ ${data.error || 'The helper is unavailable right now.'}` }]);
    } catch (err) {
      setMessages([...next, { role: 'assistant', text: `⚠️ Network error: ${err.message}` }]);
    } finally {
      setLoading(false);
      if (mobileTabRef.current !== 'helper') setHelperUnread(true);
    }
  };

  const explainChore = (chore) => {
    setSelectedChoreId(chore.id);
  };

  const accentButton = { ...styles.primaryBtn, backgroundColor: config.accent };
  const showChores = !isMobile || mobileTab === 'chores';
  const showHelper = !isMobile || mobileTab === 'helper';

  return (
    <div className={`household-app household-app-${ageMode}`} style={{ ...styles.container, fontFamily: config.font, paddingBottom: isMobile ? 'calc(150px + env(safe-area-inset-bottom))' : '90px' }}>
      {/* Header: identical for every age, only the badge, greeting and progress pill change */}
      <header style={{ ...styles.header, ...(isMobile && styles.headerMobile) }}>
        <div style={styles.headerLeft}>
          <div style={{ ...styles.avatar, ...(isMobile && styles.avatarMobile), borderColor: config.accent }}>{config.avatar}</div>
          <div style={{ minWidth: 0 }}>
            <div style={styles.titleRow}>
              <h1 style={{ ...styles.title, fontSize: isMobile ? 19 : 22 }}>Home Helper</h1>
              <span style={{ ...styles.ageBadge, color: config.accent, backgroundColor: config.accentSoft, borderColor: config.accent }}>
                🛡️ {config.label} · {config.badge}
              </span>
            </div>
            <p style={styles.subtitle}>{config.greeting}</p>
          </div>
        </div>

        <div style={{ ...styles.headerRight, ...(isMobile && { width: '100%' }) }}>
          <div style={{ ...styles.progressPill, borderColor: config.accent, backgroundColor: config.accentSoft, ...(isMobile && { marginRight: 'auto' }) }}>
            {config.reward
              ? <span>{config.reward.icon} {earned} {config.reward.unit}</span>
              : <span>✅ {doneCount}/{visibleChores.length} done</span>}
          </div>
          {onOpenSettings && (
            <button onClick={onOpenSettings} style={styles.ghostBtn} title="Manage k-ID permissions" aria-label="Permissions">
              <Shield size={18} color={config.accent} />
              {!isMobile && <span>Permissions</span>}
            </button>
          )}
          {onOpenFamily && (
            <button onClick={onOpenFamily} style={styles.ghostBtn} title="Family" aria-label="Family">
              <Users size={18} />
              {!isMobile && <span>{familyName || 'Family'}</span>}
            </button>
          )}
          <button onClick={onSignOut} style={styles.ghostBtn} aria-label="Exit">
            <LogOut size={18} />
            {!isMobile && <span>Exit</span>}
          </button>
        </div>
      </header>

      <main style={{ ...styles.grid, ...(isMobile && styles.gridMobile) }}>
        {/* Chore list */}
        {showChores && (
          <section className="household-card" style={{ ...styles.card, ...(isMobile && styles.cardMobile) }}>
            <div style={styles.cardHeader}>
              <h2 style={styles.cardTitle}>{config.listTitle}</h2>
              <span style={styles.muted}>{doneCount} / {visibleChores.length} completed</span>
            </div>

            <div style={styles.progressTrack}>
              <div style={{ ...styles.progressFill, backgroundColor: config.accent, width: `${visibleChores.length ? (doneCount / visibleChores.length) * 100 : 0}%` }} />
            </div>

            {config.seesWholeFamily && (
              <div style={styles.filterRow}>
                {['all', ...MEMBERS].map(m => (
                  <button
                    key={m}
                    onClick={() => setMemberFilter(m)}
                    style={{
                      ...styles.chip,
                      backgroundColor: memberFilter === m ? config.accent : '#1e293b',
                      color: memberFilter === m ? '#0b1120' : '#cbd5e1'
                    }}
                  >
                    {m === 'all' ? 'Everyone' : `${AGE_CONFIG[m].avatar} ${AGE_CONFIG[m].label}`}
                  </button>
                ))}
                <button onClick={startNewDay} style={{ ...styles.chip, marginLeft: 'auto' }} title="Uncheck every chore">
                  <RotateCcw size={12} /> New day
                </button>
              </div>
            )}

            <div style={styles.choreList}>
              {visibleChores.length === 0 && <p style={styles.muted}>No chores here yet.</p>}
              {visibleChores.map(chore => (
                <div
                  key={chore.id}
                  className={`household-chore-row${chore.done ? ' is-done' : ''}`}
                  style={{
                    ...styles.choreRow,
                    borderColor: selectedChoreId === chore.id ? config.accent : chore.done ? '#1f3b33' : '#273449',
                    opacity: chore.done ? 0.75 : 1
                  }}
                >
                  <button onClick={() => toggleChore(chore.id)} style={styles.iconBtn} aria-label={chore.done ? 'Mark not done' : 'Mark done'}>
                    {chore.done ? <CheckCircle2 color={config.accent} size={26} /> : <Circle color="#64748b" size={26} />}
                  </button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <button
                      type="button"
                      className="household-chore-title"
                      onClick={() => setSelectedChoreId(chore.id)}
                      style={{ ...styles.choreTitle, textDecoration: chore.done ? 'line-through' : 'none', background: 'none', border: 0, color: 'inherit', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', padding: 0 }}
                    >
                      {chore.emoji} {chore.title}
                    </button>
                    {(config.seesWholeFamily || (config.reward && chore.points > 0)) && (
                      <div style={styles.choreMeta}>
                        {config.seesWholeFamily && <span>{AGE_CONFIG[chore.assignee].avatar} {AGE_CONFIG[chore.assignee].label}</span>}
                        {config.reward && chore.points > 0 && (
                          <span style={{ color: config.accent, fontWeight: 700 }}>+{chore.points} {config.reward.icon}</span>
                        )}
                      </div>
                    )}
                  </div>
                  <button onClick={() => explainChore(chore)} style={isMobile ? styles.iconBtnBordered : styles.howBtn} title="How do I do this?" aria-label="How do I do this?">
                    <HelpCircle size={isMobile ? 18 : 15} />
                    {!isMobile && 'How?'}
                  </button>
                  {config.canAssignOthers && (
                    <button onClick={() => removeChore(chore.id)} style={styles.iconBtn} aria-label="Remove chore">
                      <Trash2 size={17} color="#f87171" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {config.reward && visibleChores.length > 0 && doneCount === visibleChores.length && (
              <div style={{ ...styles.celebrate, borderColor: config.accent, backgroundColor: config.accentSoft }}>
                <Sparkles size={18} color={config.accent} /> All done! Amazing work today.
              </div>
            )}

            {config.canAddChores && (
              <form onSubmit={addChore} style={{ ...styles.addForm, flexWrap: isMobile && config.canAssignOthers ? 'wrap' : 'nowrap' }}>
                <input
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder={config.canAssignOthers ? 'Add a chore for the family...' : 'Add a chore for yourself...'}
                  style={{ ...styles.input, ...(isMobile && config.canAssignOthers && { flexBasis: '100%' }) }}
                />
                {config.canAssignOthers && (
                  <select value={newAssignee} onChange={(e) => setNewAssignee(e.target.value)} style={{ ...styles.select, ...(isMobile && { flex: 1 }) }}>
                    {MEMBERS.map(m => <option key={m} value={m}>{AGE_CONFIG[m].label}</option>)}
                  </select>
                )}
                <button type="submit" style={accentButton} disabled={!newTitle.trim()}>
                  <Plus size={16} /> Add
                </button>
              </form>
            )}
          </section>
        )}

        {/* Helper: same panel for everyone; kids get tap-only questions, the AI tunes detail by age */}
        {showHelper && (
          <section className="household-card household-helper-card" style={{ ...styles.card, ...styles.helperCard, ...(isMobile && styles.cardMobile) }}>
            <div style={styles.cardHeader}>
              <h2 style={styles.cardTitle}>
                <Sparkles size={18} color={config.accent} style={{ verticalAlign: '-3px', marginRight: 6 }} />
                {config.helperName}
              </h2>
            </div>

            {config.safetyNote && (
              <div style={{ ...styles.safetyNote, borderColor: config.accent, backgroundColor: config.accentSoft }}>
                <ShieldAlert size={16} color={config.accent} style={{ flexShrink: 0 }} />
                <span>{config.safetyNote}</span>
              </div>
            )}

            {canUseAi ? (
              <>
                <div ref={messagesRef} style={{ ...styles.messages, height: isMobile ? 'max(200px, calc(100dvh - 580px))' : 380 }}>
                  {messages.map((msg, idx) => (
                    <div key={idx} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                      <div
                        style={{
                          ...styles.bubble,
                          backgroundColor: msg.role === 'user' ? config.accentSoft : '#1e293b',
                          borderColor: msg.role === 'user' ? config.accent : '#334155'
                        }}
                      >
                        <RichText text={msg.text} />
                      </div>
                    </div>
                  ))}
                  {loading && (
                    <div style={styles.muted}>
                      <Sparkles size={14} color={config.accent} style={{ verticalAlign: '-2px' }} /> {config.helperName} is thinking...
                    </div>
                  )}
                </div>

                <div style={{ ...styles.promptRow, ...(isMobile && styles.promptRowMobile) }}>
                  {config.helperPrompts.map(p => (
                    <button key={p} onClick={() => askHelper(p)} style={{ ...styles.promptChip, ...(isMobile && { flexShrink: 0 }) }} disabled={loading}>{p}</button>
                  ))}
                </div>

                {config.helperFreeText && (
                  <form onSubmit={(e) => { e.preventDefault(); askHelper(); }} style={styles.addForm}>
                    <input
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder={`Ask ${config.helperName}...`}
                      style={styles.input}
                      disabled={loading}
                      enterKeyHint="send"
                    />
                    <button type="submit" style={accentButton} disabled={loading || !input.trim()} aria-label="Ask">
                      <Send size={16} /> {!isMobile && 'Ask'}
                    </button>
                  </form>
                )}
              </>
            ) : (
              <div style={styles.lockedHelper}>
                {selectedChore?.steps?.length ? (
                  <div style={{ textAlign: 'left', width: '100%' }}>
                    <h3 style={{ ...styles.cardTitle, fontSize: 16, marginBottom: 12 }}>{selectedChore.emoji} {selectedChore.title}</h3>
                    {selectedChore.steps.map((step, i) => (
                      <div key={i} style={styles.stepRow}>
                        <span style={{ ...styles.stepNum, backgroundColor: config.accent }}>{i + 1}</span>
                        <span>{step}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <>
                    <ShieldAlert size={40} color={config.accent} />
                    <p style={{ ...styles.muted, maxWidth: 320 }}>
                      AI help is turned off for this account. Tap "How?" on a chore for simple steps, or ask a grown-up to turn it on in Permissions.
                    </p>
                  </>
                )}
              </div>
            )}
          </section>
        )}
      </main>

      {selectedChore && (
        <div className="kid-drawer-backdrop household-guide-backdrop" onClick={() => setSelectedChoreId(null)}>
          <aside
            className="kid-task-drawer household-task-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="household-task-title"
            onClick={event => event.stopPropagation()}
          >
            <div className="kid-drawer-header">
              <div>
                <span className="kid-drawer-eyebrow">TASK INSTRUCTIONS</span>
                <h2 id="household-task-title">{selectedChore.title}</h2>
              </div>
              <button className="kid-drawer-close" type="button" aria-label="Close instructions" onClick={() => setSelectedChoreId(null)}>
                <X size={22} />
              </button>
            </div>
            {selectedChore.guideImage ? (
              <img
                className={`kid-drawer-image ${selectedChore.guideImage.endsWith('.png') ? 'kid-drawer-image-wide' : ''}`}
                src={selectedChore.guideImage}
                alt={`Illustration: ${selectedChore.title}`}
              />
            ) : (
              <div className="household-guide-placeholder" aria-hidden="true">{selectedChore.emoji}</div>
            )}
            <div className="kid-drawer-steps">
              {selectedChore.steps?.length ? selectedChore.steps.map((step, index) => (
                <div className="kid-drawer-step" key={`${selectedChore.id}-${index}`}>
                  <span>{index + 1}</span>
                  <p>{step}</p>
                </div>
              )) : (
                <p className="household-guide-empty">No step-by-step guide has been added for this chore yet.</p>
              )}
            </div>
            <div className="kid-drawer-footer">
              {config.reward && selectedChore.points > 0 && (
                <span className="kid-drawer-points">{config.reward.icon} Earn {selectedChore.points} {config.reward.unit}</span>
              )}
              <button
                className={`kid-complete-button ${selectedChore.done ? 'is-done' : ''}`}
                type="button"
                onClick={() => {
                  if (!selectedChore.done) toggleChore(selectedChore.id);
                  setSelectedChoreId(null);
                }}
              >
                {selectedChore.done ? 'Done for today ✓' : 'Mark task complete ⭐'}
              </button>
            </div>
          </aside>
        </div>
      )}

      {isMobile && (
        <nav style={styles.tabBar}>
          {[
            { id: 'chores', label: config.navLabel, icon: <ListChecks size={22} /> },
            { id: 'helper', label: config.helperName, icon: <Sparkles size={22} /> }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => showTab(tab.id)}
              style={{ ...styles.tabBtn, color: mobileTab === tab.id ? config.accent : '#94a3b8' }}
              aria-current={mobileTab === tab.id ? 'page' : undefined}
            >
              <span style={{ position: 'relative', display: 'flex' }}>
                {tab.icon}
                {tab.id === 'helper' && helperUnread && <span style={{ ...styles.unreadDot, backgroundColor: config.accent }} />}
              </span>
              <span>{tab.label}</span>
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}

const styles = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#0b1120',
    color: '#f8fafc',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '16px',
    padding: '18px 28px',
    backgroundColor: '#0f172a',
    borderBottom: '1px solid #1e293b',
  },
  headerMobile: {
    gap: '12px',
    padding: 'calc(12px + env(safe-area-inset-top)) 16px 12px',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    minWidth: 0,
  },
  avatar: {
    fontSize: '30px',
    backgroundColor: '#1e293b',
    padding: '6px 8px',
    borderRadius: '14px',
    border: '2px solid',
    flexShrink: 0,
  },
  avatarMobile: {
    fontSize: '24px',
    padding: '4px 6px',
    borderRadius: '12px',
  },
  titleRow: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '4px 10px',
  },
  title: {
    fontWeight: '800',
  },
  ageBadge: {
    fontSize: '11px',
    fontWeight: '700',
    padding: '3px 10px',
    borderRadius: '9999px',
    border: '1px solid',
    whiteSpace: 'nowrap',
  },
  subtitle: {
    fontSize: '13px',
    color: '#94a3b8',
    marginTop: '2px',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  progressPill: {
    fontSize: '14px',
    fontWeight: '700',
    padding: '8px 14px',
    borderRadius: '9999px',
    border: '1px solid',
    whiteSpace: 'nowrap',
  },
  ghostBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    minHeight: '40px',
    minWidth: '40px',
    backgroundColor: '#1e293b',
    border: '1px solid #334155',
    color: '#cbd5e1',
    padding: '8px 12px',
    borderRadius: '10px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: '600',
    fontFamily: 'inherit',
  },
  grid: {
    maxWidth: '1120px',
    width: '100%',
    margin: '24px auto',
    padding: '0 16px',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
    gap: '20px',
    alignItems: 'start',
  },
  gridMobile: {
    display: 'block',
    margin: '12px auto',
    padding: '0 12px',
  },
  card: {
    backgroundColor: '#131c2e',
    border: '1px solid #1e293b',
    borderRadius: '18px',
    padding: '20px',
    minWidth: 0,
  },
  cardMobile: {
    padding: '16px 14px',
    borderRadius: '16px',
  },
  helperCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '12px',
  },
  cardTitle: {
    fontSize: '18px',
    fontWeight: '700',
  },
  muted: {
    fontSize: '12px',
    color: '#94a3b8',
  },
  progressTrack: {
    height: '8px',
    backgroundColor: '#1e293b',
    borderRadius: '9999px',
    overflow: 'hidden',
    marginBottom: '16px',
  },
  progressFill: {
    height: '100%',
    transition: 'width 0.3s ease',
  },
  filterRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
    marginBottom: '14px',
  },
  chip: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    minHeight: '32px',
    border: '1px solid #334155',
    backgroundColor: '#1e293b',
    color: '#cbd5e1',
    padding: '5px 11px',
    borderRadius: '9999px',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  choreList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  choreRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 6px 6px 4px',
    borderRadius: '12px',
    border: '1px solid',
    backgroundColor: '#1a2336',
  },
  choreTitle: {
    fontSize: '15px',
    fontWeight: '600',
    lineHeight: 1.35,
  },
  choreMeta: {
    display: 'flex',
    gap: '10px',
    fontSize: '12px',
    color: '#94a3b8',
    marginTop: '2px',
  },
  howBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    backgroundColor: 'transparent',
    border: '1px solid #334155',
    color: '#cbd5e1',
    padding: '6px 10px',
    borderRadius: '8px',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    fontFamily: 'inherit',
  },
  iconBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '42px',
    height: '42px',
    flexShrink: 0,
    padding: 0,
  },
  iconBtnBordered: {
    background: 'none',
    border: '1px solid #334155',
    color: '#cbd5e1',
    borderRadius: '10px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '40px',
    height: '40px',
    flexShrink: 0,
    padding: 0,
  },
  celebrate: {
    marginTop: '14px',
    padding: '10px 12px',
    border: '1px solid',
    borderRadius: '10px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '13px',
    fontWeight: '600',
  },
  addForm: {
    display: 'flex',
    gap: '8px',
    marginTop: '14px',
  },
  // 16px text keeps iOS Safari from zooming in when a field is focused
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: '44px',
    backgroundColor: '#0f172a',
    border: '1px solid #334155',
    color: '#f8fafc',
    padding: '10px 12px',
    borderRadius: '10px',
    fontSize: '16px',
    fontFamily: 'inherit',
  },
  select: {
    minHeight: '44px',
    backgroundColor: '#0f172a',
    border: '1px solid #334155',
    color: '#f8fafc',
    padding: '0 8px',
    borderRadius: '10px',
    fontSize: '16px',
    fontFamily: 'inherit',
  },
  primaryBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    minHeight: '44px',
    minWidth: '44px',
    border: 'none',
    color: '#0b1120',
    padding: '10px 14px',
    borderRadius: '10px',
    fontSize: '14px',
    fontWeight: '700',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  safetyNote: {
    display: 'flex',
    gap: '8px',
    alignItems: 'flex-start',
    fontSize: '12px',
    lineHeight: 1.5,
    color: '#e2e8f0',
    padding: '10px 12px',
    border: '1px solid',
    borderRadius: '10px',
  },
  messages: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    paddingRight: '4px',
  },
  bubble: {
    maxWidth: '88%',
    padding: '10px 13px',
    borderRadius: '12px',
    border: '1px solid',
    fontSize: '14px',
    lineHeight: 1.55,
    overflowWrap: 'anywhere',
  },
  promptRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
  },
  // One swipeable row of suggestions on phones instead of a tall wrapped block
  promptRowMobile: {
    flexWrap: 'nowrap',
    overflowX: 'auto',
    margin: '0 -14px',
    padding: '0 14px 2px',
    scrollbarWidth: 'none',
  },
  promptChip: {
    backgroundColor: '#1e293b',
    border: '1px solid #334155',
    color: '#cbd5e1',
    padding: '8px 12px',
    borderRadius: '9999px',
    fontSize: '13px',
    cursor: 'pointer',
    textAlign: 'left',
    fontFamily: 'inherit',
  },
  lockedHelper: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '12px',
    textAlign: 'center',
    padding: '24px 8px',
  },
  stepRow: {
    display: 'flex',
    gap: '10px',
    alignItems: 'flex-start',
    fontSize: '15px',
    lineHeight: 1.5,
    marginBottom: '10px',
  },
  stepNum: {
    color: '#0b1120',
    fontSize: '11px',
    fontWeight: '800',
    width: '20px',
    height: '20px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: '2px',
  },
  tabBar: {
    position: 'fixed',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 900,
    display: 'flex',
    backgroundColor: 'rgba(15, 23, 42, 0.96)',
    backdropFilter: 'blur(10px)',
    borderTop: '1px solid #1e293b',
    paddingBottom: 'env(safe-area-inset-bottom)',
  },
  tabBtn: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '2px',
    padding: '8px 0 6px',
    minHeight: '56px',
    background: 'none',
    border: 'none',
    fontSize: '11px',
    fontWeight: '700',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  unreadDot: {
    position: 'absolute',
    top: '-2px',
    right: '-4px',
    width: '9px',
    height: '9px',
    borderRadius: '50%',
    border: '2px solid #0f172a',
  },
};
