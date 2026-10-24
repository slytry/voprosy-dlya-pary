import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, mergeStates, active, nextTimestamp } from '../js/merge.js';

const early = '2026-10-24T10:00:00.000Z', late = '2026-10-25T10:00:00.000Z';
test('later additions, removals, answers and names win; no resurrection after pull', () => {
  const a = { ...emptyState(), favorites: { 'a/01': { at: early } }, hidden: { 'b/02': { removed: true, at: early } }, answers: { 'a/01': { q: 'Test', me: 'Old', at: early } } };
  const b = { ...emptyState(), favorites: { 'a/01': { removed: true, at: late } }, hidden: { 'b/02': { at: late } }, answers: { 'a/01': { removed: true, at: late } }, names: { me: 'New', partner: 'Name', at: late } };
  const merged = mergeStates(a, b);
  assert.equal(active(merged.favorites['a/01']), false);
  assert.equal(active(merged.hidden['b/02']), true);
  assert.deepEqual(merged.answers['a/01'], { removed: true, at: late });
  assert.equal(merged.names.me, 'New');
  assert.deepEqual(mergeStates(merged, a), merged);
  assert.deepEqual(mergeStates(a, b), mergeStates(b, a));
});

test('merge is deterministic, associative and idempotent, including timestamp ties', () => {
  const a = { favorites: { 'a/01': { at: early } }, answers: { 'a/01': { q: 'q', me: 'One', at: early } } };
  const b = { favorites: { 'a/01': { removed: true, at: early } }, answers: { 'a/01': { q: 'q', me: 'Two', at: early } } };
  const c = { hidden: { 'c/task-01': { at: late } }, favorites: { 'b/02': { at: late } } };
  const merged = mergeStates(a, b);
  assert.equal(merged.favorites['a/01'].removed, true);
  assert.deepEqual(merged, mergeStates(b, a));
  assert.deepEqual(mergeStates(merged, c), mergeStates(a, mergeStates(b, c)));
  assert.deepEqual(mergeStates(merged, merged), merged);
});

test('malformed records and credentials are excluded from synchronized state', () => {
  const merged = mergeStates(null, { token: 'private', password: 'private', positions: {}, favorites: { '__proto__': {}, invalid: { at: early }, 'a/01': { at: 'bad' }, 'b/02': { at: early, token: 'private' } } });
  assert.deepEqual(Object.keys(merged).sort(), ['answers', 'favorites', 'hidden', 'names', 'v']);
  assert.deepEqual(Object.keys(merged.favorites), ['b/02']);
  assert.equal(JSON.stringify(merged).includes('private'), false);
});

test('new local edit gets a timestamp newer than a future device clock', () => {
  const state = emptyState(); state.favorites['a/01'] = { at: late };
  assert.ok(nextTimestamp(state, 1) > late);
});
