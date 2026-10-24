import { emptyState, mergeStates, nextTimestamp, active } from './merge.js';

export const PROFILE_KEY = 'vdp.profile.v1';
export const SETTINGS_KEY = 'vdp.settings.v1';
export function readLocal(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}
export function writeLocal(key, value) {
  // Errors are surfaced to the UI, never silently discard an answer.
  localStorage.setItem(key, JSON.stringify(value));
}

export function createProfile(onChange, onError) {
  let state = mergeStates(emptyState(), readLocal(PROFILE_KEY, {}));
  function persist() {
    try { writeLocal(PROFILE_KEY, state); return true; }
    catch { onError('Хранилище браузера недоступно или заполнено. Последняя правка пока только в памяти.'); return false; }
  }
  function update(kind, key, value) {
    // Read before editing so another tab's latest changes are preserved.
    state = mergeStates(state, readLocal(PROFILE_KEY, {}));
    const at = nextTimestamp(state);
    if (kind === 'names') state.names = { ...value, at };
    else state[kind][key] = value === null ? { removed: true, at } : { ...value, at };
    const saved = persist();
    onChange('local');
    return saved;
  }
  function merge(remote, origin = 'remote') {
    const merged = mergeStates(mergeStates(state, readLocal(PROFILE_KEY, {})), remote);
    if (JSON.stringify(merged) === JSON.stringify(state)) return;
    state = merged; persist(); onChange(origin);
  }
  window.addEventListener('storage', event => {
    if (event.key === PROFILE_KEY && event.newValue) {
      try { merge(JSON.parse(event.newValue), 'tab'); } catch { /* Ignore malformed data from another tab. */ }
    }
  });
  return {
    get state() { return state; }, update, merge,
    toggle(kind, key) { return update(kind, key, active(state[kind][key]) ? null : {}); }
  };
}
