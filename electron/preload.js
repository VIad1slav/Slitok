// Мост между игрой и настольной оболочкой. Страница игры не имеет доступа к Node.js и файлам:
// ей видны только перечисленные здесь функции (window.desktop), и ничего больше.
const { contextBridge, ipcRenderer } = require('electron');

const dev = process.argv.includes('--gg-dev');

contextBridge.exposeInMainWorld('desktop', {
  dev,                                               // режим разработки: отладочный window.__gg и DevTools
  quit: () => ipcRenderer.send('app:quit'),
  setFullscreen: (on) => ipcRenderer.send('window:set-fullscreen', !!on),
  isFullscreen: () => ipcRenderer.sendSync('window:get-fullscreen'),
  /** Сообщать игре, когда окно вошло в полный экран или вышло из него (Alt+Enter, F11). */
  onFullscreen: (fn) => { ipcRenderer.on('window:fullscreen', (e, on) => fn(!!on)); },
});
