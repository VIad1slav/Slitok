// Проверка локализации:
//   node tools/check_i18n.mjs
// 1. В строках кода src/ (кроме src/i18n/) не должно быть кириллицы: весь текст для игрока лежит в словарях.
//    Комментарии не считаются. Заодно проверяются index.html и styles.css.
// 2. Наборы ключей в src/i18n/en.js и src/i18n/ru.js совпадают, значения одного вида (строка / список),
//    подстановки вида {name} одинаковые в обоих языках.
// 3. Каждый ключ, который игра запрашивает по шаблону (уровни, ограбления, добыча, косметика), есть в словаре.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CYR = /[Ѐ-ӿ]/;
let problems = 0;
const bad = (text) => { console.log(' FAIL ' + text); problems++; };

/** Строковые литералы файла JS: [{ line, text }]. Комментарии пропускаются, у шаблонных строк берётся только текст. */
function stringLiterals(src) {
  const out = [];
  let i = 0, line = 1;
  const n = src.length;
  let prev = '';   // последний значащий символ — чтобы отличить деление от регулярного выражения
  const readQuoted = (q) => {
    let s = '', start = line; i++;
    while (i < n && src[i] !== q) { if (src[i] === '\\') { s += src[i + 1] ?? ''; i += 2; continue; } if (src[i] === '\n') line++; s += src[i++]; }
    i++; out.push({ line: start, text: s });
  };
  const readTemplate = () => {
    let s = '', start = line; i++;
    while (i < n && src[i] !== '`') {
      if (src[i] === '\\') { s += src[i + 1] ?? ''; i += 2; continue; }
      if (src[i] === '$' && src[i + 1] === '{') { i += 2; s += ' '; readCode('}'); continue; }
      if (src[i] === '\n') line++;
      s += src[i++];
    }
    i++; out.push({ line: start, text: s });
  };
  function readCode(until) {
    let depth = 0;
    while (i < n) {
      const c = src[i], d = src[i + 1];
      if (c === '\n') { line++; i++; continue; }
      if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
      if (c === '/' && d === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; } i += 2; continue; }
      if (c === '\'' || c === '"') { readQuoted(c); prev = 'x'; continue; }
      if (c === '`') { readTemplate(); prev = 'x'; continue; }
      if (c === '/' && (prev === '' || '(,=:[!&|?{};\n+-*%<>~^'.includes(prev))) {   // регулярное выражение
        let s = '', start = line, inClass = false; i++;
        while (i < n && (src[i] !== '/' || inClass) && src[i] !== '\n') { if (src[i] === '\\') { s += src[i] + (src[i + 1] ?? ''); i += 2; continue; } if (src[i] === '[') inClass = true; if (src[i] === ']') inClass = false; s += src[i++]; }
        i++; out.push({ line: start, text: s }); prev = 'x'; continue;
      }
      if (until && c === '{') depth++;
      if (until && c === until) { if (depth === 0) { i++; return; } depth--; }
      if (!/\s/.test(c)) prev = c;
      i++;
    }
  }
  readCode(null);
  return out;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

// --- 1. кириллица в коде
const i18nDir = join(ROOT, 'src', 'i18n');
const files = [...walk(join(ROOT, 'src')), ...(statSync(join(ROOT, 'electron'), { throwIfNoEntry: false }) ? walk(join(ROOT, 'electron')) : [])]
  .filter((f) => /\.(js|mjs|cjs)$/.test(f) && !f.startsWith(i18nDir));
let literals = 0;
for (const file of files) {
  for (const s of stringLiterals(readFileSync(file, 'utf8'))) {
    literals++;
    if (CYR.test(s.text)) bad(`${relative(ROOT, file)}:${s.line}  кириллица в строке: ${s.text.trim().slice(0, 70)}`);
  }
}
// HTML и CSS: комментарии убираем, остальное проверяем целиком
for (const name of ['index.html', 'styles.css']) {
  const text = readFileSync(join(ROOT, name), 'utf8').replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  text.split('\n').forEach((l, k) => { if (CYR.test(l)) bad(`${name}:${k + 1}  кириллица: ${l.trim().slice(0, 70)}`); });
}
console.log(`  инфо проверено файлов кода: ${files.length}, строковых литералов: ${literals}`);

