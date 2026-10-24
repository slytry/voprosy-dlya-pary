import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

export async function sourceDeck(id) {
  const html = await readFile(new URL(`../private/sources/${id}.html`, import.meta.url), 'utf8');
  const start = html.indexOf('const THEMES =');
  const end = html.indexOf('const suit =', start);
  const data = vm.runInNewContext(`${html.slice(start, end)}; JSON.stringify({THEMES,TASKS,SUITS})`);
  return { ...JSON.parse(data), colors: Object.fromEntries([...html.matchAll(/--t-([\w-]+):\s*(#[\da-f]+);/gi)].map(m => [m[1], m[2]])) };
}

export async function printedCards() {
  const text = await readFile(new URL('../private/sources/rasskazhi-cards.md', import.meta.url), 'utf8');
  const questions = [...text.matchAll(/^\|\s*(\d+)\s*\|([^|]+)\|([^|]+)\|/gm)]
    .flatMap(m => ['a', 'b'].map((letter, i) => ({ id: m[1].padStart(2, '0') + letter, card: m[1].padStart(2, '0'), text: m[i + 2].trim() })));
  const rules = text.split('## Правила с карточек\n')[1].split('## Вопросы')[0].trim();
  const tagline = [...rules.matchAll(/^> (.+)$/gm)].at(-1)[1];
  return { questions, rules, tagline };
}
