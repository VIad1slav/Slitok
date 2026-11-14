// Автопроверка игры в настоящем Chromium (Playwright + установленный Chrome/Edge):
//   node tools/test/play.mjs            — все проверки (список ниже)
//   node tools/test/play.mjs --shots    — то же + скриншоты в docs/screens/
// Свой статический сервер поднимается на случайном порту, отдельно запускать ничего не нужно.
//
// Что проверяется:
//   1. ассеты из Blender загружены, консоль без ошибок; игра работает без интернета:
//      весь прогон идёт с заблокированной сетью — любой запрос не к своему серверу обрывается и считается ошибкой;
//   2. старое сохранение (до кампании) читается без потерь; замки ограблений считаются по звёздам;
//      язык: по умолчанию — язык системы, переключается на ходу, английский текст не вылезает за кнопки;
//   3. автопилот проходит все уровни кампании; время не ушло от эталона (BASELINE) больше чем на 10 %;
//   4. общая модель добычи: уровень с двумя слитками, предметы-цилиндр и шар;
//   5. физика: рука не проходит сквозь стекло, стекло бьётся, ловушка для обезьян держит;
//   6. рука читается в кадре: пальцы отличаются от фона во всех пяти обстановках и в темноте;
//   7. достижения: правила выдачи и то, что игра сама сообщает о событиях;
//   8. HUD: на пяти разрешениях и двух языках индикатор захвата не пересекается с подсказкой, элементы HUD
//      не наезжают друг на друга и не выходят за край экрана;
//   9. настройки: качество графики, предел кадров, инверсия, чувствительность, громкость — применяются и сохраняются;
//   10. металлы слитка: золото не изменилось, на платине, серебре и бронзе автопилот проходит все уровни;
//   11. предел досягаемости от плеча и усталость руки: шкала тратится и восстанавливается, дрожь, слабый хват,
//       рука разжимается на 100 %; с выключенной настройкой шкалы нет;
//   12. нагрузка на отрисовку по уровням (вызовы, треугольники, время кадра относительно уровня 1).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHOTS = process.argv.includes('--shots');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.json': 'application/json' };

