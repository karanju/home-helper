import React, { useEffect, useState } from 'react';
import { CheckCircle2, Circle, Star, Sparkles, Award, ShieldAlert, LogOut, Shield, X } from 'lucide-react';
import './kid-mode.css';

export default function KidMode({ onSignOut, sessionId, onOpenSettings }) {
  const [chores, setChores] = useState([
    { id: 1, text: '🛏️ Make your bed nicely', points: 10, done: true },
    { id: 2, text: '🧸 Put your toys back into the toy box', points: 15, done: false },
    { id: 3, text: '🎒 Pack backpack for tomorrow', points: 15, done: false },
    { id: 4, text: '🧼 Wash hands with soap and water', points: 10, done: true },
    { id: 5, text: '🦷 Brush your teeth for 2 minutes', points: 10, done: false },
    { id: 6, text: '👟 Place shoes neatly by the door', points: 10, done: false },
    { id: 7, text: '👕 Fold your clothes', points: 15, done: false },
  ]);

  const [activeChoreId, setActiveChoreId] = useState(null);

  const choreGuides = {
    1: { title: 'Make your bed', image: '/images/make-bed.svg', steps: ['Pull the blanket up to the top of the bed.', 'Smooth it out with your hands.', 'Fluff your pillow and place it at the top.'] },
    2: { title: 'Put your toys away', image: '/images/put-away-toys.svg', steps: ['Pick up one toy at a time.', 'Put each toy in its right bin or shelf.', 'Check the floor for any toys you missed.'] },
    3: { title: 'Pack your backpack', image: '/images/pack-backpack.svg', steps: ['Check what you need for tomorrow.', 'Put books and folders in first.', 'Add your pencil case and any grownup-approved snack.'] },
    4: { title: 'Wash your hands', image: '/images/wash-hands.svg', steps: ['Wet your hands and add soap.', 'Scrub palms, backs, and between fingers for 20 seconds.', 'Rinse well and dry your hands.'] },
    5: { title: 'Brush your teeth', image: '/images/brush-teeth.svg', steps: ['Put a pea-sized dot of toothpaste on your brush.', 'Brush every side of your teeth gently for two minutes.', 'Spit, rinse your brush, and put it away.'] },
    6: { title: 'Tidy your shoes', image: '/images/tidy-shoes.svg', steps: ['Find both shoes and match the pair.', 'Place them side by side by the door.', 'Keep the walking path clear.'] },
    7: { title: 'Fold your clothes', image: '/images/fold-clothes.png', steps: ['Lay one shirt flat on a clean surface.', 'Fold each side toward the middle, then fold the bottom up.', 'Stack the folded clothes neatly.'] }
  };

  const toggleChore = (id) => {
    setChores(prev =>
      prev.map(c => (c.id === id ? { ...c, done: !c.done } : c))
    );
  };

  useEffect(() => {
    if (activeChoreId === null) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setActiveChoreId(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [activeChoreId]);

  const totalPoints = chores.filter(c => c.done).reduce((acc, c) => acc + c.points, 0);
  const totalPossible = chores.reduce((acc, c) => acc + c.points, 0);
  const activeChore = chores.find(chore => chore.id === activeChoreId);
  const activeChoreGuide = activeChore ? choreGuides[activeChore.id] : null;

  return (
    <div className="kid-mode" style={styles.container}>
      {/* Kid Header */}
      <header className="kid-header" style={styles.header}>
        <div style={styles.headerLeft}>
          <div className="kid-avatar" style={styles.avatar}>🧒</div>
          <div>
            <div style={styles.titleRow}>
              <h1 className="kid-title" style={styles.title}>Kid Zone</h1>
              <span className="kid-verified-tag" style={styles.verifiedTag}>🛡️ k-ID Verified Under 13</span>
            </div>
            <p style={styles.subtitle}>Welcome back, Super Helper!</p>
          </div>
        </div>

        <div className="kid-header-right" style={styles.headerRight}>
          <div className="kid-star-badge" style={styles.starBadge}>
            <Star fill="#f59e0b" color="#f59e0b" size={20} />
            <span className="kid-star-count" style={styles.starCount}>{totalPoints} Stars</span>
          </div>
          {onOpenSettings && (
            <button onClick={onOpenSettings} style={styles.settingsBtn} title="View k-ID Permissions">
              <Shield size={16} color="#38bdf8" />
              <span>Permissions</span>
            </button>
          )}
          <button onClick={onSignOut} style={styles.signOutBtn} title="Exit Kid Zone">
            <LogOut size={16} />
            <span>Exit</span>
          </button>
        </div>
      </header>

      {/* Safety Notice Card */}
      <div className="kid-safety" style={styles.safetyCard}>
        <ShieldAlert size={20} color="#10b981" />
        <span className="kid-safety-text" style={styles.safetyText}>
          <strong>Safe Space Active:</strong> Open chat & sharp tools are disabled. Everything here is kid-safe and approved for your home!
        </span>
      </div>

      <div className="kid-content-grid" style={styles.contentGrid}>
        {/* Chores Section */}
        <section className="kid-card" style={styles.card}>
          <div style={styles.cardHeader}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Award color="#f59e0b" size={22} />
              <h2 className="kid-card-title" style={styles.cardTitle}>Daily Chore Quests</h2>
            </div>
            <span className="kid-progress-text" style={styles.progressText}>
              {chores.filter(c => c.done).length} / {chores.length} Completed
            </span>
          </div>

          {/* Progress Bar */}
          <div className="kid-progress-track" style={styles.progressBarTrack}>
            <div
              className="kid-progress-fill"
              style={{
                ...styles.progressBarFill,
                width: `${(totalPoints / totalPossible) * 100}%`
              }}
            />
          </div>

          <div className="kid-chore-list" style={styles.choreList}>
            {chores.map(chore => (
              <button
                type="button"
                key={chore.id}
                className={"kid-chore " + (chore.done ? "is-done" : "")}
                aria-label={"Open instructions: " + chore.text}
                onClick={() => setActiveChoreId(chore.id)}
                style={{
                  ...styles.choreItem,
                  width: '100%',
                  textAlign: 'left',
                  backgroundColor: chore.done ? '#1e293b' : '#1a233a',
                  borderColor: chore.done ? '#10b981' : '#334155'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  {chore.done ? (
                    <CheckCircle2 className="kid-chore-check" color="#10b981" size={24} />
                  ) : (
                    <Circle className="kid-chore-check" color="#64748b" size={24} />
                  )}
                  <span
                    className="kid-chore-text"
                    style={{
                      ...styles.choreText,
                      textDecoration: chore.done ? 'line-through' : 'none',
                      color: chore.done ? '#94a3b8' : '#f8fafc'
                    }}
                  >
                    {chore.text}
                  </span>
                </div>
                <span className="kid-chore-points" style={styles.chorePoints}>+{chore.points} ⭐</span>
              </button>
            ))}
          </div>

          {totalPoints === totalPossible && (
            <div className="kid-celebration" style={styles.celebrationBox}>
              <Sparkles size={20} color="#fbbf24" />
              <span>🎉 Incredible job! All daily quests are finished!</span>
            </div>
          )}
        </section>

      </div>

      {activeChore && activeChoreGuide && (
        <div className="kid-drawer-backdrop" onClick={() => setActiveChoreId(null)}>
          <aside
            className="kid-task-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="kid-task-title"
            onClick={event => event.stopPropagation()}
          >
            <div className="kid-drawer-header">
              <div>
                <span className="kid-drawer-eyebrow">YOUR TASK GUIDE</span>
                <h2 id="kid-task-title">{activeChoreGuide.title}</h2>
              </div>
              <button className="kid-drawer-close" type="button" aria-label="Close instructions" onClick={() => setActiveChoreId(null)}>
                <X size={22} />
              </button>
            </div>
            <img className={"kid-drawer-image " + (activeChore.id === 7 ? "kid-drawer-image-wide" : "")} src={activeChoreGuide.image} alt={"Illustration: " + activeChoreGuide.title} />
            <div className="kid-drawer-steps">
              {activeChoreGuide.steps.map((step, index) => (
                <div className="kid-drawer-step" key={step}>
                  <span>{index + 1}</span>
                  <p>{step}</p>
                </div>
              ))}
            </div>
            <div className="kid-drawer-footer">
              <span className="kid-drawer-points">⭐ Earn {activeChore.points} stars</span>
              {activeChore.done ? (
                <button className="kid-complete-button is-done" type="button" onClick={() => setActiveChoreId(null)}>
                  Done for today ✓
                </button>
              ) : (
                <button
                  className="kid-complete-button"
                  type="button"
                  onClick={() => {
                    toggleChore(activeChore.id);
                    setActiveChoreId(null);
                  }}
                >
                  Mark task complete ⭐
                </button>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

const styles = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#0c1322',
    color: '#f8fafc',
    paddingBottom: '90px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '20px 32px',
    backgroundColor: '#111a2e',
    borderBottom: '2px solid #1e293b',
    flexWrap: 'wrap',
    gap: '16px',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
  },
  avatar: {
    fontSize: '38px',
    backgroundColor: '#1e293b',
    padding: '8px',
    borderRadius: '16px',
    border: '2px solid #f59e0b',
  },
  titleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  title: {
    fontSize: '24px',
    fontWeight: '800',
    color: '#fef08a',
  },
  verifiedTag: {
    fontSize: '11px',
    fontWeight: '700',
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    color: '#34d399',
    padding: '3px 10px',
    borderRadius: '9999px',
    border: '1px solid rgba(16, 185, 129, 0.3)',
  },
  subtitle: {
    fontSize: '14px',
    color: '#94a3b8',
    marginTop: '2px',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '14px',
  },
  starBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
    border: '1px solid #f59e0b',
    padding: '8px 16px',
    borderRadius: '9999px',
  },
  starCount: {
    fontSize: '16px',
    fontWeight: '800',
    color: '#fef08a',
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
  settingsBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    border: '1px solid rgba(56, 189, 248, 0.4)',
    color: '#7dd3fc',
    padding: '8px 14px',
    borderRadius: '10px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: '600',
  },
  safetyCard: {
    maxWidth: '960px',
    margin: '20px auto 0',
    padding: '12px 20px',
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    border: '1px solid rgba(16, 185, 129, 0.3)',
    borderRadius: '12px',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    width: '90%',
  },
  safetyText: {
    fontSize: '13px',
    color: '#a7f3d0',
  },
  contentGrid: {
    maxWidth: '960px',
    margin: '24px auto',
    padding: '0 20px',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
    gap: '24px',
    width: '100%',
  },
  card: {
    backgroundColor: '#131c2e',
    border: '1px solid #1e293b',
    borderRadius: '18px',
    padding: '24px',
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '16px',
  },
  cardTitle: {
    fontSize: '18px',
    fontWeight: '700',
    color: '#ffffff',
  },
  progressText: {
    fontSize: '12px',
    color: '#94a3b8',
    fontWeight: '600',
  },
  progressBarTrack: {
    height: '8px',
    backgroundColor: '#1e293b',
    borderRadius: '9999px',
    overflow: 'hidden',
    marginBottom: '20px',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#10b981',
    transition: 'width 0.3s ease',
  },
  choreList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  choreItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '14px 16px',
    borderRadius: '12px',
    border: '1px solid',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  choreText: {
    fontSize: '14px',
    fontWeight: '500',
  },
  chorePoints: {
    fontSize: '12px',
    fontWeight: '700',
    color: '#f59e0b',
  },
  celebrationBox: {
    marginTop: '16px',
    padding: '12px',
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    border: '1px solid #f59e0b',
    borderRadius: '10px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    color: '#fef08a',
    fontSize: '13px',
    fontWeight: '600',
  },
  tabsRow: {
    display: 'flex',
    gap: '8px',
    marginBottom: '16px',
    overflowX: 'auto',
  },
  tabBtn: {
    border: 'none',
    padding: '8px 14px',
    borderRadius: '8px',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  skillDetailBox: {
    backgroundColor: '#0f172a',
    borderRadius: '12px',
    padding: '18px',
    border: '1px solid #273552',
  },
  skillImageCard: {
    width: '100%',
    height: '320px',
    borderRadius: '12px',
    overflow: 'hidden',
    marginBottom: '16px',
    backgroundColor: '#1e293b',
    border: '1px solid #334155',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  skillImage: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    display: 'block',
  },
  skillDetailTitle: {
    fontSize: '15px',
    fontWeight: '700',
    marginBottom: '14px',
    color: '#e2e8f0',
  },
  stepsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  stepRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '10px',
  },
  stepNumberBadge: {
    backgroundColor: '#3b82f6',
    color: '#ffffff',
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
  stepContent: {
    fontSize: '13px',
    color: '#cbd5e1',
    lineHeight: 1.5,
  }
};

