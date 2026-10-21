import React, { useState } from 'react';
import { Home, Utensils, Calendar, CheckSquare, Send, Sparkles, LogOut, Plus, Trash2, Shield, ShieldAlert } from 'lucide-react';
import { KidPermission } from '@k-id/core';

export default function AdultMode({ onSignOut, sessionId, onOpenSettings }) {
  const [activeTab, setActiveTab] = useState('assistant');
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      text: 'Hello. I am your Household Commander. I can help coordinate meal planning, delegate household chores among family members, manage shopping lists, or assist with recipes and home projects. How can I help today?'
    }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  // Household management state
  const [delegatedTasks, setDelegatedTasks] = useState([
    { id: 1, title: 'Clean and sanitize kitchen counters', assignee: 'Adult', due: 'Today' },
    { id: 2, title: 'After-school homework & backpack check', assignee: 'Kid', due: '4:30 PM' },
    { id: 3, title: 'Prep dinner ingredients & salad', assignee: 'Teen', due: '6:00 PM' },
  ]);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskAssignee, setNewTaskAssignee] = useState('Adult');

  const handleSend = async (customPrompt) => {
    const textToSend = customPrompt || input;
    if (!textToSend.trim() || loading) return;

    setInput('');
    const newMessages = [...messages, { role: 'user', text: textToSend }];
    setMessages(newMessages);
    setLoading(true);

    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: textToSend, ageMode: 'adult', sessionId })
      });

      const data = await res.json();
      if (res.ok) {
        setMessages([...newMessages, { role: 'assistant', text: data.reply, model: data.modelUsed }]);
      } else {
        setMessages([...newMessages, { role: 'assistant', text: `⚠️ ${data.error || 'Gemini API call failed.'}` }]);
      }
    } catch (err) {
      setMessages([...newMessages, { role: 'assistant', text: `⚠️ Network error: ${err.message}` }]);
    } finally {
      setLoading(false);
    }
  };

  const addTask = (e) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;
    setDelegatedTasks([
      ...delegatedTasks,
      { id: Date.now(), title: newTaskTitle.trim(), assignee: newTaskAssignee, due: 'Today' }
    ]);
    setNewTaskTitle('');
  };

  const removeTask = (id) => {
    setDelegatedTasks(delegatedTasks.filter(t => t.id !== id));
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={styles.avatar}>👤</div>
          <div>
            <div style={styles.titleRow}>
              <h1 style={styles.title}>Adult Household Command</h1>
              <span style={styles.verifiedTag}>🛡️ k-ID Verified 18+</span>
            </div>
            <p style={styles.subtitle}>Full Assistant • Meal Planning • Household Delegation</p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {onOpenSettings && (
            <button onClick={onOpenSettings} style={styles.settingsHeaderBtn} title="Manage k-ID Permissions">
              <Shield size={16} color="#34d399" />
              <span>Permissions</span>
            </button>
          )}
          <button onClick={onSignOut} style={styles.signOutBtn}>
            <LogOut size={16} />
            <span>Exit</span>
          </button>
        </div>
      </header>

      {/* Tabs */}
      <div style={styles.tabsContainer}>
        <button
          onClick={() => setActiveTab('assistant')}
          style={{
            ...styles.navTab,
            borderBottomColor: activeTab === 'assistant' ? '#10b981' : 'transparent',
            color: activeTab === 'assistant' ? '#34d399' : '#94a3b8'
          }}
        >
          <Sparkles size={16} />
          <span>Open AI Assistant</span>
        </button>
        <button
          onClick={() => setActiveTab('delegation')}
          style={{
            ...styles.navTab,
            borderBottomColor: activeTab === 'delegation' ? '#10b981' : 'transparent',
            color: activeTab === 'delegation' ? '#34d399' : '#94a3b8'
          }}
        >
          <CheckSquare size={16} />
          <span>Chore & Family Delegation</span>
        </button>
      </div>

      <main style={styles.main}>
        {activeTab === 'assistant' ? (
          <div style={styles.assistantLayout}>
            {/* Quick Actions Sidebar */}
            <aside style={styles.sidebar}>
              <h3 style={styles.sidebarHeading}>Household Recipes & Shortcuts</h3>
              <div style={styles.shortcutList}>
                <button
                  onClick={() => handleSend('Create a 3-day quick family dinner meal plan with healthy balance and grocery checklist.')}
                  style={styles.shortcutBtn}
                >
                  <Utensils size={15} color="#10b981" />
                  <span>3-Day Dinner Meal Plan</span>
                </button>
                <button
                  onClick={() => handleSend('Suggest safe, age-appropriate chore delegation for a 9-year-old child and 15-year-old teen.')}
                  style={styles.shortcutBtn}
                >
                  <Home size={15} color="#10b981" />
                  <span>Chore Delegation Ideas</span>
                </button>
                <button
                  onClick={() => handleSend('Write a quick Saturday morning family cleaning routine that takes under 45 minutes.')}
                  style={styles.shortcutBtn}
                >
                  <Calendar size={15} color="#10b981" />
                  <span>45-Min Weekend Clean Routine</span>
                </button>
              </div>
            </aside>

            {/* Chat Box wrapped in k-ID Permission Gate */}
            <KidPermission
              name="ai-chat"
              fallback={
                <div style={{ ...styles.chatSection, padding: '40px 24px', textAlign: 'center', justifyContent: 'center', alignItems: 'center' }}>
                  <ShieldAlert size={44} color="#10b981" style={{ marginBottom: 16 }} />
                  <h2 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '8px', color: '#ffffff' }}>
                    AI Chat Feature Locked
                  </h2>
                  <p style={{ color: '#94a3b8', fontSize: '13px', maxWidth: '380px', lineHeight: 1.5, marginBottom: '20px' }}>
                    The <code>ai-chat</code> feature requires permission. You can enable or request this in your k-ID Privacy & Permissions settings.
                  </p>
                  {onOpenSettings && (
                    <button onClick={onOpenSettings} style={styles.settingsHeaderBtn}>
                      <Shield size={16} />
                      <span>Open Permission Settings</span>
                    </button>
                  )}
                </div>
              }
            >
              <div style={styles.chatSection}>
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
                          backgroundColor: msg.role === 'user' ? '#047857' : '#1e293b',
                          borderColor: msg.role === 'user' ? '#10b981' : '#334155'
                        }}
                      >
                        <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{msg.text}</p>
                        {msg.model && (
                          <span style={styles.modelTag}>{msg.model}</span>
                        )}
                      </div>
                    </div>
                  ))}
                  {loading && (
                    <div style={styles.loadingBubble}>
                      <Sparkles size={16} color="#34d399" />
                      <span>Gemini Assistant is formulating your household plan...</span>
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
                    placeholder="Ask anything: recipes, family scheduling, chore distribution, maintenance..."
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
              </div>
            </KidPermission>
          </div>
        ) : (
          /* Delegation Tab */
          <div style={styles.delegationSection}>
            <div style={styles.cardHeader}>
              <h2 style={{ fontSize: '18px', fontWeight: '700' }}>Household Delegation Board</h2>
              <span style={{ fontSize: '13px', color: '#94a3b8' }}>Assign responsibilities across the family</span>
            </div>

            <form onSubmit={addTask} style={styles.addTaskForm}>
              <input
                type="text"
                placeholder="New task (e.g., Take out recycling, fold laundry)..."
                value={newTaskTitle}
                onChange={(e) => setNewTaskTitle(e.target.value)}
                style={styles.addTaskInput}
              />
              <select
                value={newTaskAssignee}
                onChange={(e) => setNewTaskAssignee(e.target.value)}
                style={styles.selectAssignee}
              >
                <option value="Kid">Kid (Under 13)</option>
                <option value="Teen">Teen (13-17)</option>
                <option value="Adult">Adult (18+)</option>
              </select>
              <button type="submit" style={styles.addTaskBtn}>
                <Plus size={16} />
                <span>Add Task</span>
              </button>
            </form>

            <div style={styles.taskList}>
              {delegatedTasks.map(task => (
                <div key={task.id} style={styles.taskItem}>
                  <div>
                    <div style={{ fontSize: '15px', fontWeight: '600' }}>{task.title}</div>
                    <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>
                      Assigned to: <strong style={{ color: task.assignee === 'Kid' ? '#f59e0b' : task.assignee === 'Teen' ? '#06b6d4' : '#10b981' }}>{task.assignee}</strong> • Due: {task.due}
                    </div>
                  </div>
                  <button onClick={() => removeTask(task.id)} style={styles.deleteBtn}>
                    <Trash2 size={16} color="#f87171" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

const styles = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#0a0f18',
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
    border: '2px solid #10b981',
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
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    color: '#34d399',
    padding: '3px 10px',
    borderRadius: '9999px',
    border: '1px solid rgba(16, 185, 129, 0.3)',
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
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    border: '1px solid rgba(16, 185, 129, 0.4)',
    color: '#34d399',
    padding: '8px 14px',
    borderRadius: '10px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: '600',
  },
  tabsContainer: {
    display: 'flex',
    gap: '24px',
    padding: '0 32px',
    backgroundColor: '#0f172a',
    borderBottom: '1px solid #1e293b',
  },
  navTab: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '14px 4px',
    background: 'none',
    border: 'none',
    borderBottom: '2px solid transparent',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  main: {
    maxWidth: '1200px',
    margin: '24px auto',
    padding: '0 20px',
  },
  assistantLayout: {
    display: 'grid',
    gridTemplateColumns: '320px 1fr',
    gap: '20px',
  },
  sidebar: {
    backgroundColor: '#131c2e',
    border: '1px solid #1e293b',
    borderRadius: '16px',
    padding: '20px',
    height: 'fit-content',
  },
  sidebarHeading: {
    fontSize: '13px',
    fontWeight: '700',
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: '14px',
  },
  shortcutList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  shortcutBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    backgroundColor: '#0f172a',
    border: '1px solid #1e293b',
    color: '#cbd5e1',
    padding: '12px 14px',
    borderRadius: '10px',
    fontSize: '13px',
    fontWeight: '500',
    textAlign: 'left',
    cursor: 'pointer',
    lineHeight: 1.4,
  },
  chatSection: {
    backgroundColor: '#131c2e',
    border: '1px solid #1e293b',
    borderRadius: '16px',
    display: 'flex',
    flexDirection: 'column',
    height: '620px',
    overflow: 'hidden',
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
    maxWidth: '82%',
    padding: '14px 18px',
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
    color: '#34d399',
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
    backgroundColor: '#059669',
    color: '#ffffff',
    border: 'none',
    padding: '0 20px',
    borderRadius: '10px',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  delegationSection: {
    backgroundColor: '#131c2e',
    border: '1px solid #1e293b',
    borderRadius: '16px',
    padding: '24px',
    maxWidth: '800px',
    margin: '0 auto',
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px',
  },
  addTaskForm: {
    display: 'flex',
    gap: '10px',
    marginBottom: '24px',
    flexWrap: 'wrap',
  },
  addTaskInput: {
    flex: 1,
    minWidth: '240px',
    backgroundColor: '#0f172a',
    border: '1px solid #334155',
    color: '#ffffff',
    padding: '10px 14px',
    borderRadius: '10px',
    fontSize: '14px',
    outline: 'none',
  },
  selectAssignee: {
    backgroundColor: '#0f172a',
    border: '1px solid #334155',
    color: '#cbd5e1',
    padding: '10px 12px',
    borderRadius: '10px',
    fontSize: '13px',
    outline: 'none',
  },
  addTaskBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    backgroundColor: '#10b981',
    color: '#ffffff',
    border: 'none',
    padding: '10px 16px',
    borderRadius: '10px',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  taskList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  taskItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#0f172a',
    border: '1px solid #1e293b',
    borderRadius: '12px',
    padding: '14px 18px',
  },
  deleteBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '6px',
    borderRadius: '6px',
  }
};

