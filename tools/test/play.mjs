// Автопроверка игры в настоящем Chromium (Playwright + установленный Chrome/Edge):
//   node tools/test/play.mjs            — все проверки (список ниже)
//   node tools/test/play.mjs --shots    — то же + скриншоты в docs/screens/
// Свой статический сервер поднимается на случайном порту, отдельно запускать ничего не нужно.
//
// Что проверяется:
//   1. ассеты из Blender загружены, консоль без ошибок;
//   2. старое сохранение (до кампании) читается без потерь; замки ограблений считаются по звёздам;
//   3. автопилот проходит все уровни кампании; время не ушло от эталона (BASELINE) больше чем на 10 %;
//   4. общая модель добычи: уровень с двумя слитками, предметы-цилиндр и шар;
//   5. физика: рука не проходит сквозь стекло, стекло бьётся, ловушка для обезьян держит;
//   6. нагрузка на отрисовку по уровням (вызовы, треугольники, время кадра относительно уровня 1).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHOTS = process.argv.includes('--shots');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.glb': 'model/gltf-binary', '.json': 'application/json' };

// Эталон: время автопилота (с) по id уровня. Симуляция детерминирована, поэтому расхождение значит,
// что изменилась физика, уровень или сценарий автопилота. Меняя что-то из этого намеренно — обнови число.
const BASELINE = {
  1: 6.48, 2: 4.88, 3: 49.06, 4: 7.18, 5: 9.38, 6: 8.43, 7: 6.5, 8: 5.57,   // MVP; уровни 3 и 8 — после перевода автопилота на общие шаги (было 56.83 и 5.82)
  9: 7.13, 10: 5.44, 11: 52.72, 12: 6.78, 13: 8.17, 14: 5.46, 15: 7.96, 16: 12.27, 17: 14.38, 18: 11.07,
  19: 23.59, 20: 6.83, 21: 4.56, 22: 14.08, 23: 7.71, 24: 20.32, 25: 21.92, 26: 20.5,
};
const TIME_TOLERANCE = 0.10;

const server = createServer(async (req, res) => {
  try {
    let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (p.length < 2) p += 'index.html';
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

// Сохранение старого вида (как у игроков до кампании): без version, рука — перчатка.
const OLD_SAVE = { best: { 1: { stars: 3, time: 6.5, touches: 0 }, 2: { stars: 2, time: 31.2, touches: 3 }, 5: { stars: 1, time: 80, touches: 7 } }, skin: 'glove', volume: 0.4 };
await page.addInitScript((save) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('goldenGrab.v1', JSON.stringify(save)); sessionStorage.setItem('seeded', '1'); } }, OLD_SAVE);

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

// --- сохранение и замки
const sv = await page.evaluate(async () => {
  const g = window.__gg, H = await import('/src/heists.js');
  return {
    version: g.save.version, best: g.save.best, skin: g.save.skin, volume: g.save.volume, handSkin: g.hand.skin,
    stars: H.totalStars(g.save), open: H.HEISTS.map((h) => H.isHeistUnlocked(h, g.save)), thresholds: H.HEISTS.map((h) => h.unlockStars),
    next: H.continueLevel(g.save).id,
  };
});
check(sv.version === 2 && JSON.stringify(sv.best) === JSON.stringify(OLD_SAVE.best) && sv.skin === 'glove' && sv.handSkin === 'glove' && sv.volume === 0.4,
  `старое сохранение прочитано без потерь (версия ${sv.version}, рекордов ${Object.keys(sv.best).length}, рука «${sv.skin}», громкость ${sv.volume})`);
check(sv.stars === 6 && sv.open.join() === 'true,false,false,false,false' && sv.next === 9,
  `замки по звёздам: звёзд ${sv.stars}, открыто ${sv.open.map((o) => (o ? 'да' : 'нет')).join('/')} при порогах ${sv.thresholds.join('/')}, «Играть» ведёт на уровень ${sv.next}`);

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
  await page.evaluate(() => window.__gg.ui.show('levels'));
  await shot('heists');
}

