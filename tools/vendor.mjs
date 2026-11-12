// Кладёт библиотеки игры в папку vendor/, чтобы игра работала без интернета:
//   npm install          (ставит three и cannon-es точно тех версий, что записаны в package.json)
//   node tools/vendor.mjs
// Из three берётся build/three.module.js и только те модули examples/jsm, которые игра реально импортирует
// (строки 'three/addons/…' в src/), вместе с их собственными зависимостями. Рядом кладутся файлы LICENSE.
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync, copyFileSync } from 'node:fs';
import { join, dirname, relative, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NM = join(ROOT, 'node_modules'), OUT = join(ROOT, 'vendor');
const WANT = { three: '0.160.0', 'cannon-es': '0.20.0' };

for (const [name, version] of Object.entries(WANT)) {
  const got = JSON.parse(readFileSync(join(NM, name, 'package.json'), 'utf8')).version;
  if (got !== version) { console.error(`В node_modules лежит ${name}@${got}, а нужна ${version}. Запусти npm install.`); process.exit(1); }
}

const walk = (dir, out = []) => { for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) walk(p, out); else out.push(p); } return out; };
const copy = (from, to) => { mkdirSync(dirname(to), { recursive: true }); copyFileSync(from, to); return statSync(to).size; };

// какие модули three/addons импортирует игра
const wanted = new Set();
for (const f of walk(join(ROOT, 'src')).filter((p) => p.endsWith('.js')))
  for (const m of readFileSync(f, 'utf8').matchAll(/from\s+'three\/addons\/([^']+)'/g)) wanted.add(m[1]);

// их собственные зависимости (относительные импорты внутри examples/jsm)
const JSM = join(NM, 'three', 'examples', 'jsm');
const queue = [...wanted], addons = new Set();
while (queue.length) {
  const rel = queue.pop();
  if (addons.has(rel)) continue;
  addons.add(rel);
  const src = readFileSync(join(JSM, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');   // без комментариев: в них бывают примеры кода
  for (const m of src.matchAll(/(?:from|import)\s+'(\.{1,2}\/[^']+)'/g)) queue.push(posix.join(posix.dirname(rel), m[1]));
  for (const m of src.matchAll(/from\s+'([^.'][^']*)'/g)) if (m[1] !== 'three') { console.error(`${rel} импортирует «${m[1]}» — такого в vendor/ не будет`); process.exit(1); }
}

rmSync(OUT, { recursive: true, force: true });
const rows = [];
rows.push(['three/build/three.module.js', copy(join(NM, 'three', 'build', 'three.module.js'), join(OUT, 'three', 'build', 'three.module.js'))]);
for (const rel of [...addons].sort()) rows.push([`three/examples/jsm/${rel}`, copy(join(JSM, rel), join(OUT, 'three', 'examples', 'jsm', rel))]);
rows.push(['three/LICENSE', copy(join(NM, 'three', 'LICENSE'), join(OUT, 'three', 'LICENSE'))]);
rows.push(['cannon-es/dist/cannon-es.js', copy(join(NM, 'cannon-es', 'dist', 'cannon-es.js'), join(OUT, 'cannon-es', 'dist', 'cannon-es.js'))]);
rows.push(['cannon-es/LICENSE', copy(join(NM, 'cannon-es', 'LICENSE'), join(OUT, 'cannon-es', 'LICENSE'))]);
writeFileSync(join(OUT, 'README.md'), `# vendor\n\nБиблиотеки игры, скопированные из npm-пакетов без изменений (собирает \`node tools/vendor.mjs\`):\n\n- three@${WANT.three} — MIT, см. three/LICENSE\n- cannon-es@${WANT['cannon-es']} — MIT, см. cannon-es/LICENSE\n\nРуками здесь ничего не правится.\n`);

let total = 0;
for (const [name, size] of rows) { total += size; console.log(`  ${(size / 1024).toFixed(0).padStart(6)} КБ  vendor/${name}`); }
console.log(`Итого ${(total / 1024 / 1024).toFixed(2)} МБ, файлов ${rows.length} (${relative(ROOT, OUT)}/)`);
