import test from 'node:test';
import assert from 'node:assert/strict';
import { createSync } from '../js/sync.js';
import { emptyState, mergeStates } from '../js/merge.js';
import { encryptJSON, decryptJSON } from '../js/crypto.js';

const at = '2026-10-25T00:00:00.000Z';
function harness(fetcher, initial = {}) {
  let state = mergeStates(emptyState(), initial);
  let config = { sync: true, password: 'test-password', token: 'test-token' };
  const statuses = [];
  const sync = createSync({ getConfig: () => config, saveConfig: patch => { config = { ...config, ...patch }; },
    getState: () => state, merge: remote => { state = mergeStates(state, remote); }, status: value => statuses.push(value), fetcher });
  return { sync, get state() { return state; }, get config() { return config; }, statuses, disable: () => { config.sync = false; } };
}
const response = (value, status = 200) => new Response(JSON.stringify(value), { status });

test('find secret Gist, decrypt pull, merge tombstones and push only encrypted state', async t => {
  const remote = { ...emptyState(), favorites: { 'a/01': { removed: true, at } }, hidden: { 'b/02': { at } } };
  const encrypted = await encryptJSON(remote, 'test-password');
  const requests = [];
  let uploaded;
  const h = harness(async (url, options) => {
    requests.push(url);
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    if (url.includes('?')) return response([{ id: 'secret', public: false, description: 'voprosy-dlya-pary state', files: { 'state.json': {} } }]);
    if (!options.method) return response({ public: false, files: { 'state.json': { content: uploaded?.files['state.json'].content || JSON.stringify(encrypted) } } });
    assert.equal(options.method, 'PATCH');
    uploaded = JSON.parse(options.body);
    assert.equal(options.body.includes('test-token'), false);
    assert.equal(options.body.includes('Test answer text'), false);
    return response({ id: 'secret' });
  }, { favorites: { 'a/01': { at: '2026-10-24T00:00:00.000Z' } }, answers: { 'a/01': { q: 'Test question', me: 'Test answer text', at } } });
  t.after(() => h.sync.stop());
  await h.sync.run();
  assert.equal(requests.length, 4);
  assert.equal(h.config.gistId, 'secret');
  const payload = await decryptJSON(JSON.parse(uploaded.files['state.json'].content), 'test-password');
  assert.deepEqual(payload, h.state);
  assert.equal(payload.favorites['a/01'].removed, true);
  assert.ok(payload.hidden['b/02']);
  assert.match(h.statuses.at(-1), /Синхронизировано/);
});

test('missing Gist is created secret with encrypted state.json and a separate salt', async t => {
  let body;
  const h = harness(async (url, options) => {
    if (url.includes('?')) return response([]);
    if (!options.method) return response({ public: false, files: body.files });
    assert.equal(options.method, 'POST');
    body = JSON.parse(options.body);
    return response({ id: 'new-gist' });
  });
  t.after(() => h.sync.stop());
  await h.sync.run();
  assert.equal(body.public, false);
  assert.equal(body.description, 'voprosy-dlya-pary state');
  assert.equal(h.config.gistId, 'new-gist');
  assert.deepEqual(await decryptJSON(JSON.parse(body.files['state.json'].content), 'test-password'), emptyState());
});

test('wrong remote password never overwrites the Gist; retries can recover', async t => {
  const wrong = await encryptJSON(emptyState(), 'different-password');
  let patchCount = 0, fail = true, uploaded;
  const h = harness(async (url, options) => {
    if (url.includes('?')) return response([{ id: 'one', public: false, description: 'voprosy-dlya-pary state', files: { 'state.json': {} } }]);
    if (options.method) { patchCount++; uploaded = JSON.parse(options.body).files['state.json'].content; return response({ id: 'one' }); }
    return response({ public: false, files: { 'state.json': { content: fail ? JSON.stringify(wrong) : uploaded || JSON.stringify(await encryptJSON(emptyState(), 'test-password')) } } });
  });
  t.after(() => h.sync.stop());
  await h.sync.run();
  assert.equal(patchCount, 0); assert.match(h.statuses.at(-1), /Проверьте пароль/);
  fail = false;
  await h.sync.run(); assert.equal(patchCount, 1);
});

test('disabled sync performs no request and reports denied tokens clearly', async t => {
  let calls = 0;
  const h = harness(async () => { calls++; return response({}, 401); });
  t.after(() => h.sync.stop());
  await h.sync.run(); assert.match(h.statuses.at(-1), /не принял токен/);
  h.disable(); h.sync.stop(); await h.sync.run();
  assert.equal(calls, 1);
});

test('truncated Gist is read in full without exposing the token to the raw host', async t => {
  const encrypted = await encryptJSON({ ...emptyState(), favorites: { 'a/01': { at } } }, 'test-password');
  let rawRead = false, uploaded;
  const h = harness(async (url, options) => {
    if (url.includes('?')) return response([{ id: 'one', public: false, description: 'voprosy-dlya-pary state', files: { 'state.json': {} } }]);
    if (url.startsWith('https://gist.githubusercontent.com/')) {
      rawRead = true; assert.equal(options.headers, undefined);
      return response(uploaded || encrypted);
    }
    if (options.method) { uploaded = JSON.parse(JSON.parse(options.body).files['state.json'].content); return response({ id: 'one' }); }
    return response({ public: false, files: { 'state.json': { truncated: true, content: 'truncated', raw_url: 'https://gist.githubusercontent.com/test/raw/state.json' } } });
  });
  t.after(() => h.sync.stop());
  await h.sync.run();
  assert.equal(rawRead, true); assert.ok(h.state.favorites['a/01']);
});