// --- автопилот проходит все уровни кампании
const results = await page.evaluate(async () => {
  const g = window.__gg, H = await import('/src/heists.js');
  g.timeScale = 1;
  return H.campaignOrder().map((e) => ({ ...g.autoTest(e.level.id, 180), heist: e.heist.name, number: e.number, name: e.level.name }));
});
for (const r of results) {
  const base = BASELINE[r.level], drift = base ? (r.time - base) / base : null;
  const note = base == null ? 'эталона нет' : `эталон ${base} с, ${drift >= 0 ? '+' : ''}${(drift * 100).toFixed(1)} %`;
  check(r.result === 'won' && (drift == null || Math.abs(drift) <= TIME_TOLERANCE), `${r.heist} ${r.number} «${r.name}» (id ${r.level}): ${r.result}, ${r.time} с (${note}), касаний ${r.touches}, звёзд ${r.stars}`);
}

// --- по кадру с каждого уровня: середина прохождения автопилотом (и один кадр «вид сбоку»)
if (SHOTS) {
  for (const r of results) { await freeze(r.level, Math.max(1.5, r.time * 0.5)); await shot(`level_${String(r.level).padStart(2, '0')}`); }
  await freeze(3, 7.0, true); await shot('sideview');
}

// --- музей: ваза бьётся, камера ловит движение
const museum = await page.evaluate(() => {
  const g = window.__gg, S = 1 / 120, out = {};
  const run = (s, fn) => { for (let i = 0; i < s * 120 && g.state === 'playing'; i++) { if (fn) fn(); g._fixedStep(S); } };
  // ваза падает с 25 см — должна разбиться
  g.startLevelById(12);
  const vase = g.items[0];
  run(0.5);
  out.calm = { cracks: vase.cracks, broken: vase.broken };          // просто стоит — цела
  vase.body.position.y += 0.25; run(1.5);
  out.drop = { broken: vase.broken, result: g.result };
  // лёгкий стук (опускание с 4 см) — трещина, но не вдребезги
  g.startLevelById(12);
  const v2 = g.items[0];
  run(0.5); v2.body.position.y += 0.04; run(1.0);
  out.tap = { cracks: v2.cracks, broken: v2.broken, state: g.state };
  // камера: двигаем руку, пока она смотрит
  g.startLevelById(13);
  const cam = g.traps.find((t) => t.def.type === 'camera'), h = g.hand;
  for (let i = 0; i < 20 * 120 && g.state === 'playing' && cam.state !== 'watch'; i++) g._fixedStep(S);
  out.still = { state: cam.state };
  run(1.0);                                                          // рука неподвижна — ничего не происходит
  out.still.meter = +cam.meter.toFixed(2); out.still.game = g.state;
  for (let i = 0; i < 20 * 120 && g.state === 'playing' && cam.state !== 'away'; i++) g._fixedStep(S);
  for (let i = 0; i < 20 * 120 && g.state === 'playing' && cam.state !== 'watch'; i++) g._fixedStep(S);
  run(3.0, () => h.target.set(h.pos.x, h.pos.y + 0.05, h.pos.z));   // рука ползёт вверх
  out.moved = { result: g.result, meter: +cam.meter.toFixed(2) };
  g.toMenu();
  return out;
});
check(!museum.calm.broken && museum.calm.cracks === 0 && museum.drop.broken && /Ваза/.test(museum.drop.result || ''), `ваза: стоит — цела, упала с 25 см — ${museum.drop.result}`);
check(museum.tap.cracks === 1 && !museum.tap.broken && museum.tap.state === 'playing', `ваза: лёгкий удар даёт трещину, но не разбивает (трещин ${museum.tap.cracks})`);
check(museum.still.state === 'watch' && museum.still.meter === 0 && museum.still.game === 'playing', `камера смотрит, рука неподвижна — тревоги нет (полоска ${museum.still.meter})`);
check(/Камера/.test(museum.moved.result || ''), `камера смотрит, рука движется — ${museum.moved.result}`);

