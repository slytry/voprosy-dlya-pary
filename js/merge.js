export const emptyState = () => ({
  v: 1, favorites: {}, hidden: {}, answers: {},
  names: { me: '', partner: '', at: '1970-01-01T00:00:00.000Z' }
});

const validDate = at => typeof at === 'string' && Number.isFinite(Date.parse(at));
const validKey = key => /^[a-z0-9-]+\/[a-z0-9-]+$/i.test(key);

function record(value, kind) {
  if (!value || !validDate(value.at)) return null;
  const at = new Date(value.at).toISOString();
  if (value.removed) return { removed: true, at };
  if (kind === 'answers') return {
    q: String(value.q || ''), me: String(value.me || ''), partner: String(value.partner || ''), at
  };
  return { at };
}

// Ties are deterministic across devices; a simultaneous deletion wins.
function newer(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (a.at !== b.at) return a.at > b.at ? a : b;
  if (!!a.removed !== !!b.removed) return a.removed ? a : b;
  return JSON.stringify(a) > JSON.stringify(b) ? a : b;
}

export function mergeStates(left, right) {
  const merged = emptyState();
  for (const kind of ['favorites', 'hidden', 'answers']) {
    for (const key of [...new Set([...Object.keys(left?.[kind] || {}), ...Object.keys(right?.[kind] || {})])].sort()) {
      if (!validKey(key)) continue;
      const value = newer(record(left?.[kind]?.[key], kind), record(right?.[kind]?.[key], kind));
      if (value) merged[kind][key] = value;
    }
  }
  const names = value => validDate(value?.at) ? {
    me: String(value.me || ''), partner: String(value.partner || ''), at: new Date(value.at).toISOString()
  } : null;
  merged.names = newer(names(left?.names), names(right?.names)) || merged.names;
  return merged;
}

export const active = record => !!record && !record.removed;
export const activeKeys = records => Object.keys(records).filter(key => active(records[key]));

export function nextTimestamp(state, now = Date.now()) {
  const dates = [state.names.at];
  for (const kind of ['favorites', 'hidden', 'answers']) dates.push(...Object.values(state[kind]).map(r => r.at));
  return new Date(Math.max(now, ...dates.map(at => Date.parse(at) + 1))).toISOString();
}
