// Отладка: запускает игру в Chrome, выполняет в ней JavaScript из файла и печатает результат.
//   node tools/test/eval.mjs script.js [screenshot.png]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.glb': 'model/gltf-binary' };
const server = createServer(async (req, res) => { try { let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)); if (p.length < 2) p += 'index.html'; const body = await readFile(join(ROOT, p)); res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' }); res.end(body); } catch { res.writeHead(404); res.end(); } });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(`http://127.0.0.1:${server.address().port}/?dev=1`);
await page.waitForFunction(() => window.__gg && window.__gg.state === 'menu', null, { timeout: 60000 });
const code = await readFile(process.argv[2], 'utf8');
const out = await page.evaluate(code);
console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 1));
if (process.argv[3]) await page.screenshot({ path: process.argv[3] });
await browser.close(); server.close();
