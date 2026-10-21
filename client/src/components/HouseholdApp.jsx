import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Circle, HelpCircle, ListChecks, LoaderCircle, LockKeyhole, LogOut, Mic, Plus, RotateCcw, Send, Shield, ShieldAlert, Sparkles, Square, Trash2, Users, X } from 'lucide-react';
import { useFeature } from './FeatureGate';
import { apiFetch, authHeaders } from '../auth';
import { AGE_CONFIG, MEMBERS, SEED_CHORES } from '../household';
import { useChores } from '../useChores';
import './kid-mode.css';

const MOBILE_QUERY = '(max-width: 720px)';
// Matches the server: a guide still writing after this long was cut off and can be retried
const GUIDE_STALE_MS = 5 * 60 * 1000;
const TASK_PROMPTS = ['Give me a tip', 'How can I make it faster?', 'I\'m stuck on a step'];

// Earlier turns for the AI routes: real exchanges only (no error notes), trimmed to the server's limits
function toHistory(messages, max) {
  return messages
    .filter(m => !m.error)
    .slice(-max)
    .map(m => ({ role: m.role, text: m.text.slice(0, 1000) }));
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

export default function HouseholdApp({ ageMode, sessionId, family, myUserId, familyName, onSignOut, onOpenSettings, onOpenFamily }) {
  const config = AGE_CONFIG[ageMode];
  const canUseAi = useFeature('ai-chat');
  // Kids only see AI picture guides with AI Media Generation on; teens and adults always do
  const canMakePictures = useFeature('ai-media-generation');
  const showAiPictures = ageMode !== 'kid' || canMakePictures;
  const canUseVoice = useFeature('ai-voice-mode');
  const canUseKidVoice = ageMode === 'kid' && !sessionId?.startsWith('demo_') && canUseAi && canUseVoice;
  const canUseFreeText = config.helperFreeText || canUseKidVoice;
  const isMobile = useIsMobile();

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
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const messagesRef = useRef(null);
  const recorderRef = useRef(null);
  const recordingChunksRef = useRef([]);
  const mediaStreamRef = useRef(null);
  const recordingTimeoutRef = useRef(null);
  const recordingCancelledRef = useRef(false);

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

  useEffect(() => () => {
    recordingCancelledRef.current = true;
    window.clearTimeout(recordingTimeoutRef.current);
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    mediaStreamRef.current?.getTracks().forEach(track => track.stop());
  }, []);

  useEffect(() => {
    if (!selectedChoreId) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setSelectedChoreId(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [selectedChoreId]);

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

  useEffect(() => {
    if (!isAddOpen) return;
    const onKey = (e) => e.key === 'Escape' && setIsAddOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isAddOpen]);

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

  const stopRecording = () => {
    window.clearTimeout(recordingTimeoutRef.current);
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  };

  const startRecording = async () => {
    setVoiceError('');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setVoiceError('Voice recording is not supported by this browser.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      recordingChunksRef.current = [];
      recordingCancelledRef.current = false;
      const supportedTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
      const mimeType = typeof MediaRecorder.isTypeSupported === 'function'
        ? supportedTypes.find(type => MediaRecorder.isTypeSupported(type))
        : undefined;
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = event => {
        if (event.data.size > 0) recordingChunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        setVoiceError('The recording stopped unexpectedly. Please try again.');
        window.clearTimeout(recordingTimeoutRef.current);
        stream.getTracks().forEach(track => track.stop());
        mediaStreamRef.current = null;
        setIsRecording(false);
      };
      recorder.onstop = async () => {
        window.clearTimeout(recordingTimeoutRef.current);
        stream.getTracks().forEach(track => track.stop());
        mediaStreamRef.current = null;
        setIsRecording(false);
        const audio = new Blob(recordingChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        recordingChunksRef.current = [];
        if (recordingCancelledRef.current) return;
        if (!audio.size) {
          setVoiceError('No audio was recorded. Please try again.');
          return;
        }

        setIsTranscribing(true);
        try {
          const response = await fetch('/api/transcribe-audio', {
            method: 'POST',
            headers: {
              ...(await authHeaders()),
              'Content-Type': audio.type || 'audio/webm',
              'X-Age-Mode': ageMode,
              'X-Session-ID': sessionId || ''
            },
            body: audio
          });
          const result = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(result.error || 'Transcription failed.');
          setInput(current => [current.trim(), result.transcript].filter(Boolean).join(' '));
        } catch (error) {
          setVoiceError(error.message || 'Could not transcribe the recording.');
        } finally {
          setIsTranscribing(false);
        }
      };
      recorder.start();
      recordingTimeoutRef.current = window.setTimeout(() => {
        if (recorder.state === 'recording') recorder.stop();
      }, 60_000);
      setIsRecording(true);
    } catch (error) {
      setVoiceError(error.name === 'NotAllowedError'
        ? 'Allow microphone access in your browser, then try again.'
        : 'Could not start the microphone. Please try again.');
    }
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
          : { role: 'assistant', text: `⚠️ ${data.error || 'The helper is unavailable right now.'}`, error: true }
      ]);
    } catch (err) {
      setMessages([...next, { role: 'assistant', text: `⚠️ Network error: ${err.message}`, error: true }]);
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
        : { role: 'assistant', text: `⚠️ ${data.error || 'The helper is unavailable right now.'}`, error: true });
    } catch (err) {
      appendTo({ role: 'assistant', text: `⚠️ Network error: ${err.message}`, error: true });
    } finally {
      setTaskLoading(false);
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
                {[{ id: 'all', name: 'Everyone' }, ...members].map(m => (
                  <button
                    key={m.id}
                    onClick={() => setMemberFilter(m.id)}
                    style={{
                      ...styles.chip,
                      backgroundColor: memberFilter === m.id ? config.accent : '#1e293b',
                      color: memberFilter === m.id ? '#0b1120' : '#cbd5e1'
                    }}
                  >
                    {m.ageMode ? `${AGE_CONFIG[m.ageMode].avatar} ${m.name}` : m.name}
                  </button>
                ))}
                <button
                  onClick={openAddChore}
                  style={{ ...styles.chip, marginLeft: 'auto', backgroundColor: config.accent, borderColor: config.accent, color: '#0b1120' }}
                >
                  <Plus size={14} /> Add chore
                </button>
              </div>
            )}

            <div style={styles.choreList}>
              {choreError && <p style={{ ...styles.muted, color: '#f87171' }}>{choreError}</p>}
              {visibleChores.length === 0 && (
                <p style={styles.muted}>
                  {inFamily && config.canAssignOthers ? 'No chores yet. Tap "Add chore" to get the family started.' : 'No chores here yet.'}
                </p>
              )}
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
                        {config.seesWholeFamily && (
                          memberById[chore.assigneeId]
                            ? <span>{AGE_CONFIG[memberById[chore.assigneeId].ageMode].avatar} {memberById[chore.assigneeId].name}</span>
                            : <span>Unassigned</span>
                        )}
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

            {/* Teens add their own chores inline; adults use the "Add chore" popup at the top of the list */}
            {config.canAddChores && !config.canAssignOthers && (
              <form onSubmit={addChore} style={styles.addForm}>
                <input
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Add a chore for yourself..."
                  style={styles.input}
                />
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
                        {msg.proposedChores && (
                          <div style={styles.proposalCard}>
                            {msg.proposedChores.map((p, i) => (
                              <div key={i} style={styles.proposalRow}>
                                <span style={{ fontSize: 18 }}>{p.emoji}</span>
                                <span style={{ flex: 1, fontWeight: 600 }}>{p.title}</span>
                                <span style={styles.muted}>
                                  {p.assigneeIds.filter(id => memberById[id]).map(id => `${AGE_CONFIG[memberById[id].ageMode].avatar} ${memberById[id].name}`).join(' · ')}
                                </span>
                              </div>
                            ))}
                            {msg.proposalStatus ? (
                              <div style={styles.muted}>{msg.proposalStatus === 'added' ? '✓ Added to the board' : 'Dismissed'}</div>
                            ) : (
                              <div style={{ display: 'flex', gap: 8 }}>
                                <button onClick={() => addProposedChores(idx, msg.proposedChores)} style={{ ...accentButton, minHeight: 36, padding: '6px 12px' }}>
                                  <Plus size={14} /> Add all
                                </button>
                                <button onClick={() => resolveProposal(idx, 'dismissed')} style={{ ...styles.ghostBtn, minHeight: 36 }}>
                                  Dismiss
                                </button>
                              </div>
                            )}
                          </div>
                        )}
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

                {canUseFreeText && (
                  <>
                  <form onSubmit={(e) => { e.preventDefault(); askHelper(); }} style={styles.addForm}>
                    <input
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      maxLength={1000}
                      placeholder={`Ask ${config.helperName}...`}
                      style={styles.input}
                      disabled={loading}
                      enterKeyHint="send"
                    />
                    {(ageMode === 'kid' ? canUseKidVoice : true) && (
                      <button
                        type="button"
                        onClick={canUseVoice ? (isRecording ? stopRecording : startRecording) : onOpenSettings}
                        style={{ ...styles.voiceBtn, borderColor: isRecording ? '#ef4444' : config.accent, color: isRecording ? '#ef4444' : config.accent, opacity: canUseVoice ? 1 : 0.78 }}
                        disabled={isTranscribing || loading}
                        aria-label={!canUseVoice ? 'Enable voice input in Permissions' : isRecording ? 'Stop recording' : isTranscribing ? 'Transcribing voice message' : 'Record voice message'}
                        title={!canUseVoice ? 'Enable voice input in Permissions' : isRecording ? 'Stop recording' : 'Speak a message'}
                      >
                        {isTranscribing ? <LoaderCircle size={18} className="voice-spinner" /> : !canUseVoice ? <LockKeyhole size={17} /> : isRecording ? <Square size={16} fill="currentColor" /> : <Mic size={18} />}
                        {!isMobile && (!canUseVoice ? 'Enable voice' : isRecording ? 'Stop' : isTranscribing ? 'Transcribing…' : 'Speak')}
                      </button>
                    )}
                    <button type="submit" style={accentButton} disabled={loading || !input.trim() || isRecording || isTranscribing} aria-label="Ask">
                      <Send size={16} /> {!isMobile && 'Ask'}
                    </button>
                  </form>
                  {voiceError && <p role="alert" style={styles.voiceError}>{voiceError}</p>}
                  {isRecording && <p aria-live="polite" style={styles.voiceStatus}>Recording… tap Stop when you are done (up to 60 seconds).</p>}
                  {isTranscribing && <p aria-live="polite" style={styles.voiceStatus}>Transcribing your recording…</p>}
                  </>
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
                    {ageMode !== 'kid' && onOpenSettings && (
                      <button type="button" onClick={onOpenSettings} style={styles.voiceBtn}>
                        <Mic size={17} /> Enable AI chat and voice in Permissions
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </section>
        )}
      </main>

      {isAddOpen && (
        <div style={styles.modalBackdrop} onClick={() => setIsAddOpen(false)}>
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-chore-title"
            onSubmit={addChore}
            onClick={(e) => e.stopPropagation()}
            style={{ ...styles.modal, ...(isMobile && styles.modalMobile) }}
          >
            <div style={styles.cardHeader}>
              <h2 id="add-chore-title" style={styles.cardTitle}>Add a chore</h2>
              <button type="button" onClick={() => setIsAddOpen(false)} style={styles.iconBtn} aria-label="Close">
                <X size={20} color="#94a3b8" />
              </button>
            </div>

            <label style={styles.fieldLabel} htmlFor="add-chore-name">Chore</label>
            <input
              id="add-chore-name"
              autoFocus
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="e.g. Water the plants"
              style={{ ...styles.input, width: '100%' }}
            />

            <span style={{ ...styles.fieldLabel, marginTop: 16 }}>Assign to</span>
            <div style={styles.assigneeRow}>
              {members.map(m => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setNewAssignee(m.id)}
                  aria-pressed={newAssignee === m.id}
                  style={{
                    ...styles.assigneeOption,
                    borderColor: newAssignee === m.id ? AGE_CONFIG[m.ageMode].accent : '#334155',
                    backgroundColor: newAssignee === m.id ? AGE_CONFIG[m.ageMode].accentSoft : '#0f172a'
                  }}
                >
                  <span style={{ fontSize: 22 }}>{AGE_CONFIG[m.ageMode].avatar}</span>
                  <span style={styles.assigneeName}>{m.name}</span>
                </button>
              ))}
            </div>

            {choreIdeas.length > 0 && (
              <>
                <span style={{ ...styles.fieldLabel, marginTop: 16 }}>Ideas for {memberById[newAssignee]?.name}</span>
                <div style={styles.ideaRow}>
                  {choreIdeas.map(idea => (
                    <button
                      key={idea.id}
                      type="button"
                      onClick={() => pickIdea(idea)}
                      style={{ ...styles.chip, borderColor: newIdea?.id === idea.id ? config.accent : '#334155', flexShrink: 0 }}
                    >
                      {idea.emoji} {idea.title}
                    </button>
                  ))}
                </div>
              </>
            )}

            <div style={styles.modalActions}>
              <button type="button" onClick={() => setIsAddOpen(false)} style={styles.ghostBtn}>Cancel</button>
              <button type="submit" style={accentButton} disabled={!newTitle.trim()}>
                <Plus size={16} /> Add chore
              </button>
            </div>
          </form>
        </div>
      )}

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
            {showAiPictures && selectedChore.posterUrl ? (
              <img
                className="kid-drawer-image kid-drawer-image-wide"
                src={selectedChore.posterUrl}
                alt={`Picture guide: ${selectedChore.title}`}
              />
            ) : selectedChore.guideImage ? (
              <img
                className={`kid-drawer-image ${selectedChore.guideImage.endsWith('.png') ? 'kid-drawer-image-wide' : ''}`}
                src={selectedChore.guideImage}
                alt={`Illustration: ${selectedChore.title}`}
              />
            ) : showAiPictures && selectedChore.posterStatus === 'pending' ? (
              <div className="household-guide-placeholder household-guide-pending">
                <span aria-hidden="true">🎨</span>
                Drawing a picture guide...
              </div>
            ) : (
              <div className="household-guide-placeholder" aria-hidden="true">{selectedChore.emoji}</div>
            )}
            <div className="kid-drawer-steps">
              {selectedChore.steps?.length ? selectedChore.steps.map((step, index) => (
                <div className="kid-drawer-step" key={`${selectedChore.id}-${index}`}>
                  <span>{index + 1}</span>
                  <p>{step}</p>
                </div>
              )) : selectedChore.instructionsStatus === 'pending' && !(selectedChore.updatedAt && Date.now() - Date.parse(selectedChore.updatedAt) > GUIDE_STALE_MS) ? (
                <p className="household-guide-empty">✨ Writing step-by-step instructions... this can take a minute.</p>
              ) : ['failed', 'pending'].includes(selectedChore.instructionsStatus) ? (
                <div className="household-guide-failed">
                  <p className="household-guide-empty">The instructions couldn't be written right now.</p>
                  {(config.canAssignOthers || (config.canAddChores && selectedChore.assigneeId === myMemberId)) && (
                    <button type="button" onClick={() => retryGuide(selectedChore)}>
                      <RotateCcw size={14} /> Try again
                    </button>
                  )}
                </div>
              ) : (
                <p className="household-guide-empty">No step-by-step guide has been added for this chore yet.</p>
              )}
              {selectedChore.tip && <p className="household-guide-note">💡 {selectedChore.tip}</p>}
              {selectedChore.safety && <p className="household-guide-note is-safety">⚠️ {selectedChore.safety}</p>}
            </div>
            {canUseAi && (
              <section className="household-task-chat" aria-label={`Ask ${config.helperName} about this task`}>
                <h3>
                  <Sparkles size={16} color={config.accent} style={{ verticalAlign: '-2px', marginRight: 6 }} />
                  Ask {config.helperName} about this task
                </h3>
                {(taskChats[selectedChore.id]?.length > 0 || taskLoading) && (
                  <div ref={taskMessagesRef} className="household-task-chat-messages">
                    {(taskChats[selectedChore.id] || []).map((msg, idx) => (
                      <div key={idx} className={`household-task-chat-bubble is-${msg.role}`}>
                        <RichText text={msg.text} />
                      </div>
                    ))}
                    {taskLoading && <div className="household-task-chat-thinking">{config.helperName} is thinking...</div>}
                  </div>
                )}
                {!taskChats[selectedChore.id]?.length && (
                  <div className="household-task-chat-chips">
                    {TASK_PROMPTS.map(p => (
                      <button key={p} type="button" onClick={() => askAboutTask(p)} disabled={taskLoading}>{p}</button>
                    ))}
                  </div>
                )}
                <form className="household-task-chat-form" onSubmit={(e) => { e.preventDefault(); askAboutTask(); }}>
                  <input
                    value={taskInput}
                    onChange={(e) => setTaskInput(e.target.value)}
                    maxLength={500}
                    placeholder="Ask a question about this task..."
                    disabled={taskLoading}
                    enterKeyHint="send"
                  />
                  <button type="submit" style={{ backgroundColor: config.accent }} disabled={taskLoading || !taskInput.trim()} aria-label="Ask">
                    <Send size={16} />
                  </button>
                </form>
              </section>
            )}
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
  modalBackdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: 10000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '16px',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    backdropFilter: 'blur(4px)',
  },
  modal: {
    width: '100%',
    maxWidth: '420px',
    backgroundColor: '#131c2e',
    border: '1px solid #334155',
    borderRadius: '18px',
    padding: '20px',
    maxHeight: '90dvh',
    overflowY: 'auto',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.6)',
  },
  // Bottom sheet on phones, so the form sits near the thumb and above the keyboard
  modalMobile: {
    alignSelf: 'flex-end',
    maxWidth: 'none',
    margin: '0 -16px -16px',
    width: 'calc(100% + 32px)',
    borderRadius: '20px 20px 0 0',
    paddingBottom: 'calc(20px + env(safe-area-inset-bottom))',
  },
  fieldLabel: {
    display: 'block',
    fontSize: '12px',
    fontWeight: '700',
    color: '#94a3b8',
    marginBottom: '6px',
  },
  assigneeRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(92px, 1fr))',
    gap: '8px',
  },
  assigneeName: {
    maxWidth: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  // One swipeable row, so a long list of ideas doesn't push the buttons off a phone screen
  ideaRow: {
    display: 'flex',
    gap: '6px',
    overflowX: 'auto',
    paddingBottom: '4px',
    scrollbarWidth: 'thin',
  },
  assigneeOption: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4px',
    padding: '10px 4px',
    border: '1px solid',
    borderRadius: '12px',
    color: '#f8fafc',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  modalActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '8px',
    marginTop: '20px',
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
  voiceBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    minHeight: '44px',
    minWidth: '44px',
    padding: '8px 10px',
    border: '1px solid',
    borderRadius: '10px',
    backgroundColor: '#0f172a',
    fontSize: '13px',
    fontWeight: '700',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  voiceError: { color: '#fca5a5', fontSize: '12px', lineHeight: 1.4 },
  voiceStatus: { color: '#94a3b8', fontSize: '12px', lineHeight: 1.4 },
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
  proposalCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    marginTop: '10px',
    paddingTop: '10px',
    borderTop: '1px solid #334155',
  },
  proposalRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
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
