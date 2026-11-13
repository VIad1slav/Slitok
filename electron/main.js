// Главный процесс настольной версии Golden Grab (Electron).
//
// Что он делает:
//   - открывает одно окно без меню и показывает в нём игру — те же index.html и src/, что и в браузере;
//   - отдаёт игре только её собственные файлы по адресу app://game/…, любые другие адреса запрещены;
//   - переключает полный экран (Alt+Enter, F11 и из настроек игры);
//   - в сборке для игроков запрещает DevTools, F12, Ctrl+R и перезагрузку страницы.
//
// Режимы: «разработка» — запуск из исходников (npm run desktop): DevTools, F12 и отладочный window.__gg разрешены;
//         «релиз» — собранное приложение или запуск с ключом --release: всё это выключено.
const { app, BrowserWindow, protocol, ipcMain, Menu, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const CONFIG = require('./config.js');

const DEV = !app.isPackaged && !process.argv.includes('--release');
const APP_ROOT = path.join(__dirname, '..');           // папка с index.html
const ORIGIN = 'app://game';
const ICON = path.join(__dirname, 'icon.png');

// Папка данных: %APPDATA%\Golden Grab (Windows), ~/.config/Golden Grab (Linux). Проверки подставляют свою.
app.setName(CONFIG.productName);
app.setPath('userData', process.env.GG_USER_DATA || path.join(app.getPath('appData'), CONFIG.productName));

// На ноутбуках с двумя видеокартами просим дискретную.
app.commandLine.appendSwitch('force_high_performance_gpu');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

// Какие папки и файлы игры можно отдавать окну. Всё остальное — 404.
const ALLOWED = [/^index\.html$/, /^styles\.css$/, /^src\//, /^vendor\//, /^assets\//];
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.ico': 'image/x-icon' };
// Страница может брать код, стили, картинки и данные только у самой себя (importmap в index.html — встроенный скрипт).
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' data: blob:; media-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'";

async function serve(request) {
  const url = new URL(request.url);
  let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.normalize(path.join(APP_ROOT, rel));
  rel = path.relative(APP_ROOT, file).split(path.sep).join('/');
  if (url.host !== 'game' || rel.startsWith('..') || !ALLOWED.some((re) => re.test(rel))) return new Response('not found', { status: 404 });
  try {
    const body = await fs.promises.readFile(file);   // читаем сами: запросы к file:// запрещены вместе со всей остальной сетью
    return new Response(body, { status: 200, headers: { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff' } });
  } catch { return new Response('not found', { status: 404 }); }
}

/** Сообщение пришло от страницы игры, а не откуда-то ещё. */
const fromGame = (event) => { try { return event.senderFrame.url.startsWith(ORIGIN + '/'); } catch { return false; } };

let win = null;
const steam = require('./steam.js');
const features = [require('./store.js'), steam];   // дополнительные части: файлы игрока и Steam
steam.start({ DEV });   // до готовности приложения: Steam может добавить ключи запуска для оверлея

function createWindow() {
  const startFullscreen = features.reduce((v, f) => (f.startFullscreen ? f.startFullscreen() : v), true);
  win = new BrowserWindow({
    width: 1280, height: 720, minWidth: 960, minHeight: 540,
    fullscreen: startFullscreen, show: false, backgroundColor: '#030304',
    title: CONFIG.productName, autoHideMenuBar: true,
    ...(fs.existsSync(ICON) ? { icon: ICON } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
      devTools: DEV, spellcheck: false, webviewTag: false,
      additionalArguments: DEV ? ['--gg-dev'] : [],
    },
  });
  win.removeMenu();
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { win = null; });
  win.on('page-title-updated', (e) => e.preventDefault());   // заголовок окна — всегда название игры
  for (const ev of ['enter-full-screen', 'leave-full-screen']) win.on(ev, () => win?.webContents.send('window:fullscreen', win.isFullScreen()));

  const wc = win.webContents;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));                       // новых окон нет
  wc.on('will-navigate', (e, url) => { if (!url.startsWith(ORIGIN + '/')) e.preventDefault(); });
  wc.on('will-attach-webview', (e) => e.preventDefault());
  wc.setVisualZoomLevelLimits(1, 1).catch(() => {});
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const key = input.key.toLowerCase(), mod = input.control || input.meta;
    if ((key === 'enter' && input.alt) || key === 'f11') { e.preventDefault(); if (!input.isAutoRepeat) win.setFullScreen(!win.isFullScreen()); return; }
    if (DEV) { if (key === 'f12') wc.toggleDevTools(); return; }
    // релиз: никаких DevTools, перезагрузки страницы, масштаба и печати
    const blocked = key === 'f12' || key === 'f5' || (mod && ['r', 'u', 'p', 's', '+', '-', '=', '0'].includes(key)) || (mod && input.shift && ['i', 'j', 'c'].includes(key));
    if (blocked) e.preventDefault();
  });
  if (!DEV) wc.on('devtools-opened', () => wc.closeDevTools());
  wc.on('context-menu', (e) => e.preventDefault());

  win.loadURL(`${ORIGIN}/index.html${DEV ? '?dev=1' : ''}`);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    protocol.handle('app', serve);
    const ses = session.defaultSession;
    // Никакой сети: всё, что не app://game (и не служебные адреса DevTools в режиме разработки), обрывается.
    ses.webRequest.onBeforeRequest((details, cb) => {
      const ok = details.url.startsWith(ORIGIN + '/') || /^(data|blob):/.test(details.url) || (DEV && /^(devtools|chrome-extension):/.test(details.url));
      cb({ cancel: !ok });
    });
    // Игре нужны только захват мыши и полный экран.
    ses.setPermissionRequestHandler((wc, permission, cb) => cb(permission === 'pointerLock' || permission === 'fullscreen'));
    ses.setPermissionCheckHandler((wc, permission) => permission === 'pointerLock' || permission === 'fullscreen');

    ipcMain.on('app:quit', (e) => { if (fromGame(e)) app.quit(); });
    ipcMain.on('window:set-fullscreen', (e, on) => { if (fromGame(e) && win) win.setFullScreen(!!on); });
    ipcMain.on('window:get-fullscreen', (e) => { e.returnValue = fromGame(e) && win ? win.isFullScreen() : false; });
    for (const f of features) f.ready?.({ ipcMain, fromGame, DEV, getWindow: () => win });

    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => { for (const f of features) f.quit?.(); });
}

module.exports = { features, DEV };
