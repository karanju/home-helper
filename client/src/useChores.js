import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from './auth';
import { SEED_CHORES } from './household';

const STORAGE_KEY = 'home_helper_chores_v1';
const POLL_MS = 15000;

// Chores used to store the assignee's age group as `assignee`; everything now uses `assigneeId`.
// A guide still being written when the page closed will never finish, so it is offered as a retry instead.
const normalize = (chore) => ({
  ...chore,
  assigneeId: chore.assigneeId ?? chore.assignee,
  ...(chore.instructionsStatus === 'pending' && { instructionsStatus: 'failed' }),
  ...(chore.posterStatus === 'pending' && { posterStatus: 'failed' })
});

function loadLocalChores() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (Array.isArray(saved)) {
      const savedIds = new Set(saved.map(chore => chore.id));
      return [...saved, ...SEED_CHORES.filter(chore => !savedIds.has(chore.id))].map(normalize);
    }
  } catch {}
  return SEED_CHORES.map(normalize);
}

// Without a family (or in demo mode) chores live in this browser, assigned to age groups.
function useLocalChores() {
  const [chores, setChores] = useState(loadLocalChores);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(chores));
    } catch {}
  }, [chores]);

  return {
    chores,
    error: null,
    addChore: async (chore) => {
      const created = { id: Date.now(), done: false, steps: [], ...chore };
      setChores(prev => [...prev, created]);
      return created;
    },
    toggleChore: async (id) => setChores(prev => prev.map(c => (c.id === id ? { ...c, done: !c.done } : c))),
    removeChore: async (id) => setChores(prev => prev.filter(c => c.id !== id)),
    // Local chores get their AI guide written into them by the browser
    patchChore: (id, updates) => setChores(prev => prev.map(c => (c.id === id ? { ...c, ...updates } : c))),
    refresh: async () => {}
  };
}

// In a family, chores live in Firestore behind the server's chore API, assigned to family members.
// Changes show instantly here and reach other devices on their next refresh (focus, or every 15s).
function useFamilyChores(enabled) {
  const [chores, setChores] = useState([]);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const data = await apiFetch('/api/families/chores');
      setChores(data.chores);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    refresh();
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, POLL_MS);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(poll);
      window.removeEventListener('focus', refresh);
    };
  }, [enabled, refresh]);

  // Apply the change locally first; if the server refuses, show why and reload the real list
  const mutate = async (optimistic, request) => {
    setChores(optimistic);
    try {
      await request();
    } catch (err) {
      setError(err.message);
    }
    refresh();
  };

  return {
    chores,
    error,
    refresh,
    addChore: async (chore) => {
      try {
        const { chore: created } = await apiFetch('/api/families/chores', { method: 'POST', body: chore });
        setChores(prev => [...prev, created]);
        setError(null);
        return created;
      } catch (err) {
        setError(err.message);
        return null;
      }
    },
    toggleChore: (id) => {
      const chore = chores.find(c => c.id === id);
      if (!chore) return Promise.resolve();
      return mutate(
        prev => prev.map(c => (c.id === id ? { ...c, done: !c.done } : c)),
        () => apiFetch(`/api/families/chores/${id}`, { method: 'PATCH', body: { done: !chore.done } })
      );
    },
    removeChore: (id) => mutate(
      prev => prev.filter(c => c.id !== id),
      () => apiFetch(`/api/families/chores/${id}`, { method: 'DELETE' })
    )
  };
}

export function useChores({ inFamily }) {
  // Both hooks always run (hook order must stay fixed); only one is used
  const local = useLocalChores();
  const family = useFamilyChores(inFamily);
  return inFamily ? family : local;
}
