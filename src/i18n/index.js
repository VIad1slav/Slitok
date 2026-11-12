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
const fill = (s, params) => (params ? s.replace(/\{(\w+)\}/g, (m, k) => (k in params ? params[k] : m)) : s);

/** Текст по ключу; params подставляются на место {имён}. Нет ключа — возвращается сам ключ (и это видно на экране). */
export function t(key, params) {
  const v = lookup(key);
  return typeof v === 'string' ? fill(v, params) : key;
}
/** Список строк по ключу (например, строки управления). */
export const tList = (key) => { const v = lookup(key); return Array.isArray(v) ? v : []; };
/** Случайная строка из списка (фразы на экране поражения). */
export const tPick = (key) => { const v = tList(key); return v.length ? v[Math.floor(Math.random() * v.length)] : key; };

// --- тексты, привязанные к данным игры. Поле name / hint в самом описании (так делают проверки) важнее словаря.
export const levelName = (level) => level.name ?? t(`level.${level.id}.name`);
export const levelHint = (level) => level.hint ?? t(level.stage ? `level.${level.id}.s${level.stage}.hint` : `level.${level.id}.hint`);
export const heistName = (heist) => t(`heist.${heist.id}.name`);
export const heistTagline = (heist) => t(`heist.${heist.id}.tagline`);
export const lootName = (type) => type.name ?? t(`loot.${type.id}.name`);
export const lootFall = (type) => type.failFall ?? t(`loot.${type.id}.fall`);
export const lootBroken = (type) => type.failBreak ?? t(`loot.${type.id}.broken`);
export const cosmeticName = (c) => t(`cosmetic.${c.id}`);