// Эталон: время автопилота (с) по id уровня. Симуляция детерминирована, поэтому расхождение значит,
// что изменилась физика, уровень или сценарий автопилота. Меняя что-то из этого намеренно — обнови число.
const BASELINE = {   // 2026-11-12: все уровни начинаются в общей позе HAND_START, автопилот сначала разворачивает руку
  1: 7.41, 2: 6.51, 3: 51.12, 4: 8.1, 5: 9.37, 6: 10.33, 7: 8.21, 8: 11.29,
  9: 8.03, 10: 7.06, 11: 54.78, 12: 7.65, 13: 9.8, 14: 7.52, 15: 10.03, 16: 12.21, 17: 14.37, 18: 12.61,
  19: 24.48, 20: 8.88, 21: 12.45, 22: 14.97, 23: 7.6, 24: 28.02, 25: 29.92, 26: 30.71,
  27: 33.27, 28: 6.51, 29: 30.82, 30: 10.86, 31: 35.28, 32: 27.11,
  33: 6.93, 34: 14.95, 35: 12.89, 36: 29.52, 37: 14.97, 38: 18.71, 39: 80.68, 40: 78.22,
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
const base = `http://127.0.0.1:${server.address().port}/`;
const url = base + '?dev=1';   // режим разработки: без него игра не выставляет отладочный window.__gg

let browser;
for (const channel of ['chrome', 'msedge']) {
  try {
    browser = await chromium.launch({ channel, headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
    break;
  } catch { /* пробуем следующий браузер */ }
}
if (!browser) { console.error('Не найден Chrome или Edge'); process.exit(2); }
// Язык системы — русский: проверки ниже сверяют русские причины провала, а заодно это проверка выбора языка по умолчанию.
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, locale: 'ru-RU' });
const errors = [];
// Сеть заблокирована: игра обязана грузиться только со своего сервера (библиотеки лежат в vendor/).
const external = [];
const offline = (somePage) => somePage.route((u) => !String(u).startsWith(base) && !/^(data|blob):/.test(String(u)), (route) => { external.push(route.request().url()); route.abort(); });
await offline(page);
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
const sleeveInfo = await page.evaluate(() => { const h = window.__gg.hand, f = h.rig.sleeve?.sleeve; return { glb: h.usedSleeveGlb, bone: f?.parent?.name, tex: !!f?.material?.map, upper: h.upper?.name, bones: Object.keys(h.rig.bones).length }; });
check(sleeveInfo.glb && sleeveInfo.bone === 'forearm' && sleeveInfo.tex && sleeveInfo.upper === 'sleeve_upper' && sleeveInfo.bones === 17, `рукав куртки взят из hand.glb: предплечье на кости ${sleeveInfo.bone}, ткань с текстурой, часть выше локтя — ${sleeveInfo.upper}; костей в скелете по-прежнему ${sleeveInfo.bones}`);
check(info.report.pngTextures.length === 0, `все текстуры взяты из WebP${info.report.pngTextures.length ? ', кроме: ' + info.report.pngTextures.join(', ') : ''}`);

// --- сохранение и замки
const sv = await page.evaluate(async () => {
  const g = window.__gg, H = await import('/src/heists.js'), I = await import('/src/i18n/index.js');
  return {
    lang: g.settings.lang, shown: I.getLang(), stored: { save: JSON.parse(localStorage.getItem('goldenGrab.v1')), settings: JSON.parse(localStorage.getItem('goldenGrab.settings.v1')) }, title: document.querySelector('.screen[data-name=menu] .btn.primary').textContent,
    version: g.save.version, best: g.save.best, skin: g.save.skin, volume: g.settings.volume, handSkin: g.hand.skin,
    stars: H.totalStars(g.save), open: H.HEISTS.map((h) => H.isHeistUnlocked(h, g.save)), thresholds: H.HEISTS.map((h) => h.unlockStars),
    next: H.continueLevel(g.save).id,
  };
});
check(sv.version === 6 && JSON.stringify(sv.best) === JSON.stringify(OLD_SAVE.best) && sv.skin === 'glove' && sv.handSkin === 'glove' && sv.volume === 0.4,
  `старое сохранение прочитано без потерь (версия ${sv.version}, рекордов ${Object.keys(sv.best).length}, рука «${sv.skin}», громкость ${sv.volume})`);
check(sv.stored.save?.version === 6 && JSON.stringify(sv.stored.save.best) === JSON.stringify(OLD_SAVE.best) && sv.stored.save.volume === undefined && sv.stored.settings?.volume === 0.4,
  `старое сохранение сразу переписано в новом виде: прогресс отдельно, настройки отдельно (громкость ${sv.stored.settings?.volume})`);
check(sv.lang === null && sv.shown === 'ru' && sv.title === 'Играть', `язык по умолчанию взят из системы (ru-RU → «${sv.shown}», кнопка «${sv.title}»), в старом сохранении язык не задан`);
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

// --- испорченное сохранение не роняет игру: мусор отбрасывается, годное остаётся
const junk = await page.evaluate(async () => {
  const S = await import('/src/save.js');
  // сохранение версии 5 (до металлов): всё на месте, металл — золото; неизвестный металл тоже становится золотом
  const v5 = S.migrateSave({ version: 5, best: { 1: { stars: 3, time: 6.5, touches: 0 }, 40: { stars: 1, time: 300, touches: 9 } }, skin: 'glove_red', accessory: 'ring', achievements: { SPEEDRUN: true }, stats: { glassBroken: 4 } });
  const v6 = S.migrateSave({ version: 6, best: {}, metal: 'silver' }), odd = S.migrateSave({ version: 6, best: {}, metal: 'unobtainium' });
  const a = S.migrateSave({ best: { 1: { stars: 3, time: 5 }, 2: 'мусор', 3: { stars: 'x' }, 7: { stars: 9, time: 20, touches: 1 } }, skin: 'ring', accessory: 'нет такого' });
  const b = S.migrateSave('строка вместо объекта'), c = S.migrateSettings({ volume: 'громко', lang: 'xx', noFlicker: 1 }), d = S.migrateSettings(null, null);
  return { a, b, c, d, v5, v6: v6.metal, odd: odd.metal };
});
check(junk.v5.version === 6 && junk.v5.metal === 'gold' && junk.v5.best[40]?.time === 300 && junk.v5.best[1]?.stars === 3 && junk.v5.skin === 'glove_red' && junk.v5.accessory === 'ring' && junk.v5.achievements.SPEEDRUN === true && junk.v5.stats.glassBroken === 4 && junk.v6 === 'silver' && junk.odd === 'gold',
  `сохранение версии 5 читается без потерь: рекорды (${Object.keys(junk.v5.best).length}), рука «${junk.v5.skin}», украшение «${junk.v5.accessory}», достижения и счётчики на месте, металл — ${junk.v5.metal}; неизвестный металл → ${junk.odd}`);
check(Object.keys(junk.a.best).join() === '1,7' && junk.a.best[7].stars === 3 && junk.a.skin === 'skin' && junk.a.accessory === null && Object.keys(junk.b.best).length === 0 && junk.c.volume === 0.7 && junk.c.lang === null && junk.c.noFlicker === false && junk.d.volume === 0.7,
  `испорченные поля сохранения отбрасываются, годные рекорды остаются (${Object.keys(junk.a.best).join(', ')}), настройки с мусором → значения по умолчанию`);

// --- язык: переключение на ходу, выбор хранится в сохранении, текст не вылезает за кнопки и карточки
// Экраны показываются по очереди на обоих языках; у каждой кнопки, карточки и подписи сверяется,
// что содержимое не шире самого элемента (scrollWidth > clientWidth значит «текст обрезан или вылез»).
const overflow = () => page.evaluate(async () => {
  const g = window.__gg, bad = [];
  const scan = (screen) => {
    for (const e of document.querySelectorAll('.screen:not([hidden]) .btn, .screen:not([hidden]) .lvlcard, .screen:not([hidden]) .lvlcard .name, .screen:not([hidden]) .heisthead > span, .screen:not([hidden]) .card, .screen:not([hidden]) kbd, .screen:not([hidden]) .setlabel, .hud .tl, .hud .hint'))
      if (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1) bad.push(`${screen}: «${e.textContent.trim().slice(0, 30)}» (${e.scrollWidth}×${e.scrollHeight} в ${e.clientWidth}×${e.clientHeight})`);
    const r = document.querySelector('.screen:not([hidden]) .card')?.getBoundingClientRect();
    if (r && (r.left < 0 || r.right > innerWidth || r.top < 0 || r.bottom > innerHeight)) bad.push(`${screen}: карточка не помещается в окно`);
  };
  for (const name of ['menu', 'levels', 'controls', 'settings']) { g.ui.show(name); scan(name); }
  g.startLevelById(39); scan('уровень 39'); g.pause(); scan('пауза');
  g.resume(); g.fail('x'); g.endTimer = 0; g.endAction?.(); g.endAction = null; scan('поражение');
  g.startLevelById(40); g.state = 'playing';
  g.ui.showWin({ level: g.level, place: (await import('/src/heists.js')).placeOf(40), time: 754.2, touches: 12, starsCount: 1, best: { time: 754.2 }, next: { locked: true, heist: (await import('/src/heists.js')).HEISTS[4] }, record: true, stars: 61 }); scan('победа');
  g.toMenu();
  return bad;
});
const setLang = (lang) => page.evaluate((l) => window.__gg.setLanguage(l), lang);
await setLang('en');
const en = await page.evaluate(async () => {
  const g = window.__gg, I = await import('/src/i18n/index.js'), H = await import('/src/heists.js');
  const cyr = [...document.querySelectorAll('#ui *')].filter((e) => !e.children.length && /[\u0400-\u04FF]/.test(e.textContent)).map((e) => e.textContent.trim()).filter((x) => x !== 'Русский');
  return { play: document.querySelector('.screen[data-name=menu] .btn.primary').textContent, saved: await new Promise((r) => setTimeout(() => r(JSON.parse(localStorage.getItem('goldenGrab.settings.v1')).lang), 400)), htmlLang: document.documentElement.lang,
    level: I.levelName(H.levelById(3)), heist: I.heistName(H.HEISTS[0]), cyr, best: Object.keys(g.save.best).length };
});
check(en.play === 'Play' && en.saved === 'en' && en.htmlLang === 'en' && en.level === 'Monkey Trap' && en.best === 3, `переключение на английский: кнопка «${en.play}», уровень 3 — «${en.level}», выбор записан в сохранение, рекорды на месте (${en.best})`);
check(en.cyr.length === 0, `в английском интерфейсе не осталось русского текста${en.cyr.length ? ': ' + en.cyr.slice(0, 5).join(' | ') : ''}`);
const overEn = await overflow();
check(overEn.length === 0, `английский текст помещается в кнопки и карточки${overEn.length ? ': ' + overEn.slice(0, 6).join(' | ') : ''}`);
if (SHOTS) {
  await shot('menu_en');
  await page.evaluate(() => window.__gg.ui.show('levels')); await shot('heists_en');
  await page.evaluate(() => window.__gg.ui.show('controls')); await shot('controls_en');
  await page.evaluate(() => window.__gg.ui.show('settings')); await shot('settings_en');
  await freeze(3, 7.0); await shot('level_03_en');
  await page.evaluate(() => window.__gg.toMenu());
}
await setLang('ru');
const overRu = await overflow();
check(overRu.length === 0, `русский текст помещается в кнопки и карточки${overRu.length ? ': ' + overRu.slice(0, 6).join(' | ') : ''}`);
// язык системы не русский → английский
{
  const p2 = await browser.newPage({ viewport: { width: 1280, height: 720 }, locale: 'de-DE' });
  await offline(p2);
  await p2.goto(url);
  await p2.waitForFunction(() => window.__gg && window.__gg.state === 'menu', null, { timeout: 60000 });
  const picked = await p2.evaluate(() => ({ auto: window.__gg.qualityPicked, now: window.__gg.settings.quality }));
  check(['low', 'medium', 'high'].includes(picked.auto) && picked.now === picked.auto, `первый запуск: качество графики подобрано по скорости видеокарты — «${picked.auto}»`);
  const d = await p2.evaluate(() => ({ play: document.querySelector('.screen[data-name=menu] .btn.primary').textContent, skin: window.__gg.save.skin, lang: window.__gg.settings.lang }));
  check(d.play === 'Play' && d.lang === null, `новый игрок с нерусской системой (de-DE) видит английский: кнопка «${d.play}»`);
  check(d.skin === 'skin', `у нового игрока рука по умолчанию — светлая кожа («${d.skin}»)`);
  await p2.close();
}

// экран загрузки: одна текстура нарочно приходит с задержкой — меню не должно появиться раньше неё
{
  const p3 = await browser.newPage({ viewport: { width: 1280, height: 720 }, locale: 'ru-RU' });
  await offline(p3);
  let release; const held = new Promise((r) => { release = r; });
  await p3.route('**/gold_albedo.webp', async (route) => { await held; route.continue(); });
  await p3.goto(url, { waitUntil: 'domcontentloaded' });
  await p3.waitForFunction(() => window.__gg?.ui?.loadP > 0.3, null, { timeout: 60000 });
  await p3.waitForTimeout(600);
  const mid = await p3.evaluate(() => ({ state: window.__gg.state, p: window.__gg.ui.loadP, loading: !window.__gg.ui.screens.loading.hidden, menu: !window.__gg.ui.screens.menu.hidden, pct: window.__gg.ui.loadPct.textContent, title: document.querySelector('.screen[data-name=loading] .title').textContent }));
  if (SHOTS) { mkdirSync(join(ROOT, 'docs', 'screens'), { recursive: true }); await p3.screenshot({ path: join(ROOT, 'docs', 'screens', 'loading.png') }); console.log('  скриншот loading'); }
  release();
  await p3.waitForFunction(() => window.__gg.state === 'menu', null, { timeout: 60000 });
  const end = await p3.evaluate(() => ({ p: window.__gg.ui.loadP, menu: !window.__gg.ui.screens.menu.hidden }));
  check(mid.state === 'loading' && mid.loading && !mid.menu && mid.p > 0.3 && mid.p < 0.9 && mid.title === 'GOLDEN GRAB' && end.p === 1 && end.menu,
    `экран загрузки: пока не пришла последняя текстура, виден он (${mid.pct}, название «${mid.title}»), меню скрыто; после загрузки — меню`);
  await p3.close();
}

if (SHOTS) {
  await shot('menu');
  await page.evaluate(() => window.__gg.ui.show('levels'));
  await shot('heists');
  await page.evaluate(() => window.__gg.ui.show('settings'));
  await shot('settings');
  await page.evaluate(() => window.__gg.ui.show('menu'));
}

// --- автопилот проходит все уровни кампании
const results = await page.evaluate(async () => {
  const g = window.__gg, H = await import('/src/heists.js'), I = await import('/src/i18n/index.js');
  g.timeScale = 1;
  return H.campaignOrder().map((e) => ({ ...g.autoTest(e.level.id, 400), heist: I.heistName(e.heist), number: e.number, name: I.levelName(e.level) }));
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
  g.startLevelById(12); g.hand.place(g.level.approach);
  const vase = g.items[0];
  run(0.5);
  out.calm = { cracks: vase.cracks, broken: vase.broken };          // просто стоит — цела
  vase.body.position.y += 0.25; run(1.5);
  out.drop = { broken: vase.broken, result: g.result };
  // лёгкий стук (опускание с 4 см) — трещина, но не вдребезги
  g.startLevelById(12); g.hand.place(g.level.approach);
  const v2 = g.items[0];
  run(0.5); v2.body.position.y += 0.04; run(1.0);
  out.tap = { cracks: v2.cracks, broken: v2.broken, state: g.state };
  // камера: двигаем руку, пока она смотрит
  g.startLevelById(13); g.hand.place(g.level.approach);
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
  g.startLevelById(21); g.hand.place(g.level.approach);
  const sh = g.traps.find((t) => t.def.type === 'shutter'), h = g.hand, hole = { x: 0.09, y: 1.02, z: -0.1 };
  run(2.5, () => h.target.set(hole.x + 0.02, hole.y, hole.z));
  for (let i = 0; i < 12 * 120 && g.state === 'playing' && sh.state !== 'closed'; i++) g._fixedStep(S);
  run(0.6);
  out.shutter = { k: +sh.k.toFixed(2), alarm: !!g.alarmState, alarmText: g.alarmState?.text, handX: +h.pos.x.toFixed(3) };
  // закрытая заслонка не пускает руку внутрь
  g.startLevelById(21); g.hand.place(g.level.approach);
  const sh2 = g.traps.find((t) => t.def.type === 'shutter');
  for (let i = 0; i < 12 * 120 && g.state === 'playing' && !(sh2.state === 'closed' && sh2.k > 0.99); i++) g._fixedStep(S);
  run(1.2, () => h.target.set(-0.2, hole.y, hole.z));
  out.closed = { handX: +h.pos.x.toFixed(3), wallX: 0.09, alarm: !!g.alarmState };
  // весы: слиток унесён без груза — тревога
  g.startLevelById(22); g.hand.place(g.level.approach);
  const bar = g.items[0];
  run(1.0);
  out.scaleCalm = !g.alarmState;
  bar.body.position.set(0.3, 1.0, 0.3); bar.body.velocity.set(0, 0, 0);
  run(1.0);
  out.scale = { alarm: !!g.alarmState, text: g.alarmState?.text };
  // перегородка: рука идёт горизонтально сквозь барьер уровня 20 — должна упереться
  // перегородка: рука ныряет прямо в барьер уровня 20 (он на z = -0.02, высотой до y = 1.0) — пройти сквозь него нельзя
  g.startLevelById(20); g.hand.place(g.level.approach);
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

// --- казино: темнота, бриллиант, украшения руки
const casino = await page.evaluate(async () => {
  const g = window.__gg, S = 1 / 120, out = {}, C = await import('/src/cosmetics.js');
  const run = (s, fn) => { for (let i = 0; i < s * 120 && g.state === 'playing'; i++) { if (fn) fn(); g._fixedStep(S); } };
  const settle = () => { for (let i = 0; i < 40; i++) { for (const t of g.traps) t.update(0); g.stage.update(0.016, 0, g.hand.pos, 0); } };
  // темнота: гаснут свет и отражения окружения (иначе золото и стекло видны как днём); уровень не проваливается
  g.startLevelById(28); g.hand.place(g.level.approach);
  const bo = g.traps.find((t) => t.def.type === 'blackout');
  settle(); const litSpot = g.stage.spot.intensity;
  for (let i = 0; i < 12 * 120 && bo.state !== 'dark'; i++) g._fixedStep(S);
  settle();
  const envK = () => { const m = g.items[0].material; return +(m.envMapIntensity / (m.userData.envBase ?? m.envMapIntensity)).toFixed(2); };   // у предмета своя копия материала
  out.dark = { spot: +g.stage.spot.intensity.toFixed(2), litSpot: +litSpot.toFixed(1), env: envK(), lights: g.stage.scene.children.filter((o) => o.isPointLight).length, state: g.state };
  // предупреждение: с миганием яркость скачет, в «плавном» режиме — только убывает
  const warnValues = (noFlicker) => { g.settings.noFlicker = noFlicker; g.startLevelById(28); g.hand.place(g.level.approach); const b = g.traps.find((t) => t.def.type === 'blackout'), v = []; for (let i = 0; i < 12 * 120 && b.state !== 'dark'; i++) { g._fixedStep(S); if (b.state === 'warn') v.push(b.k); } return v; };
  const jumps = (v) => v.filter((x, i) => i && x < v[i - 1] - 0.2).length;
  out.flicker = { on: jumps(warnValues(false)), smooth: jumps(warnValues(true)) };
  g.settings.noFlicker = false;
  g.startLevelById(1); g.hand.place(g.level.approach); settle();
  out.lightOff = { env: envK(), spot: +g.stage.spot.intensity.toFixed(1) };
  // бриллиант: выскальзывает на скорости, которую слиток выдерживает, и выпадает от удара о стекло
  g.startLevelById(30); g.hand.place(g.level.approach);
  const h = g.hand, d = g.items[0];
  const grab = () => { const p = d.position(); run(2.5, () => h.target.set(p.x + 0.3, p.y + 0.045, p.z)); run(1.5, () => h.target.set(p.x, p.y + 0.045, p.z)); run(0.5, () => h.target.set(p.x, p.y + 0.02, p.z)); h.setGrip(true); run(0.5); return h.holding; };
  out.diamond = { held: grab() };
  run(0.6, () => h.target.set(h.pos.x + 0.11, h.pos.y, h.pos.z));          // рывок наружу
  out.diamond.slipped = !h.holding; out.diamond.state = g.state;
  // украшения: кольцо висит на кости пальца, часы — на предплечье; обычная рука не перекрашивает украшение
  h.setAccessory(C.cosmeticById('ring'), g.models);
  out.ring = { bone: h.accessory?.parent?.name, glb: !!g.models.ring };
  h.setAccessory(C.cosmeticById('watch'), g.models);
  out.watch = { bone: h.accessory?.parent?.name };
  h.setSkin(C.cosmeticById('glove'));
  let recolored = 0; h.accessory.traverse((o) => { if (o.isMesh && o.material === g.M.glove) recolored++; });
  out.watch.recolored = recolored;
  h.setAccessory(null); h.setSkin(C.cosmeticById(g.save.skin));
  out.unlock = { at10: C.unlockedCosmetics('hand', 10).map((c) => c.id), at48: C.unlockedCosmetics('accessory', 48).map((c) => c.id) };
  g.toMenu();
  return out;
});
check(casino.dark.spot < casino.dark.litSpot * 0.05 && casino.dark.env < 0.1 && casino.dark.state === 'playing', `темнота: прожектор ${casino.dark.litSpot} → ${casino.dark.spot}, отражения на золоте ×${casino.dark.env}, точечных ламп в сцене ${casino.dark.lights}, уровень продолжается`);
check(casino.flicker.on >= 1 && casino.flicker.smooth === 0, `мигание перед темнотой: обычный режим — скачков яркости ${casino.flicker.on}, «плавный» — ${casino.flicker.smooth}`);
check(casino.lightOff.env === 1 && casino.lightOff.spot > 5, `после уровня с темнотой свет и отражения вернулись (отражения ×${casino.lightOff.env})`);
check(casino.diamond.held && casino.diamond.slipped && casino.diamond.state === 'playing', `бриллиант: взят ${casino.diamond.held ? 'да' : 'нет'}, от рывка выскользнул ${casino.diamond.slipped ? 'да' : 'нет'}`);
check(casino.ring.bone === 'ring_01' && casino.watch.bone === 'forearm' && casino.watch.recolored === 0 && casino.ring.glb, `украшения: кольцо на кости ${casino.ring.bone}, часы на ${casino.watch.bone}, смена руки их не перекрашивает`);
check(casino.unlock.at10.join() === 'skin,glove,glove_red' && casino.unlock.at48.join() === 'ring,watch', `косметика по звёздам: при 10 — ${casino.unlock.at10.join(', ')}; украшения при 48 — ${casino.unlock.at48.join(', ')}`);

// --- сейф босса: этапы финала, пятно камеры, большой слиток
const boss = await page.evaluate(() => {
  const g = window.__gg, S = 1 / 120, out = {};
  const run = (s, fn) => { for (let i = 0; i < s * 120 && g.state === 'playing'; i++) { if (fn) fn(); g._fixedStep(S); } };
  // финал: автопилот доходит до этапа 2, там провал; «Ещё раз» должно вернуть на этап 2 с тем же временем
  g.startLevelById(40); g.hand.place(g.level.approach); g.autopilot = null;
  g.runAuto(40); g.timeScale = 0;
  for (let i = 0; i < 120 * 120 && g.state === 'playing' && g.stageIndex === 0; i++) g._fixedStep(S);
  out.stage2 = { index: g.stageIndex, label: g.level.stage + '/' + g.level.stageCount, glass: g.box.usedGlb, time: +g.time.toFixed(1) };
  g.autopilot = null; g.fail('проверка'); const t = g.time, touches = g.touches;
  g.restartLevel();
  out.restart = { index: g.stageIndex, time: +g.time.toFixed(1), kept: Math.abs(g.time - t) < 0.01 && g.touches === touches, state: g.state };
  // на первом этапе «Ещё раз» начинает уровень с нуля
  g.startLevelById(40); g.hand.place(g.level.approach); run(1.0); g.fail('проверка'); g.restartLevel();
  out.restart0 = { index: g.stageIndex, time: +g.time.toFixed(1) };
  // пятно камеры (уровень 39): рука вне пятна двигается свободно, в пятне — тревога
  g.startLevelById(39); g.hand.place(g.level.approach);
  const cam = g.traps.find((t2) => t2.def.type === 'camera'), h = g.hand;
  const follow = (dx) => run(4.0, () => h.target.set(cam.zone.c.x + dx, 1.32, cam.zone.c.z + 0.02 * Math.sin(g.time * 9)));   // над коробкой: пятно считается по горизонтали
  follow(0.3);                                           // держимся в 30 см от центра пятна и шевелимся
  out.zoneOut = { meter: +cam.meter.toFixed(2), alarm: !!g.alarmState };
  follow(0.0);                                           // едем вместе с пятном, в его центре
  out.zoneIn = { result: g.result, alarm: !!g.alarmState };
  // большой слиток (уровень 33) выскальзывает на скорости, которую обычный слиток держит
  g.startLevelById(33); g.hand.place(g.level.approach);
  const bar = g.items[0], p = bar.position().clone();
  run(2.0, () => h.target.set(p.x + 0.4, p.y + 0.06, p.z)); run(1.5, () => h.target.set(p.x, p.y + 0.06, p.z)); run(0.5, () => h.target.set(p.x, p.y + 0.03, p.z));
  h.setGrip(true); run(0.5);
  out.big = { held: h.holding, slipSpeed: h.slipSpeed, size: bar.type.bounds.join('×') };
  run(0.6, () => h.target.set(h.pos.x + 0.11, h.pos.y, h.pos.z));    // рывок наружу, вдоль отверстия
  out.big.slipped = !h.holding;
  g.toMenu();
  return out;
});
check(boss.stage2.index === 1 && boss.stage2.glass, `финал: после первого этапа начался этап ${boss.stage2.label} (на ${boss.stage2.time}-й секунде), стекло этапа из Blender`);
check(boss.restart.index === 1 && boss.restart.kept && boss.restart.state === 'playing', `финал: «Ещё раз» на втором этапе возвращает на этап ${boss.restart.index + 1}, время продолжает идти с ${boss.restart.time} с`);
check(boss.restart0.index === 0 && boss.restart0.time === 0, 'финал: «Ещё раз» на первом этапе начинает уровень заново');
check(boss.zoneOut.meter === 0 && !boss.zoneOut.alarm && /Камера/.test(boss.zoneIn.result || '') , `пятно камеры: вне пятна движение не замечено, в пятне — ${boss.zoneIn.result}`);
check(boss.big.held && boss.big.slipped && boss.big.slipSpeed < 1, `большой слиток ${boss.big.size} м: взят, от рывка выскользнул (порог ${boss.big.slipSpeed} м/с)`);

// --- рука читается в кадре. Кадр рисуется дважды — с рукой и без неё — и в точках, где находятся фаланги пальцев,
// сравнивается цвет. Разница (0..255) показывает, насколько пальцы отличаются от того, что за ними.
// Порог 12 — примерно «различимо глазом»; без подсветки руки (HAND_GLOW) в темноте выходит около нуля.
const handSeen = await page.evaluate(async () => {
  const g = window.__gg, C = await import('/src/cosmetics.js'), SC = await import('/src/scene.js'), S = 1 / 120, out = [];
  const gl = g.stage.renderer.getContext(), px = new Uint8Array(4), v = g.hand.pos.clone();
  const sample = () => {
    g.stage.render();
    const pts = [];
    for (const [name, bone] of Object.entries(g.hand.rig.bones)) {
      if (!/_0[23]$/.test(name)) continue;
      bone.getWorldPosition(v).project(g.stage.camera);
      const x = Math.round((v.x * 0.5 + 0.5) * gl.drawingBufferWidth), y = Math.round((v.y * 0.5 + 0.5) * gl.drawingBufferHeight);
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); pts.push([px[0], px[1], px[2]]);
    }
    return pts;
  };
  const diff = () => {
    const a = sample(); g.hand.group.visible = false; const b = sample(); g.hand.group.visible = true;
    return a.reduce((sum, c, i) => sum + Math.max(Math.abs(c[0] - b[i][0]), Math.abs(c[1] - b[i][1]), Math.abs(c[2] - b[i][2])), 0) / a.length;
  };
  const settle = () => { g.hand.updateVisual(0); for (let i = 0; i < 60; i++) { for (const t of g.traps) t.update(0); g.stage.update(0.016, 0, g.hand.pos, 0); } g.stage.scene.updateMatrixWorld(true); };
  const cases = [[1, false], [12, false], [21, false], [30, false], [33, false], [28, true], [37, true]];
  for (const [id, dark] of cases) for (const skin of ['skin', 'glove']) {
    g.startLevelById(id); g.hand.setSkin(C.cosmeticById(skin));
    if (dark) { const bo = g.traps.find((t) => t.def.type === 'blackout'); for (let i = 0; i < 20 * 120 && bo.state !== 'dark'; i++) g._fixedStep(S); }
    settle();
    const lit = +diff().toFixed(1), keep = { ...SC.HAND_GLOW };
    SC.HAND_GLOW.fill = 0; SC.HAND_GLOW.rim = 0; settle();
    const plain = +diff().toFixed(1);
    Object.assign(SC.HAND_GLOW, keep); settle();
    out.push({ id, dark, skin, lit, plain });
  }
  g.hand.setSkin(C.cosmeticById(g.save.skin)); g.toMenu();
  return out;
});
for (const h of handSeen) check(h.lit >= 12, `рука в кадре, уровень ${h.id}${h.dark ? ' (темнота)' : ''}, ${h.skin === 'skin' ? 'кожа' : 'чёрная перчатка'}: отличие пальцев от фона ${h.lit} из 255 (без подсветки было бы ${h.plain})`);

// --- HUD: ничего не перекрывается и не выходит за экран
// На каждом разрешении и языке включается всё сразу: индикатор захвата, подсказка, тревога с отсчётом, сообщение,
// полоска, счётчик кадров, надпись «кликни». Затем сравниваются рамки (bounding box) всех видимых элементов.
const HUD_SIZES = [[1280, 720], [1366, 768], [1920, 1080], [2560, 1440], [3840, 2160]];
const hudBad = [], hudSeen = { lines: new Set(), scales: new Set(), cases: 0, gaps: [] };
await page.evaluate(() => window.__gg.applySettings({ quality: 'low' }));   // 4K-кадры здесь не важны, важна вёрстка
for (const [w, h] of HUD_SIZES) {
  await page.setViewportSize({ width: w, height: h });
  for (const lang of ['en', 'ru']) {
    const res = await page.evaluate(async ([lang]) => {
      const g = window.__gg, I = await import('/src/i18n/index.js'), { LEVELS } = await import('/src/levels.js'), out = [];
      g.setLanguage(lang);
      const frames = (n) => new Promise((r) => { const tick = () => (n-- > 0 ? requestAnimationFrame(tick) : r()); tick(); });
      const box = (sel) => { const e = document.querySelector(sel); if (!e || e.hidden || !e.getClientRects().length || getComputedStyle(e).display === 'none') return null; const r = e.getBoundingClientRect(); return r.width && r.height ? { sel, l: r.left, t: r.top, r: r.right, b: r.bottom } : null; };
      const hit = (a, b) => a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;
      const noHint = { ...LEVELS.find((l) => l.id === 1), id: 9003, name: 'no hint', hint: '' };
      const longest = Object.keys(I).length && ['trap.cameraWatch', 'toast.cracked', 'trap.darkWarn'].map((k) => I.t(k, { name: I.t('loot.bigbar.name') })).sort((a, b) => b.length - a.length)[0];
      const longHint = { ...LEVELS.find((l) => l.id === 1), id: 9004, name: 'long hint', hint: (I.t('level.36.hint') + ' ' + I.t('level.39.hint')).slice(0, 250) };   // подсказка в три строки
      for (const lvl of [1, 3, 16, 36, 39, 40, noHint, longHint]) {
        if (typeof lvl === 'object') g.startLevelDef(lvl); else g.startLevelById(lvl);
        g.timeScale = 0; g.hand.grabReady = true;
        g.alarm(99, I.t('trap.shutterAlarm')); g.toast(longest); g.hud.meter = { label: I.t('meter.weight'), value: 0.7, mark: 0.5 }; g.ui.setFps(144);
        await frames(3);
        const hintEl = document.querySelector('.hud .hint'), lh = parseFloat(getComputedStyle(hintEl).lineHeight) || 20;
        const lines = hintEl.textContent ? Math.round((hintEl.clientHeight - 18) / lh) : 0;
        const els = ['.hud .tl', '.hud .tr', '.hud .alarm', '.hud .toast', '.hud .grab', '.hud .hint', '.hud .clickme', '.fpsbox'].map(box).filter(Boolean);
        const grab = els.find((e) => e.sel === '.hud .grab'), hint = els.find((e) => e.sel === '.hud .hint');
        const where = `${innerWidth}×${innerHeight} ${lang}, уровень ${typeof lvl === 'object' ? lvl.name : lvl}`;
        const row = { lines, zoom: g.ui.scale, gap: grab && hint ? hint.t - grab.b : null, bad: [] };
        if (!grab || getComputedStyle(document.querySelector('.hud .grab')).opacity === '0') row.bad.push(`${where}: индикатор захвата не виден`);
        for (let i = 0; i < els.length; i++) {
          const a = els[i];
          if (a.l < -0.5 || a.t < -0.5 || a.r > innerWidth + 0.5 || a.b > innerHeight + 0.5) row.bad.push(`${where}: ${a.sel} выходит за край экрана`);
          for (let j = i + 1; j < els.length; j++) if (hit(a, els[j])) row.bad.push(`${where}: ${a.sel} пересекается с ${els[j].sel}`);
        }
        out.push(row);
      }
      g.ui.setFps(null); g.toMenu();
      return out;
    }, [lang]);
    for (const r of res) { hudBad.push(...r.bad); hudSeen.lines.add(r.lines); hudSeen.scales.add(+r.zoom.toFixed(2)); hudSeen.cases++; if (r.gap != null) hudSeen.gaps.push(r.gap); }
  }
}
await page.setViewportSize({ width: 1280, height: 720 });
await page.evaluate(() => { const g = window.__gg; g.setLanguage('ru'); g.applySettings({ quality: 'high' }); g.timeScale = 1; });
check(hudSeen.gaps.length > 0 && Math.min(...hudSeen.gaps) >= 8, `индикатор захвата и подсказка не пересекаются: зазор между ними от ${Math.min(...hudSeen.gaps).toFixed(0)} до ${Math.max(...hudSeen.gaps).toFixed(0)} пикс. (подсказки в ${[...hudSeen.lines].sort().join(', ')} строк; 0 — без подсказки)`);
check(hudBad.length === 0, `HUD на ${HUD_SIZES.map((x) => x.join('×')).join(', ')} и двух языках (${hudSeen.cases} случаев, масштаб интерфейса ×${[...hudSeen.scales].sort().join(' / ×')}): перекрытий и выходов за экран ${hudBad.length}${hudBad.length ? ' — ' + [...new Set(hudBad)].slice(0, 6).join(' | ') : ''}`);

// --- настройки
const set = await page.evaluate(async () => {
  const g = window.__gg, out = {}, S = 1 / 120, canvas = g.stage.renderer.domElement;
  const stored = () => new Promise((r) => setTimeout(() => r(JSON.parse(localStorage.getItem('goldenGrab.settings.v1'))), 400));
  // экран настроек: клик по строке меняет значение
  g.ui.show('settings');
  const rowBtn = (key) => document.querySelector(`.setrow[data-key=${key}] .btn`);
  out.rows = [...document.querySelectorAll('.setrow')].map((r) => r.dataset.key);
  rowBtn('quality').click();                              // high → low (по кругу)
  out.low = { name: g.settings.quality, shadows: g.stage.renderer.shadowMap.enabled, post: g.stage.quality.post, pr: g.stage.pixelRatio, transmission: g.M.glass.transmission, label: rowBtn('quality').textContent };
  g.startLevelById(1); for (let i = 0; i < 60; i++) g._fixedStep(S); g.stage.update(0.016, 0, g.hand.pos, 0); g.stage.render();
  const gl = g.stage.renderer.getContext(), px = new Uint8Array(4); gl.readPixels(gl.drawingBufferWidth >> 1, gl.drawingBufferHeight >> 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  out.low.pixel = px[0] + px[1] + px[2]; out.low.auto = g.autoTest(1, 60).result;
  g.applySettings({ quality: 'medium' });
  out.medium = { shadows: g.stage.spot.shadow.mapSize.x, samples: g.stage.samples, pr: g.stage.pixelRatio, transmission: g.M.glass.transmission };
  g.applySettings({ quality: 'high' });
  out.high = { shadows: g.stage.spot.shadow.mapSize.x, samples: g.stage.samples, transmission: g.M.glass.transmission, post: g.stage.quality.post };
  // инверсия вперёд-назад: колесо двигает цель в другую сторону
  g.startLevelById(1); const z0 = g.hand.target.z;
  canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, cancelable: true })); const dz = g.hand.target.z - z0;
  g.applySettings({ invertDepth: true }); const z1 = g.hand.target.z;
  canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, cancelable: true })); out.invert = { normal: +dz.toFixed(3), inverted: +(g.hand.target.z - z1).toFixed(3) };
  g.applySettings({ invertDepth: false });
  // предел кадров: считаем кадры игры за секунду
  const frames = async (limit) => { g.applySettings({ fpsLimit: limit }); let n = 0; const orig = g.stage.render.bind(g.stage); g.stage.render = () => { n++; orig(); }; await new Promise((r) => setTimeout(r, 300)); n = 0; await new Promise((r) => setTimeout(r, 2000)); g.stage.render = orig; return n / 2; };
  out.fps = { free: await frames(0), at30: await frames(30), at60: await frames(60) };
  g.applySettings({ fpsLimit: 0 });
  // громкость и счётчик кадров
  g.audio.init(); g.applySettings({ volume: 0.2, music: 0.9, showFps: true, sensitivity: 9, quality: 'ultra' });
  await new Promise((r) => setTimeout(r, 1300));
  out.misc = { sfx: g.audio.volume, music: g.audio.music, fpsBox: !g.ui.fpsBox.hidden && /FPS/.test(g.ui.fpsBox.textContent), sensitivity: g.settings.sensitivity, quality: g.settings.quality };
  out.stored = await stored();
  g.applySettings({ volume: 0.4, music: 0.7, showFps: false, sensitivity: 1 });
  g.toMenu();
  return out;
});
check(set.rows.join() === 'lang,quality,fpsLimit,showFps,sensitivity,invertDepth,volume,music,fatigue,noFlicker', `экран настроек: строки ${set.rows.join(', ')} (режим экрана — только в приложении)`);
check(set.low.name === 'low' && set.low.shadows === false && set.low.post === false && set.low.pr === 0.75 && set.low.transmission === 0 && set.low.pixel > 0 && set.low.auto === 'won',
  `качество «${set.low.label}»: теней нет, постобработки нет, стекло простое, разрешение ×${set.low.pr}; кадр не чёрный, уровень 1 проходится`);
