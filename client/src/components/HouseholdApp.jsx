import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowUp, Check, ChevronRight, CircleAlert, House, Lightbulb, ListChecks, LogOut, PartyPopper, Plus,
  RotateCcw, Shield, ShieldCheck, Sparkles, Star, Trash2, TriangleAlert, Users, Zap
} from 'lucide-react';
import { useFeature } from './FeatureGate';
import Sheet from './Sheet';
import { apiFetch, authHeaders } from '../auth';
import { AGE_CONFIG, MEMBERS, SEED_CHORES } from '../household';
import { useChores } from '../useChores';
import { useIsMobile } from '../useIsMobile';
import './household.css';

// Matches the server: a guide still writing after this long was cut off and can be retried
const GUIDE_STALE_MS = 5 * 60 * 1000;
const TASK_PROMPTS = ['Give me a tip', 'How can I make it faster?', 'I\'m stuck on a step'];

const SPRING = { type: 'spring', bounce: 0, duration: 0.4 };
// A committed tap earns a little overshoot; nothing else bounces
const POP = { type: 'spring', bounce: 0.35, duration: 0.4 };
const REWARD_ICONS = { kid: Star, teen: Zap };

// Earlier turns for the AI routes: real exchanges only (no error notes), trimmed to the server's limits
function toHistory(messages, max) {
  return messages
    .filter(m => !m.error)
    .slice(-max)
    .map(m => ({ role: m.role, text: m.text.slice(0, 1000) }));
}

// Gemini replies use light markdown; render headings, bullets and **bold** without a library
function RichText({ text }) {
  const inline = (line) =>
    line.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part
    );

  return text.split('\n').map((raw, i) => {
    const line = raw.trimEnd();
    if (!line.trim() || /^-{3,}$/.test(line.trim())) return <div key={i} className="rich-gap" />;
    const heading = line.match(/^#{1,6}\s+(.*)/);
    if (heading) return <div key={i} className="rich-heading">{inline(heading[1])}</div>;
    const bullet = line.match(/^\s*[*-]\s+(.*)/);
    if (bullet) return <div key={i} className="rich-bullet">{inline(bullet[1])}</div>;
    return <div key={i}>{inline(line)}</div>;
  });
}

function Avatar({ member, size = '' }) {
  return (
    <span className={`avatar ${size}`} data-age={member.ageMode} aria-hidden="true">
      {member.name.charAt(0).toUpperCase()}
    </span>
  );
}

function CheckButton({ title, done, onToggle }) {
  return (
    <motion.button
      type="button"
      className={`check${done ? ' is-done' : ''}`}
      onClick={onToggle}
      aria-pressed={done}
      aria-label={`Done: ${title}`}
      whileTap={{ scale: 0.86 }}
      transition={SPRING}
    >
      <motion.span className="check-fill" initial={false} animate={{ scale: done ? 1 : 0.4, opacity: done ? 1 : 0 }} transition={POP}>
        <Check size={15} strokeWidth={3.25} />
      </motion.span>
    </motion.button>
  );
}

function ProgressRing({ done, total }) {
  const progress = total ? done / total : 0;
  return (
    <svg className="ring" width="52" height="52" viewBox="0 0 52 52" aria-hidden="true">
      <circle className="ring-track" cx="26" cy="26" r="22" />
      <motion.circle
        className="ring-fill"
        cx="26"
        cy="26"
        r="22"
        transform="rotate(-90 26 26)"
        initial={false}
        animate={{ pathLength: progress, opacity: progress ? 1 : 0 }}
        transition={SPRING}
      />
    </svg>
  );
}

// Segmented control; the selection thumb slides between options as one shared element
function Segmented({ options, value, onChange }) {
  return (
    <div className="segmented" role="group" aria-label="Show chores for">
      {options.map(option => (
        <button key={option.id} type="button" aria-pressed={value === option.id} onClick={() => onChange(option.id)}>
          {value === option.id && <motion.span layoutId="segmented-thumb" className="segmented-thumb" transition={SPRING} />}
          <span className="segmented-label">
            {option.ageMode && <Avatar member={option} size="avatar-sm" />}
            {option.name}
          </span>
        </button>
      ))}
    </div>
  );
}

