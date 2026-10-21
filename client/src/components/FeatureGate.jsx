import React, { createContext, useContext } from 'react';
import { useKidPermission } from '@k-id/core';

// True while the ?mock-age demo bypass is active (no k-ID session exists)
export const DemoModeContext = createContext(false);

// Whether a k-ID permission is on. useKidPermission needs a <KidSessionProvider>, which the demo
// tree doesn't have; a mounted tree is always one or the other, so the hook order never changes.
export function useFeature(name) {
  const isDemo = useContext(DemoModeContext);
  if (isDemo) return true;
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useKidPermission().can(name);
}

export function FeatureGate({ name, fallback = null, children }) {
  return <>{useFeature(name) ? children : fallback}</>;
}
