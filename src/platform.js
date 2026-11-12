// Платформа: где запущена игра — в браузере или в настольном приложении (Electron).
// Весь остальной код спрашивает об этом только здесь. В браузере настольные функции просто ничего не делают,
// поэтому веб-версия и проверки работают из того же кода.
//
// window.desktop создаёт electron/preload.js; в браузере его нет.
const d = (typeof window !== 'undefined' && window.desktop) || null;

// Ключи localStorage. Первый — тот же, что был у игры с самого начала: старые сохранения читаются по нему.
const LS_KEYS = { save: 'goldenGrab.v1', settings: 'goldenGrab.settings.v1' };
const lsRead = (name) => { try { const v = JSON.parse(localStorage.getItem(LS_KEYS[name]) || 'null'); return v && typeof v === 'object' ? v : null; } catch { return null; } };
const lsWrite = (name, text) => { try { localStorage.setItem(LS_KEYS[name], text); } catch { /* приватный режим, переполнение — играем без сохранения */ } };

const pending = new Map();   // отложенные записи: имя → { timer, text }
const put = (name, text) => { if (d) d.storeWrite(name, text); else lsWrite(name, text); };

/**
 * Хранилище данных игрока. name — 'save' или 'settings'.
 * Настольное приложение: файлы <папка данных>/saves/<name>.json (их пишет electron/store.js).
 * Браузер: localStorage.
 */
const store = {
  /** @returns {{ data: object|null, note: string|null, migrated?: boolean }} note: 'restored' | 'reset' — файл был повреждён */
  read(name) {
    if (!d) return { data: lsRead(name), note: null };
    let res;
    try { res = d.storeRead(name); } catch { res = null; }
    if (res?.data) return res;
    // Файла нет. Если в localStorage приложения осталось сохранение (ранние сборки хранили его там) — переносим без потерь.
    const old = res?.note ? null : lsRead(name);
    return old ? { data: old, note: null, migrated: true } : { data: null, note: res?.note ?? null };
  },
  /** now = false — записать через четверть секунды (ползунок шлёт десятки изменений подряд). */
  write(name, obj, now = false) {
    const text = JSON.stringify(obj);
    const p = pending.get(name);
    if (p) { clearTimeout(p.timer); pending.delete(name); }
    if (now) return put(name, text);
    pending.set(name, { text, timer: setTimeout(() => { pending.delete(name); put(name, text); }, 250) });
  },
  /** Записать всё отложенное прямо сейчас (перед выходом из игры). */
  flush() { for (const [name, p] of pending) { clearTimeout(p.timer); put(name, p.text); } pending.clear(); },
  /** Папка с файлами игрока (только настольное приложение). */
  dir() { return d ? d.storeDir() : null; },
};
if (typeof window !== 'undefined') window.addEventListener('pagehide', () => store.flush());

export const platform = {
  store,
  /** Настольное приложение? */
  isDesktop: !!d,
  /**
   * Режим разработки: доступны отладочный window.__gg и автопилот.
   * Настольное приложение — только при запуске из исходников; браузер — только с параметром ?dev в адресе
   * (его добавляют проверки tools/test/).
   */
  dev: d ? !!d.dev : (typeof location !== 'undefined' && new URLSearchParams(location.search).has('dev')),

  quit() { store.flush(); d?.quit(); },

  // --- окно
  canFullscreen: !!d || (typeof document !== 'undefined' && !!document.documentElement?.requestFullscreen),
  isFullscreen() { return d ? d.isFullscreen() : !!document.fullscreenElement; },
  setFullscreen(on) {
    if (d) return d.setFullscreen(on);
    if (on) document.documentElement.requestFullscreen?.().catch(() => {}); else if (document.fullscreenElement) document.exitFullscreen?.();
  },
  /** fn(полный экран?) — вызывается при любом переключении (Alt+Enter, F11, настройки). */
  onFullscreen(fn) {
    if (d) d.onFullscreen(fn);
    else document.addEventListener('fullscreenchange', () => fn(!!document.fullscreenElement));
  },
};
