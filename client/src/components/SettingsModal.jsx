import React from 'react';
import { KidSettingsProvider, KidSettings } from '@k-id/core';
import { X, Shield } from 'lucide-react';

export default function SettingsModal({ sessionId, isOpen, onClose }) {
  if (!isOpen) return null;

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Shield size={20} color="#818cf8" />
            <h2 style={styles.title}>k-ID Privacy & Permissions</h2>
          </div>
          <button style={styles.closeBtn} onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <p style={styles.subtext}>
          Manage AI features, data controls, and guardian-approved capabilities for this session.
        </p>

        <div style={styles.content}>
          {sessionId ? (
            <KidSettingsProvider sessionId={sessionId}>
              <KidSettings />
            </KidSettingsProvider>
          ) : (
            <p style={{ color: '#94a3b8', textAlign: 'center', padding: '20px' }}>
              No active k-ID session ID found. Verify via age gate to manage permissions.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    backdropFilter: 'blur(4px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    padding: '20px',
  },
  modal: {
    backgroundColor: '#1e293b',
    border: '1px solid #334155',
    borderRadius: '16px',
    width: '100%',
    maxWidth: '520px',
    maxHeight: '85vh',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.6)',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '18px 24px',
    borderBottom: '1px solid #334155',
    backgroundColor: '#0f172a',
  },
  title: {
    fontSize: '17px',
    fontWeight: '700',
    color: '#ffffff',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: '#94a3b8',
    cursor: 'pointer',
    padding: '4px',
    borderRadius: '6px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  subtext: {
    fontSize: '13px',
    color: '#94a3b8',
    padding: '12px 24px 0',
    lineHeight: 1.5,
  },
  content: {
    padding: '20px 24px',
    overflowY: 'auto',
    flex: 1,
    color: '#f8fafc',
  }
};