export default function HouseholdApp({ ageMode, sessionId, family, myUserId, familyName, onSignOut, onOpenSettings, onOpenFamily }) {
  const config = AGE_CONFIG[ageMode];
  const canUseAi = useFeature('ai-chat');
  // Kids only see AI picture guides with AI Media Generation on; teens and adults always do
  const canMakePictures = useFeature('ai-media-generation');
  const showAiPictures = ageMode !== 'kid' || canMakePictures;
  const isMobile = useIsMobile();
  const RewardIcon = REWARD_ICONS[ageMode];

  // In a family, chores are shared and assigned to real people; otherwise they're local, assigned to age groups
  const inFamily = Boolean(family && myUserId);
  const { chores, error: choreError, addChore: saveChore, toggleChore, removeChore, patchChore, refresh: refreshChores } = useChores({ inFamily });
  const members = inFamily
    ? family.members.map(m => ({ id: m.userId, name: m.displayName.split(' ')[0], ageMode: m.ageMode || 'kid' }))
    : MEMBERS.map(m => ({ id: m, name: AGE_CONFIG[m].label, ageMode: m }));
  const memberById = Object.fromEntries(members.map(m => [m.id, m]));
  const myMemberId = inFamily ? myUserId : ageMode;

  const [memberFilter, setMemberFilter] = useState('all');
  const [newTitle, setNewTitle] = useState('');
  const [newIdea, setNewIdea] = useState(null);
  const [newAssignee, setNewAssignee] = useState(myMemberId);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [selectedChoreId, setSelectedChoreId] = useState(null);

  const [messages, setMessages] = useState([{ role: 'assistant', text: config.helperIntro }]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesRef = useRef(null);

  // Task chat inside the drawer: one short conversation per chore
  const [taskChats, setTaskChats] = useState({});
  const [taskInput, setTaskInput] = useState('');
  const [taskLoading, setTaskLoading] = useState(false);
  const taskMessagesRef = useRef(null);

  // On phones the list and the helper are two tabs instead of two columns
  const [mobileTab, setMobileTab] = useState('chores');
  const [helperUnread, setHelperUnread] = useState(false);
  const mobileTabRef = useRef(mobileTab);
  mobileTabRef.current = mobileTab;

  // The accent and type follow the age mode everywhere, including sheets portaled outside this tree.
  // Set before paint so the first frame isn't drawn in the default accent.
  useLayoutEffect(() => {
    document.documentElement.dataset.age = ageMode;
    return () => { delete document.documentElement.dataset.age; };
  }, [ageMode]);

  // Scroll only the message list, never the page (scrollIntoView would jump the page on load)
  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, loading, mobileTab]);

  useEffect(() => {
    const el = taskMessagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [taskChats, taskLoading, selectedChoreId]);

  useEffect(() => {
    setTaskInput('');
  }, [selectedChoreId]);

  const visibleChores = config.seesWholeFamily
    ? chores.filter(c => memberFilter === 'all' || c.assigneeId === memberFilter)
    : chores.filter(c => c.assigneeId === myMemberId);
  const doneCount = visibleChores.filter(c => c.done).length;
  const earned = visibleChores.filter(c => c.done).reduce((sum, c) => sum + (c.points || 0), 0);
  const selectedChore = chores.find(c => c.id === selectedChoreId);
  // Keep showing the last chore while its sheet animates away
  const lastGuideChoreRef = useRef(null);
  if (selectedChore) lastGuideChoreRef.current = selectedChore;
  const guideChore = selectedChore || lastGuideChoreRef.current;

  // Preselect whoever the list is filtered to, so filtering to the kid then tapping Add assigns to the kid
  const openAddChore = () => {
    setNewTitle('');
    setNewIdea(null);
    setNewAssignee(memberFilter === 'all' ? myMemberId : memberFilter);
    setIsAddOpen(true);
  };

  // Ready-made chores (with steps and illustrations) that suit the age of whoever is picked
  const assigneeAge = memberById[newAssignee]?.ageMode || 'kid';
  const choreIdeas = SEED_CHORES.filter(c => c.assignee === assigneeAge && !chores.some(existing => existing.title === c.title && existing.assigneeId === newAssignee));
  const pickIdea = (idea) => {
    setNewTitle(idea.title);
    setNewIdea(idea);
  };

  const showTab = (tab) => {
    setMobileTab(tab);
    if (tab === 'helper') setHelperUnread(false);
    window.scrollTo({ top: 0 });
  };

  // Local chores (demo, no family) get their AI guide from this browser. Family chores get it from the server,
  // which writes it in the background; the next refresh brings it in.
  const generateLocalGuide = async (chore) => {
    const ageGroup = chore.assigneeId;
    patchChore(chore.id, { instructionsStatus: 'pending', posterStatus: null });
    try {
      const data = await apiFetch('/api/ai/chore-instructions', {
        method: 'POST',
        body: { title: chore.title, assignees: [ageGroup], ageMode, sessionId }
      });
      const set = data.byAge[ageGroup];
      if (!set) throw new Error('No instructions came back');
      patchChore(chore.id, { steps: set.steps, tip: set.tip, safety: set.safety, instructionsStatus: 'ready' });

      if (ageGroup === 'kid' && canMakePictures) {
        patchChore(chore.id, { posterStatus: 'pending' });
        try {
          const image = await apiFetch('/api/ai/chore-image', {
            method: 'POST',
            body: { title: chore.title, steps: set.steps.slice(0, 5), ageMode, sessionId }
          });
          patchChore(chore.id, { posterUrl: image.imageUrl, posterStatus: 'ready' });
        } catch {
          patchChore(chore.id, { posterStatus: 'failed' });
        }
      }
    } catch {
      patchChore(chore.id, { instructionsStatus: 'failed' });
    }
  };

  const createChore = async (draft) => {
    const created = await saveChore(draft);
    if (!inFamily && created && !created.steps?.length) generateLocalGuide(created);
  };

  const retryGuide = async (chore) => {
    if (!inFamily) {
      generateLocalGuide(chore);
      return;
    }
    try {
      await apiFetch(`/api/families/chores/${encodeURIComponent(chore.id)}/instructions`, { method: 'POST' });
    } catch {}
    refreshChores();
  };

  // A short tick on phones that support it, on the same frame as the check fills
  const toggleWithFeedback = (chore) => {
    if (!chore.done) navigator.vibrate?.(10);
    toggleChore(chore.id);
  };

  const addChore = (e) => {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title) return;
    const assigneeId = config.canAssignOthers ? newAssignee : myMemberId;
    // An idea's steps and picture only carry over if its name wasn't changed
    const idea = newIdea?.title === title ? newIdea : null;
    createChore({
      title,
      assigneeId,
      emoji: idea?.emoji || '📝',
      points: idea?.points ?? (memberById[assigneeId]?.ageMode === 'adult' ? 0 : 15),
      steps: idea?.steps || [],
      guideImage: idea?.guideImage || null
    });
    setNewTitle('');
    setNewIdea(null);
    setIsAddOpen(false);
    // Make sure the new chore is visible under the current filter
    if (memberFilter !== 'all' && memberFilter !== assigneeId) setMemberFilter('all');
  };

  const askHelper = async (text) => {
    const question = (text ?? input).trim();
    if (!question || loading) return;

    setInput('');
    const next = [...messages, { role: 'user', text: question }];
    setMessages(next);
    setLoading(true);

    // Adults talk to the parent assistant, which can also propose chores for the board
    const isParent = ageMode === 'adult';
    try {
      const res = await fetch(isParent ? '/api/ai/parent-assistant' : '/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ message: question, ageMode, sessionId, ...(isParent && { history: toHistory(messages, 20) }) })
      });
      const data = await res.json();
      setMessages([
        ...next,
        res.ok
          ? { role: 'assistant', text: data.reply, ...(data.proposedChores?.length && { proposedChores: data.proposedChores }) }
          : { role: 'assistant', text: data.error || 'The helper is unavailable right now.', error: true }
      ]);
    } catch (err) {
      setMessages([...next, { role: 'assistant', text: `Network error: ${err.message}`, error: true }]);
    } finally {
      setLoading(false);
      if (mobileTabRef.current !== 'helper') setHelperUnread(true);
    }
  };

  const resolveProposal = (index, status) =>
    setMessages(prev => prev.map((msg, i) => (i === index ? { ...msg, proposalStatus: status } : msg)));

  // A chore proposed for several people becomes one chore each, so everyone ticks off their own
  const addProposedChores = (index, proposed) => {
    proposed.forEach(p => p.assigneeIds.filter(id => memberById[id]).forEach(assigneeId => createChore({
      title: p.title,
      assigneeId,
      emoji: p.emoji,
      points: memberById[assigneeId].ageMode === 'adult' ? 0 : p.points
    })));
    resolveProposal(index, 'added');
  };

  const askAboutTask = async (text) => {
    const chore = selectedChore;
    const question = (text ?? taskInput).trim();
    if (!chore || !question || taskLoading) return;

    const previous = taskChats[chore.id] || [];
    const appendTo = (msg) => setTaskChats(prev => ({ ...prev, [chore.id]: [...(prev[chore.id] || []), msg] }));
    setTaskInput('');
    appendTo({ role: 'user', text: question });
    setTaskLoading(true);

    try {
      const res = await fetch('/api/ai/task-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({
          chore: { title: chore.title.slice(0, 100), steps: (chore.steps || []).slice(0, 10).map(step => step.slice(0, 300)) },
          history: toHistory(previous, 10),
          message: question,
          ageMode,
          sessionId
        })
      });
      const data = await res.json();
      appendTo(res.ok
        ? { role: 'assistant', text: data.reply }
        : { role: 'assistant', text: data.error || 'The helper is unavailable right now.', error: true });
    } catch (err) {
      appendTo({ role: 'assistant', text: `Network error: ${err.message}`, error: true });
    } finally {
      setTaskLoading(false);
    }
  };

  const showChores = !isMobile || mobileTab === 'chores';
  const showHelper = !isMobile || mobileTab === 'helper';
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const allDone = visibleChores.length > 0 && doneCount === visibleChores.length;

  const renderBubble = (msg, idx) => (
    <motion.div
      key={idx}
      className={`message is-${msg.role}`}
      initial={{ opacity: 0, y: 8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={SPRING}
    >
      <div className={`bubble${msg.error ? ' is-error' : ''}`}>
        {msg.error && <CircleAlert size={15} className="bubble-error-icon" />}
        <div className="bubble-text"><RichText text={msg.text} /></div>
        {msg.proposedChores && (
          <div className="proposal">
            <ul className="proposal-list">
              {msg.proposedChores.map((p, i) => (
                <li key={i} className="proposal-row">
                  <span className="proposal-emoji" aria-hidden="true">{p.emoji}</span>
                  <span className="proposal-title">{p.title}</span>
                  <span className="proposal-people">
                    {p.assigneeIds.filter(id => memberById[id]).map(id => (
                      <Avatar key={id} member={memberById[id]} size="avatar-sm" />
                    ))}
                  </span>
                </li>
              ))}
            </ul>
            {msg.proposalStatus ? (
              <p className="footnote proposal-status">
                {msg.proposalStatus === 'added' ? <><Check size={14} /> Added to the board</> : 'Dismissed'}
              </p>
            ) : (
              <div className="proposal-actions">
                <button type="button" className="btn btn-primary btn-sm" onClick={() => addProposedChores(idx, msg.proposedChores)}>
                  <Plus size={15} strokeWidth={2.5} /> Add all
                </button>
                <button type="button" className="btn btn-gray btn-sm" onClick={() => resolveProposal(idx, 'dismissed')}>
                  Dismiss
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );

  return (
    <div className={`household household-${ageMode}`}>
      <header className="topbar material-bar">
        <div className="topbar-inner">
          <div className="brand">
            <span className="brand-mark"><House size={16} strokeWidth={2.25} /></span>
            <span className="brand-name">Homebase</span>
            <span className="badge"><ShieldCheck size={12} strokeWidth={2.5} /> {config.label} · {config.badge}</span>
          </div>
          <nav className="topbar-actions" aria-label="Account">
            {onOpenSettings && (
              <button type="button" className="toolbar-btn" onClick={onOpenSettings} title="Manage k-ID permissions" aria-label="Permissions">
                <Shield size={18} />
                {!isMobile && <span>Permissions</span>}
              </button>
            )}
            {onOpenFamily && (
              <button type="button" className="toolbar-btn" onClick={onOpenFamily} title="Family" aria-label="Family">
                <Users size={18} />
                {!isMobile && <span>{familyName || 'Family'}</span>}
              </button>
            )}
            <button type="button" className="toolbar-btn" onClick={onSignOut} title="Sign out" aria-label="Sign out">
              <LogOut size={18} />
              {!isMobile && <span>Sign out</span>}
            </button>
          </nav>
        </div>
      </header>

      <main className="household-main">
        <section className="hero">
          <div className="hero-text">
            <p className="eyebrow">{today}</p>
            <h1 className="large-title">{showChores ? config.listTitle : config.helperName}</h1>
            <p className="subhead">{showChores ? config.greeting : 'Ask anything about chores, cooking or planning.'}</p>
          </div>
          {showChores && (
            <div className="hero-stats" aria-label={`${doneCount} of ${visibleChores.length} done`}>
              <ProgressRing done={doneCount} total={visibleChores.length} />
              <div className="hero-stats-text">
                <span className="hero-stats-value">{doneCount}<span className="hero-stats-of"> of {visibleChores.length}</span></span>
                <span className="footnote">done today</span>
              </div>
              {config.reward && RewardIcon && (
                <div className="hero-stats-text hero-reward">
                  <span className="hero-stats-value"><RewardIcon size={18} className="reward-icon" /> {earned}</span>
                  <span className="footnote">{config.reward.unit}</span>
                </div>
              )}
            </div>
          )}
        </section>

        <div className="household-grid">
          {/* Chore list */}
          {showChores && (
            <motion.section className="chores" aria-label={config.listTitle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
              {config.seesWholeFamily && (
                <div className="chores-toolbar">
                  <Segmented options={[{ id: 'all', name: 'Everyone' }, ...members]} value={memberFilter} onChange={setMemberFilter} />
                  <button type="button" className="btn btn-primary" onClick={openAddChore}>
                    <Plus size={17} strokeWidth={2.5} /> Add chore
                  </button>
                </div>
              )}

              {choreError && <p className="footnote text-danger">{choreError}</p>}

              {visibleChores.length === 0 ? (
                <div className="empty-state">
                  <span className="empty-icon"><ListChecks size={26} /></span>
                  <p className="headline">No chores yet</p>
                  <p className="subhead">
                    {inFamily && config.canAssignOthers ? 'Add a chore to get the family started.' : 'Nothing on your list right now.'}
                  </p>
                </div>
              ) : (
                <ul className="grouped chore-list">
                  <AnimatePresence initial={false}>
                    {visibleChores.map(chore => {
                      const assignee = memberById[chore.assigneeId];
                      const showPoints = config.reward && chore.points > 0;
                      return (
                        <motion.li
                          layout="position"
                          key={chore.id}
                          className={`grouped-row chore-row${chore.done ? ' is-done' : ''}`}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={SPRING}
                        >
                          <CheckButton title={chore.title} done={chore.done} onToggle={() => toggleWithFeedback(chore)} />
                          <button type="button" className="chore-main" onClick={() => setSelectedChoreId(chore.id)} aria-label={`${chore.title}: how to do it`}>
                            <span className="chore-emoji" aria-hidden="true">{chore.emoji}</span>
                            <span className="chore-text">
                              <span className="chore-title">{chore.title}</span>
                              {config.seesWholeFamily && (
                                <span className="chore-meta">
                                  {assignee ? <><Avatar member={assignee} size="avatar-sm" /> {assignee.name}</> : 'Unassigned'}
                                </span>
                              )}
                            </span>
                            {showPoints && RewardIcon && (
                              <span className="chore-points"><RewardIcon size={13} /> {chore.points}</span>
                            )}
                            <ChevronRight size={18} className="chore-chevron" aria-hidden="true" />
                          </button>
                          {config.canAssignOthers && (
                            <button type="button" className="chore-delete" onClick={() => removeChore(chore.id)} aria-label={`Remove ${chore.title}`}>
                              <Trash2 size={16} />
                            </button>
                          )}
                        </motion.li>
                      );
                    })}
                  </AnimatePresence>
                </ul>
              )}

              <AnimatePresence>
                {config.reward && allDone && (
                  <motion.div
                    className="celebrate"
                    initial={{ opacity: 0, scale: 0.94 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.94 }}
                    transition={POP}
                  >
                    <PartyPopper size={20} /> All done! Amazing work today.
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Teens add their own chores inline; adults use the "Add chore" sheet */}
              {config.canAddChores && !config.canAssignOthers && (
                <form onSubmit={addChore} className="composer add-inline">
                  <input
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="Add a chore for yourself"
                    aria-label="New chore"
                    enterKeyHint="done"
                  />
                  <button type="submit" className="composer-send" disabled={!newTitle.trim()} aria-label="Add chore">
                    <Plus size={18} strokeWidth={2.75} />
                  </button>
                </form>
              )}
            </motion.section>
          )}

          {/* Helper: same panel for everyone; kids get tap-only questions, the AI tunes detail by age */}
          {showHelper && (
            <motion.section className="card helper" aria-label={config.helperName} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
              <header className="helper-header">
                <span className="helper-mark"><Sparkles size={18} /></span>
                <div className="helper-heading">
                  <h2 className="headline">{config.helperName}</h2>
                  <p className="footnote">AI helper · {config.label} mode</p>
                </div>
              </header>

              {config.safetyNote && (
                <p className="helper-safety">
                  <ShieldCheck size={15} />
                  <span>{config.safetyNote}</span>
                </p>
              )}

              {canUseAi ? (
                <>
                  <div ref={messagesRef} className="messages">
                    {messages.map(renderBubble)}
                    {loading && (
                      <div className="message is-assistant" aria-label={`${config.helperName} is thinking`}>
                        <div className="typing"><span /><span /><span /></div>
                      </div>
                    )}
                  </div>

                  <div className="prompt-row">
                    {config.helperPrompts.map(p => (
                      <button key={p} type="button" className="chip" onClick={() => askHelper(p)} disabled={loading}>{p}</button>
                    ))}
                  </div>

                  {config.helperFreeText && (
                    <form onSubmit={(e) => { e.preventDefault(); askHelper(); }} className="composer">
                      <input
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        maxLength={1000}
                        placeholder={`Ask ${config.helperName}`}
                        aria-label={`Ask ${config.helperName}`}
                        disabled={loading}
                        enterKeyHint="send"
                      />
                      <button type="submit" className="composer-send" disabled={loading || !input.trim()} aria-label="Send">
                        <ArrowUp size={18} strokeWidth={2.75} />
                      </button>
                    </form>
                  )}
                </>
              ) : (
                <div className="helper-locked">
                  {selectedChore?.steps?.length ? (
                    <div className="helper-locked-steps">
                      <h3 className="headline">{selectedChore.emoji} {selectedChore.title}</h3>
                      <ol className="steps">
                        {selectedChore.steps.map((step, i) => <li key={i}>{step}</li>)}
                      </ol>
                    </div>
                  ) : (
                    <>
                      <span className="empty-icon"><Shield size={24} /></span>
                      <p className="subhead">
                        AI help is turned off for this account. Tap a chore for simple steps, or ask a grown-up to turn it on in Permissions.
                      </p>
                    </>
                  )}
                </div>
              )}
            </motion.section>
          )}
        </div>
      </main>

      <Sheet
        open={isAddOpen}
        onClose={() => setIsAddOpen(false)}
        title="New chore"
        footer={
          <>
            <button type="button" className="btn btn-gray" onClick={() => setIsAddOpen(false)}>Cancel</button>
            <button type="submit" form="add-chore-form" className="btn btn-primary" disabled={!newTitle.trim()}>Add chore</button>
          </>
        }
      >
        <form id="add-chore-form" className="add-form" onSubmit={addChore}>
          <div>
            <label className="field-label" htmlFor="add-chore-name">Chore</label>
            <input
              id="add-chore-name"
              className="field"
              autoFocus
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="e.g. Water the plants"
            />
          </div>

          <div>
            <span className="field-label">Assign to</span>
            <div className="assignee-grid">
              {members.map(m => (
                <button
                  key={m.id}
                  type="button"
                  className="assignee pressable"
                  data-age={m.ageMode}
                  onClick={() => setNewAssignee(m.id)}
                  aria-pressed={newAssignee === m.id}
                >
                  <Avatar member={m} size="avatar-lg" />
                  <span className="assignee-name">{m.name}</span>
                </button>
              ))}
            </div>
          </div>

          {choreIdeas.length > 0 && (
            <div>
              <span className="field-label">Ideas for {memberById[newAssignee]?.name}</span>
              <div className="idea-row">
                {choreIdeas.map(idea => (
                  <button key={idea.id} type="button" className="chip" aria-pressed={newIdea?.id === idea.id} onClick={() => pickIdea(idea)}>
                    <span aria-hidden="true">{idea.emoji}</span> {idea.title}
                  </button>
                ))}
              </div>
            </div>
          )}
        </form>
      </Sheet>

      <Sheet
        open={Boolean(selectedChore)}
        onClose={() => setSelectedChoreId(null)}
        placement="right"
        eyebrow="How to"
        title={guideChore?.title}
        className="guide-sheet"
        footer={guideChore && (
          <div className="guide-footer">
            {config.reward && RewardIcon && guideChore.points > 0 && (
              <span className="guide-points"><RewardIcon size={15} /> Earn {guideChore.points} {config.reward.unit}</span>
            )}
            <button
              type="button"
              className={`btn btn-lg btn-block ${guideChore.done ? 'btn-tinted' : 'btn-primary'}`}
              onClick={() => {
                if (!guideChore.done) toggleWithFeedback(guideChore);
                setSelectedChoreId(null);
              }}
            >
              <Check size={19} strokeWidth={2.75} /> {guideChore.done ? 'Done for today' : 'Mark as done'}
            </button>
          </div>
        )}
      >
        {guideChore && (
          <div className="guide">
            {showAiPictures && guideChore.posterUrl ? (
              <img className="guide-image is-wide" src={guideChore.posterUrl} alt={`Picture guide: ${guideChore.title}`} />
            ) : guideChore.guideImage ? (
              <img
                className={`guide-image${guideChore.guideImage.endsWith('.png') ? ' is-wide' : ''}`}
                src={guideChore.guideImage}
                alt={`Illustration: ${guideChore.title}`}
              />
            ) : showAiPictures && guideChore.posterStatus === 'pending' ? (
              <div className="guide-placeholder">
                <div className="spinner" />
                <span className="footnote">Drawing a picture guide…</span>
              </div>
            ) : (
              <div className="guide-placeholder" aria-hidden="true"><span className="guide-emoji">{guideChore.emoji}</span></div>
            )}

            {guideChore.steps?.length ? (
              <ol className="steps">
                {guideChore.steps.map((step, index) => <li key={`${guideChore.id}-${index}`}>{step}</li>)}
              </ol>
            ) : guideChore.instructionsStatus === 'pending' && !(guideChore.updatedAt && Date.now() - Date.parse(guideChore.updatedAt) > GUIDE_STALE_MS) ? (
              <p className="guide-status"><span className="spinner" /> Writing step-by-step instructions. This can take a minute.</p>
            ) : ['failed', 'pending'].includes(guideChore.instructionsStatus) ? (
              <div className="guide-status is-failed">
                <p className="subhead">The instructions couldn't be written right now.</p>
                {(config.canAssignOthers || (config.canAddChores && guideChore.assigneeId === myMemberId)) && (
                  <button type="button" className="btn btn-gray btn-sm" onClick={() => retryGuide(guideChore)}>
                    <RotateCcw size={14} /> Try again
                  </button>
                )}
              </div>
            ) : (
              <p className="subhead">No step-by-step guide has been added for this chore yet.</p>
            )}

            {guideChore.tip && (
              <p className="callout"><Lightbulb size={17} /><span>{guideChore.tip}</span></p>
            )}
            {guideChore.safety && (
              <p className="callout is-safety"><TriangleAlert size={17} /><span>{guideChore.safety}</span></p>
            )}

            {canUseAi && (
              <section className="task-chat" aria-label={`Ask ${config.helperName} about this task`}>
                <h3 className="headline task-chat-title">
                  <Sparkles size={16} /> Ask {config.helperName}
                </h3>
                {(taskChats[guideChore.id]?.length > 0 || taskLoading) && (
                  <div ref={taskMessagesRef} className="messages task-chat-messages">
                    {(taskChats[guideChore.id] || []).map(renderBubble)}
                    {taskLoading && (
                      <div className="message is-assistant" aria-label={`${config.helperName} is thinking`}>
                        <div className="typing"><span /><span /><span /></div>
                      </div>
                    )}
                  </div>
                )}
                {!taskChats[guideChore.id]?.length && (
                  <div className="prompt-row">
                    {TASK_PROMPTS.map(p => (
                      <button key={p} type="button" className="chip" onClick={() => askAboutTask(p)} disabled={taskLoading}>{p}</button>
                    ))}
                  </div>
                )}
                <form className="composer" onSubmit={(e) => { e.preventDefault(); askAboutTask(); }}>
                  <input
                    value={taskInput}
                    onChange={(e) => setTaskInput(e.target.value)}
                    maxLength={500}
                    placeholder="Ask about this task"
                    aria-label="Ask about this task"
                    disabled={taskLoading}
                    enterKeyHint="send"
                  />
                  <button type="submit" className="composer-send" disabled={taskLoading || !taskInput.trim()} aria-label="Send">
                    <ArrowUp size={18} strokeWidth={2.75} />
                  </button>
                </form>
              </section>
            )}
          </div>
        )}
      </Sheet>

      {isMobile && (
        <nav className="tabbar material-bar" aria-label="Sections">
          {[
            { id: 'chores', label: config.navLabel, Icon: ListChecks },
            { id: 'helper', label: config.helperName, Icon: Sparkles }
          ].map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              className={`tab${mobileTab === id ? ' is-active' : ''}`}
              onClick={() => showTab(id)}
              aria-current={mobileTab === id ? 'page' : undefined}
            >
              <span className="tab-icon">
                <Icon size={24} strokeWidth={mobileTab === id ? 2.25 : 1.75} />
                {id === 'helper' && helperUnread && <span className="tab-dot" />}
              </span>
              <span>{label}</span>
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