check(set.medium.transmission === 0 && set.medium.shadows === 1024 && set.medium.samples === 2 && set.medium.pr === 1 && set.high.shadows === 2048 && set.high.samples === 4 && set.high.transmission === 1 && set.high.post,
  `качество «среднее»: тени ${set.medium.shadows}, сглаживание ×${set.medium.samples}, стекло простое; «высокое»: тени ${set.high.shadows}, сглаживание ×${set.high.samples}, настоящее стекло`);
check(set.invert.normal > 0 && Math.abs(set.invert.inverted + set.invert.normal) < 1e-6, `инверсия вперёд-назад: колесо двигает руку на ${set.invert.normal} м, с инверсией — на ${set.invert.inverted} м`);
check(set.fps.at30 >= 24 && set.fps.at30 <= 33 && set.fps.at60 >= 48 && set.fps.at60 <= 66 && set.fps.free > set.fps.at60, `предел кадров: без предела ${set.fps.free.toFixed(0)}, «не больше 30» — ${set.fps.at30.toFixed(0)}, «не больше 60» — ${set.fps.at60.toFixed(0)} кадров/с`);
check(set.misc.sfx === 0.2 && set.misc.music === 0.9 && set.misc.fpsBox && set.misc.sensitivity === 2.5 && set.misc.quality === 'high', `громкость эффектов ${set.misc.sfx} и фона ${set.misc.music} раздельно, счётчик кадров виден, недопустимые значения отброшены (чувствительность 9 → ${set.misc.sensitivity}, качество «ultra» → ${set.misc.quality})`);
check(set.stored.volume === 0.2 && set.stored.music === 0.9 && set.stored.showFps === true && set.stored.quality === 'high' && set.stored.fpsLimit === 0, 'настройки записаны в хранилище');

