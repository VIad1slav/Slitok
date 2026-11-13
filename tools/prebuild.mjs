// Проверка перед сборкой приложения (запускается сама перед npm run build:win / build:linux):
// всё, что должно попасть в сборку, на месте — иначе сборка получится нерабочей или тяжёлой.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [], notes = [];
const need = (rel, how) => { if (!existsSync(join(ROOT, rel))) problems.push(`нет ${rel} — ${how}`); };

need('vendor/three/build/three.module.js', 'запусти npm run vendor');
need('vendor/cannon-es/dist/cannon-es.js', 'запусти npm run vendor');
need('electron/icon.ico', 'запусти node tools/steam/app_icon.mjs');
const tex = readdirSync(join(ROOT, 'assets', 'textures'));
for (const f of tex.filter((x) => x.endsWith('.png'))) if (!tex.includes(f.replace('.png', '.webp'))) problems.push(`нет WebP для ${f} — запусти npm run textures`);
for (const lang of ['en', 'ru']) need(`src/i18n/${lang}.js`, 'словарь');

const cfg = createRequire(import.meta.url)(join(ROOT, 'electron', 'config.js'));
if (cfg.steamAppId === cfg.steamDevAppId) notes.push(`App ID в electron/config.js — тестовый (${cfg.steamAppId}). Перед загрузкой в Steam впиши настоящий.`);
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
notes.push(`версия ${pkg.version}, Electron ${pkg.devDependencies.electron}`);

for (const n of notes) console.log('  инфо', n);
if (problems.length) { for (const p of problems) console.log(' FAIL', p); process.exit(1); }
console.log('  ok   всё нужное для сборки на месте');
