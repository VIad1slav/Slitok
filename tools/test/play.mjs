// Автопроверка игры в настоящем Chromium (Playwright + установленный Chrome/Edge):
//   node tools/test/play.mjs            — консоль без ошибок, автопилот проходит все уровни,
//                                         стекло не пропускает руку, ловушка для обезьян работает, FPS
//   node tools/test/play.mjs --shots    — то же + скриншоты в docs/screens/
// Свой статический сервер поднимается на случайном порту, отдельно запускать ничего не нужно.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHOTS = process.argv.includes('--shots');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.glb': 'model/gltf-binary', '.json': 'application/json' };

const server = createServer(async (req, res) => {
  try {
    let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (p.endsWith('\\') || p.endsWith('/')) p += 'index.html';
    const file = join(ROOT, p);
    if (!file.startsWith(ROOT)) throw new Error('forbidden');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

let browser;
for (const channel of ['chrome', 'msedge']) {
  try {
    browser = await chromium.launch({ channel, headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
    break;
  } catch { /* пробуем следующий браузер */ }
}
if (!browser) { console.error('Не найден Chrome или Edge'); process.exit(2); }
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });

await page.goto(url);
await page.waitForFunction(() => window.__gg && window.__gg.state === 'menu', null, { timeout: 60000 });
let failed = 0;
const check = (ok, text) => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${text}`); if (!ok) failed++; };

const info = await page.evaluate(() => {
  const g = window.__gg, gl = g.stage.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
  return { report: g.assetReport, renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown' };
});
console.log('GPU:', info.renderer);
check(info.report.missingModels.length === 0 && info.report.fallbackTextures.length === 0, `все модели и текстуры из Blender загружены (${JSON.stringify(info.report)})`);

const shot = async (name) => {
  if (!SHOTS) return;
  mkdirSync(join(ROOT, 'docs', 'screens'), { recursive: true });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(ROOT, 'docs', 'screens', name + '.png') });
  console.log('  скриншот', name);
};
// прогнать автопилот до момента t (сек) и остановить время, чтобы снять кадр
const freeze = (id, t, side = false) => page.evaluate(([lvl, sec, sideView]) => {
  const g = window.__gg;
  g.runAuto(lvl); g.timeScale = 0;
  for (let i = 0; i < sec * 120 && g.state === 'playing'; i++) g._fixedStep(1 / 120);
  if (sideView) { g.stage.sideTarget = 1; g.stage.sideBlend = 1; }
}, [id, t, side]);

if (SHOTS) {
  await shot('menu');
  await freeze(1, 3.4); await shot('level1_grab');
  await freeze(2, 2.6); await shot('level2_side');
  await freeze(3, 7.0); await shot('level3_monkey');
  await freeze(5, 5.2); await shot('level5_lasers');
  await freeze(8, 3.0); await shot('level8_carousel');
  await freeze(3, 7.0, true); await shot('level3_sideview');
}

// --- 1. автопилот проходит все уровни
const results = await page.evaluate(() => { window.__gg.timeScale = 1; return [1, 2, 3, 4, 5, 6, 7, 8].map((id) => window.__gg.autoTest(id, 120)); });
for (const r of results) check(r.result === 'won', `уровень ${r.level}: ${r.result}, ${r.time} с, касаний ${r.touches}, трещин ${r.damage}, звёзд ${r.stars}`);

// --- 2. физика: рука не проходит сквозь стекло, ловушка для обезьян держит, стекло бьётся
const phys = await page.evaluate(() => {
  const g = window.__gg, S = 1 / 120, out = {};
  const run = (s, fn) => { for (let i = 0; i < s * 120 && g.state === 'playing'; i++) { if (fn) fn(); g._fixedStep(S); } };
  // рука давит на верхнюю стенку уровня 2 сверху на максимальной скорости
  g.startLevel(1);
  const h = g.hand, top = 0.9 + g.level.box.size[1];
  run(1.0, () => h.target.set(-0.2, 1.5, -0.1));
  run(1.5, () => h.target.set(-0.2, 0.95, -0.1));
  let minY = Infinity;
  h.forEachArmSphere((x, y, z, r) => { if (Math.abs(x + 0.2) < 0.25 && Math.abs(z + 0.1) < 0.18) minY = Math.min(minY, y - r); });
  out.wall = { lowest: +minY.toFixed(4), glassTop: top, touches: g.touches, damage: g.box.damage };
  // продолжаем бить — стекло должно разбиться
  for (let k = 0; k < 8 && g.state === 'playing'; k++) { run(0.7, () => h.target.set(-0.2, 1.5, -0.1)); run(0.7, () => h.target.set(-0.2, 0.95, -0.1)); }
  out.broken = { result: g.result, broken: g.box.broken };
  // уровень 3: хватаем слиток поперёк и тянем наружу
  g.startLevel(2);
  const b = g.bar.position().clone(), yG = b.y + 0.0225 + 0.022, V = h.target.constructor;
  const go = (x, y, z, sec, sp = 0.5) => { const d = new V(x, y, z); run(sec, () => { const c = h.target, dd = c.distanceTo(d); if (dd > sp * S) c.lerp(d, sp * S / dd); else c.copy(d); }); };
  go(b.x, yG + 0.012, b.z + 0.5, 1.5); go(b.x, yG + 0.012, b.z, 2); go(b.x, yG - 0.01, b.z, 0.5, 0.2);
  h.setGrip(true); run(0.5);
  const held = h.holding;
  go(b.x, yG + 0.03, b.z, 0.6, 0.2); go(b.x, yG + 0.03, b.z + 0.6, 4, 0.4);
  out.monkey = { held, barZ: +g.bar.position().z.toFixed(3), wallZ: g.level.box.pos[1] + g.level.box.size[2] / 2, state: g.state };
  // слиток летит внутри коробки и не пролетает сквозь дно/стенки
  g.startLevel(0);
  g.bar.body.position.y += 0.15; g.bar.body.velocity.set(2.5, -1, 1.5);
  run(2);
  out.drop = { inside: g.box.contains(g.bar.position()), y: +g.bar.position().y.toFixed(3) };
  g.toMenu();
  return out;
});
check(phys.wall.lowest > phys.wall.glassTop - 0.004, `рука не прошла сквозь стекло (низ руки ${phys.wall.lowest} м, верх стекла ${phys.wall.glassTop.toFixed(3)} м, касаний ${phys.wall.touches})`);
check(phys.broken.broken && /Стекло/.test(phys.broken.result || ''), `стекло разбивается от сильных ударов (${phys.broken.result})`);
check(phys.monkey.held && phys.monkey.barZ < phys.monkey.wallZ, `ловушка для обезьян: слиток поперёк не вышел (z = ${phys.monkey.barZ}, стенка ${phys.monkey.wallZ.toFixed(2)})`);
check(phys.drop.inside && phys.drop.y > 0.9, `брошенный слиток остался внутри коробки (y = ${phys.drop.y})`);

// --- 3. FPS на уровне 1 (5 секунд реального времени)
await page.evaluate(() => { window.__gg.startLevel(0); });
await page.waitForTimeout(1500);
const fps = await page.evaluate(() => new Promise((res) => {
  let n = 0; const t0 = performance.now();
  const tick = (t) => { n++; if (t - t0 < 5000) requestAnimationFrame(tick); else res({ fps: n / ((t - t0) / 1000), pixelRatio: window.__gg.stage.pixelRatio }); };
  requestAnimationFrame(tick);
}));
check(fps.fps >= 55, `FPS на уровне 1: ${fps.fps.toFixed(1)} (pixelRatio ${fps.pixelRatio}, 1280×720)`);
await shot('level1_start');

check(errors.length === 0, `консоль без ошибок${errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''}`);
await browser.close(); server.close();
console.log(failed ? `\nПровалено проверок: ${failed}` : '\nВсе проверки пройдены');
process.exit(failed ? 1 : 0);