// --- 2. словари
const en = (await import('../src/i18n/en.js')).default, ru = (await import('../src/i18n/ru.js')).default;
const kind = (v) => (Array.isArray(v) ? 'список' : typeof v);
const params = (v) => [...new Set(String(Array.isArray(v) ? v.join(' ') : v).match(/\{\w+\}/g) || [])].sort().join(',');
for (const k of Object.keys(en)) if (!(k in ru)) bad(`ключ «${k}» есть в en.js, но нет в ru.js`);
for (const k of Object.keys(ru)) if (!(k in en)) bad(`ключ «${k}» есть в ru.js, но нет в en.js`);
for (const k of Object.keys(en)) {
  if (!(k in ru)) continue;
  if (kind(en[k]) !== kind(ru[k])) bad(`ключ «${k}»: в en.js ${kind(en[k])}, в ru.js ${kind(ru[k])}`);
  else if (params(en[k]) !== params(ru[k])) bad(`ключ «${k}»: разные подстановки — en {${params(en[k])}}, ru {${params(ru[k])}}`);
  if (Array.isArray(en[k]) && Array.isArray(ru[k]) && en[k].length !== ru[k].length) bad(`ключ «${k}»: в списках разное число строк (${en[k].length} и ${ru[k].length})`);
  for (const [lang, d] of [['en', en], ['ru', ru]]) if ((Array.isArray(d[k]) ? d[k] : [d[k]]).some((s) => typeof s !== 'string' || !s.trim())) bad(`ключ «${k}»: пустое значение в ${lang}.js`);
  if (CYR.test(Array.isArray(en[k]) ? en[k].join('') : en[k])) bad(`ключ «${k}»: кириллица в английском тексте`);
}

// --- 3. ключи, которые собираются из данных
const { LEVELS, stageCount } = await import('../src/levels.js');
const { HEISTS } = await import('../src/heists.js');
const { LOOT } = await import('../src/loot-types.js');
const { COSMETICS } = await import('../src/cosmetics.js');
const need = [];
for (const l of LEVELS) {
  need.push(`level.${l.id}.name`);
  if (l.stages) for (let s = 1; s <= stageCount(l); s++) need.push(`level.${l.id}.s${s}.hint`); else need.push(`level.${l.id}.hint`);
}
for (const h of HEISTS) need.push(`heist.${h.id}.name`, `heist.${h.id}.tagline`);
for (const [id, type] of Object.entries(LOOT)) { need.push(`loot.${id}.name`, `loot.${id}.fall`); if (type.fragile) need.push(`loot.${id}.broken`); }
for (const c of COSMETICS) need.push(`cosmetic.${c.id}`);
for (const k of need) if (!(k in en)) bad(`нет ключа «${k}», который нужен игре`);

// ключи, запрошенные в коде напрямую: t('…') / tList('…')
const used = new Set(need);
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/\b(?:t|tList|tPick|say)\(\s*'([\w.]+)'/g)) { used.add(m[1]); if (!(m[1] in en)) bad(`${relative(ROOT, file)}: запрошен ключ «${m[1]}», которого нет в словаре`); }
}
const prefixes = [...new Set([...files].flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/\b(?:t|tList|tPick|say)\(\s*`([\w.]+)\$\{/g)].map((m) => m[1])))];
const unused = Object.keys(en).filter((k) => !used.has(k) && !prefixes.some((p) => k.startsWith(p)));
if (unused.length) console.log(`  инфо ключи без прямого обращения в коде (${unused.length}): ${unused.slice(0, 12).join(', ')}${unused.length > 12 ? '…' : ''}`);

console.log(`  инфо ключей в словарях: en ${Object.keys(en).length}, ru ${Object.keys(ru).length}`);
console.log(problems ? `\nЗамечаний: ${problems}` : '\nЛокализация в порядке');
process.exit(problems ? 1 : 0);
