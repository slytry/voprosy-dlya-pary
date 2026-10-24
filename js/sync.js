import { createKeyCache, encryptJSON, decryptJSON } from './crypto.js';
import { mergeStates } from './merge.js';

const DESCRIPTION = 'voprosy-dlya-pary state';
const FILE = 'state.json';

// Injected fetch and callbacks also let tests exercise the complete Gist flow offline.
export function createSync({ getConfig, saveConfig, getState, merge, status, fetcher = fetch }) {
  let timer, running = false, pending = false, retry = 2000, salt;
  let generation = 0;
  const cache = createKeyCache();
  const enabled = () => {
    const c = getConfig();
    return c.sync && !!c.token && !!c.password;
  };
  async function api(path, options = {}) {
    const response = await fetcher(`https://api.github.com${path}`, {
      ...options,
      headers: {
        Accept: 'application/vnd.github+json', Authorization: `Bearer ${getConfig().token}`,
        'X-GitHub-Api-Version': '2022-11-28', ...(options.body ? { 'Content-Type': 'application/json' } : {})
      },
      signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) {
      if (response.status === 401) throw new Error('GitHub не принял токен. Проверьте его в настройках.');
      if (response.status === 403) throw new Error('GitHub отказал в доступе. Проверьте права Gists и лимит запросов.');
      throw new Error(`Ошибка GitHub (${response.status}). Попробую снова.`);
    }
    return response.json();
  }
  async function findGist(stillEnabled) {
    if (getConfig().gistId) return getConfig().gistId;
    for (let page = 1; ; page++) {
      const list = await api(`/gists?per_page=100&page=${page}`);
      if (!stillEnabled()) return null;
      const found = list.find(g => !g.public && g.description === DESCRIPTION && g.files?.[FILE]);
      if (found) { saveConfig({ gistId: found.id }); return found.id; }
      if (list.length < 100) return null;
    }
  }
  async function readGist(id, stillEnabled) {
    const gist = await api(`/gists/${encodeURIComponent(id)}`);
    if (!stillEnabled()) return;
    if (gist.public) throw new Error('Нужен secret gist. Отключите синхронизацию и проверьте настройки Gist.');
    const file = gist.files?.[FILE];
    if (!file) throw new Error('В Gist нет state.json. Восстановите файл и повторите синхронизацию.');
    if (!file.truncated) return file.content;
    const url = new URL(file.raw_url);
    if (url.protocol !== 'https:' || url.hostname !== 'gist.githubusercontent.com') throw new Error('Неожиданный адрес файла Gist.');
    // Raw URLs need no token. Do not send credentials to a second host.
    const response = await fetcher(url.href, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error('Не удалось прочитать полный файл Gist. Попробую снова.');
    return response.text();
  }
  async function mergeContent(content, stillEnabled) {
    if (!stillEnabled()) return;
    let envelope;
    try { envelope = JSON.parse(content); }
    catch { throw new Error('В Gist повреждён state.json. Восстановите файл и повторите синхронизацию.'); }
    const remote = await decryptJSON(envelope, getConfig().password, cache);
    if (!stillEnabled()) return;
    if (remote?.v !== 1) throw new Error('Неизвестная версия профиля в Gist.');
    salt = envelope.salt;
    merge(mergeStates(getState(), remote));
  }
  function schedule(delay = 2000) {
    if (!enabled()) return;
    clearTimeout(timer);
    timer = setTimeout(run, delay);
  }
  async function run() {
    clearTimeout(timer);
    if (!enabled()) return;
    if (running) { pending = true; return; }
    running = true; pending = false;
    const runGeneration = generation;
    const stillEnabled = () => enabled() && runGeneration === generation;
    status('Синхронизирую…');
    try {
      let id = await findGist(stillEnabled);
      if (!stillEnabled()) return;
      if (id) await mergeContent(await readGist(id, stillEnabled), stillEnabled);
      for (let attempt = 0; attempt < 3; attempt++) {
        if (!stillEnabled()) return;
        const snapshot = JSON.stringify(getState());
        const envelope = await encryptJSON(JSON.parse(snapshot), getConfig().password, cache, salt);
        salt = envelope.salt;
        if (!stillEnabled()) return;
        const sent = JSON.stringify(envelope);
        const body = JSON.stringify({ description: DESCRIPTION, ...(!id ? { public: false } : {}), files: { [FILE]: { content: sent } } });
        const gist = await api(id ? `/gists/${encodeURIComponent(id)}` : '/gists', { method: id ? 'PATCH' : 'POST', body });
        if (!stillEnabled()) return;
        if (!id) { id = gist.id; saveConfig({ gistId: id }); }
        const content = await readGist(id, stillEnabled);
        if (!stillEnabled()) return;
        if (content === sent) {
          retry = 2000;
          status(`Синхронизировано в ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`);
          if (snapshot !== JSON.stringify(getState())) pending = true;
          return;
        }
        await mergeContent(content, stillEnabled);
      }
      if (!stillEnabled()) return;
      throw new Error('Другие устройства изменяют Gist. Не удалось подтвердить запись за 3 попытки; повторю синхронизацию.');
    } catch (error) {
      if (stillEnabled()) {
        status(error instanceof TypeError ? 'Нет связи с GitHub. Данные сохранены здесь; повторю синхронизацию.' : error.message);
        schedule(retry);
        retry = Math.min(retry * 2, 60000);
      }
    } finally {
      running = false;
      if (pending && enabled()) schedule();
    }
  }
  function stop() {
    generation++; clearTimeout(timer); pending = false; salt = undefined; cache.clear();
  }
  return { run, schedule, stop };
}
