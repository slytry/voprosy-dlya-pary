import { createKeyCache, decryptJSON } from './crypto.js';
import { active, activeKeys } from './merge.js';
import { createProfile, readLocal, writeLocal, SETTINGS_KEY } from './storage.js';
import { createSync } from './sync.js';
import { createGame, groupQuestions } from './game.js';
import { suit } from './suits.js';

const app = document.getElementById('app');
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const decks = new Map();
const keyCache = createKeyCache();
let registry = [], game, gameId, renderId = 0, toastTimer, syncText = 'Синхронизация выключена';
let config = readLocal(SETTINGS_KEY, {});

function toast(message, undo) {
  const box = document.getElementById('toast');
  clearTimeout(toastTimer);
  box.replaceChildren(document.createTextNode(message));
  if (undo) {
    const button = document.createElement('button');
    button.textContent = 'Вернуть';
    button.onclick = () => { undo(); box.hidden = true; };
    box.append(button);
  }
  box.hidden = false;
  toastTimer = setTimeout(() => { box.hidden = true; }, undo ? 6500 : 6000);
}

function saveConfig(patch) {
  config = { ...config, ...patch };
  try { writeLocal(SETTINGS_KEY, config); }
  catch { toast('Не удалось сохранить настройки в браузере. Проверьте свободное место.'); }
}

const profile = createProfile(origin => {
  updateCounts();
  if (origin !== 'remote') sync.schedule();
  if (origin !== 'local') render(true);
}, toast);

const sync = createSync({
  getConfig: () => config, saveConfig, getState: () => profile.state,
  merge: state => profile.merge(state),
  status: text => {
    syncText = text;
    const status = document.getElementById('sync-status');
    if (status) status.textContent = text;
  }
});

