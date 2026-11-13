// Мост между игрой и настольной оболочкой. Страница игры не имеет доступа к Node.js и файлам:
// ей видны только перечисленные здесь функции (window.desktop), и ничего больше.
const { contextBridge, ipcRenderer } = require('electron');

const dev = process.argv.includes('--gg-dev');

contextBridge.exposeInMainWorld('desktop', {
  dev,                                               // режим разработки: отладочный window.__gg и DevTools
  quit: () => ipcRenderer.send('app:quit'),
  setFullscreen: (on) => ipcRenderer.send('window:set-fullscreen', !!on),
  isFullscreen: () => ipcRenderer.sendSync('window:get-fullscreen'),
  // файлы игрока: name — 'save' или 'settings' (см. electron/store.js)
  storeRead: (name) => ipcRenderer.sendSync('store:read', String(name)),
  storeWrite: (name, text) => ipcRenderer.send('store:write', String(name), String(text)),
  storeDir: () => ipcRenderer.sendSync('store:dir'),
  // Steam: есть ли он, и отправка полученных достижений (список имён из Steamworks)
  steamStatus: () => ipcRenderer.sendSync('steam:status'),
  steamUnlock: (ids) => ipcRenderer.send('steam:unlock', Array.isArray(ids) ? ids.map(String) : []),
  /** Сообщать игре, когда окно вошло в полный экран или вышло из него (Alt+Enter, F11). */
  onFullscreen: (fn) => { ipcRenderer.on('window:fullscreen', (e, on) => fn(!!on)); },
});
