// Файлы игрока: сохранение (save.json) и настройки (settings.json) в папке данных приложения.
//
// Где лежат: <папка данных>/saves/ — на Windows это %APPDATA%\Golden Grab\saves\.
// Запись «атомарная»: сначала пишется временный файл, потом он переименовывается на место настоящего —
// если игру или компьютер выключат посреди записи, старый файл останется целым. Перед заменой прежний файл
// копируется в *.bak (последняя заведомо хорошая копия).
// Повреждённый файл не роняет игру: он откладывается в сторону (*.corrupt-<время>), берётся копия *.bak,
// а если и её нет — игра начинает с чистого сохранения.
const { app } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const CONFIG = require('./config.js');

const NAMES = ['save', 'settings'];          // других файлов страница игры читать и писать не может
const MAX_BYTES = 1024 * 1024;

const dir = () => path.join(app.getPath('userData'), CONFIG.saveFolder);
const fileOf = (name) => path.join(dir(), `${name}.json`);

function parse(text) {
  const v = JSON.parse(text);
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
  return v;
}

/** Прочитать файл. Возвращает { data, note }: note — 'restored' (взята копия .bak) или 'reset' (начато заново). */
function read(name) {
  if (!NAMES.includes(name)) return { data: null, note: null };
  const file = fileOf(name);
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return { data: null, note: null }; }   // файла ещё нет — первый запуск
  try { return { data: parse(text), note: null }; } catch { /* повреждён — разбираемся ниже */ }
  try { fs.renameSync(file, `${file}.corrupt-${Date.now()}`); } catch { /* не удалось отложить — не страшно */ }
  try {
    const data = parse(fs.readFileSync(`${file}.bak`, 'utf8'));
    return { data, note: 'restored' };
  } catch { return { data: null, note: 'reset' }; }
}

/** Записать файл. text — готовый JSON от игры. Возвращает true, если записано. */
function write(name, text) {
  if (!NAMES.includes(name) || typeof text !== 'string' || text.length > MAX_BYTES) return false;
  try { parse(text); } catch { return false; }                 // мусор на диск не пишем
  const file = fileOf(name), tmp = `${file}.tmp`;
  try {
    fs.mkdirSync(dir(), { recursive: true });
    const fd = fs.openSync(tmp, 'w');
    try { fs.writeSync(fd, text, 0, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    if (fs.existsSync(file)) { try { parse(fs.readFileSync(file, 'utf8')); fs.copyFileSync(file, `${file}.bak`); } catch { /* прежний файл плох — в .bak его не кладём */ } }
    fs.renameSync(tmp, file);
    return true;
  } catch (err) {
    console.error('[Golden Grab] save write failed:', err.message);
    return false;
  }
}

module.exports = {
  dir, read, write,
  /** Открывать ли окно сразу на весь экран — из настроек игрока (по умолчанию да). */
  startFullscreen() { const s = read('settings').data; return s && typeof s.fullscreen === 'boolean' ? s.fullscreen : true; },
  ready({ ipcMain, fromGame }) {
    ipcMain.on('store:read', (e, name) => { e.returnValue = fromGame(e) ? read(name) : { data: null, note: null }; });
    ipcMain.on('store:write', (e, name, text) => { if (fromGame(e)) write(name, text); });
    ipcMain.on('store:dir', (e) => { e.returnValue = fromGame(e) ? dir() : ''; });
  },
};
