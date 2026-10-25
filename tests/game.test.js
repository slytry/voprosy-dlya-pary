import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createGame, groupQuestions } from '../js/game.js';

test('numbered questions group by numeric card order with a data-derived range and agent additions last', () => {
  const questions = [
    { id: '14b', card: '14', theme: 'two' }, { id: '02b', card: '02', theme: 'one' },
    { id: 'x1', source: 'agent', theme: 'two' }, { id: '14a', card: '14', theme: 'one' },
    { id: '02a', card: '02', theme: 'two' }
  ];
  const before = structuredClone(questions);
  const result = groupQuestions(questions, [{ id: 'one' }, { id: 'two' }]);
  assert.deepEqual(result.range, { min: 2, max: 14 });
  assert.deepEqual(result.groups.map(group => [group.number, group.questions.map(q => q.id)]), [
    [2, ['02a', '02b']], [14, ['14a', '14b']]
  ]);
  assert.deepEqual(result.added.map(q => q.id), ['x1']);
  assert.deepEqual(questions, before);
});

test('unnumbered questions group in theme data order and preserve question order within each theme', () => {
  const questions = [{ id: 'b1', theme: 'two' }, { id: 'a1', theme: 'one' }, { id: 'b2', theme: 'two' }];
  const themes = [{ id: 'one' }, { id: 'empty' }, { id: 'two' }];
  const result = groupQuestions(questions, themes);
  assert.equal(result.range, null);
  assert.deepEqual(result.groups.map(group => [group.theme.id, group.questions.map(q => q.id)]), [
    ['one', ['a1']], ['two', ['b1', 'b2']]
  ]);
  assert.deepEqual(result.added, []);
  assert.deepEqual(groupQuestions([], themes), { groups: [], added: [], range: null });
});

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

test('encrypted list route opens through the existing password form and jumps only after the initial render', async () => {
  const source = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
  const unlock = source.slice(source.indexOf('function unlock('), source.indexOf('function persistPosition('));
  const render = source.slice(source.indexOf('async function render('), source.indexOf("window.addEventListener('hashchange'"));
  const elements = new Map(['unlock-form', 'deck-password', 'unlock-error'].map(id => [id, {}]));
  const calls = [];
  const context = {
    URL, location: { hash: '#/deck/a/list?n=07' }, renderId: 0, game: null, wakeLock: null,
    config: {}, registry: [{ id: 'a', title: 'Тестовая колода', encrypted: true, source: { kind: 'purchased' } }],
    app: { innerHTML: '', setAttribute() {}, contains: () => false, focus() {} },
    document: { getElementById: id => elements.get(id) },
    window: { scrollY: 100, scrollTo: (x, y) => calls.push(['scroll', y]) },
    updateCounts() {}, escape: String, pageTop: () => '', keyCache: { clear() {} }, sync: { stop() {} },
    saveConfig: patch => { context.config = { ...context.config, ...patch }; },
    loadDeck: async (meta, password = context.config.password) => password === 'test-only' ? { id: meta.id } : null,
    startGame: () => assert.fail('List must not start a game'),
    deckList: (deck, preserve) => { calls.push(['list', preserve]); return number => calls.push(['jump', number]); }
  };
  vm.createContext(context);
  vm.runInContext(unlock + render, context);
  await context.render();
  assert.match(context.app.innerHTML, /id="unlock-form"/);
  assert.equal(calls.some(([action]) => action === 'list'), false);
  elements.get('deck-password').value = 'test-only';
  await elements.get('unlock-form').onsubmit({ preventDefault() {}, target: { querySelector: () => ({}) } });
  assert.deepEqual(calls.slice(-3), [['list', false], ['scroll', 0], ['jump', '07']]);
  assert.equal(context.location.hash, '#/deck/a/list?n=07');
  await context.render(true);
  assert.deepEqual(calls.slice(-2), [['list', true], ['scroll', 100]]);
  assert.equal(calls.filter(([action]) => action === 'jump').length, 1);
});

