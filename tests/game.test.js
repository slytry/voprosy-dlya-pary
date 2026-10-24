import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createGame } from '../js/game.js';

const cards = [
  { key: 'a/01', themeKey: 'a/one' }, { key: 'a/02', themeKey: 'a/two' },
  { key: 'a/03', themeKey: 'a/one' }, { key: 'a/task-01', themeKey: 'a/task', task: true }
];
test('first card is a question; questions are not repeated before the end', () => {
  for (let attempt = 0; attempt < 30; attempt++) {
    const game = createGame(cards);
    assert.equal(!!game.current().task, false);
    const seen = new Set();
    while (!game.end()) { assert.ok(!seen.has(game.current().key)); seen.add(game.current().key); game.next(); }
    assert.equal(seen.size, 4);
    game.prev(); assert.ok(game.current());
  }
});

test('historyPos skips switched-off themes in both directions, including the end', () => {
  const game = createGame(cards, { history: ['a/01', 'a/02', 'a/03'], pos: 0, mix: false, off: ['a/two'] });
  game.next(); assert.equal(game.current().key, 'a/03');
  game.prev(); assert.equal(game.current().key, 'a/01');
  game.next(); game.next(); assert.equal(game.end(), true);
  game.prev(); assert.equal(game.current().key, 'a/03');
  game.state.off = ['a/one']; game.refresh();
  assert.equal(game.current(), null);
  game.prev(); assert.equal(game.current().key, 'a/02');
});

test('hidden question and task disappear immediately and stay out for 120 draws and resets', () => {
  const hidden = new Set();
  const game = createGame(cards, null, key => !hidden.has(key));
  hidden.add(game.current().key); hidden.add('a/task-01');
  game.refresh();
  for (let i = 0; i < 120; i++) {
    if (game.end()) game.reset();
    assert.ok(!hidden.has(game.current().key));
    game.next();
  }
  game.task(); assert.ok(!game.current()?.task);
});

test('manual tasks and restored local positions work; reopening enables the theme', () => {
  const game = createGame(cards, { history: ['a/01'], pos: 0, mix: false });
  game.task(); assert.equal(game.current().key, 'a/task-01');
  const restored = createGame(cards, JSON.parse(JSON.stringify(game.state)));
  assert.equal(restored.current().key, 'a/task-01');
  restored.state.off = ['a/two'];
  assert.equal(restored.open('a/02'), true);
  assert.equal(restored.current().key, 'a/02');
  assert.ok(!restored.state.off.includes('a/two'));
});

test('a card deep link is consumed once and profile renders keep the current game position', async () => {
  const source = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
  // Run the actual router with only its DOM and deck-loading boundaries stubbed.
  const render = source.slice(source.indexOf('async function render('), source.indexOf("window.addEventListener('hashchange'"));
  let saved;
  const location = { hash: '#/deck/a?card=01&other=keep' };
  const context = {
    URL, location, renderId: 0, game: null, wakeLock: null,
    app: { setAttribute() {}, contains: () => false, focus() {} }, document: {},
    window: { scrollY: 0, scrollTo() {}, history: { state: { marker: true }, replaceState(state, title, hash) { location.hash = hash; } } },
    registry: [{ id: 'a' }], updateCounts() {}, loadDeck: async () => ({}), cardsFor: () => cards,
    startGame(id, values, target) {
      context.game = createGame(values, saved || { mix: false });
      if (target) context.game.open(`${id}/${target}`);
      saved = context.game.state;
    }
  };
  vm.createContext(context);
  await vm.runInContext(`${render}; render();`, context);
  assert.equal(context.game.current().key, 'a/01');
  assert.equal(location.hash, '#/deck/a?other=keep');
  context.game.next();
  const current = context.game.current().key;
  assert.notEqual(current, 'a/01');
  await context.render(true);
  assert.equal(context.game.current().key, current);
  location.hash = '#/deck/a?card=03';
  await context.render();
  assert.equal(context.game.current().key, 'a/03');
  assert.equal(location.hash, '#/deck/a');
});
