import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { encryptJSON } from '../js/crypto.js';

const root = new URL('../', import.meta.url);
const id = process.argv[2];
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id || '')) {
  console.error('Использование: node scripts/encrypt-deck.mjs <id>');
  process.exitCode = 1;
} else {
  try {
    const deck = JSON.parse(await readFile(new URL(`private/decks/${id}.json`, root), 'utf8'));
    if (deck.id !== id) throw new Error('ID колоды не совпадает с именем файла.');
    const password = process.env.DECK_PASSWORD || (await readFile(new URL('private/password.txt', root), 'utf8')).trim();
    const encrypted = await encryptJSON(deck, password);
    const target = new URL(`decks/${id}.enc.json`, root);
    await writeFile(target, JSON.stringify(encrypted, null, 2) + '\n');
    console.log(`Зашифровано: ${fileURLToPath(target)}`);
  } catch (error) {
    console.error(`Не удалось зашифровать колоду: ${error.message}`);
    process.exitCode = 1;
  }
}
