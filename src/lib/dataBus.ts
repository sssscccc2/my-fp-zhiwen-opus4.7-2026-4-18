import { useEffect } from 'react';

/**
 * Tiny global event bus for "data changed, please reload" notifications.
 *
 * Why not Redux/Zustand: every page already owns its own data fetch logic.
 * We only need a one-line "ping all subscribers when something mutates" so
 * the sidebar (which shows group counts) refreshes after the editor saves
 * a profile, without prop-drilling or context plumbing.
 *
 * Usage:
 *   - After mutating profiles/groups/proxies: `fireDataChanged()`
 *   - In components that should refresh: `useDataReload(reloadFn)`
 */
const bus = new EventTarget();
const EVT = 'change';

export function fireDataChanged(): void {
  bus.dispatchEvent(new Event(EVT));
}

export function useDataReload(reloadFn: () => void | Promise<void>): void {
  useEffect(() => {
    const handler = () => {
      void reloadFn();
    };
    bus.addEventListener(EVT, handler);
    return () => bus.removeEventListener(EVT, handler);
  }, [reloadFn]);
}