// --- банк: заслонка не давит руку, весы ловят пропажу, перегородка не пускает руку
const bank = await page.evaluate(() => {
  const g = window.__gg, S = 1 / 120, out = {};
  const run = (s, fn) => { for (let i = 0; i < s * 120 && g.state === 'playing'; i++) { if (fn) fn(); g._fixedStep(S); } };
  // заслонка: рука стоит в отверстии, пока та закрывается
  g.startLevelById(21);
  const sh = g.traps.find((t) => t.def.type === 'shutter'), h = g.hand, hole = { x: 0.09, y: 1.02, z: -0.1 };
  run(2.5, () => h.target.set(hole.x + 0.02, hole.y, hole.z));
  for (let i = 0; i < 12 * 120 && g.state === 'playing' && sh.state !== 'closed'; i++) g._fixedStep(S);
  run(0.6);
  out.shutter = { k: +sh.k.toFixed(2), alarm: !!g.alarmState, alarmText: g.alarmState?.text, handX: +h.pos.x.toFixed(3) };
  // закрытая заслонка не пускает руку внутрь
  g.startLevelById(21);
  const sh2 = g.traps.find((t) => t.def.type === 'shutter');
  for (let i = 0; i < 12 * 120 && g.state === 'playing' && !(sh2.state === 'closed' && sh2.k > 0.99); i++) g._fixedStep(S);
  run(1.2, () => h.target.set(-0.2, hole.y, hole.z));
  out.closed = { handX: +h.pos.x.toFixed(3), wallX: 0.09, alarm: !!g.alarmState };
  // весы: слиток унесён без груза — тревога
  g.startLevelById(22);
  const bar = g.items[0];
  run(1.0);
  out.scaleCalm = !g.alarmState;
  bar.body.position.set(0.3, 1.0, 0.3); bar.body.velocity.set(0, 0, 0);
  run(1.0);
  out.scale = { alarm: !!g.alarmState, text: g.alarmState?.text };
  // перегородка: рука идёт горизонтально сквозь барьер уровня 20 — должна упереться
  // перегородка: рука ныряет прямо в барьер уровня 20 (он на z = -0.02, высотой до y = 1.0) — пройти сквозь него нельзя
  g.startLevelById(20);
  run(1.5, () => h.target.set(-0.1, 1.25, 0.2));
  run(2.5, () => h.target.set(-0.1, 0.99, 0.06));
  let inside = 0; h.forEachArmSphere((x, y, z, r) => { if (y < 0.995 && Math.abs(z + 0.02) < r * 0.6) inside++; });
  out.barrier = { inside, handY: +h.pos.y.toFixed(3) };
  g.toMenu();
  return out;
});
check(bank.shutter.k < 0.9 && bank.shutter.alarm, `заслонка упёрлась в руку и остановилась (закрыта на ${Math.round(bank.shutter.k * 100)} %), тревога: «${bank.shutter.alarmText}»`);
check(bank.closed.handX > bank.closed.wallX && !bank.closed.alarm, `закрытая заслонка не пускает руку (x = ${bank.closed.handX}, стенка ${bank.closed.wallX})`);
check(bank.scaleCalm && bank.scale.alarm, `весы: слиток на месте — тихо; унесён без груза — «${bank.scale.text}»`);
check(bank.barrier.inside === 0, `рука не прошла сквозь внутренний барьер (сфер руки внутри барьера: ${bank.barrier.inside}, высота кисти ${bank.barrier.handY} м)`);

