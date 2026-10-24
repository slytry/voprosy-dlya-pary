export function shuffle(values) {
  const array = [...values];
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// Only positions, filters and ordering live here. The profile is shared by all games.
export function createGame(cards, saved, available = () => true) {
  const byKey = new Map(cards.map(card => [card.key, card]));
  const themes = [...new Set(cards.filter(c => !c.task).map(c => c.themeKey))];
  const state = {
    off: (saved?.off || []).filter(id => themes.includes(id)).slice(0, Math.max(0, themes.length - 1)),
    mix: saved?.mix !== false,
    history: (saved?.history || []).filter(key => byKey.has(key)),
    pos: -1, deck: []
  };
  state.pos = Math.min(Math.max(Number(saved?.pos) || 0, 0), state.history.length);
  const allowed = key => {
    const card = byKey.get(key);
    return !!card && available(key) && (card.task || !state.off.includes(card.themeKey));
  };
  const end = () => state.pos >= state.history.length;
  const current = () => end() ? null : byKey.get(state.history[state.pos]);
  function historyPos(dir) {
    let pos = state.pos + dir;
    while (pos >= 0 && pos < state.history.length && !allowed(state.history[pos])) pos += dir;
    return pos;
  }
  function rebuild() {
    const seen = new Set(state.history);
    state.deck = shuffle(cards.filter(c => allowed(c.key) && (state.mix || !c.task) && !seen.has(c.key)).map(c => c.key));
    if (!state.history.length && byKey.get(state.deck[0])?.task) {
      const question = state.deck.findIndex(key => !byKey.get(key).task);
      if (question > 0) [state.deck[0], state.deck[question]] = [state.deck[question], state.deck[0]];
    }
  }
  function next() {
    const pos = historyPos(1);
    if (pos < state.history.length) state.pos = pos;
    else {
      const id = state.deck.shift();
      if (id) state.history.push(id);
      state.pos = state.history.length - (id ? 1 : 0);
    }
  }
  function prev() {
    const pos = historyPos(-1);
    if (pos >= 0) state.pos = pos;
  }
  function refresh() {
    rebuild();
    if (!end() && !allowed(state.history[state.pos])) next();
    else if (end() && state.deck.length) next();
  }
  function reset() {
    state.history = []; state.pos = -1;
    rebuild(); next();
  }
  function task() {
    const seen = new Set(state.history);
    const tasks = cards.filter(c => c.task && allowed(c.key));
    let pool = tasks.filter(c => !seen.has(c.key));
    if (!pool.length) pool = tasks.filter(c => c.key !== current()?.key);
    const card = shuffle(pool)[0] || tasks[0];
    if (!card) return;
    state.deck = state.deck.filter(key => key !== card.key);
    state.history.push(card.key); state.pos = state.history.length - 1;
  }
  function open(key) {
    const card = byKey.get(key);
    if (!card || !available(key)) return false;
    state.off = state.off.filter(id => id !== card.themeKey);
    const pos = state.history.lastIndexOf(key);
    if (pos >= 0) state.pos = pos;
    else { state.history.push(key); state.pos = state.history.length - 1; }
    rebuild();
    return true;
  }
  if (!state.history.length) reset();
  else refresh();
  return { state, cards, themes, current, end, historyPos, next, prev, task, reset, refresh, open, allowed };
}
