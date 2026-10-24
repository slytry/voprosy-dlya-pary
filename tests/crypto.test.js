import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecipheriv, pbkdf2Sync } from 'node:crypto';
import { encryptJSON, decryptJSON, createKeyCache, ITERATIONS } from '../js/crypto.js';

test('AES-256-GCM roundtrip, Unicode and the Node crypto wire format', async () => {
  const value = { question: 'Тестовый вопрос?', answers: ['Мы', 'Вдвоём ♡'], favorites: { 'test/01a': { at: '2026-10-25T00:00:00Z' } } };
  const password = 'test-only пароль';
  const envelope = await encryptJSON(value, password);
  assert.equal(envelope.v, 1);
  assert.equal(envelope.kdf, 'PBKDF2-SHA256');
  assert.equal(envelope.iter, ITERATIONS);
  assert.equal(Buffer.from(envelope.salt, 'base64').length, 16);
  assert.equal(Buffer.from(envelope.iv, 'base64').length, 12);
  assert.deepEqual(await decryptJSON(envelope, password), value);
  const data = Buffer.from(envelope.data, 'base64');
  const key = pbkdf2Sync(password, Buffer.from(envelope.salt, 'base64'), ITERATIONS, 32, 'sha256');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(data.subarray(-16));
  const clear = Buffer.concat([decipher.update(data.subarray(0, -16)), decipher.final()]);
  assert.deepEqual(JSON.parse(clear), value);
});

test('wrong password, altered ciphertext and unknown format fail clearly', async () => {
  const encrypted = await encryptJSON({ secret: 'test' }, 'correct');
  await assert.rejects(decryptJSON(encrypted, 'wrong'), /Проверьте пароль/);
  const data = Buffer.from(encrypted.data, 'base64'); data[0] ^= 1;
  await assert.rejects(decryptJSON({ ...encrypted, data: data.toString('base64') }, 'correct'), /расшифровать/);
  await assert.rejects(decryptJSON({ ...encrypted, iter: 1 }, 'correct'), /формат/);
  await assert.rejects(encryptJSON({}, ''), /пароль/);
});

test('fresh salts and IVs; session cache reuses a key without reusing the IV', async () => {
  const cache = createKeyCache();
  const a = await encryptJSON({}, 'same', cache);
  const b = await encryptJSON({}, 'same', cache);
  const c = await encryptJSON({}, 'same', cache, a.salt);
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.iv, c.iv);
  assert.notEqual(a.data, c.data);
  assert.equal(cache.get('same', a.salt, a.iter), cache.get('same', a.salt, a.iter));
  assert.deepEqual(await decryptJSON(c, 'same', cache), {});
  cache.clear();
});