// --- общая модель добычи
const loot = await page.evaluate(async () => {
  const g = window.__gg, { LOOT } = await import('/src/loot-types.js'), { LEVELS } = await import('/src/levels.js');
  const base = LEVELS.find((l) => l.id === 1), out = {};
  // два слитка на одной подставке: оба надо донести
  const two = { ...base, id: 9001, name: 'проверка: два слитка', bar: undefined, loot: [{ type: 'bar', pos: [0, 0.05, -0.045], mass: 1, friction: 0.6 }, { type: 'bar', pos: [0, 0.05, 0.045], mass: 1, friction: 0.6 }] };
  const r2 = g.autoTest(two, 60);
  out.two = { result: r2.result, time: r2.time, done: g.lootDone, need: g.lootNeed };
  // предметы другой формы: стоящий цилиндр и шар
  LOOT.testCyl = { name: 'цилиндр', failFall: 'Цилиндр упал со стола', bounds: [0.07, 0.07, 0.07], shapes: [{ type: 'cylinder', radius: 0.035, height: 0.07 }], held: [[0, 0, 0, 0.035]], mass: 0.6, friction: 0.6, material: 'steel' };
  LOOT.testBall = { name: 'шар', failFall: 'Шар упал со стола', bounds: [0.07, 0.07, 0.07], shapes: [{ type: 'sphere', radius: 0.035 }], held: [[0, 0, 0, 0.035]], mass: 0.4, friction: 0.9, material: 'steel' };
  for (const type of ['testCyl', 'testBall']) {
    const r = g.autoTest({ ...base, id: 9002, name: 'проверка: ' + type, bar: undefined, loot: [{ type, pos: [0, 0.05, 0] }] }, 60);
    out[type] = { result: r.result, time: r.time };
  }
  delete LOOT.testCyl; delete LOOT.testBall;
  g.toMenu();
  return out;
});
check(loot.two.result === 'won' && loot.two.done === 2, `два слитка на уровне: ${loot.two.result}, донесено ${loot.two.done} из ${loot.two.need}, ${loot.two.time} с`);
check(loot.testCyl.result === 'won', `предмет-цилиндр берётся и доносится: ${loot.testCyl.result}, ${loot.testCyl.time} с`);
check(loot.testBall.result === 'won', `предмет-шар берётся и доносится: ${loot.testBall.result}, ${loot.testBall.time} с`);

// --- физика: рука не проходит сквозь стекло, ловушка для обезьян держит, стекло бьётся
const phys = await page.evaluate(() => {
  const g = window.__gg, S = 1 / 120, out = {};
  const run = (s, fn) => { for (let i = 0; i < s * 120 && g.state === 'playing'; i++) { if (fn) fn(); g._fixedStep(S); } };
  // рука давит на верхнюю стенку уровня 2 сверху на максимальной скорости
  g.startLevelById(2);
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
  g.startLevelById(3);
  const bar = g.items[0], b = bar.position().clone(), yG = b.y + 0.0225 + 0.022, V = h.target.constructor;
  const go = (x, y, z, sec, sp = 0.5) => { const d = new V(x, y, z); run(sec, () => { const c = h.target, dd = c.distanceTo(d); if (dd > sp * S) c.lerp(d, sp * S / dd); else c.copy(d); }); };
  go(b.x, yG + 0.012, b.z + 0.5, 1.5); go(b.x, yG + 0.012, b.z, 2); go(b.x, yG - 0.01, b.z, 0.5, 0.2);
  h.setGrip(true); run(0.5);
  const held = h.holding;
  go(b.x, yG + 0.03, b.z, 0.6, 0.2); go(b.x, yG + 0.03, b.z + 0.6, 4, 0.4);
  out.monkey = { held, barZ: +bar.position().z.toFixed(3), wallZ: g.level.box.pos[1] + g.level.box.size[2] / 2, state: g.state };
  // слиток летит внутри коробки и не пролетает сквозь дно/стенки
  g.startLevelById(1);
  const flying = g.items[0];
  flying.body.position.y += 0.15; flying.body.velocity.set(2.5, -1, 1.5);
  run(2);
  out.drop = { inside: g.box.contains(flying.position()), y: +flying.position().y.toFixed(3) };
  g.toMenu();
  return out;
});
check(phys.wall.lowest > phys.wall.glassTop - 0.004, `рука не прошла сквозь стекло (низ руки ${phys.wall.lowest} м, верх стекла ${phys.wall.glassTop.toFixed(3)} м, касаний ${phys.wall.touches})`);
check(phys.broken.broken && /Стекло/.test(phys.broken.result || ''), `стекло разбивается от сильных ударов (${phys.broken.result})`);
check(phys.monkey.held && phys.monkey.barZ < phys.monkey.wallZ, `ловушка для обезьян: слиток поперёк не вышел (z = ${phys.monkey.barZ}, стенка ${phys.monkey.wallZ.toFixed(2)})`);
check(phys.drop.inside && phys.drop.y > 0.9, `брошенный слиток остался внутри коробки (y = ${phys.drop.y})`);