// --- достижения
const ach = await page.evaluate(async () => {
  const g = window.__gg, A = await import('/src/achievements.js'), H = await import('/src/heists.js'), out = {};
  // 1) правила на «чистом» игроке
  const save = { best: {}, achievements: {}, stats: {} }, unlocked = [];
  const a = new A.Achievements(save, { onUnlock: (id) => unlocked.push(id) });
  out.empty = a.sync().length;
  out.slow = a.emit('win', { level: 1, time: 25, touches: 3, stars: 1 });
  save.best[3] = { stars: 1, time: 60, touches: 5 }; out.monkey = a.emit('win', { level: 3, time: 60, touches: 5, stars: 1 });
  out.fast = a.emit('win', { level: 2, time: 8.2, touches: 0, stars: 3 });
  out.touched = a.emit('win', { level: 32, time: 40, touches: 1, stars: 2 });
  out.clean = a.emit('win', { level: 32, time: 40, touches: 0, stars: 3 });
  out.vase = a.emit('lootBroken', { type: 'vase' });
  out.glass9 = []; for (let i = 0; i < 9; i++) out.glass9.push(...a.emit('glassBroken'));
  out.glass10 = a.emit('glassBroken');
  for (const id of H.HEISTS[0].levels) save.best[id] = { stars: 2, time: 30, touches: 2 };
  out.heist = a.emit('win', { level: 11, time: 30, touches: 2, stars: 2 });
  for (const id of H.HEISTS[0].levels) save.best[id].stars = 3;
  out.heistStars = a.emit('win', { level: 11, time: 30, touches: 0, stars: 3 });
  for (const h of H.HEISTS) for (const id of h.levels) save.best[id] = { stars: 3, time: 30, touches: 0 };
  out.all = a.emit('win', { level: 40, time: 100, touches: 0, stars: 3 });
  out.again = a.emit('win', { level: 40, time: 100, touches: 0, stars: 3 });
  out.total = Object.keys(save.achievements).length; out.known = A.ACHIEVEMENTS.length; out.calls = unlocked.length; out.unique = new Set(unlocked).size;
  // 2) что игра выдала сама за этот прогон (автопилот прошёл кампанию, проверки разбили вазу и стекло)
  out.game = Object.keys(g.save.achievements).sort(); out.glassBroken = g.save.stats.glassBroken || 0;
  out.stored = Object.keys(JSON.parse(localStorage.getItem('goldenGrab.v1')).achievements || {}).length;
  return out;
});
check(ach.empty === 0 && ach.slow.length === 0 && ach.monkey.join() === 'MONKEY_TRAP' && ach.fast.join() === 'SPEEDRUN' && ach.touched.length === 0 && ach.clean.join() === 'NO_TOUCH' && ach.vase.join() === 'BREAK_VASE',
  `достижения по событиям: «Ловушка для обезьян» → ${ach.monkey}, уровень за 8,2 с → ${ach.fast}, «Джекпот» без касаний → ${ach.clean} (с одним касанием — нет), разбитая ваза → ${ach.vase}`);
