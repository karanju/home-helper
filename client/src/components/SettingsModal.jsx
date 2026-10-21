import React, { useContext } from 'react';
import { KidSettingsProvider, KidSettings } from '@k-id/core';
import { Shield } from 'lucide-react';
import { DemoModeContext } from './FeatureGate';
import Sheet from './Sheet';

export default function SettingsModal({ sessionId, challengeId, onChallenge, isOpen, onClose }) {
  const isDemo = useContext(DemoModeContext);

  return (
    <Sheet open={isOpen} onClose={onClose} eyebrow="k-ID" title="Privacy & Permissions">
      <div className="panel-stack">
        <p className="subhead">
          Manage AI features, data controls, and guardian-approved capabilities for this session.
        </p>
        {isDemo ? (
          <div className="panel-empty">
            <Shield size={22} />
            <p className="subhead">Permissions need a real k-ID session. Sign in and pass the age check to manage them.</p>
          </div>
        ) : sessionId ? (
          <KidSettingsProvider sessionId={sessionId} challengeId={challengeId} onChallenge={onChallenge}>
            <KidSettings />
          </KidSettingsProvider>
        ) : (
          <div className="panel-empty">
            <Shield size={22} />
            <p className="subhead">No active k-ID session found. Pass the age check to manage permissions.</p>
          </div>
        )}
      </div>
    </Sheet>
  );
}
