// Проверка настольной версии (Electron):
//   node tools/test/desktop.mjs                 — запуск из исходников: режим разработки и режим «релиз»
//   node tools/test/desktop.mjs --exe <путь>    — то же для собранного .exe (режим «релиз»)
// Данные игрока на время проверки лежат во временной папке (GG_USER_DATA), настоящие сохранения не трогаются.
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2), opt = (name) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : null; };
const EXE = opt('exe'), SHOTS = args.includes('--shots');
let failed = 0;
const check = (ok, text) => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${text}`); if (!ok) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Запустить игру. release — режим для игроков. Возвращает { app, page, dir, external, errors }. */
async function launch({ release, dir = mkdtempSync(join(tmpdir(), 'gg-desktop-')), env = {} }) {
  const launchArgs = EXE ? [] : ['.', ...(release ? ['--release'] : [])];
  const app = await electron.launch({ ...(EXE ? { executablePath: EXE } : {}), args: launchArgs, cwd: EXE ? dirname(EXE) : ROOT, env: { ...process.env, GG_USER_DATA: dir, ...env } });
  const page = await app.firstWindow();
  const errors = [], external = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('request', (r) => { if (!/^(app:\/\/game\/|data:|blob:)/.test(r.url())) external.push(r.url()); });
  await page.waitForFunction(() => { const m = document.querySelector('.screen[data-name=menu]'); return m && !m.hidden; }, null, { timeout: 90000 });
  return { app, page, dir, external, errors };
}
const windowInfo = (app) => app.evaluate(({ BrowserWindow, app: a }) => {
  const w = BrowserWindow.getAllWindows()[0], p = w.webContents.getLastWebPreferences();
  return { title: w.getTitle(), fullscreen: w.isFullScreen(), menu: w.isMenuBarVisible(), userData: a.getPath('userData'), packaged: a.isPackaged, name: a.getName(),
    prefs: { contextIsolation: p.contextIsolation, nodeIntegration: p.nodeIntegration, sandbox: p.sandbox, devTools: p.devTools, webSecurity: p.webSecurity } };
});
const readJson = (file) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };
const quit = async (app, page) => { const done = closed(app); await page.evaluate(() => window.desktop.quit()); return Promise.race([done, sleep(8000).then(() => false)]); };
const closed = (app) => new Promise((r) => app.once('close', () => r(true)));
/** Нажатие клавиши на уровне окна — как с настоящей клавиатуры (проходит через обработчик главного процесса). */
const press = (app, keyCode, modifiers = []) => app.evaluate(({ BrowserWindow }, [k, m]) => { const wc = BrowserWindow.getAllWindows()[0].webContents; wc.sendInputEvent({ type: 'keyDown', keyCode: k, modifiers: m }); wc.sendInputEvent({ type: 'keyUp', keyCode: k, modifiers: m }); }, [keyCode, modifiers]);
// Вывести окно на передний план и сказать, получилось ли. Windows не всегда отдаёт фокус окну, которое запустила
// программа, а не человек (особенно если в это время кто-то работает за компьютером). Без фокуса игра законно
// стоит на паузе и мышь не захватывается — тогда проверки, которым нужен фокус, пропускаются, а не проваливаются.
const focus = async (app) => {
  const ok = await app.evaluate(async ({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.show(); w.focus(); await new Promise((r) => setTimeout(r, 900)); return w.isFocused(); });
  if (!ok) console.log('  пропуск  Windows не отдала окну фокус — проверки захвата мыши в этом запуске пропущены');
  return ok;
};

// ------------------------------------------------------------------ режим разработки
if (!EXE) {
  console.log('Режим разработки (запуск из исходников)');
  const { app, page, dir, external, errors } = await launch({ release: false });
  const info = await windowInfo(app);
  check(info.title === 'Golden Grab' && info.name === 'Golden Grab', `окно называется «${info.title}»`);
  check(info.prefs.contextIsolation === true && info.prefs.nodeIntegration === false && info.prefs.sandbox === true && info.prefs.webSecurity === true,
    `безопасность окна: contextIsolation ${info.prefs.contextIsolation}, nodeIntegration ${info.prefs.nodeIntegration}, sandbox ${info.prefs.sandbox}`);
  check(info.fullscreen === true && info.menu === false, `по умолчанию полный экран (${info.fullscreen}), строки меню нет`);
  const web = await page.evaluate(() => ({ require: typeof require, process: typeof process, desktop: Object.keys(window.desktop || {}).sort().join(','), dev: window.desktop?.dev, gg: typeof window.__gg, href: location.href,
    quit: [...document.querySelectorAll('.screen[data-name=menu] .btn')].map((b) => b.textContent) }));
  check(web.require === 'undefined' && web.process === 'undefined', `странице недоступны require и process (${web.require}, ${web.process}); через мост видно только: ${web.desktop}`);
  check(web.dev === true && web.gg === 'object', 'режим разработки: отладочный window.__gg есть');
  check(web.href.startsWith('app://game/'), `игра загружена из локальных файлов (${web.href})`);
  check(web.quit.some((x) => /Выход|Quit/.test(x)), `в главном меню есть кнопка выхода (${web.quit.slice(0, 5).join(' / ')})`);

  // «Играть» → мышь захвачена сразу; потеря фокуса → пауза, время стоит.
  // Идёт раньше переключения полного экрана: нажатие Alt в проверке на время сбивает захват мыши.
  const focusedDev = await focus(app);
  await page.click('.screen[data-name=menu] .btn.primary');
  await page.waitForFunction(() => !!document.pointerLockElement, null, { timeout: 3000 }).catch(() => {});
  const play = await page.evaluate(() => ({ state: window.__gg.state, locked: document.pointerLockElement === window.__gg.stage.renderer.domElement }));
  if (focusedDev) check(play.state === 'playing' && play.locked, `клик «Играть»: уровень идёт (${play.state}), мышь захвачена сразу (${play.locked})`);
  if (!focusedDev) await page.evaluate(() => { const g = window.__gg; if (g.state === 'paused') g.resume(); });
  await sleep(300);
  const t0 = await page.evaluate(() => window.__gg.time);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].blur());
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));   // на случай, если ОС не отдала фокус другому окну
  await sleep(300);
  const p1 = await page.evaluate(() => ({ state: window.__gg.state, time: window.__gg.time }));
  await sleep(700);
  const p2 = await page.evaluate(() => ({ state: window.__gg.state, time: window.__gg.time }));
  check(p1.state === 'paused' && p2.time === p1.time && p1.time > t0 - 0.001, `потеря фокуса: игра на паузе (${p1.state}), время стоит (${p1.time.toFixed(2)} → ${p2.time.toFixed(2)} с)`);
  await page.evaluate(() => window.__gg.toMenu());

  // Steam: если клиента нет, игра просто работает без него
  const steam = await page.evaluate(() => window.desktop.steamStatus());
  check(typeof steam.available === 'boolean', steam.available ? 'Steam найден: достижения будут отправляться' : `Steam не найден (${steam.reason}) — игра запустилась и работает без него`);
  check(existsSync(join(ROOT, 'steam_appid.txt')), 'в режиме разработки рядом с проектом создан steam_appid.txt (в сборку он не попадает)');

  // уровень 1 автопилотом — то же, что в браузере
  const auto = await page.evaluate(() => window.__gg.autoTest(1, 60));
  check(auto.result === 'won', `уровень 1 проходится автопилотом в настольном окне: ${auto.result}, ${auto.time} с`);
  const granted = await page.evaluate(() => Object.keys(window.__gg.save.achievements));
  check(granted.includes('SPEEDRUN'), `достижение за победу выдано и отправлено в мост Steam без ошибок (${granted.join(', ')})`);
  await page.evaluate(() => { const g = window.__gg; g.endTimer = 0; g.endAction?.(); g.endAction = null; g.toMenu(); });

  // сохранение — файл JSON в папке данных, рядом настройки
  const saves = join(dir, 'saves'), saveFile = join(saves, 'save.json'), settingsFile = join(saves, 'settings.json');
  await page.evaluate(() => window.__gg.setLanguage('en')); await sleep(600);
  const onDisk = { save: readJson(saveFile), settings: readJson(settingsFile), files: existsSync(saves) ? readdirSync(saves) : [], dir: await page.evaluate(() => window.desktop.storeDir()) };
  check(onDisk.save?.version === 5 && onDisk.save.best?.[1]?.stars >= 1 && onDisk.settings?.lang === 'en' && !onDisk.files.some((f) => f.endsWith('.tmp')),
    `сохранение записано в файл: ${onDisk.dir}\\save.json (рекорд уровня 1: ${onDisk.save?.best?.[1]?.time} с), настройки — settings.json (язык ${onDisk.settings?.lang}); в папке: ${onDisk.files.join(', ')}`);
  await page.evaluate(() => window.__gg.setLanguage('ru')); await sleep(600);

  // оконный режим и обратно
  await page.evaluate(() => window.desktop.setFullscreen(false));
  await page.waitForFunction(() => !window.desktop.isFullscreen(), null, { timeout: 10000 });
  const windowed = (await windowInfo(app)).fullscreen;
  await press(app, 'Enter', ['alt']);
  await page.waitForFunction(() => window.desktop.isFullscreen(), null, { timeout: 10000 }).catch(() => {});
  const back = (await windowInfo(app)).fullscreen;
  check(windowed === false && back === true, `полный экран переключается: из настроек — в окно (полный экран: ${windowed}), Alt+Enter — снова полный (${back})`);
  await page.evaluate(() => window.desktop.setFullscreen(false));
  await page.waitForFunction(() => !window.desktop.isFullscreen(), null, { timeout: 10000 });

  if (SHOTS) { mkdirSync(join(ROOT, 'docs', 'screens'), { recursive: true }); await page.evaluate(() => window.__gg.toMenu()); await sleep(400); await page.screenshot({ path: join(ROOT, 'docs', 'screens', 'desktop_menu.png') }); }

  check(external.length === 0, `обращений не к своим файлам: ${external.length}${external.length ? ' — ' + external.slice(0, 3).join(', ') : ''}`);
  check(errors.length === 0, `консоль без ошибок${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  check(await quit(app, page), 'выход из приложения работает');
  await sleep(500);

  // --- перезапуск: сохранение читается из файла; оконный режим запомнен
  {
    const r = await launch({ release: false, dir, env: { GG_NO_STEAM: '1' } });   // заодно: запуск совсем без Steam
    const noSteam = await r.page.evaluate(() => window.desktop.steamStatus());
    check(noSteam.available === false && r.errors.length === 0, `без Steam (${noSteam.reason}) игра запускается, ошибок в консоли нет`);
    const st = await r.page.evaluate(() => ({ best: window.__gg.save.best, fullscreen: window.desktop.isFullscreen(), lang: window.__gg.settings.lang }));
    check(st.best[1]?.stars >= 1 && st.fullscreen === false && st.lang === 'ru', `после перезапуска рекорд на месте (уровень 1: ${st.best[1]?.time} с), окно открылось в запомненном режиме (полный экран: ${st.fullscreen})`);
    await quit(r.app, r.page); await sleep(500);
  }
  // --- повреждённый файл: игра запускается, берёт запасную копию; без копии — начинает с чистого листа
  {
    writeFileSync(saveFile, '{"version":4,"best":{"1":{"stars":3,"time":5.5,"touches":0},"2":{"stars":2,"time":9,"touches":1}},"skin":"skin","accessory":null}');
    let r = await launch({ release: false, dir });
    await r.page.evaluate(() => { const g = window.__gg; g.save.best[9] = { stars: 1, time: 50, touches: 9 }; return import('/src/save.js').then((S) => S.storeSave(g.save)); });   // вторая запись: появляется .bak
    await sleep(300); await quit(r.app, r.page); await sleep(500);
    const bak = readJson(saveFile + '.bak');
    writeFileSync(saveFile, '{"version":4,"best":{"1":{"sta');                       // оборванная запись
    r = await launch({ release: false, dir });
    const st = await r.page.evaluate(() => ({ best: Object.keys(window.__gg.save.best), state: window.__gg.state }));
    const files = readdirSync(saves);
    check(st.state === 'menu' && bak && st.best.join() === '1,2' && files.some((f) => f.startsWith('save.json.corrupt-')), `повреждённый save.json: игра запустилась, взята запасная копия (рекорды уровней ${st.best.join(', ')}), испорченный файл отложен (${files.filter((f) => f.includes('corrupt')).join(', ')})`);
    await quit(r.app, r.page); await sleep(500);
    for (const f of readdirSync(saves)) if (f.startsWith('save.json')) rmSync(join(saves, f));
    writeFileSync(saveFile, 'это не JSON'); writeFileSync(settingsFile, '[1, 2');
    r = await launch({ release: false, dir });
    const st2 = await r.page.evaluate(() => ({ best: Object.keys(window.__gg.save.best).length, state: window.__gg.state, volume: window.__gg.settings.volume }));
    check(st2.state === 'menu' && st2.best === 0 && st2.volume === 0.7 && r.errors.length === 0, `испорчены оба файла и копии нет: игра запустилась с чистым сохранением (рекордов ${st2.best}), ошибок на экране и в консоли нет`);
    await quit(r.app, r.page); await sleep(500);
  }
  // --- перенос из localStorage: файла нет, а в localStorage приложения лежит старое сохранение
  {
    for (const f of readdirSync(saves)) rmSync(join(saves, f));
    let r = await launch({ release: false, dir });
    await r.page.evaluate(() => localStorage.setItem('goldenGrab.v1', JSON.stringify({ best: { 1: { stars: 3, time: 6.5, touches: 0 }, 5: { stars: 1, time: 80, touches: 7 } }, skin: 'glove', volume: 0.4 })));
    await sleep(300); await quit(r.app, r.page); await sleep(500);
    for (const f of readdirSync(saves)) rmSync(join(saves, f));
    r = await launch({ release: false, dir });
    const st = await r.page.evaluate(() => ({ best: window.__gg.save.best, skin: window.__gg.save.skin, volume: window.__gg.settings.volume }));
    await sleep(300);
    const file = readJson(saveFile), set = readJson(settingsFile);
    check(st.best[1]?.time === 6.5 && st.best[5]?.stars === 1 && st.skin === 'glove' && st.volume === 0.4 && file?.best?.[5]?.time === 80 && file.skin === 'glove' && set?.volume === 0.4,
      `сохранение из localStorage перенесено в файл без потерь (рекордов ${Object.keys(st.best).length}, рука «${st.skin}», громкость ${st.volume})`);
    await quit(r.app, r.page); await sleep(500);
  }
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* папку ещё держит система — не страшно */ }
}