check(ach.glass9.length === 0 && ach.glass10.join() === 'GLASS_BREAKER' && ach.heist.join() === 'HEIST_PAWNSHOP' && ach.heistStars.join() === 'STARS_PAWNSHOP',
  `достижения по прогрессу: стекло разбито 10 раз → ${ach.glass10}, Ломбард пройден → ${ach.heist}, все звёзды Ломбарда → ${ach.heistStars}`);
check(ach.total === ach.known && ach.again.length === 0 && ach.calls === ach.unique && ach.calls === ach.known, `все ${ach.known} достижений получаемы, каждое выдаётся один раз (выдано ${ach.calls})`);
check(['ALL_LEVELS', 'BREAK_VASE', 'HEIST_BOSS', 'HEIST_PAWNSHOP', 'MONKEY_TRAP', 'SPEEDRUN'].every((id) => ach.game.includes(id)) && ach.stored === ach.game.length,
  `игра сама выдала за этот прогон ${ach.game.length} достижений (${ach.game.join(', ')}) — всё записано в сохранение`);

// --- металлы слитка
// Золото проверено выше: время автопилота на всех уровнях сверено с эталоном. Здесь — остальные три металла
// (все 40 уровней на каждом) и то, что металл меняет массу, хват, порог весов, вид и названия.
const metals = await page.evaluate(async () => {
  const g = window.__gg, H = await import('/src/heists.js'), MT = await import('/src/metals.js'), I = await import('/src/i18n/index.js'), { LOOT } = await import('/src/loot-types.js'), out = { runs: {}, look: {} };
  const keep = g.save.metal;
  for (const m of MT.METALS) {
    g.save.metal = m.id; I.setTextMetal(m.id);
    // вид, масса и хват: уровень 1 (слиток 1 кг) и уровень 33 (большой слиток 6 кг)
    g.startLevelById(1); const bar = g.items[0];
    g.startLevelById(33); const big = g.items[0];
    g.startLevelById(22); const scale = g.traps.find((t) => t.def.type === 'scale');
    out.look[m.id] = { mass: +bar.body.mass.toFixed(3), bigMass: +big.body.mass.toFixed(2), slip: +(g.hand.levelSlipSpeed * bar.slipScale).toFixed(3), bigSlip: +(Math.min(g.hand.levelSlipSpeed, big.type.slipSpeed) * big.slipScale).toFixed(3),
      scaleMin: +scale.def.min.toFixed(3), barOnScale: +g.items[0].mass.toFixed(3), color: '#' + bar.material.color.getHexString(), map: !!bar.material.map, normal: !!bar.material.normalMap,
      name: I.lootName(LOOT.bar, bar.metal), fall: I.lootFall(LOOT.bigbar, big.metal), other: g.items[1].mass };
    if (m.id === 'gold') continue;       // золото уже прошло всю кампанию выше, с эталоном времени
    const res = H.campaignOrder().map((e) => g.autoTest(e.level.id, 400));
    out.runs[m.id] = { won: res.filter((r) => r.result === 'won').length, total: res.length, failed: res.filter((r) => r.result !== 'won').map((r) => `${r.level}: ${r.result}`), time: +res.reduce((a, r) => a + r.time, 0).toFixed(0) };
  }
  // меню: кнопка «Слиток» перебирает металлы, выбор записывается; текст с {Metal} меняется
  g.save.metal = keep; I.setTextMetal(keep); g.toMenu();
  const btn = () => [...document.querySelectorAll('.screen[data-name=menu] .btn')].find((b) => /^(Слиток|Bar):/.test(b.textContent));
  const labels = [btn().textContent];
  for (let i = 0; i < 4; i++) { btn().click(); labels.push(btn().textContent); if (i === 0) out.afterClick = { saved: JSON.parse(localStorage.getItem('goldenGrab.v1')).metal, line: I.t('fail.lines') === 'fail.lines' ? I.tList('fail.lines').map((x) => x).pop() : '', menuBar: g.items[0].metal?.id, pick: I.tPick('fail.lines') }; }
  out.labels = labels; out.final = g.save.metal;
  return out;
});
const ML = metals.look;
check(ML.gold.mass === 1 && ML.gold.bigMass === 6 && ML.gold.slip === 1.85 && ML.gold.bigSlip === 0.9 && ML.gold.scaleMin === 1.6 && ML.gold.map === true,
  `золото — как раньше: слиток ${ML.gold.mass} кг, большой ${ML.gold.bigMass} кг, выскальзывает на ${ML.gold.slip} и ${ML.gold.bigSlip} м/с, порог весов ${ML.gold.scaleMin} кг, запечённый цвет на месте`);
