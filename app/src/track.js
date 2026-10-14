import { validEvent } from './event-schema.js';

// Page-local milestone deduplication only; no storage, identifiers or retries.
export function createTracker(target = globalThis) {
  const seen = new Set();
  return function track(step, code) {
    try {
      if (!validEvent({ step, code })) return;
      const milestone = ['os', 'entry_shown', 'entry_blocked', 'home_reached'].includes(step);
      const key = `${step}:${code}`;
      if (milestone && seen.has(key)) return;
      if (milestone) seen.add(key);
      const body = JSON.stringify({ step, code });
      if (typeof target.navigator?.sendBeacon === 'function') {
        target.navigator.sendBeacon('/api/event', new Blob([body], { type: 'application/json' }));
      } else if (typeof target.fetch === 'function') {
        Promise.resolve(target.fetch('/api/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true })).catch(() => {});
      }
    } catch { /* Observation must never affect UI, authentication or transactions. */ }
  };
}
export const track = createTracker();
export function installErrorTracking(target = globalThis, emit = track) {
  try {
    if (typeof target.addEventListener !== 'function') return;
    target.addEventListener('error', event => {
      try {
        const kinds = { TypeError: 'type', RangeError: 'range', ReferenceError: 'reference', SyntaxError: 'syntax' };
        emit('js_error', Object.prototype.hasOwnProperty.call(kinds, event.error?.name) ? kinds[event.error.name] : 'error');
      } catch { /* never rethrow from an error observer */ }
    });
    target.addEventListener('unhandledrejection', () => { try { emit('js_error', 'rejection'); } catch {} });
  } catch { /* best effort */ }
}
installErrorTracking();
