import React, { useState } from 'react';
import { CheckCircle2, Circle, Star, Sparkles, Award, ShieldAlert, LogOut, Shield } from 'lucide-react';

export default function KidMode({ onSignOut, sessionId, onOpenSettings }) {
  const [chores, setChores] = useState([
    { id: 1, text: '🛏️ Make your bed nicely', points: 10, done: true },
    { id: 2, text: '🧸 Put your toys back into the toy box', points: 15, done: false },
    { id: 3, text: '🎒 Pack backpack for tomorrow', points: 15, done: false },
    { id: 4, text: '🧼 Wash hands with soap and water', points: 10, done: true },
    { id: 5, text: '🦷 Brush your teeth for 2 minutes', points: 10, done: false },
    { id: 6, text: '👟 Place shoes neatly by the door', points: 10, done: false },
  ]);

  const [activeLifeSkill, setActiveLifeSkill] = useState(0);

  const lifeSkills = [
    {
      title: 'How to Fold a T-Shirt in 3 Easy Steps',
      image: '/images/fold-tshirt.svg',
      steps: [
        '1. Lay your shirt face down flat on your bed.',
        '2. Fold both sleeves toward the center.',
        '3. Fold the bottom half up to the top. Nice and tidy!'
      ],
      emoji: '👕'
    },
    {
      title: 'How to Pack Your Backpack',
      image: '/images/pack-backpack.svg',
      steps: [
        '1. Heavy books go in the back pocket first.',
        '2. Put folders and notebooks in the middle.',
        '3. Pencil case and snack box go in the front pocket!'
      ],
      emoji: '🎒'
    },
    {
      title: 'Super Soap Hand Washing Song',
      image: '/images/wash-hands.svg',
      steps: [
        '1. Wet your hands and apply soap bubbles.',
        '2. Scrub palms, backs of hands, and between fingers.',
        '3. Hum "Happy Birthday" twice (20 seconds), then rinse!'
      ],
      emoji: '🧼'
    },
    {
      title: 'How to Make Your Bed Cozy and Tidy',
      image: '/images/make-bed.svg',
      steps: [
        '1. Pull your top sheet straight up to the head of the bed.',
        '2. Smooth out the blanket so there are no big wrinkles.',
        '3. Fluff your pillow and set it neatly at the top!'
      ],
      emoji: '🛏️'
    }
  ];

  const toggleChore = (id) => {
    setChores(prev =>
      prev.map(c => (c.id === id ? { ...c, done: !c.done } : c))
    );
  };

  const totalPoints = chores.filter(c => c.done).reduce((acc, c) => acc + c.points, 0);
  const totalPossible = chores.reduce((acc, c) => acc + c.points, 0);

  return (
    <div style={styles.container}>
      {/* Kid Header */}
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={styles.avatar}>🧒</div>
          <div>
            <div style={styles.titleRow}>
              <h1 style={styles.title}>Kid Zone</h1>
              <span style={styles.verifiedTag}>🛡️ k-ID Verified Under 13</span>
            </div>
            <p style={styles.subtitle}>Welcome back, Super Helper!</p>
          </div>
        </div>

        <div style={styles.headerRight}>
          <div style={styles.starBadge}>
            <Star fill="#f59e0b" color="#f59e0b" size={20} />
            <span style={styles.starCount}>{totalPoints} Stars</span>
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
      <div style={styles.safetyCard}>
        <ShieldAlert size={20} color="#10b981" />
        <span style={styles.safetyText}>
          <strong>Safe Space Active:</strong> Open chat & sharp tools are disabled. Everything here is kid-safe and approved for your home!
        </span>
      </div>

      <div style={styles.contentGrid}>
        {/* Chores Section */}
        <section style={styles.card}>
          <div style={styles.cardHeader}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Award color="#f59e0b" size={22} />
              <h2 style={styles.cardTitle}>Daily Chore Quests</h2>
            </div>
            <span style={styles.progressText}>
              {chores.filter(c => c.done).length} / {chores.length} Completed
            </span>
          </div>

          {/* Progress Bar */}
          <div style={styles.progressBarTrack}>
            <div
              style={{
                ...styles.progressBarFill,
                width: `${(totalPoints / totalPossible) * 100}%`
              }}
            />
          </div>

          <div style={styles.choreList}>
            {chores.map(chore => (
              <div
                key={chore.id}
                onClick={() => toggleChore(chore.id)}
                style={{
                  ...styles.choreItem,
                  backgroundColor: chore.done ? '#1e293b' : '#1a233a',
                  borderColor: chore.done ? '#10b981' : '#334155'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  {chore.done ? (
                    <CheckCircle2 color="#10b981" size={24} />
                  ) : (
                    <Circle color="#64748b" size={24} />
                  )}
                  <span
                    style={{
                      ...styles.choreText,
                      textDecoration: chore.done ? 'line-through' : 'none',
                      color: chore.done ? '#94a3b8' : '#f8fafc'
                    }}
                  >
                    {chore.text}
                  </span>
                </div>
                <span style={styles.chorePoints}>+{chore.points} ⭐</span>
              </div>
            ))}
          </div>

          {totalPoints === totalPossible && (
            <div style={styles.celebrationBox}>
              <Sparkles size={20} color="#fbbf24" />
              <span>🎉 Incredible job! All daily quests are finished!</span>
            </div>
          )}
        </section>

        {/* Life Skills Guide */}
        <section style={styles.card}>
          <div style={styles.cardHeader}>
            <h2 style={styles.cardTitle}>🌟 Helpful Life Skills</h2>
          </div>

          <div style={styles.tabsRow}>
            {lifeSkills.map((skill, idx) => (
              <button
                key={idx}
                onClick={() => setActiveLifeSkill(idx)}
                style={{
                  ...styles.tabBtn,
                  backgroundColor: activeLifeSkill === idx ? '#3b82f6' : '#1e293b',
                  color: activeLifeSkill === idx ? '#ffffff' : '#94a3b8'
                }}
              >
                <span>{skill.emoji}</span> {skill.title.split(' ')[2] || 'Skill'}
              </button>
            ))}
          </div>

          <div style={styles.skillDetailBox}>
            {/* Visual Learning Illustration */}
            <div style={styles.skillImageCard}>
              <img
                src={lifeSkills[activeLifeSkill].image}
                alt={lifeSkills[activeLifeSkill].title}
                style={styles.skillImage}
              />
            </div>

            <h3 style={styles.skillDetailTitle}>
              {lifeSkills[activeLifeSkill].emoji} {lifeSkills[activeLifeSkill].title}
            </h3>
            <div style={styles.stepsList}>
              {lifeSkills[activeLifeSkill].steps.map((step, idx) => (
                <div key={idx} style={styles.stepRow}>
                  <span style={styles.stepNumberBadge}>{idx + 1}</span>
                  <p style={styles.stepContent}>{step.replace(/^\d+\.\s*/, '')}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
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
    height: '180px',
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
    objectFit: 'cover',
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

