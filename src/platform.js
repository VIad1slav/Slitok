// Платформа: где запущена игра — в браузере или в настольном приложении (Electron).
// Весь остальной код спрашивает об этом только здесь. В браузере настольные функции просто ничего не делают,
// поэтому веб-версия и проверки работают из того же кода.
//
// window.desktop создаёт electron/preload.js; в браузере его нет.
const d = (typeof window !== 'undefined' && window.desktop) || null;

export const platform = {
  /** Настольное приложение? */
  isDesktop: !!d,
  /**
   * Режим разработки: доступны отладочный window.__gg и автопилот.
   * Настольное приложение — только при запуске из исходников; браузер — только с параметром ?dev в адресе
   * (его добавляют проверки tools/test/).
   */
  dev: d ? !!d.dev : (typeof location !== 'undefined' && new URLSearchParams(location.search).has('dev')),

  quit() { d?.quit(); },

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