const isHidden = key => active(profile.state.hidden[key]);
const isFavorite = key => active(profile.state.favorites[key]);
const nameOf = who => profile.state.names[who]?.trim() || (who === 'me' ? 'Я' : 'Партнёр');
const favoriteKeys = () => activeKeys(profile.state.favorites).filter(key => !isHidden(key));
const positionKey = id => `vdp.position.${id}`;
const deckLink = (id, card) => `#/deck/${encodeURIComponent(id)}${card ? `?card=${encodeURIComponent(card)}` : ''}`;
const deckListLink = id => `${deckLink(id)}/list`;
const sourceLabel = card => card.source === 'agent' ? 'добавлено агентом' : card.generated ? (card.task ? 'задание сгенерировано агентом' : 'сгенерировано агентом') : '';
const date = at => new Date(at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

function updateCounts() {
  document.getElementById('favorite-count').textContent = favoriteKeys().length;
  document.getElementById('hidden-count').textContent = activeKeys(profile.state.hidden).length;
  for (const link of document.querySelectorAll('nav a')) {
    if (location.hash.startsWith(link.getAttribute('href'))) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

async function json(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Не удалось загрузить файл (${response.status}). Проверьте соединение и попробуйте снова.`);
  return response.json();
}

async function loadDeck(meta, password = config.password) {
  if (decks.has(meta.id)) return decks.get(meta.id);
  if (meta.encrypted && !password) return null;
  const payload = await json(new URL(`../decks/${meta.file}`, import.meta.url));
  const deck = meta.encrypted ? await decryptJSON(payload, password, keyCache) : payload;
  if (deck.id !== meta.id || !Array.isArray(deck.questions) || !Array.isArray(deck.themes)) throw new Error('Формат колоды повреждён.');
  decks.set(meta.id, deck);
  return deck;
}

async function loadAvailable() {
  const results = await Promise.allSettled(registry.map(meta => loadDeck(meta)));
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'rejected' && !registry[i].encrypted) throw results[i].reason;
  }
}

function cardsFor(deck) {
  const meta = registry.find(m => m.id === deck.id);
  return [
    ...deck.questions.map((q, i) => {
      const theme = deck.themes.find(t => t.id === q.theme);
      return { ...q, key: `${deck.id}/${q.id}`, deckId: deck.id, deckTitle: deck.title,
        theme, themeKey: `${deck.id}/${theme.id}`, n: q.card || String(i + 1).padStart(2, '0'), generated: meta.source.kind === 'generated' };
    }),
    ...(deck.tasks?.items || []).map((task, i) => ({ ...task, key: `${deck.id}/${task.id}`, deckId: deck.id, deckTitle: deck.title,
      theme: { id: 'task', name: deck.tasks.name, color: deck.tasks.color || '#B24925', suit: deck.tasks.suit || 'spark' },
      themeKey: `${deck.id}/task`, n: String(i + 1).padStart(2, '0'), task: true, generated: true }))
  ];
}
const allCards = () => [...decks.values()].flatMap(cardsFor);
const cardByKey = key => allCards().find(card => card.key === key);

function pageTop(title, subtitle = '', actions = '') {
  return `<div class="page-top"><a class="back" href="#/">← Все колоды</a>${actions}<h1>${escape(title)}</h1>${subtitle ? `<p class="hand">${escape(subtitle)}</p>` : ''}</div>`;
}

function home() {
  document.title = 'Вопросы для пары';
  app.innerHTML = `<div class="intro"><p class="eyebrow">Без спешки · по очереди · вдвоём</p><h1>Давай поговорим<br>о нас</h1><p class="hand">Один вопрос может стать началом большого разговора.</p></div>
    <div class="deck-grid">${registry.map(meta => {
      const visible = meta.questionCount - activeKeys(profile.state.hidden).filter(key => key.startsWith(`${meta.id}/`) && !key.split('/')[1].startsWith('task-')).length;
      return `<article class="deck-tile"><a class="deck-game" href="${deckLink(meta.id)}"><span class="badge">${meta.encrypted ? '<span aria-label="Зашифровано">🔒</span>' : ''}${escape(meta.source.label)}${meta.encrypted ? ' · под паролем' : ''}</span>
        <h2>${escape(meta.title)}</h2><p class="muted">${escape(meta.subtitle)}</p><div class="tile-bottom"><span>${Math.max(0, visible)} вопросов${meta.encrypted ? ' · 100 из игры + 3 от агента' : ''}</span><span class="tile-arrow" aria-hidden="true">↗</span></div></a><a class="deck-list-link" href="${deckListLink(meta.id)}">Все вопросы</a></article>`;
    }).join('')}</div><p class="hint" style="margin-top:24px">Избранное, скрытые карточки и ответы общие для всех колод. Сохраняются в этом браузере.</p>`;
}

function unlock(meta, title = meta.title) {
  document.title = `${title} — Вопросы для пары`;
  app.innerHTML = `${pageTop(title)}<section class="lock-box"><p class="eyebrow">Зашифрованная колода</p><h2>Открыть «${escape(meta.title)}»</h2><p class="muted">Введите пароль от купленных колод. Он сохранится в этом браузере.</p>
    <form id="unlock-form"><label>Пароль<input id="deck-password" name="password" type="password" autocomplete="current-password" required></label><button class="primary" type="submit">Открыть колоду</button><p class="status error" id="unlock-error" role="alert"></p></form></section>`;
  document.getElementById('unlock-form').onsubmit = async event => {
    event.preventDefault();
    const button = event.target.querySelector('button');
    const password = document.getElementById('deck-password').value;
    button.disabled = true;
    const errorBox = document.getElementById('unlock-error');
    errorBox.textContent = 'Открываю…';
    try {
      if (config.password !== password) keyCache.clear();
      await loadDeck(meta, password);
      if (config.password !== password) sync.stop();
      saveConfig({ password });
      if (config.sync) sync.run();
      await render();
    } catch (error) { errorBox.textContent = error.message; button.disabled = false; }
  };
}

function persistPosition() {
  if (!game) return;
  try { writeLocal(positionKey(gameId), game.state); }
  catch { toast('Не удалось сохранить позицию. Ответы и избранное хранятся отдельно.'); }
}

function startGame(id, cards, target) {
  gameId = id;
  game = createGame(cards, readLocal(positionKey(id), null), key => !isHidden(key) && (id !== 'favorites' || isFavorite(key)));
  if (target) {
    const key = `${id}/${target}`;
    if (!game.open(key)) toast('Карточка скрыта или больше не найдена. Проверьте раздел «Скрытые».');
  }
  paintGame();
}

function cardMarkup(card) {
  if (!card) return `<article class="card end" data-ended="true"><div class="card-body"><p class="card-label">Колода закончилась</p><p class="question">Можно вернуться к прошлым карточкам или начать новый круг.</p><button class="primary" data-action="reset">Перемешать заново</button></div></article>`;
  const added = sourceLabel(card);
  return `<article class="card enter" data-key="${escape(card.key)}" style="--c:${escape(card.theme.color)}" aria-label="${card.task ? 'Задание' : 'Вопрос'}">
    <div class="mark">${suit(card.theme.suit)}</div><div class="card-top"><div class="corner"><span>${escape(card.n)}</span>${suit(card.theme.suit)}</div>
    <div class="card-tools"><button data-action="favorite" data-key="${escape(card.key)}" aria-label="${isFavorite(card.key) ? 'Убрать из избранного' : 'В избранное'}" aria-pressed="${isFavorite(card.key)}">${isFavorite(card.key) ? '★' : '☆'}</button><button class="hide-card" data-action="hide" data-key="${escape(card.key)}">Скрыть</button></div></div>
    <div class="card-body"><p class="card-label">${escape(card.theme.name)}</p><p class="question${card.text.length > 170 ? ' long' : ''}">${escape(card.text)}</p>${added ? `<p class="card-source">${escape(added)}</p>` : ''}</div>
    <div class="card-bottom"><span class="card-ref">${card.card ? `карточка ${escape(card.card)}` : escape(card.deckTitle)}</span><div class="corner br"><span>${escape(card.n)}</span>${suit(card.theme.suit)}</div></div></article>`;
}

function paintGame() {
  persistPosition();
  const favoriteGame = gameId === 'favorites';
  const deck = decks.get(gameId);
  const card = game.current();
  const allowedQuestions = game.cards.filter(c => !c.task && game.allowed(c.key));
  const allowed = new Set(allowedQuestions.map(c => c.key));
  const shown = new Set(game.state.history.slice(0, game.state.pos + 1).filter(key => allowed.has(key))).size;
  const shownTasks = game.state.history.slice(0, game.state.pos + 1).filter(key => game.allowed(key) && game.cards.find(c => c.key === key)?.task).length;
  const themes = game.themes.map(id => game.cards.find(c => c.themeKey === id));
  const hasTasks = game.cards.some(c => c.task && !isHidden(c.key) && (!favoriteGame || isFavorite(c.key)));
  const nextKey = game.state.history[game.historyPos(1)] || game.state.deck[0];
  const nextCard = game.cards.find(c => c.key === nextKey);
  const title = favoriteGame ? 'Наше избранное' : deck.title;
  document.title = `${title} — Вопросы для пары`;
  app.innerHTML = `${pageTop(title, deck?.tagline || (favoriteGame ? 'Самые важные вопросы из всех колод' : 'Поговорим о том, что важно'), favoriteGame ? '' : `<a class="back" href="${deckListLink(gameId)}">Все вопросы</a>`)}
    <div class="play-layout"><section class="play" aria-label="Игра">
      <div class="count" aria-live="polite"><span>Вопросы <b>${shown} / ${allowedQuestions.length}</b></span><span>Задания <b>${shownTasks}</b></span></div>
      <div class="table" id="table"><div class="peek"></div><div class="peek next" ${nextCard ? `style="--c:${escape(nextCard.theme.color)}"` : 'hidden'}></div>${cardMarkup(card)}</div>
      <div class="controls"><button class="prev" data-action="prev" aria-label="Предыдущая карточка" ${game.historyPos(-1) < 0 ? 'disabled' : ''}>←</button><button class="primary next" data-action="next" ${game.end() ? 'disabled' : ''}>Следующая →</button><button data-action="task" ${hasTasks ? '' : 'disabled'}>${suit('spark')} Задание</button></div>
      <p class="hint">Смахните влево — следующая, вправо — предыдущая.</p>
      ${card && !card.task ? answerForm(card) : ''}
    </section><aside class="panel">
      <section><h2>Темы</h2><p class="hint">Нажмите на тему, чтобы убрать её из колоды или вернуть. Оставьте хотя бы одну.</p><div class="chips">${themes.map(c => `<button class="chip" data-action="theme" data-theme="${escape(c.themeKey)}" style="--c:${escape(c.theme.color)}" aria-pressed="${!game.state.off.includes(c.themeKey)}">${suit(c.theme.suit)}<span>${favoriteGame ? `${escape(c.deckTitle)} · ` : ''}${escape(c.theme.name)}</span><span class="n">${game.cards.filter(q => !q.task && q.themeKey === c.themeKey && !isHidden(q.key) && (!favoriteGame || isFavorite(q.key))).length}</span></button>`).join('')}</div></section>
      ${hasTasks ? `<section><h2>Задания${deck ? ` «${escape(deck.tasks.name)}»` : ''}</h2><p class="hint">Сгенерированы агентом</p><div class="seg"><button data-action="mix" data-mix="on" aria-pressed="${game.state.mix}">В колоде</button><button data-action="mix" data-mix="off" aria-pressed="${!game.state.mix}">Только по кнопке «Задание»</button></div></section>` : ''}
      <section><h2>Как играть</h2><ul class="rules"><li>Тяните карточки по очереди. Отвечайте сами, задавайте вопрос партнёру или отвечайте оба.</li><li>На любой вопрос можно сказать «пас» без объяснений.</li><li>Слушайте до конца. Не оценивайте и не советуйте, пока не попросят.</li><li>Если стало тяжело, возьмите задание и передохните.</li></ul>${deck?.rules ? `<details><summary>Правила с карточки</summary><div class="deck-rules">${escape(deck.rules.replace(/\*\*/g, '').replace(/^> /gm, ''))}</div></details>` : ''}
      ${!favoriteGame ? `<p class="hint">${escape(registry.find(m => m.id === gameId).source.label)}${registry.find(m => m.id === gameId).source.url ? ` · <a href="${escape(registry.find(m => m.id === gameId).source.url)}" target="_blank" rel="noopener noreferrer">Источник</a>` : ''}</p>` : ''}</section>
      <button class="quiet" data-action="reset">Перемешать заново</button>
    </aside></div>`;
  bindSwipe();
}

function answerForm(card) {
  const answer = active(profile.state.answers[card.key]) ? profile.state.answers[card.key] : {};
  return `<form class="answer-form" id="answer-form" data-key="${escape(card.key)}"><h2 class="eyebrow" style="margin:0">Сохранить этот разговор</h2>${['me', 'partner'].map(who => `<label for="answer-${who}">${escape(nameOf(who))}<textarea id="answer-${who}" name="${who}" rows="2" placeholder="Пара слов о главном">${escape(answer[who] || '')}</textarea></label>`).join('')}<p class="status" id="answer-status" aria-live="polite">Ответы сохраняются сами в этом браузере. Поля можно оставить пустыми.</p></form>`;
}

function bindSwipe() {
  const card = document.querySelector('.card[data-key]');
  if (!card) return;
  let start;
  card.addEventListener('pointerdown', event => {
    if (event.target.closest('button') || (event.pointerType === 'mouse' && event.button !== 0)) return;
    start = { x: event.clientX, y: event.clientY, id: event.pointerId };
    card.setPointerCapture(event.pointerId);
  });
  card.addEventListener('pointerup', event => {
    if (!start || event.pointerId !== start.id) return;
    const dx = event.clientX - start.x, dy = event.clientY - start.y;
    start = null;
    if (Math.abs(dx) > 65 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      if (dx < 0) game.next(); else game.prev();
      paintGame();
    }
  });
  card.addEventListener('pointercancel', () => { start = null; });
}

function lockedGroup(meta, count) {
  return `<div class="list-item"><p class="muted">${count} карточек в зашифрованной колоде. Откройте её с паролем, чтобы увидеть текст.</p><a class="button" href="${deckLink(meta.id)}">Открыть «${escape(meta.title)}»</a></div>`;
}

function listItem(card, mode, number = '') {
  const key = escape(card.key);
  const answer = profile.state.answers[card.key];
  const hidden = isHidden(card.key);
  const added = sourceLabel(card);
  const deckList = mode === 'deck';
  return `<article class="list-item${deckList && hidden ? ' is-hidden' : ''}"><p class="list-question">${number ? `<span class="muted">${escape(number)}.</span> ` : ''}${escape(mode === 'answers' ? answer.q || card.text : card.text)}</p>
    ${mode === 'answers' ? `<dl>${['me', 'partner'].filter(who => answer[who]).map(who => `<dt>${escape(nameOf(who))}</dt><dd>${escape(answer[who])}</dd>`).join('')}</dl>` : ''}
    <div class="item-meta"><span${deckList ? ` class="theme-heading" style="--c:${escape(card.theme.color)}"` : ''}>${deckList ? suit(card.theme.suit) : ''}${escape(card.theme.name)}${card.card ? ` · карточка ${escape(card.card)}` : ''}${added ? ` · ${escape(added)}` : ''}${deckList && hidden ? ' · скрыто' : ''}${mode === 'answers' ? ` · ${date(answer.at)}` : ''}</span><div class="item-actions">
    ${mode === 'hidden' ? `<button data-action="restore" data-key="${key}">Вернуть</button>` : hidden ? `<button data-action="restore-open" data-key="${key}">${deckList ? 'Открыть карточку' : 'Вернуть и открыть'}</button>${deckList ? `<button data-action="restore" data-key="${key}">Вернуть</button>` : ''}` : `<a class="button" href="${deckLink(card.deckId, card.id)}">Открыть карточку</a>`}
    ${mode === 'favorites' || deckList ? `<button data-action="favorite" data-key="${key}" aria-label="${isFavorite(card.key) ? 'Убрать из избранного' : 'В избранное'}" aria-pressed="${isFavorite(card.key)}">${deckList ? (isFavorite(card.key) ? '★' : '☆') : 'Убрать из избранного'}</button>${hidden ? '' : `<button data-action="hide" data-key="${key}">Скрыть</button>`}` : ''}
    ${mode === 'answers' ? `<button data-action="delete-answer" data-key="${key}">Удалить ответ</button>` : ''}</div></div></article>`;
}

function deckList(deck, preserve) {
  const { groups, added, range } = groupQuestions(deck.questions, deck.themes);
  const cards = cardsFor(deck);
  const byId = new Map(cards.map(card => [card.id, card]));
  const tasksOpen = preserve && document.getElementById('deck-tasks')?.open;
  const jumpValue = preserve ? document.getElementById('card-number')?.value || '' : '';
  const questions = (items, numbered = false) => items.map((q, i) => listItem(byId.get(q.id), 'deck', numbered ? q.id.slice(-1) : i + 1)).join('');
  const rangeHint = range ? `Карточки ${range.min}–${range.max}` : '';
  document.title = `Все вопросы · ${deck.title} — Вопросы для пары`;
  app.innerHTML = `${pageTop('Все вопросы', deck.title, `<a class="back" href="${deckLink(deck.id)}">Играть</a>`)}
    ${range ? `<form class="card-jump" id="card-jump" novalidate><label for="card-number">Перейти к карточке №<input id="card-number" type="number" inputmode="numeric" min="${range.min}" max="${range.max}" step="1" value="${escape(jumpValue)}" aria-describedby="jump-status"></label><button type="submit">Перейти</button><p class="status" id="jump-status" role="status">${rangeHint}</p></form>` : ''}
    <div class="collection">${groups.map(group => `<section class="collection-group" id="${range ? `card-${group.number}` : `theme-${escape(group.theme.id)}`}">
      ${range ? `<h2>Карточка ${String(group.number).padStart(2, '0')}</h2>` : `<h2 class="theme-heading" style="--c:${escape(group.theme.color)}">${suit(group.theme.suit)}${escape(group.theme.name)}</h2>`}${questions(group.questions, !!range)}</section>`).join('')}
      ${added.length ? `<section class="collection-group"><h2>Добавлено агентом</h2>${questions(added)}</section>` : ''}
      ${cards.some(card => card.task) ? `<details class="collection-group" id="deck-tasks" ${tasksOpen ? 'open' : ''}><summary>Задания «${escape(deck.tasks.name)}»</summary>${cards.filter(card => card.task).map((card, i) => listItem(card, 'deck', i + 1)).join('')}</details>` : ''}
    </div>`;
  let highlighted, highlightTimer;
  const jump = value => {
    if (!range) return;
    const number = Number(value);
    const target = Number.isInteger(number) && groups.some(group => group.number === number) ? document.getElementById(`card-${number}`) : null;
    const input = document.getElementById('card-number');
    const status = document.getElementById('jump-status');
    input.setAttribute('aria-invalid', String(!target));
    status.classList.toggle('error', !target);
    status.textContent = target ? rangeHint : `${rangeHint}. Введите номер существующей карточки.`;
    if (!target) return;
    input.value = String(number).padStart(2, '0');
    highlighted?.classList.remove('jump-highlight');
    clearTimeout(highlightTimer);
    highlighted = target;
    target.scrollIntoView({ block: 'start' });
    target.classList.add('jump-highlight');
    highlightTimer = setTimeout(() => target.classList.remove('jump-highlight'), 1800);
  };
  const form = document.getElementById('card-jump');
  if (form) form.onsubmit = event => { event.preventDefault(); jump(document.getElementById('card-number').value); };
  return jump;
}

function collection(mode) {
  game = null;
  const title = { favorites: 'Избранное', hidden: 'Скрытые', answers: 'Наши ответы' }[mode];
  const keys = mode === 'favorites' ? favoriteKeys() : activeKeys(profile.state[mode]);
  const selected = new Set(keys);
  document.title = `${title} — Вопросы для пары`;
  const actions = mode === 'favorites' && keys.length ? '<a class="button primary" href="#/favorites/play">Играть избранное</a>' : mode === 'answers' ? `<button data-action="download" ${keys.length ? '' : 'disabled'}>Скачать .md</button><button data-action="copy" ${keys.length ? '' : 'disabled'}>Скопировать всё</button>` : '';
  app.innerHTML = `${pageTop(title)}<div class="page-actions">${actions}</div><div class="collection">${keys.length ? registry.map(meta => {
    const count = keys.filter(key => key.startsWith(`${meta.id}/`)).length;
    if (!count) return '';
    const deck = decks.get(meta.id);
    const cards = deck ? cardsFor(deck).filter(card => selected.has(card.key)) : [];
    let content = '';
    if (!deck) content = lockedGroup(meta, count);
    else if (mode === 'answers') content = deck.themes.map(theme => {
      const group = cards.filter(card => card.theme.id === theme.id);
      return group.length ? `<h3 class="theme-heading" style="--c:${escape(theme.color)}">${suit(theme.suit)}${escape(theme.name)}</h3>${group.map(card => listItem(card, mode)).join('')}` : '';
    }).join('');
    else content = cards.map(card => listItem(card, mode)).join('');
    return `<section class="collection-group"><h2>${escape(meta.title)} <span class="muted">· ${count}</span></h2>${content}</section>`;
  }).join('') : `<p class="empty">${mode === 'favorites' ? 'Здесь будут любимые вопросы и задания из всех колод. Нажмите звезду на карточке.' : mode === 'hidden' ? 'Скрытых карточек пока нет. Их можно убрать кнопкой «Скрыть» во время игры.' : 'Откройте вопрос и запишите пару слов под ним. Здесь сохранятся ваши разговоры.'}</p>`}</div>`;
}

function markdown() {
  const lines = ['# Наши ответы', '', `Выгружено ${new Date().toLocaleDateString('ru-RU')}`];
  for (const meta of registry) {
    const answers = activeKeys(profile.state.answers).filter(key => key.startsWith(`${meta.id}/`));
    if (!answers.length) continue;
    lines.push('', `## ${meta.title}`);
    const deck = decks.get(meta.id);
    const themes = deck?.themes || [{ id: 'unknown', name: 'Вопросы' }];
    for (const theme of themes) {
      const keys = answers.filter(key => !deck || cardByKey(key)?.theme.id === theme.id);
      if (!keys.length) continue;
      lines.push('', `### ${theme.name}`);
      for (const key of keys) {
        const answer = profile.state.answers[key];
        lines.push('', `#### ${answer.q || cardByKey(key)?.text || key}`, '');
        for (const who of ['me', 'partner']) if (answer[who]) lines.push(`**${nameOf(who)}:** ${answer[who]}`, '');
        lines.push(`_${date(answer.at)}_`);
      }
    }
  }
  return lines.join('\n') + '\n';
}

function settings() {
  game = null;
  document.title = 'Настройки — Вопросы для пары';
  app.innerHTML = `${pageTop('Настройки')}<div class="settings"><section><h2>Кто играет</h2><div class="field-row">${['me', 'partner'].map(who => `<label>${who === 'me' ? 'Первый игрок' : 'Второй игрок'}<input id="name-${who}" maxlength="40" value="${escape(profile.state.names[who])}" placeholder="${who === 'me' ? 'Я' : 'Партнёр'}" autocomplete="off"></label>`).join('')}</div><p class="status" id="name-status" aria-live="polite">Имена сохраняются сами</p></section>
    <section><h2>Пароль от колод</h2><form id="password-form"><label>Пароль<input id="saved-password" type="password" value="${escape(config.password || '')}" autocomplete="current-password" required></label><button type="submit">Сохранить пароль</button><p class="status" id="password-status" role="status"></p></form><p class="hint">Пароль и токен хранятся только в localStorage этого браузера. Они не отправляются в профиль Gist.</p></section>
    <section><h2>Синхронизация через GitHub Gist</h2><p class="muted">Общий профиль на ваших устройствах: избранное, скрытые карточки, ответы и имена. Позиция в игре остаётся на устройстве.</p>
      <form id="sync-form"><label>GitHub Personal Access Token<input id="github-token" type="password" value="${escape(config.token || '')}" autocomplete="off" spellcheck="false" required></label><p class="hint">Fine-grained: Account permissions → Gists → Read and write. Classic: scope gist. <a href="https://github.com/settings/tokens" target="_blank" rel="noopener noreferrer">Создать токен</a></p><button class="primary" type="submit">${config.sync ? 'Сохранить и синхронизировать' : 'Включить синхронизацию'}</button></form>
      <p class="status" id="sync-status" aria-live="polite">${escape(syncText)}</p><p class="hint">Приложение найдёт или создаст secret gist «voprosy-dlya-pary state». Его содержимое шифруется паролем от колод. На всех устройствах используйте один пароль и один GitHub-аккаунт.</p>
      ${config.sync ? '<button class="quiet" data-action="sync-now">Синхронизировать сейчас</button> <button class="quiet" data-action="sync-off">Отключить</button>' : ''}</section>
    <section><h2>На этом устройстве</h2><p class="muted">Все изменения сохраняются в браузере сразу, даже без интернета. Не очищайте данные сайта, если ещё не синхронизировали ответы или не скачали их.</p><p class="hint">Для офлайн-запуска откройте портал хотя бы раз с интернетом. Шрифты без сети заменятся системными.</p></section></div>`;
  document.getElementById('password-form').onsubmit = async event => {
    event.preventDefault();
    const password = document.getElementById('saved-password').value;
    const status = document.getElementById('password-status');
    const button = event.target.querySelector('button');
    button.disabled = true;
    status.textContent = 'Проверяю пароль…';
    try {
      if (config.password !== password) keyCache.clear();
      const meta = registry.find(m => m.encrypted);
      if (meta) {
        const envelope = await json(new URL(`../decks/${meta.file}`, import.meta.url));
        await decryptJSON(envelope, password, keyCache);
      }
      const changed = config.password !== password;
      if (changed) sync.stop();
      saveConfig({ password });
      status.textContent = 'Пароль сохранён';
      if (config.sync) sync.run();
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  };
  document.getElementById('sync-form').onsubmit = event => {
    event.preventDefault();
    if (!config.password) { document.getElementById('sync-status').textContent = 'Сначала сохраните пароль от колод. Без него синхронизация недоступна.'; return; }
    const token = document.getElementById('github-token').value.trim();
    sync.stop();
    saveConfig({ sync: true, token, ...(token !== config.token ? { gistId: null } : {}) });
    settings(); sync.run();
  };
}

app.addEventListener('submit', event => { if (event.target.id === 'answer-form') event.preventDefault(); });
app.addEventListener('input', event => {
  if (event.target.closest('#answer-form')) {
    const form = event.target.closest('form');
    const key = form.dataset.key;
    const card = cardByKey(key);
    const me = form.elements.me.value, partner = form.elements.partner.value;
    const saved = profile.update('answers', key, me.trim() || partner.trim() ? { q: card.text, me, partner } : null);
    document.getElementById('answer-status').textContent = saved ? 'Сохранено в этом браузере' : 'Не удалось сохранить. Ответ пока только в памяти.';
  } else if (event.target.id.startsWith('name-')) {
    const saved = profile.update('names', null, { me: document.getElementById('name-me').value, partner: document.getElementById('name-partner').value });
    document.getElementById('name-status').textContent = saved ? 'Имена сохранены' : 'Не удалось сохранить имена';
  }
});

app.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const { action, key } = button.dataset;
  if (['next', 'prev', 'task', 'reset', 'theme', 'mix'].includes(action)) {
    if (!game) return;
    if (action === 'theme') {
      const id = button.dataset.theme;
      if (game.state.off.includes(id)) game.state.off = game.state.off.filter(t => t !== id);
      else if (game.state.off.length >= game.themes.length - 1) { toast('Оставьте хотя бы одну тему.'); return; }
      else game.state.off.push(id);
      game.refresh();
    } else if (action === 'mix') { game.state.mix = button.dataset.mix === 'on'; game.refresh(); }
    else game[action]();
    paintGame();
  } else if (action === 'favorite') {
    profile.toggle('favorites', key);
    if (game) { game.refresh(); paintGame(); } else await render(true);
  } else if (action === 'hide') {
    profile.update('hidden', key, {});
    if (game) { game.refresh(); paintGame(); } else await render(true);
    toast('Скрыто ·', () => {
      profile.update('hidden', key, null);
      if (game) { game.refresh(); paintGame(); } else render(true);
    });
  } else if (action === 'restore' || action === 'restore-open') {
    profile.update('hidden', key, null);
    if (action === 'restore-open') { const [id, card] = key.split('/'); location.hash = deckLink(id, card); }
    else await render(true);
  } else if (action === 'delete-answer') {
    const previous = profile.state.answers[key];
    profile.update('answers', key, null);
    await render(true);
    toast('Ответ удалён ·', () => { profile.update('answers', key, previous); render(true); });
  } else if (action === 'download') {
    const blob = new Blob([markdown()], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = 'nashi-otvety.md'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } else if (action === 'copy') {
    try { await navigator.clipboard.writeText(markdown()); toast('Ответы скопированы'); }
    catch { toast('Браузер не дал скопировать текст. Используйте «Скачать .md».'); }
  } else if (action === 'sync-now') sync.run();
  else if (action === 'sync-off') {
    sync.stop(); saveConfig({ sync: false, token: '' });
    syncText = 'Синхронизация выключена'; settings();
  }
});

async function render(preserve = false) {
  const id = ++renderId;
  const focus = preserve && app.contains(document.activeElement) ? {
    id: document.activeElement.id, start: document.activeElement.selectionStart, end: document.activeElement.selectionEnd
  } : null;
  const scroll = window.scrollY;
  app.setAttribute('aria-busy', 'true');
  updateCounts();
  try {
    let afterRender;
    const url = new URL((location.hash || '#/').slice(1), 'https://local.invalid');
    const path = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (!path.length) { game = null; home(); }
    else if (path[0] === 'settings') settings();
    else if (path[0] === 'deck') {
      const meta = registry.find(m => m.id === path[1]);
      if (!meta) throw new Error('Такой колоды нет. Вернитесь к списку колод.');
      let deck;
      try { deck = await loadDeck(meta); } catch (error) { if (!meta.encrypted) throw error; }
      if (id !== renderId) return;
      game = null;
      if (!deck) unlock(meta);
      else if (path[2] === 'list') afterRender = deckList(deck, preserve);
      else {
        startGame(meta.id, cardsFor(deck), url.searchParams.get('card'));
        if (url.searchParams.has('card')) {
          url.searchParams.delete('card');
          window.history.replaceState(window.history.state, '', `#${url.pathname}${url.search}`);
        }
      }
    } else if (['favorites', 'hidden', 'answers'].includes(path[0])) {
      await loadAvailable();
      if (id !== renderId) return;
      game = null;
      if (path[0] === 'favorites' && path[1] === 'play') {
        const keys = new Set(favoriteKeys());
        const locked = registry.find(m => m.encrypted && !decks.has(m.id) && [...keys].some(key => key.startsWith(`${m.id}/`)));
        if (locked) unlock(locked, 'Открыть избранное');
        else if (!keys.size) collection('favorites');
        else startGame('favorites', allCards().filter(card => keys.has(card.key)));
      } else collection(path[0]);
    } else throw new Error('Страница не найдена. Вернитесь к списку колод.');
    if (!game && wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
    if (preserve) {
      if (focus?.id) {
        const element = document.getElementById(focus.id);
        if (element) { element.focus({ preventScroll: true }); try { element.setSelectionRange?.(focus.start, focus.end); } catch { /* number inputs reject selection */ } }
      }
      window.scrollTo(0, scroll);
    } else { window.scrollTo(0, 0); app.focus({ preventScroll: true }); }
    if (!preserve && url.searchParams.has('n')) afterRender?.(url.searchParams.get('n'));
  } catch (error) {
    game = null;
    app.innerHTML = `${pageTop('Не получилось открыть страницу')}<p class="error">${escape(error.message)}</p><button data-action="retry" id="retry">Попробовать снова</button>`;
    document.getElementById('retry').onclick = () => render();
  } finally { if (id === renderId) app.setAttribute('aria-busy', 'false'); }
}

window.addEventListener('hashchange', () => { persistPosition(); render(); });
window.addEventListener('keydown', event => {
  if (!game || event.target.closest('input,textarea,button,select') || event.altKey || event.metaKey || event.ctrlKey) return;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    if (event.key === 'ArrowLeft') game.prev(); else game.next();
    paintGame();
  }
});
window.addEventListener('pagehide', persistPosition);
window.addEventListener('online', () => sync.run());

let wakeLock;
async function keepAwake() {
  if (document.visibilityState !== 'visible') return;
  if (game && !wakeLock && navigator.wakeLock) {
    try { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } catch { /* Optional browser capability. */ }
  }
}
document.addEventListener('pointerdown', keepAwake);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { sync.run(); keepAwake(); }
});

try {
  registry = await json(new URL('../decks/index.json', import.meta.url));
  await render();
  if (config.sync && config.password && config.token) sync.run();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
} catch (error) {
  app.setAttribute('aria-busy', 'false');
  app.innerHTML = `<h1>Колоды не загрузились</h1><p>${escape(error.message)}</p><button id="reload">Попробовать снова</button>`;
  document.getElementById('reload').onclick = () => location.reload();
}
