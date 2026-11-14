// Локализация: весь текст, который видит игрок, лежит в словарях src/i18n/en.js и src/i18n/ru.js.
// В остальном коде текста нет — только ключи: t('menu.play'), t('win.title', { heist, number }).
// Проверка tools/check_i18n.mjs следит, что наборы ключей совпадают и что в коде не осталось русских строк.
//
// Файл не зависит от браузера: его читают и проверки в Node (там язык — русский, пока не задан другой).
import en from './en.js';
import ru from './ru.js';

const DICTS = { en, ru };
export const LANGS = Object.keys(DICTS);
export const DEFAULT_LANG = 'en';

let current = 'ru';

/** Язык системы: русский, если язык браузера/ОС начинается с «ru», иначе английский. */
export function detectLang() {
  const sys = (typeof navigator !== 'undefined' && (navigator.language || navigator.languages?.[0])) || '';
  return String(sys).toLowerCase().startsWith('ru') ? 'ru' : DEFAULT_LANG;
}

export const getLang = () => current;
/** Выбрать язык; неизвестный или пустой код — язык системы. Возвращает выбранный язык. */
export function setLang(lang) {
  current = DICTS[lang] ? lang : detectLang();
  if (typeof document !== 'undefined') document.documentElement.lang = current;
  return current;
}
/** Название языка на нём самом — для переключателя. */
export const langName = (lang) => DICTS[lang]?.['lang.self'] ?? lang;

const lookup = (key) => DICTS[current][key] ?? en[key];

// Металл слитка, выбранный игроком. Любой текст может упомянуть его подстановками {metal} («золото») и {Metal} («Золото»):
// они доступны всегда, передавать их в t() не нужно.
let metal = 'gold';
export const setTextMetal = (id) => { metal = DICTS.en[`metal.${id}.name`] ? id : 'gold'; };
const always = (k) => (k === 'metal' ? lookup(`metal.${metal}.name`) : k === 'Metal' ? lookup(`metal.${metal}.cap`) : undefined);
const fill = (s, params) => s.replace(/\{(\w+)\}/g, (m, k) => (params && k in params ? params[k] : always(k) ?? m));

/** Текст по ключу; params подставляются на место {имён}. Нет ключа — возвращается сам ключ (и это видно на экране). */
export function t(key, params) {
  const v = lookup(key);
  return typeof v === 'string' ? fill(v, params) : key;
}
/** Список строк по ключу (например, строки управления). */
export const tList = (key) => { const v = lookup(key); return Array.isArray(v) ? v : []; };
/** Случайная строка из списка (фразы на экране поражения). */
export const tPick = (key, params) => { const v = tList(key); return v.length ? fill(v[Math.floor(Math.random() * v.length)], params) : key; };

// --- тексты, привязанные к данным игры. Поле name / hint в самом описании (так делают проверки) важнее словаря.
export const levelName = (level) => level.name ?? t(`level.${level.id}.name`);
export const levelHint = (level) => level.hint ?? t(level.stage ? `level.${level.id}.s${level.stage}.hint` : `level.${level.id}.hint`);
export const heistName = (heist) => t(`heist.${heist.id}.name`);
export const heistTagline = (heist) => t(`heist.${heist.id}.tagline`);
// У слитков (тип с пометкой metal) название зависит от металла: m — запись из src/metals.js или её id; не задан — выбранный игроком.
const metalKey = (type, m, suffix) => `metal.${(typeof m === 'string' ? m : m?.id) || metal}.${type.id}${suffix}`;
export const lootName = (type, m) => type.name ?? (type.metal ? t(metalKey(type, m, '')) : t(`loot.${type.id}.name`));
export const lootFall = (type, m) => type.failFall ?? (type.metal ? t(metalKey(type, m, 'Fall')) : t(`loot.${type.id}.fall`));
export const metalName = (m) => t(`metal.${m.id}.name`);
export const lootBroken = (type) => type.failBreak ?? t(`loot.${type.id}.broken`);
export const cosmeticName = (c) => t(`cosmetic.${c.id}`);