// --- нагрузка на отрисовку. Время кадра на этой видеокарте скачет на десятки процентов само по себе
// (режимы питания), поэтому каждый уровень сравнивается с уровнем 1 «вперемежку»: уровень, эталон, уровень,
// эталон… — и берётся лучшее время каждого. Плюс точные числа без шума: вызовы отрисовки и треугольники.
const perf = await page.evaluate(async () => {
  const g = window.__gg, H = await import('/src/heists.js'), gl = g.stage.renderer.getContext(), px = new Uint8Array(4), out = [];
  const time = (n = 40) => { const a = performance.now(); for (let i = 0; i < n; i++) g.stage.render(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return (performance.now() - a) / n; };
  const load = (id, seconds) => {
    g.runAuto(id); g.timeScale = 0;
    for (let k = 0; k < seconds * 120 && g.state === 'playing'; k++) g._fixedStep(1 / 120);
    g.hand.updateVisual(0); for (const it of g.items) if (!it.banked) it.sync();
    for (const tr of g.traps) tr.update(0);
    g.stage.update(0.016, 0, g.hand.pos, 0);
  };
  g.stage.renderer.info.autoReset = false;
  load(1, 0.5); time(60);                               // прогрев
  for (const e of H.campaignOrder()) {
    let calls = 0, tris = 0;
    const pairs = [];
    for (let round = 0; round < 7; round++) {
      load(e.level.id, round ? 0.3 : 2.5);
      if (!round) { g.stage.renderer.info.reset(); g.stage.render(); calls = g.stage.renderer.info.render.calls; tris = g.stage.renderer.info.render.triangles; }
      time(8); const ms = Math.min(time(), time());
      load(1, 0.3);
      time(8); pairs.push({ ms, ref: Math.min(time(), time()) });
    }
    // медиана отношений по парам «уровень — эталон»: скачок режима видеокарты портит одну-две пары, но не медиану
    pairs.sort((a, b) => a.ms / a.ref - b.ms / b.ref);
    out.push({ id: e.level.id, name: e.level.name, calls, tris, ms: pairs[3].ms, ref: pairs[3].ref });
  }
  g.stage.renderer.info.autoReset = true; g.timeScale = 1; g.toMenu();
  return out;
});
// Пределы: самый тяжёлый уровень MVP — время кадра ×1.02 к уровню 1, 92 вызова, 81 тыс. треугольников.
// Время кадра — главный критерий: не хуже чем на 15 % (плюс 5 % на остаточный шум); вызовы и треугольники — ориентир.
const PERF_LIMIT = { calls: 140, tris: 130000, ratio: 1.2 };
for (const p of perf) {
  const ratio = p.ms / p.ref;
  check(p.calls <= PERF_LIMIT.calls && p.tris <= PERF_LIMIT.tris && ratio <= PERF_LIMIT.ratio, `отрисовка, уровень ${p.id} «${p.name}»: вызовов ${p.calls}, треугольников ${(p.tris / 1000).toFixed(0)} тыс., кадр ${p.ms.toFixed(2)} мс (×${ratio.toFixed(2)} к уровню 1)`);
}

// --- грубая защита от катастрофы: счётчик кадров (в браузере без окна он очень шумный, решения по нему не принимаем)
await page.evaluate(() => { window.__gg.startLevelById(1); });
await page.waitForTimeout(1500);
const fps = await page.evaluate(() => new Promise((res) => {
  let n = 0; const t0 = performance.now();
  const tick = (t) => { n++; if (t - t0 < 5000) requestAnimationFrame(tick); else res({ fps: n / ((t - t0) / 1000), pixelRatio: window.__gg.stage.pixelRatio }); };
  requestAnimationFrame(tick);
}));
console.log(`  инфо счётчик кадров на уровне 1: ${fps.fps.toFixed(0)} кадров/с (pixelRatio ${fps.pixelRatio}, 1280×720) — шумный, не критерий`);
await shot('level1_start');

check(errors.length === 0, `консоль без ошибок${errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''}`);
await browser.close(); server.close();
console.log(failed ? `\nПровалено проверок: ${failed}` : '\nВсе проверки пройдены');
process.exit(failed ? 1 : 0);
