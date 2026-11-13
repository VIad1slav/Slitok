// Сохранение и настройки игрока.
//
// Это два небольших набора данных:
//   save     — прогресс: рекорды по уровням и выбранный вид руки. Что открыто (ограбления, косметика),
//              не хранится, а каждый раз считается из звёзд.
//   settings — настройки: язык, громкость, графика, управление.
// Где они лежат, решает src/platform.js: в настольном приложении — файлы save.json и settings.json
// в папке данных игрока, в браузере — localStorage.
//
// Версии сохранения:
//   1 (без поля version) — { best, skin, volume };
//   2 — добавлены version и accessory;
//   3 — добавлен lang;
//   4 — настройки (volume, lang, noFlicker) переехали в settings; в save остались best, skin, accessory;
//   5 — добавлены achievements (полученные достижения) и stats (счётчики, например «сколько раз разбито стекло»).
// Любая старая версия читается без потерь: рекорды и рука остаются, настройки переносятся в settings.
import { cosmeticById } from './cosmetics.js';
import { LANGS } from './i18n/index.js';
import { platform } from './platform.js';

export const SAVE_VERSION = 5;
export const SETTINGS_VERSION = 1;

export const SAVE_DEFAULTS = { version: SAVE_VERSION, best: {}, skin: 'skin', accessory: null, achievements: {}, stats: {} };
export const SETTINGS_DEFAULTS = {
  version: SETTINGS_VERSION,
  lang: null,            // null — язык системы
  volume: 0.7,           // громкость эффектов, 0..1
  noFlicker: false,      // true — свет перед темнотой гаснет плавно, без мигания
  fullscreen: true,      // настольное приложение: открываться на весь экран
};

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v, min, max, def) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def);

/** Привести прочитанное сохранение к текущему виду. Незнакомые и испорченные поля заменяются значениями по умолчанию. */
export function migrateSave(raw) {
  const src = isObj(raw) ? raw : {};
  const save = { ...SAVE_DEFAULTS, best: {}, achievements: {}, stats: {} };
  if (isObj(src.best)) {
    for (const [id, r] of Object.entries(src.best)) {
      if (isObj(r) && Number.isFinite(r.stars) && Number.isFinite(r.time)) save.best[id] = { stars: Math.min(3, Math.max(1, Math.round(r.stars))), time: r.time, touches: Number.isFinite(r.touches) ? r.touches : 0 };
    }
  }
  if (typeof src.skin === 'string' && cosmeticById(src.skin).id === src.skin && cosmeticById(src.skin).kind === 'hand') save.skin = src.skin;   // неизвестный вариант руки → кожа
  if (typeof src.accessory === 'string' && cosmeticById(src.accessory).id === src.accessory && cosmeticById(src.accessory).kind === 'accessory') save.accessory = src.accessory;
  if (isObj(src.achievements)) for (const [id, v] of Object.entries(src.achievements)) if (v === true && /^[A-Z0-9_]{1,64}$/.test(id)) save.achievements[id] = true;
  if (isObj(src.stats)) for (const [k, v] of Object.entries(src.stats)) if (Number.isFinite(v) && v >= 0) save.stats[k] = v;
  return save;
}

/**
 * Привести настройки к текущему виду. legacy — сохранение старой версии (до 4): если отдельных настроек ещё нет,
 * громкость, язык и «мигание света» берутся из него.
 */
export function migrateSettings(raw, legacy = null) {
  const src = isObj(raw) ? raw : (isObj(legacy) ? { volume: legacy.volume, lang: legacy.lang, noFlicker: legacy.noFlicker } : {});
  const s = { ...SETTINGS_DEFAULTS };
  s.lang = LANGS.includes(src.lang) ? src.lang : null;                    // неизвестный язык → язык системы
  s.volume = num(src.volume, 0, 1, s.volume);
  s.noFlicker = src.noFlicker === true;
  if (typeof src.fullscreen === 'boolean') s.fullscreen = src.fullscreen;
  return s;
}

/** Прочитать сохранение и настройки. Ничего не бросает: при любой беде возвращаются значения по умолчанию. */
export function loadAll() {
  const rawSave = platform.store.read('save'), rawSettings = platform.store.read('settings');
  const save = migrateSave(rawSave.data), settings = migrateSettings(rawSettings.data, rawSave.data);
  // сохранение пришло из другого места (старый localStorage) или в старом виде — сразу записываем в новом
  if (rawSave.data && (rawSave.migrated || rawSave.data.version !== SAVE_VERSION)) platform.store.write('save', save, true);
  if (rawSettings.migrated || (!rawSettings.data && rawSave.data)) platform.store.write('settings', settings, true);
  return { save, settings, notes: { save: rawSave.note, settings: rawSettings.note } };
}

export const storeSave = (save) => platform.store.write('save', save, true);          // прогресс пишется сразу
export const storeSettings = (settings) => platform.store.write('settings', settings);   // настройки — с небольшой задержкой (ползунки)
