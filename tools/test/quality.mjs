// Замер нагрузки на отрисовку на трёх уровнях качества графики:
//   node tools/test/quality.mjs                — на видеокарте по умолчанию (обычно дискретная)
//   node tools/test/quality.mjs --gpu low      — на встроенной (энергосберегающей) видеокарте, если она есть
//   [--size 1920x1080] [--out docs/quality_perf.md]
// Для каждого уровня кампании и каждого качества: автопилот доводит уровень до середины, время замирает,
// кадр рисуется 30 раз подряд с ожиданием видеокарты — получается время одного кадра без ограничения VSync.
// «Кадров в секунду» в таблице — это 1000 / время кадра: потолок, который видеокарта может выдать на отрисовке.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { extname, join, normalize, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2), opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const [W, H] = opt('size', '1920x1080').split('x').map(Number), lowGpu = opt('gpu', '') === 'low', out = opt('out', null);

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.glb': 'model/gltf-binary' };
const server = createServer(async (req, res) => {
  try { let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)); if (p.length < 2) p += 'index.html'; const body = await readFile(join(ROOT, p)); res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' }); res.end(body); } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', ...(lowGpu ? ['--force_low_power_gpu'] : ['--force_high_performance_gpu'])] });
const page = await browser.newPage({ viewport: { width: W, height: H }, locale: 'ru-RU' });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(`http://127.0.0.1:${server.address().port}/?dev=1`);
await page.waitForFunction(() => window.__gg && window.__gg.state === 'menu', null, { timeout: 120000 });

const gpu = await page.evaluate(() => { const gl = window.__gg.stage.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info'); return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
console.log('Видеокарта:', gpu, `· окно ${W}×${H}`);

const rows = await page.evaluate(async () => {
  const g = window.__gg, H = await import('/src/heists.js'), I = await import('/src/i18n/index.js'), gl = g.stage.renderer.getContext(), px = new Uint8Array(4), out = [];
  // после каждого кадра читается пиксель из середины: так видеокарта обязана дорисовать кадр до конца, а заодно видно, что кадр не чёрный
  let lost = false, black = 0;
  g.stage.renderer.domElement.addEventListener('webglcontextlost', () => { lost = true; });
  const time = (n) => { const a = performance.now(); for (let i = 0; i < n; i++) { g.stage.render(); gl.readPixels(gl.drawingBufferWidth >> 1, gl.drawingBufferHeight >> 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); if (px[0] + px[1] + px[2] === 0) black++; } return (performance.now() - a) / n; };
  for (const e of H.campaignOrder()) {
    g.applySettings({ quality: 'high' });
    g.runAuto(e.level.id); g.timeScale = 0;
    for (let k = 0; k < 2.5 * 120 && g.state === 'playing'; k++) g._fixedStep(1 / 120);
    g.hand.updateVisual(0); for (const it of g.items) if (!it.banked) it.sync(); for (const tr of g.traps) tr.update(0);
    g.stage.update(0.016, 0, g.hand.pos, 0);
    const row = { id: e.level.id, heist: I.heistName(e.heist), name: I.levelName(e.level) };
    for (const q of ['low', 'medium', 'high']) {
      g.applySettings({ quality: q }); g.stage.update(0.016, 0, g.hand.pos, 0);
      time(4);                                             // прогрев: шейдеры этого качества
      row[q] = Math.min(time(12), time(12));
      if (lost || gl.isContextLost()) { row.lost = q; break; }
    }
    out.push(row);
    if (row.lost) break;
  }
  out.black = black;
  g.applySettings({ quality: 'high' }); g.timeScale = 1; g.toMenu();
  return out;
});

const lostRow = rows.find((r) => r.lost);
if (lostRow) { console.log(`ГРАФИЧЕСКИЙ КОНТЕКСТ ПОТЕРЯН на уровне ${lostRow.id}, качество ${lostRow.lost} — замер прерван`); }
const fps = (ms) => (1000 / ms).toFixed(0), f2 = (x) => x.toFixed(2);
const stat = (list, q) => { list = list.filter((r) => r[q] != null); const v = list.map((r) => r[q]); if (!v.length) return { avg: NaN, max: NaN, worst: { id: '—', name: '—' } }; return { avg: v.reduce((a, b) => a + b, 0) / v.length, max: Math.max(...v), worst: list[v.indexOf(Math.max(...v))] }; };
const heists = [...new Set(rows.map((r) => r.heist))];
const lines = ['| Ограбление | Низкое, мс (кадров/с) | Среднее, мс (кадров/с) | Высокое, мс (кадров/с) |', '| --- | --- | --- | --- |'];
for (const h of [...heists, null]) {
  const list = h ? rows.filter((r) => r.heist === h) : rows;
  lines.push(`| ${h || '**Все 40 уровней**'} | ${['low', 'medium', 'high'].map((q) => { const s = stat(list, q); return `${f2(s.avg)} (${fps(s.avg)}), худший ${f2(s.max)} (${fps(s.max)})`; }).join(' | ')} |`);
}
const worst = ['low', 'medium', 'high'].map((q) => { const s = stat(rows, q); return `${q}: уровень ${s.worst.id} «${s.worst.name}» — ${f2(s.max)} мс (${fps(s.max)} кадров/с)`; });
console.log(lines.join('\n'));
console.log('Самый тяжёлый уровень — ' + worst.join('; '));
if (out) {
  writeFileSync(resolve(out), `## ${gpu}\n\nОкно ${W}×${H}, время одного кадра (меньше — лучше) и потолок кадров в секунду на отрисовке.\n\n${lines.join('\n')}\n\nСамый тяжёлый уровень — ${worst.join('; ')}.\n`);
  console.log('Записано:', out);
}
await browser.close(); server.close();
