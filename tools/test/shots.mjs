// Съёмка кадров из игры по списку:
//   node tools/test/shots.mjs <список.json> <папка> [--size 1920x1080] [--prefix имя_] [--quality high] [--lang ru]
// Список — JSON-массив кадров. Поля кадра (все, кроме name, необязательные):
//   name   — имя файла без расширения
//   level  — id уровня; автопилот ведёт руку t секунд (или долю прохождения frac: 0..1), затем время замирает
//   start  — true: кадр сразу после старта уровня, рука в стартовой позе
//   dark   — true: дождаться полной темноты (уровни с «перебоями со светом»)
//   side   — true: вид сбоку
//   skin, accessory — вариант руки и украшение (id из src/cosmetics.js); metal — металл слитка (id из src/metals.js)
//   lang   — язык интерфейса; hud — false, чтобы убрать интерфейс с кадра
//   screen — вместо уровня показать экран меню: 'menu' | 'levels' | 'controls' | 'settings' | 'loading'
//   eval   — строка JavaScript, выполняется в игре перед снимком (g — игра)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync, readFileSync } from 'node:fs';
import { extname, join, normalize, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2), opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const list = JSON.parse(readFileSync(resolve(args[0]), 'utf8')), outDir = resolve(args[1]);
const [W, H] = opt('size', '1280x720').split('x').map(Number), prefix = opt('prefix', ''), quality = opt('quality', null);
const langAll = opt('lang', null);   // --lang ru: снять весь список на этом языке, что бы ни стояло в самих кадрах
if (langAll) for (const s of list) s.lang = langAll;
mkdirSync(outDir, { recursive: true });

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  try {
    let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)); if (p.length < 2) p += 'index.html';
    const body = await readFile(join(ROOT, p));
    res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, locale: 'ru-RU' });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(`http://127.0.0.1:${server.address().port}/?dev=1`);
await page.waitForFunction(() => window.__gg && window.__gg.state === 'menu', null, { timeout: 60000 });
if (quality) await page.evaluate((q) => window.__gg.applySettings?.({ quality: q }), quality);

for (const s of list) {
  await page.evaluate(async (s) => {
    const g = window.__gg, C = await import('/src/cosmetics.js'), S = 1 / 120;
    if (s.lang && g.setLanguage) g.setLanguage(s.lang);
    if (s.metal) { g.save.metal = s.metal; (await import('/src/i18n/index.js')).setTextMetal(s.metal); }   // металл слитка — до старта уровня
    if (s.skin) g.hand.setSkin(C.cosmeticById(s.skin));
    g.hand.setAccessory(s.accessory ? C.cosmeticById(s.accessory) : null, g.models);
    if (s.screen) { if (g.state !== 'menu') g.toMenu(); g.ui.show(s.screen); if (s.eval) new Function('g', s.eval)(g); return; }
    if (s.start) { g.startLevelById(s.level); g.timeScale = 0; }
    else {
      let t = s.t;
      if (t == null) { const r = g.autoTest(s.level, 400); t = r.time * (s.frac ?? 0.5); }
      g.runAuto(s.level); g.timeScale = 0;
      for (let i = 0; i < t * 120 && g.state === 'playing'; i++) g._fixedStep(S);
    }
    if (s.dark) { const bo = g.traps.find((x) => x.def.type === 'blackout'); for (let i = 0; i < 20 * 120 && bo && bo.state !== 'dark'; i++) g._fixedStep(S); for (let i = 0; i < 60; i++) { for (const x of g.traps) x.update(0); g.stage.update(0.016, 0, g.hand.pos, 0); } }
    if (s.side) { g.stage.sideTarget = 1; g.stage.sideBlend = 1; }
    document.getElementById('ui').style.visibility = s.hud === false ? 'hidden' : '';
    if (s.eval) new Function('g', s.eval)(g);
  }, s);
  await page.waitForTimeout(s.wait ?? 500);
  const file = join(outDir, `${prefix}${s.name}.png`);
  await page.screenshot({ path: file });
  console.log('  кадр', file);
}
await browser.close(); server.close();
