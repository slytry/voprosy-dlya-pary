// The same WebCrypto envelope is used by Node, browsers, decks and Gist.
export const ITERATIONS = 310000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function bytes(value) {
  return Uint8Array.from(atob(value), c => c.charCodeAt(0));
}

export function createKeyCache() {
  const keys = new Map();
  return {
    get(password, salt, iter) {
      const id = JSON.stringify([password, salt, iter]);
      if (!keys.has(id)) {
        const key = crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey'])
          .then(material => crypto.subtle.deriveKey(
            { name: 'PBKDF2', hash: 'SHA-256', salt: bytes(salt), iterations: iter },
            material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']));
        keys.set(id, key);
        key.catch(() => keys.delete(id));
      }
      return keys.get(id);
    },
    clear() { keys.clear(); }
  };
}

export async function encryptJSON(value, password, cache = createKeyCache(), salt) {
  if (!password) throw new Error('Введите пароль для шифрования.');
  const envelope = {
    v: 1, kdf: 'PBKDF2-SHA256', iter: ITERATIONS,
    salt: salt || base64(crypto.getRandomValues(new Uint8Array(16))),
    iv: base64(crypto.getRandomValues(new Uint8Array(12)))
  };
  const key = await cache.get(password, envelope.salt, envelope.iter);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: bytes(envelope.iv) }, key,
    encoder.encode(JSON.stringify(value)));
  return { ...envelope, data: base64(new Uint8Array(data)) };
}

export async function decryptJSON(envelope, password, cache = createKeyCache()) {
  if (envelope?.v !== 1 || envelope.kdf !== 'PBKDF2-SHA256' || envelope.iter !== ITERATIONS ||
      !['salt', 'iv', 'data'].every(k => typeof envelope[k] === 'string')) {
    throw new Error('Неизвестный формат зашифрованных данных.');
  }
  try {
    if (bytes(envelope.salt).length !== 16 || bytes(envelope.iv).length !== 12) throw new Error();
    const key = await cache.get(password, envelope.salt, envelope.iter);
    const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(envelope.iv) }, key, bytes(envelope.data));
    return JSON.parse(decoder.decode(data));
  } catch {
    throw new Error('Не удалось расшифровать данные. Проверьте пароль; файл также мог быть повреждён.');
  }
}
