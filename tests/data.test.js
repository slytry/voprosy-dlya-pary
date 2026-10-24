import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { decryptJSON } from '../js/crypto.js';
import { sourceDeck, printedCards } from './source.js';

const root = new URL('../', import.meta.url);
const readJSON = async name => JSON.parse(await readFile(new URL(name, root), 'utf8'));
const registry = await readJSON('decks/index.json');
let privateAvailable = true, password;
try { password = process.env.DECK_PASSWORD || (await readFile(new URL('private/password.txt', root), 'utf8')).trim(); }
catch { privateAvailable = false; }

function validate(deck) {
  const ids = [...deck.questions, ...deck.tasks.items].map(q => q.id);
  assert.equal(ids.length, new Set(ids).size);
  assert.ok(ids.every(id => /^[a-z0-9-]+$/.test(id)));
  assert.ok(deck.questions.every(q => q.text && deck.themes.some(t => t.id === q.theme)));
  assert.ok(deck.themes.every(t => /^#[\da-f]{6}$/i.test(t.color) && t.suit && t.name));
  assert.equal(deck.tasks.source, 'agent');
  assert.equal(deck.tasks.items.length, 20);
  assert.deepEqual(deck.tasks.items.map(q => q.id), Array.from({ length: 20 }, (_, i) => `task-${String(i + 1).padStart(2, '0')}`));
  assert.equal(registry.find(meta => meta.id === deck.id).questionCount, deck.questions.length);
}

test('registry and generated deck: stable IDs, 72 questions, 7 themes, 20 tasks', async () => {
  assert.equal(new Set(registry.map(m => m.id)).size, registry.length);
  for (const meta of registry) {
    assert.ok(['purchased', 'generated'].includes(meta.source.kind));
    assert.equal(meta.encrypted, meta.source.kind === 'purchased');
    assert.match(meta.file, /^[a-z0-9.-]+\.json$/);
  }
  const deck = await readJSON('decks/razgovory-vdvoyom.json');
  validate(deck);
  assert.equal(deck.questions.length, 72); assert.equal(deck.themes.length, 7);
  for (const theme of deck.themes) {
    const questions = deck.questions.filter(q => q.theme === theme.id);
    assert.deepEqual(questions.map(q => q.id), questions.map((_, i) => `${theme.id}-${String(i + 1).padStart(2, '0')}`));
  }
});

test('encrypted deck has only a WebCrypto envelope', async () => {
  const encrypted = await readJSON('decks/rasskazhi.enc.json');
  assert.deepEqual(Object.keys(encrypted).sort(), ['data', 'iter', 'iv', 'kdf', 'salt', 'v']);
  assert.equal(encrypted.iter, 310000);
});

test('generated deck matches the original HTML verbatim', { skip: !privateAvailable && 'private/ sources are not present' }, async () => {
  const deck = await readJSON('decks/razgovory-vdvoyom.json');
  const source = await sourceDeck(deck.id);
  assert.deepEqual(deck.questions.map(q => q.text), source.THEMES.flatMap(t => t.qs));
  assert.deepEqual(deck.tasks.items.map(q => q.text), source.TASKS.qs);
  assert.deepEqual(deck.themes.map(t => [t.id, t.name, t.color]), source.THEMES.map(t => [t.id, t.name, source.colors[t.id]]));
});

test('decrypt purchased deck: exactly 100 printed questions plus 3 agent questions and original rules', { skip: !privateAvailable && 'private/ password and sources are not present' }, async () => {
  const deck = await decryptJSON(await readJSON('decks/rasskazhi.enc.json'), password);
  validate(deck);
  const original = await readJSON('private/decks/rasskazhi.json');
  assert.deepEqual(deck, original);
  const printed = await printedCards();
  const source = await sourceDeck('rasskazhi');
  assert.equal(deck.questions.length, 103); assert.equal(deck.themes.length, 9);
  const purchased = deck.questions.filter(q => q.card);
  assert.equal(purchased.length, 100);
  assert.deepEqual(purchased.map(({ id, card, text }) => ({ id, card, text })).sort((a, b) => a.id.localeCompare(b.id)), printed.questions);
  assert.deepEqual(deck.questions.filter(q => !q.card).map(q => [q.id, q.source]), [['x1', 'agent'], ['x2', 'agent'], ['x3', 'agent']]);
  assert.equal(deck.rules, printed.rules); assert.equal(deck.tagline, printed.tagline);
  assert.deepEqual(deck.themes.map(t => [t.id, t.name, t.color]), source.THEMES.map(t => [t.id, t.name, source.colors[t.id]]));
  for (const theme of source.THEMES) {
    assert.deepEqual(deck.questions.filter(q => q.theme === theme.id).map(q => q.text), theme.qs.map(q => q[1]));
  }
  assert.deepEqual(deck.tasks.items.map(q => q.text), source.TASKS.qs);
});

test('purchased question text and password do not occur in public project files', { skip: !privateAvailable && 'private/ sources are not present' }, async () => {
  const { questions } = await printedCards();
  const needles = questions.filter(q => q.text.length > 90).slice(0, 8).map(q => q.text);
  const publicFiles = [];
  async function walk(dir) {
    for (const entry of await readdir(new URL(dir, root), { withFileTypes: true })) {
      if (['private', '.git', 'node_modules'].includes(entry.name)) continue;
      const path = `${dir}${entry.name}`;
      if (entry.isDirectory()) await walk(`${path}/`);
      else publicFiles.push(path);
    }
  }
  await walk('');
  for (const file of publicFiles) {
    const text = await readFile(new URL(file, root), 'utf8');
    assert.ok(!needles.some(q => text.includes(q)), `Purchased question found in ${file}`);
    if (password.length >= 8) assert.ok(!text.includes(password), `Password found in ${file}`);
  }
});