check(ML.platinum.mass === 1.11 && ML.silver.mass === 0.54 && ML.bronze.mass === 0.46 && ML.platinum.bigSlip < ML.gold.bigSlip && ML.silver.slip > ML.gold.slip && ML.bronze.slip > ML.silver.slip && ['platinum', 'silver', 'bronze'].every((m) => ML[m].other === 2),
  `масса и хват по металлам: платина ${ML.platinum.mass} кг (большой ${ML.platinum.bigMass} кг, порог ${ML.platinum.bigSlip} м/с), серебро ${ML.silver.mass} кг (${ML.silver.slip} м/с), бронза ${ML.bronze.mass} кг (${ML.bronze.slip} м/с); груз для весов не меняется (${ML.silver.other} кг)`);
check(['platinum', 'silver', 'bronze'].every((m) => ML[m].barOnScale >= ML[m].scaleMin && ML[m].scaleMin <= 2),
  `весы: порог веса идёт за металлом (платина ${ML.platinum.scaleMin} кг, серебро ${ML.silver.scaleMin} кг, бронза ${ML.bronze.scaleMin} кг) — слиток на весах тревогу не поднимает, груз 2 кг его заменяет`);
check(new Set(Object.values(ML).map((x) => x.color)).size === 4 && ['platinum', 'silver', 'bronze'].every((m) => !ML[m].map && ML[m].normal),
  `вид: у металлов разные цвета (${Object.entries(ML).map(([k, v]) => `${k} ${v.color}`).join(', ')}), карта нормалей общая с золотом, запечённого золотого цвета у них нет`);