// ------------------------------------------------------------------ режим для игроков
console.log(EXE ? `Собранное приложение: ${EXE}` : 'Режим «релиз» (запуск из исходников с ключом --release)');
{
  const { app, page, dir, external, errors } = await launch({ release: true });
  const info = await windowInfo(app);
  if (EXE) check(info.packaged === true, `приложение собрано (isPackaged ${info.packaged}), папка данных: ${info.userData}`);
  check(info.title === 'Golden Grab' && info.fullscreen === true && info.menu === false, `окно «${info.title}», полный экран, без строки меню`);
  check(info.prefs.contextIsolation === true && info.prefs.nodeIntegration === false && info.prefs.sandbox === true, 'окно изолировано так же, как в режиме разработки');
  const web = await page.evaluate(() => ({ gg: typeof window.__gg, dev: window.desktop.dev, href: location.href }));
  check(web.gg === 'undefined' && web.dev === false, `отладочного window.__gg нет (${web.gg})`);

  // «Играть»: уровень идёт, мышь захвачена. Эта проверка идёт первой: попытка открыть DevTools ниже на время сбивает захват мыши.
  const focusedRel = await focus(app);
  await page.click('.screen[data-name=menu] .btn.primary');
  await page.waitForFunction(() => !!document.pointerLockElement, null, { timeout: 3000 }).catch(() => {});
  await sleep(1200);
  const hud = await page.evaluate(() => ({ hud: !document.querySelector('.hud').hidden, timer: document.querySelector('.hud .timer').textContent, locked: !!document.pointerLockElement, level: document.querySelector('.hud .lvl').textContent }));
  await sleep(1000);
  const timer2 = await page.evaluate(() => document.querySelector('.hud .timer').textContent);
  if (focusedRel) check(hud.hud && hud.locked && timer2 !== hud.timer, `клик «Играть»: уровень «${hud.level}» идёт (таймер ${hud.timer} → ${timer2}), мышь захвачена (${hud.locked})`);
  else check(hud.hud && /\S/.test(hud.level), `клик «Играть»: уровень «${hud.level}» запущен (окно без фокуса — игра на паузе, как и должна)`);
  if (SHOTS) { mkdirSync(join(ROOT, 'docs', 'screens'), { recursive: true }); await page.screenshot({ path: join(ROOT, 'docs', 'screens', EXE ? 'desktop_exe_level.png' : 'desktop_level.png') }); }

  if (await page.evaluate(() => document.querySelector('.screen[data-name=pause]').hidden)) { await page.keyboard.press('Escape'); await sleep(500); }
  await page.evaluate(() => { const b = [...document.querySelectorAll('.screen[data-name=pause] .btn')].pop(); b.click(); });   // «В меню»
  await sleep(400);

  // сохранение и настройки пишутся в файлы: меняем руку (это сохранение) и язык (это настройки) кнопками меню
  {
    const saves = join(dir, 'saves');
    const clickBtn = (re) => page.evaluate((src) => { const b = [...document.querySelectorAll('.screen[data-name=menu] .btn')].find((x) => new RegExp(src).test(x.textContent)); b?.click(); return !!b; }, re);
    const clickLang = () => page.evaluate(() => document.querySelector('.setrow[data-key=lang] .btn').click());   // строка «Язык» на экране настроек
    await clickBtn('^(Рука|Hand)'); await clickLang(); await sleep(700);
    const save = readJson(join(saves, 'save.json')), settings = readJson(join(saves, 'settings.json'));
    check(save?.skin === 'glove' && ['en', 'ru'].includes(settings?.lang), `файлы игрока пишутся: ${join(info.userData, 'saves')} — save.json (рука «${save?.skin}»), settings.json (язык ${settings?.lang})`);
    await clickBtn('^(Рука|Hand)'); await clickLang(); await sleep(400);
  }

  // DevTools, F12, Ctrl+R: страница не должна перезагрузиться, DevTools — открыться
  await page.evaluate(() => { window.__marker = 42; });
  for (const [k, m] of [['F12', []], ['R', ['control']], ['F5', []], ['I', ['control', 'shift']]]) await press(app, k, m);
  await app.evaluate(({ BrowserWindow }) => { try { BrowserWindow.getAllWindows()[0].webContents.openDevTools(); } catch { /* запрещено */ } });
  await sleep(1200);
  const hard = { marker: await page.evaluate(() => window.__marker), devtools: await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.isDevToolsOpened()) };
  check(hard.marker === 42 && hard.devtools === false, `F12, Ctrl+R, F5, Ctrl+Shift+I ничего не делают: страница не перезагружена, DevTools закрыты (${hard.devtools})`);
  const ctx = await page.evaluate(() => { const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true }); document.body.dispatchEvent(e); return e.defaultPrevented; });
  check(ctx === true, 'контекстное меню отключено');

  check(external.length === 0, `обращений не к своим файлам: ${external.length}${external.length ? ' — ' + external.slice(0, 3).join(', ') : ''}`);
  check(errors.length === 0, `консоль без ошибок${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);

  // выход кнопкой из главного меню
  const done = closed(app);
  await page.evaluate(() => { const b = [...document.querySelectorAll('.screen[data-name=menu] .btn')].find((x) => /Выход|Quit/.test(x.textContent)); b.click(); });
  check(await Promise.race([done, sleep(8000).then(() => false)]), 'кнопка «Выход» закрывает приложение');
  await app.close().catch(() => {}); await sleep(500);
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* папку ещё держит система — не страшно */ }
}

console.log(failed ? `\nПровалено проверок: ${failed}` : '\nВсе проверки настольной версии пройдены');
process.exit(failed ? 1 : 0);
