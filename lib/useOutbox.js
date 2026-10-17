'use client';
import { useEffect, useState } from 'react';
import { queue, syncer } from './sync.js';

// Live view of the saved-but-unsent reports, for the banner and the "saved" screen.
export function useOutbox() {
  const [state, setState] = useState({ items: [], running: false });
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const items = await queue.getAll();
        if (alive) setState({ items, running: syncer.isRunning() });
      } catch { /* IndexedDB unavailable: treat as an empty queue */ }
    };
    load();
    const stop = syncer.subscribe(load);
    return () => { alive = false; stop(); };
  }, []);
  return state;
}