check(ML.silver.name === 'Серебряный слиток' && /платиновый/.test(ML.platinum.fall) && ML.gold.name === 'Золотой слиток',
  `названия зависят от металла: «${ML.gold.name}», «${ML.silver.name}», «${ML.platinum.fall}»`);
for (const [m, r] of Object.entries(metals.runs)) check(r.won === r.total, `автопилот на металле «${m}»: пройдено ${r.won} из ${r.total} уровней, суммарное время ${r.time} с${r.failed.length ? ' — не пройдены: ' + r.failed.join('; ') : ''}`);
check(metals.labels.length === 5 && new Set(metals.labels.slice(0, 4)).size === 4 && metals.labels[4] === metals.labels[0] && metals.afterClick.saved === 'platinum' && metals.afterClick.menuBar === 'platinum' && metals.final === 'gold',
  `меню: кнопка перебирает четыре металла по кругу (${metals.labels.slice(0, 4).join(' → ')}), выбор записан в сохранение, слиток за меню сменился`);

// --- предел досягаемости от плеча и усталость руки
// Проверочный уровень — коробка уровня 8 без карусели, слиток 2 кг, с полями reach и fatigue.
const tired = await page.evaluate(async () => {
  const g = window.__gg, S = 1 / 120, out = {}, { LEVELS } = await import('/src/levels.js');
  const L8 = LEVELS.find((l) => l.id === 8), L7 = LEVELS.find((l) => l.id === 7);
  const base = { ...L8, id: 9010, name: 'проверка: усталость', hint: '', traps: [], timeLimit: undefined, monkey: false, bar: { ...L8.bar, yaw: 90, mass: 2 } };
  const withAll = { ...base, reach: { max: 1.3 }, fatigue: { extend: 0.2, hold: 0.05, recover: 0.25 } };
  const run = (s, fn) => { for (let i = 0; i < s * 120 && g.state === 'playing'; i++) { if (fn) fn(); g._fixedStep(S); } };
  const fat = () => g.traps.find((t) => t.def.type === 'fatigue');
  const dist = () => g.hand.pos.distanceTo(g.hand.shoulder);
  const hole = [-0.1, 1.0, 0.11];                       // центр круглого отверстия в передней стенке
  const enter = (h) => { run(1.5, () => h.target.set(hole[0], hole[1], 0.5)); run(3, () => h.target.set(hole[0], hole[1], -0.4)); };

  // 1) предел досягаемости: без поля reach рука уходит глубже, с ним — останавливается на расстоянии max от плеча
  g.startLevelDef(base); g.hand.place(g.level.approach); enter(g.hand);
  out.free = { dist: +dist().toFixed(3), z: +g.hand.pos.z.toFixed(3), reachMax: g.hand.reachMax };
  g.settings.fatigue = true;
  g.startLevelDef(withAll); g.hand.place(g.level.approach); const h = g.hand; enter(h);
  out.limited = { dist: +dist().toFixed(3), z: +h.pos.z.toFixed(3) };
  h.moveTarget(0, 0, -5); out.moveTarget = +h.target.distanceTo(h.shoulder).toFixed(3);       // ввод игрока тоже ограничен

  // 2) шкала: растёт при вытянутой руке, падает, когда рука вынута
  out.extended = +fat().value.toFixed(3);
  run(2); out.extended2 = +fat().value.toFixed(3);
  run(1.5, () => h.target.set(hole[0], hole[1], 0.4)); run(0.7, () => h.target.set(0.3, 1.05, 0.45));   // назад по оси отверстия и в сторону — отдыхать
  const afterExit = fat().value; run(2.5);
  out.rest = { before: +afterExit.toFixed(3), after: +fat().value.toFixed(3), meter: !!g.hud.meter2 };

  // 3) дрожь с 60 %: кисть качается, и качается одинаково при повторе (без случайных чисел)
  const shake = () => { g.startLevelDef(withAll); g.hand.place(g.level.approach); const f = fat(); const path = []; run(2, () => { f.value = 0.9; h.target.set(-0.1, 1.2, 0.4); path.push(h.pos.x + h.pos.y + h.pos.z); }); return path; };
  const s1 = shake(), calm = (() => { g.startLevelDef(base); g.hand.place(g.level.approach); const path = []; run(2, () => { g.hand.target.set(-0.1, 1.2, 0.4); path.push(g.hand.pos.x + g.hand.pos.y + g.hand.pos.z); }); return path; })(), s2 = shake();
  const wobble = (p) => { let m = 0; for (let i = 200; i < p.length; i++) m = Math.max(m, Math.abs(p[i] - p[i - 1])); return m; };
  out.tremor = { shaking: wobble(s1), calm: wobble(calm), same: s1.every((v, i) => v === s2[i]), flag: h.shaking };

  // 4) хват слабеет с 80 %, на 100 % рука разжимается сама и какое-то время не хватает
  g.startLevelDef(withAll); g.hand.place(g.level.approach);
  const bar = g.items[0], p = bar.position().clone();
  run(1.5, () => h.target.set(p.x, p.y + 0.045, 0.5)); run(2.5, () => h.target.set(p.x, p.y + 0.045, p.z)); run(0.5, () => h.target.set(p.x, p.y + 0.02, p.z));
  h.setGrip(true); run(0.5);
  out.grab = { held: h.holding, mass: bar.mass };
  fat().value = 0.9; run(0.05); out.weak = { factor: +h.slipFactor.toFixed(2), value: +fat().value.toFixed(2) };
  fat().value = 0.999; run(0.5);
  out.gaveOut = { held: h.holding, lock: +h.gripLock.toFixed(2), state: g.state, value: +fat().value.toFixed(2) };

  // 5) настройка «усталость руки» выключена: шкалы нет, предел досягаемости остаётся
  g.settings.fatigue = false;
  g.startLevelDef(withAll); g.hand.place(g.level.approach); enter(g.hand); run(1);
  out.off = { trap: !!fat(), meter: !!g.hud.meter2, dist: +dist().toFixed(3), shaking: g.hand.shaking, factor: g.hand.slipFactor };
  g.settings.fatigue = true;

  // 6) две полоски сразу: жар и усталость на одном уровне
  g.startLevelDef({ ...L7, id: 9011, name: 'проверка: жар и усталость', hint: '', fatigue: {}, reach: { max: 1.35 } });
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const m1 = document.querySelector('.hud .meter:not(.meter2)'), m2 = document.querySelector('.hud .meter2');
  out.two = { heat: !m1.hidden && m1.querySelector('.mlabel').textContent, fatigue: !m2.hidden && m2.querySelector('.mlabel').textContent, overlap: m1.getBoundingClientRect().bottom > m2.getBoundingClientRect().top + 0.5 };
  // на обычном уровне кампании нет ни предела, ни шкалы
  g.startLevelById(8); out.campaign = { reach: g.hand.reachMax, trap: !!fat(), factor: g.hand.slipFactor, shaking: g.hand.shaking };
  g.toMenu();
  return out;
});
check(tired.free.reachMax === null && tired.limited.dist <= 1.305 && tired.free.dist > tired.limited.dist + 0.02 && tired.limited.z > tired.free.z + 0.02 && tired.moveTarget <= 1.3001,
  `предел досягаемости: без поля reach кисть уходит на ${tired.free.dist} м от плеча (z = ${tired.free.z}), с reach.max = 1.3 — останавливается на ${tired.limited.dist} м (z = ${tired.limited.z}); ввод игрока ограничен так же (${tired.moveTarget} м)`);
check(tired.extended > 0.2 && tired.extended2 > tired.extended && tired.rest.before < tired.extended2 && tired.rest.after < tired.extended2 - 0.3 && tired.rest.meter,
  `усталость: вытянутая рука — шкала ${tired.extended} → ${tired.extended2}; рука вынута и разжата — ${tired.rest.before} сразу после выхода, ${tired.rest.after} после отдыха; полоска на HUD есть`);
check(tired.tremor.flag && tired.tremor.shaking > tired.tremor.calm * 3 && tired.tremor.same, `дрожь при усталости 90 %: кисть качается (шаг ${(tired.tremor.shaking * 1000).toFixed(2)} мм против ${(tired.tremor.calm * 1000).toFixed(2)} мм у спокойной руки), при повторе — точно так же (детерминированно)`);
check(tired.grab.held && tired.weak.factor < 1 && tired.weak.factor >= 0.5 && !tired.gaveOut.held && tired.gaveOut.lock > 0.5 && tired.gaveOut.state === 'playing',
  `слиток ${tired.grab.mass} кг в уставшей руке: при 90 % порог выскальзывания ×${tired.weak.factor}; на 100 % рука разжалась сама, хват заблокирован ещё на ${tired.gaveOut.lock} с, уровень продолжается`);