test('a local edit made during push is retained and sent on the next debounced push', { timeout: 5000 }, async t => {
  let pushed, uploaded, count = 0, done;
  const secondPush = new Promise(resolve => { done = resolve; });
  const h = harness(async (url, options) => {
    if (url.includes('?')) return response([]);
    if (!options.method) return response({ public: false, files: { 'state.json': { content: JSON.stringify(uploaded) } } });
    pushed = JSON.parse(options.body);
    uploaded = JSON.parse(pushed.files['state.json'].content);
    if (++count === 1) h.state.favorites['a/01'] = { at };
    else done();
    return response({ id: 'new' });
  });
  t.after(() => h.sync.stop());
  await h.sync.run();
  assert.ok(h.state.favorites['a/01']);
  const snapshot = await decryptJSON(JSON.parse(pushed.files['state.json'].content), 'test-password');
  assert.equal(snapshot.favorites['a/01'], undefined);
  await secondPush;
  const next = await decryptJSON(uploaded, 'test-password');
  assert.ok(next.favorites['a/01']);
  assert.match(h.statuses.at(-1), /Синхронизировано/);
});

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('two concurrent devices confirm and retry until the Gist contains both edits and tombstones', { timeout: 5000 }, async t => {
  let content = JSON.stringify(await encryptJSON({ ...emptyState(), favorites: { 'shared/01': { at: '2026-10-24T00:00:00.000Z' } } }, 'test-password'));
  const pulls = new Set(), bothPulled = deferred(), bothWritten = deferred();
  let writes = 0;
  const fetcher = async (url, options) => {
    if (url.includes('?')) return response([{ id: 'shared', public: false, description: 'voprosy-dlya-pary state', files: { 'state.json': {} } }]);
    if (!options.method) {
      const snapshot = content;
      const token = options.headers.Authorization;
      if (!pulls.has(token)) {
        pulls.add(token);
        if (pulls.size === 2) bothPulled.resolve();
        await bothPulled.promise;
      }
      return response({ public: false, files: { 'state.json': { content: snapshot } } });
    }
    assert.equal(options.method, 'PATCH');
    content = JSON.parse(options.body).files['state.json'].content;
    if (++writes <= 2) {
      if (writes === 2) bothWritten.resolve();
      await bothWritten.promise;
    }
    return response({ id: 'shared' });
  };
  const a = harness(fetcher, { favorites: { 'a/01': { at }, 'shared/01': { removed: true, at } } });
  const b = harness(fetcher, { hidden: { 'b/02': { at } } });
  a.config.token = 'device-a'; b.config.token = 'device-b';
  t.after(() => { a.sync.stop(); b.sync.stop(); });
  await Promise.all([a.sync.run(), b.sync.run()]);
  const result = await decryptJSON(JSON.parse(content), 'test-password');
  assert.ok(result.favorites['a/01']); assert.ok(result.hidden['b/02']);
  assert.equal(result.favorites['shared/01'].removed, true);
  assert.equal(writes, 3);
  for (const device of [a, b]) assert.match(device.statuses.at(-1), /Синхронизировано/);
});

test('three unconfirmed writes report a conflict and a later retry can recover', async t => {
  const remote = JSON.stringify(await encryptJSON({ ...emptyState(), hidden: { 'b/02': { at } } }, 'test-password'));
  let writes = 0, conflict = true, uploaded;
  const h = harness(async (url, options) => {
    if (url.includes('?')) return response([{ id: 'one', public: false, description: 'voprosy-dlya-pary state', files: { 'state.json': {} } }]);
    if (!options.method) return response({ public: false, files: { 'state.json': { content: conflict ? remote : uploaded } } });
    writes++; uploaded = JSON.parse(options.body).files['state.json'].content;
    return response({ id: 'one' });
  }, { favorites: { 'a/01': { at } } });
  t.after(() => h.sync.stop());
  await h.sync.run();
  assert.equal(writes, 3);
  assert.equal(h.statuses.some(value => value.startsWith('Синхронизировано')), false);
  assert.match(h.statuses.at(-1), /3 попытки/);
  assert.ok(h.state.favorites['a/01']); assert.ok(h.state.hidden['b/02']);
  conflict = false;
  await h.sync.run();
  assert.equal(writes, 4);
  assert.match(h.statuses.at(-1), /Синхронизировано/);
});

test('a late Gist search from an old generation cannot replace the new token gistId', async t => {
  const started = deferred(), result = deferred();
  let requests = 0;
  const h = harness(async () => { requests++; started.resolve(); return result.promise; });
  t.after(() => h.sync.stop());
  const previousRun = h.sync.run();
  await started.promise;
  h.sync.stop();
  h.config.token = 'new-token'; h.config.gistId = 'new-gist';
  result.resolve(response([{ id: 'old-gist', public: false, description: 'voprosy-dlya-pary state', files: { 'state.json': {} } }]));
  await previousRun;
  assert.equal(h.config.gistId, 'new-gist');
  assert.equal(h.config.token, 'new-token');
  assert.equal(requests, 1);
});
