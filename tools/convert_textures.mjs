// Готовит текстуры для игры: PNG из Blender → WebP рядом с ними.
//   node tools/convert_textures.mjs            — все текстуры из assets/textures
//   node tools/convert_textures.mjs --max 2048 — не уменьшать (для сравнения качества)
// Запускать заново после пересборки ассетов в Blender (tools/blender/build_all.py).
//
// PNG остаются в репозитории как исходники; игра грузит .webp, а если его нет — .png, а если нет и его —
// рисует текстуру сама (src/textures.js).
//
// Правила:
//   карты нормалей (*_normal)        — WebP без потерь: любое сжатие с потерями даёт на них видимую «рябь»;
//   цвет (*_albedo), ORM, стекло      — WebP качества 85;
//   сторона больше MAX_SIDE пикселей  — уменьшается до MAX_SIDE (рука и слиток занимают на экране
//                                       не больше 300–400 пикселей, 2048 для них избыточно).
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'assets', 'textures');
const args = process.argv.slice(2), opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const MAX_SIDE = Number(opt('max', 1024));
const QUALITY = 85;

const kb = (n) => (n / 1024).toFixed(0).padStart(6) + ' КБ';
const rows = [];
let before = 0, after = 0;
for (const file of readdirSync(DIR).filter((f) => f.endsWith('.png')).sort()) {
  const src = join(DIR, file), dst = src.replace(/\.png$/, '.webp');
  const meta = await sharp(src).metadata();
  const side = Math.min(MAX_SIDE, Math.max(meta.width, meta.height));
  const isNormal = /_normal\.png$/.test(file);
  let img = sharp(src);
  if (side < Math.max(meta.width, meta.height)) img = img.resize(side, side, { kernel: 'lanczos3' });
  await img.webp(isNormal ? { lossless: true, effort: 6 } : { quality: QUALITY, alphaQuality: 100, smartSubsample: true, effort: 6 }).toFile(dst);
  const a = statSync(src).size, b = statSync(dst).size;
  before += a; after += b;
  rows.push({ file, a, b, from: `${meta.width}`, to: `${side}`, mode: isNormal ? 'без потерь' : `качество ${QUALITY}` });
}

console.log('файл'.padEnd(28) + 'PNG'.padStart(9) + 'WebP'.padStart(12) + '   размер        режим');
for (const r of rows) console.log(r.file.replace('.png', '').padEnd(28) + kb(r.a) + '  →' + kb(r.b) + `   ${r.from}${r.from !== r.to ? ' → ' + r.to : ''}`.padEnd(15) + ' ' + r.mode);
console.log(`\nИтого текстуры: ${(before / 1048576).toFixed(1)} МБ → ${(after / 1048576).toFixed(1)} МБ (${rows.length} файлов, меньше в ${(before / after).toFixed(1)} раза)`);

if (!args.includes('--no-report')) {
  const md = ['# Вес текстур: PNG → WebP', '', `Собрано \`node tools/convert_textures.mjs\` (наибольшая сторона ${MAX_SIDE} пикселей).`, '',
    '| Файл | PNG, КБ | WebP, КБ | Сторона, пикс. | Режим |', '| --- | ---: | ---: | --- | --- |',
    ...rows.map((r) => `| ${r.file.replace('.png', '')} | ${(r.a / 1024).toFixed(0)} | ${(r.b / 1024).toFixed(0)} | ${r.from}${r.from !== r.to ? ' → ' + r.to : ''} | ${r.mode} |`),
    `| **Итого** | **${(before / 1024).toFixed(0)}** | **${(after / 1024).toFixed(0)}** | | |`, ''].join('\n');
  writeFileSync(join(ROOT, 'docs', 'assets_weight.md'), md);
}