check(!tired.off.trap && !tired.off.meter && tired.off.dist <= 1.305 && !tired.off.shaking && tired.off.factor === 1, `настройка «Усталость руки» выключена: шкалы и дрожи нет, предел досягаемости остался (${tired.off.dist} м)`);
check(tired.two.heat === 'ЖАР' && tired.two.fatigue === 'УСТАЛОСТЬ' && !tired.two.overlap, `две полоски на HUD одновременно: «${tired.two.heat}» и «${tired.two.fatigue}», друг на друга не наезжают`);
check(tired.campaign.reach === null && !tired.campaign.trap && tired.campaign.factor === 1 && !tired.campaign.shaking, 'на уровнях кампании 1–40 нет ни предела досягаемости, ни усталости');

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
  g.startLevelById(2); g.hand.place(g.level.approach);
  const h = g.hand, top = 0.9 + g.level.box.size[1];
  run(1.0, () => h.target.set(-0.2, 1.5, -0.1));
  run(1.5, () => h.target.set(-0.2, 0.95, -0.1));
  let minY = Infinity;
  h.forEachArmSphere((x, y, z, r) => { if (Math.abs(x + 0.2) < 0.25 && Math.abs(z + 0.1) < 0.18) minY = Math.min(minY, y - r); });
  out.wall = { lowest: +minY.toFixed(4), glassTop: top, touches: g.touches, damage: g.box.damage };
  // продолжаем бить — стекло должно разбиться
  for (let k = 0; k < 8 && g.state === 'playing'; k++) { run(0.7, () => h.target.set(-0.2, 1.5, -0.1)); run(0.7, () => h.target.set(-0.2, 0.95, -0.1)); }
  out.broken = { result: g.result, broken: g.box.broken, counted: g.save.stats.glassBroken || 0 };
  // уровень 3: хватаем слиток поперёк и тянем наружу
  g.startLevelById(3); g.hand.place(g.level.approach);
  const bar = g.items[0], b = bar.position().clone(), yG = b.y + 0.0225 + 0.022, V = h.target.constructor;
  const go = (x, y, z, sec, sp = 0.5) => { const d = new V(x, y, z); run(sec, () => { const c = h.target, dd = c.distanceTo(d); if (dd > sp * S) c.lerp(d, sp * S / dd); else c.copy(d); }); };
  go(b.x, yG + 0.012, b.z + 0.5, 1.5); go(b.x, yG + 0.012, b.z, 2); go(b.x, yG - 0.01, b.z, 0.5, 0.2);
  h.setGrip(true); run(0.5);
  const held = h.holding;
  go(b.x, yG + 0.03, b.z, 0.6, 0.2); go(b.x, yG + 0.03, b.z + 0.6, 4, 0.4);
  out.monkey = { held, barZ: +bar.position().z.toFixed(3), wallZ: g.level.box.pos[1] + g.level.box.size[2] / 2, state: g.state };
  // слиток летит внутри коробки и не пролетает сквозь дно/стенки
  g.startLevelById(1); g.hand.place(g.level.approach);
  const flying = g.items[0];
  flying.body.position.y += 0.15; flying.body.velocity.set(2.5, -1, 1.5);
  run(2);
  out.drop = { inside: g.box.contains(flying.position()), y: +flying.position().y.toFixed(3) };
  g.toMenu();
  return out;
});
check(phys.wall.lowest > phys.wall.glassTop - 0.004, `рука не прошла сквозь стекло (низ руки ${phys.wall.lowest} м, верх стекла ${phys.wall.glassTop.toFixed(3)} м, касаний ${phys.wall.touches})`);
check(phys.broken.broken && /Стекло/.test(phys.broken.result || '') && phys.broken.counted >= 1, `стекло разбивается от сильных ударов (${phys.broken.result}); счётчик разбитого стекла для достижения: ${phys.broken.counted}`);
check(phys.monkey.held && phys.monkey.barZ < phys.monkey.wallZ, `ловушка для обезьян: слиток поперёк не вышел (z = ${phys.monkey.barZ}, стенка ${phys.monkey.wallZ.toFixed(2)})`);
check(phys.drop.inside && phys.drop.y > 0.9, `брошенный слиток остался внутри коробки (y = ${phys.drop.y})`);

// --- нагрузка на отрисовку. Время кадра на этой видеокарте скачет на десятки процентов само по себе
// (режимы питания), поэтому каждый уровень сравнивается с уровнем 1 «вперемежку»: уровень, эталон, уровень,
// эталон… — и берётся лучшее время каждого. Плюс точные числа без шума: вызовы отрисовки и треугольники.
const perf = await page.evaluate(async () => {
  const g = window.__gg, H = await import('/src/heists.js'), I = await import('/src/i18n/index.js'), gl = g.stage.renderer.getContext(), px = new Uint8Array(4), out = [];
  const time = (n = 40) => { const a = performance.now(); for (let i = 0; i < n; i++) g.stage.render(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return (performance.now() - a) / n; };
  // эталон — уровень 1 в том виде, какой он имел в MVP: обстановка по умолчанию (хранилище, деревянный стол).
  // Уровень вне кампании не получает тему ограбления, поэтому берём копию уровня 1 с чужим id.
  const { LEVELS } = await import('/src/levels.js');
  const REF = { ...LEVELS.find((l) => l.id === 1), id: 9000, name: 'эталон MVP' };
  const load = (id, seconds) => {
    if (id === 'ref') g.startLevelDef(REF); else g.runAuto(id);
    g.timeScale = 0;
    for (let k = 0; k < seconds * 120 && g.state === 'playing'; k++) g._fixedStep(1 / 120);
    g.hand.updateVisual(0); for (const it of g.items) if (!it.banked) it.sync();
    for (const tr of g.traps) tr.update(0);
    g.stage.update(0.016, 0, g.hand.pos, 0);
  };
  g.stage.renderer.info.autoReset = false;
  load('ref', 0.5); time(60);                           // прогрев
  for (const e of H.campaignOrder()) {
    let calls = 0, tris = 0;
    const pairs = [];
    for (let round = 0; round < 7; round++) {
      load(e.level.id, round ? 0.3 : 2.5);
      if (!round) { g.stage.renderer.info.reset(); g.stage.render(); calls = g.stage.renderer.info.render.calls; tris = g.stage.renderer.info.render.triangles; }
      time(8); const ms = Math.min(time(), time());
      load('ref', 0.3);
      time(8); pairs.push({ ms, ref: Math.min(time(), time()) });
    }
    // медиана отношений по парам «уровень — эталон»: скачок режима видеокарты портит одну-две пары, но не медиану
    pairs.sort((a, b) => a.ms / a.ref - b.ms / b.ref);
    out.push({ id: e.level.id, name: I.levelName(e.level), calls, tris, ms: pairs[3].ms, ref: pairs[3].ref });
  }
  g.stage.renderer.info.autoReset = true; g.timeScale = 1; g.toMenu();
  return out;
});
// Пределы: самый тяжёлый уровень MVP — время кадра ×1.02 к уровню 1 (в обстановке MVP), 92 вызова, 81 тыс. треугольников.
// Время кадра — главный критерий: не хуже чем на 15 % (плюс 5 % на остаточный шум); вызовы и треугольники — ориентир.
const PERF_LIMIT = { calls: 140, tris: 130000, ratio: 1.2 };
for (const p of perf) {
  const ratio = p.ms / p.ref;
  check(p.calls <= PERF_LIMIT.calls && p.tris <= PERF_LIMIT.tris && ratio <= PERF_LIMIT.ratio, `отрисовка, уровень ${p.id} «${p.name}»: вызовов ${p.calls}, треугольников ${(p.tris / 1000).toFixed(0)} тыс., кадр ${p.ms.toFixed(2)} мс (×${ratio.toFixed(2)} к уровню 1 из MVP)`);
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

// без ?dev отладочного доступа нет
{
  const p4 = await browser.newPage({ viewport: { width: 640, height: 360 }, locale: 'ru-RU' });
  await offline(p4);
  await p4.goto(base);
  await p4.waitForFunction(() => { const m = document.querySelector('.screen[data-name=menu]'); return m && !m.hidden; }, null, { timeout: 60000 });
  const open = await p4.evaluate(() => ({ gg: typeof window.__gg, quit: [...document.querySelectorAll('.screen[data-name=menu] .btn')].length }));
  check(open.gg === 'undefined', `без режима разработки (?dev) отладочного window.__gg нет (${open.gg})`);
  await p4.close();
}
check(external.length === 0, `без интернета: обращений к внешним адресам ${external.length}${external.length ? ' — ' + [...new Set(external)].slice(0, 4).join(', ') : ' (сеть была заблокирована весь прогон)'}`);
check(errors.length === 0, `консоль без ошибок${errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''}`);
await browser.close(); server.close();
console.log(failed ? `\nПровалено проверок: ${failed}` : '\nВсе проверки пройдены');
process.exit(failed ? 1 : 0);
