import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('service worker caches the complete portal under a subpath and serves it offline', async () => {
  const base = 'https://example.test/voprosy-dlya-pary/';
  const events = new Map(), files = new Map(), deleted = [];
  let offline = false, claimed = false;
  const href = value => new URL(typeof value === 'string' ? value : value.url, base).href;
  const fetcher = async value => {
    if (offline) throw new TypeError('offline');
    const path = new URL(href(value)).pathname.replace('/voprosy-dlya-pary/', '') || 'index.html';
    return new Response(await readFile(new URL(`../${path}`, import.meta.url)));
  };
  const cache = {
    async addAll(values) { for (const value of values) files.set(href(value), await fetcher(value)); },
    async match(value) { return files.get(href(value))?.clone(); },
    async put(value, response) { files.set(href(value), response); }
  };
  const context = {
    self: {
      location: { href: `${base}sw.js` },
      addEventListener: (name, callback) => events.set(name, callback),
      skipWaiting: async () => {}, clients: { claim: async () => { claimed = true; } }
    },
    caches: { open: async () => cache, keys: async () => ['vdp-static-v0', 'vdp-static-v1', 'other-app'], delete: async key => deleted.push(key) },
    fetch: fetcher, URL, Response
  };
  vm.runInNewContext(await readFile(new URL('../sw.js', import.meta.url), 'utf8'), context);
  let work;
  events.get('install')({ waitUntil: promise => { work = promise; } });
  await work;
  for (const path of ['index.html', 'js/app.js', 'js/sync.js', 'css/app.css', 'decks/index.json', 'decks/razgovory-vdvoyom.json', 'decks/rasskazhi.enc.json']) {
    assert.ok(files.has(`${base}${path}`), `Not cached: ${path}`);
  }
  events.get('activate')({ waitUntil: promise => { work = promise; } });
  await work;
  assert.equal(claimed, true);
  assert.deepEqual(deleted, ['vdp-static-v0']);
  offline = true;
  for (const path of ['', 'css/app.css', 'js/app.js', 'decks/index.json', 'decks/rasskazhi.enc.json']) {
    let response;
    events.get('fetch')({ request: new Request(`${base}${path}`), respondWith: promise => { response = promise; } });
    assert.ok((await response).ok, `Offline response failed: ${path}`);
  }
  for (const url of [`${base}private/password.txt`, 'https://api.github.com/gists', 'https://example.test/another-app/js/app.js']) {
    let intercepted = false;
    events.get('fetch')({ request: new Request(url), respondWith: () => { intercepted = true; } });
    assert.equal(intercepted, false);
  }
});