test('deck list keeps hidden questions, shares card actions, validates jumps and preserves open tasks', async () => {
  const source = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
  const helpers = source.slice(source.indexOf('const deckLink ='), source.indexOf('const date ='));
  const cards = source.slice(source.indexOf('function cardsFor('), source.indexOf('function home('));
  const list = source.slice(source.indexOf('function listItem('), source.indexOf('function collection('));
  const elements = new Map(), scrolled = [], timers = [];
  let markup = '';
  const app = {
    get innerHTML() { return markup; },
    set innerHTML(value) { markup = value; elements.clear(); }
  };
  const document = { getElementById(id) {
    if (!markup.includes('id="' + id + '"')) return null;
    if (!elements.has(id)) {
      const classes = new Set();
      elements.set(id, {
        value: '', open: false, attrs: {}, textContent: '',
        classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name),
          toggle: (name, active) => active ? classes.add(name) : classes.delete(name) },
        setAttribute(name, value) { this.attrs[name] = value; },
        scrollIntoView: () => scrolled.push(id)
      });
    }
    return elements.get(id);
  } };
  const hidden = new Set(['a/02a']), favorites = new Set();
  const context = {
    app, document, groupQuestions, escape: value => String(value ?? ''),
    registry: [{ id: 'a', source: { kind: 'purchased' } }], profile: { state: { answers: {} } },
    isHidden: key => hidden.has(key), isFavorite: key => favorites.has(key),
    suit: name => '<svg data-suit="' + name + '"></svg>',
    clearTimeout() {}, setTimeout: callback => { timers.push(callback); return timers.length; }
  };
  vm.createContext(context);
  vm.runInContext(helpers + cards + list, context);
  const deck = {
    id: 'a', title: 'Тестовая колода',
    themes: [{ id: 'one', name: 'Первая', color: '#123456', suit: 'circle' }, { id: 'two', name: 'Вторая', color: '#654321', suit: 'heart' }],
    questions: [
      { id: '14b', card: '14', theme: 'two', text: 'Четырнадцать b' },
      { id: '02b', card: '02', theme: 'one', text: 'Два b' },
      { id: 'x1', source: 'agent', theme: 'two', text: 'Добавленный вопрос' },
      { id: '14a', card: '14', theme: 'one', text: 'Четырнадцать a' },
      { id: '02a', card: '02', theme: 'two', text: 'Два a' }
    ],
    tasks: { name: 'Передышка', items: [{ id: 'task-01', text: 'Тестовое задание' }] }
  };
  const jump = context.deckList(deck, false);
  assert(markup.indexOf('Карточка 02') < markup.indexOf('Карточка 14'));
  assert(markup.indexOf('Два a') < markup.indexOf('Два b'));
  assert.equal((markup.match(/class="list-item/g) || []).length, 6);
  assert.match(markup, /class="list-item is-hidden"/);
  assert.match(markup, /скрыто/);
  assert.match(markup, /data-action="restore" data-key="a\/02a"/);
  assert.match(markup, /href="#\/deck\/a\?card=02b"/);
  assert.equal((markup.match(/data-action="favorite"/g) || []).length, 6);
  assert.match(markup, /Добавлено агентом/);
  assert.match(markup, /задание сгенерировано агентом/);
  assert.match(markup, /<details[^>]+id="deck-tasks"\s*>/);
  jump('02');
  assert.deepEqual(scrolled, ['card-2']);
  assert(document.getElementById('card-2').classList.contains('jump-highlight'));
  timers[0]();
  assert.equal(document.getElementById('card-2').classList.contains('jump-highlight'), false);
  jump('7');
  assert.equal(document.getElementById('card-number').attrs['aria-invalid'], 'true');
  assert.match(document.getElementById('jump-status').textContent, /Карточки 2–14/);
  assert.deepEqual(scrolled, ['card-2']);
  document.getElementById('card-number').value = '14';
  document.getElementById('card-jump').onsubmit({ preventDefault() {} });
  assert.equal(scrolled.at(-1), 'card-14');
  document.getElementById('deck-tasks').open = true;
  context.deckList(deck, true);
  assert.match(markup, /id="deck-tasks" open/);
  assert.match(markup, /value="14"/);
  context.registry[0].source.kind = 'generated';
  context.deckList({ ...deck, questions: deck.questions.map(({ card, ...q }) => q) }, false);
  assert.doesNotMatch(markup, /id="card-jump"/);
  assert(markup.indexOf('id="theme-one"') < markup.indexOf('id="theme-two"'));
  assert.match(markup, /сгенерировано агентом/);
});
