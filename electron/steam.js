// Steam: достижения и оверлей. Работает через библиотеку steamworks.js (в главном процессе).
//
// Главное правило: Steam необязателен. Если клиент Steam не запущен, игра не куплена на этом аккаунте или
// библиотека не загрузилась, — игра запускается и работает как обычно, просто достижения в Steam не уходят
// (они запоминаются в сохранении и отправятся при следующем запуске со Steam).
//
// App ID — в electron/config.js. Для разработки это 480 (Spacewar, общий тестовый App ID Valve).
// Облачные сохранения кода не требуют: в Steamworks включается Auto-Cloud на папку saves (см. docs/steam_setup.md).
const { app } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const CONFIG = require('./config.js');

let client = null;
let status = { available: false, reason: 'not started', appId: null, overlay: false };

/** Запускается до готовности приложения: ключи для оверлея надо выставить заранее. */
function start({ DEV }) {
  const appId = Number(process.env.GG_STEAM_APP_ID) || (DEV ? CONFIG.steamDevAppId : CONFIG.steamAppId);
  status.appId = appId;
  if (!appId || process.env.GG_NO_STEAM) { status.reason = 'disabled'; return; }
  let steamworks;
  try { steamworks = require('steamworks.js'); } catch (err) { status.reason = `library: ${err.message}`; return; }
  try {
    // Только в сборке с настоящим App ID: если игру запустили не из Steam, Steam перезапустит её сам.
    if (app.isPackaged && appId !== CONFIG.steamDevAppId && steamworks.restartAppIfNecessary(appId)) { app.quit(); return; }
    // Только в разработке: steam_appid.txt рядом с проектом, чтобы Steam узнал игру при запуске не из клиента.
    if (DEV) { try { fs.writeFileSync(path.join(__dirname, '..', 'steam_appid.txt'), String(appId)); } catch { /* не страшно */ } }
    client = steamworks.init(appId);
    status = { available: true, reason: null, appId, overlay: false, player: client.localplayer.getName() };
    if (CONFIG.steamOverlay && !process.env.GG_NO_OVERLAY) { steamworks.electronEnableSteamOverlay(); status.overlay = true; }
  } catch (err) {
    client = null;
    status.reason = String(err.message || err).split('\n')[0];   // чаще всего: клиент Steam не запущен
  }
}

function unlock(id) {
  if (!client || typeof id !== 'string' || !/^[A-Z0-9_]{1,64}$/.test(id)) return false;
  try { return client.achievement.isActivated(id) || client.achievement.activate(id); } catch { return false; }
}

module.exports = {
  start, unlock,
  status: () => status,
  ready({ ipcMain, fromGame }) {
    ipcMain.on('steam:status', (e) => { e.returnValue = fromGame(e) ? { available: status.available, reason: status.reason, overlay: status.overlay } : { available: false }; });
    ipcMain.on('steam:unlock', (e, ids) => { if (fromGame(e) && Array.isArray(ids)) for (const id of ids.slice(0, 64)) unlock(id); });
  },
};
