// Кампания: ограбления и порядок уровней в них — только данные и простые подсчёты
// (без three.js: файл читают и проверки в Node).
//
// Названия и подписи ограблений — в словарях src/i18n/ (ключи heist.<id>.name и heist.<id>.tagline).
// levels      — id уровней из src/levels.js в порядке прохождения. Рекорды хранятся по id,
//               поэтому уровень можно переставить в другое ограбление, не потеряв сохранения.
// bonus       — дополнительное ограбление вне основной кампании (не учитывается в достижениях про всю кампанию).
// unlockStars — сколько звёзд всего (по всем ограблениям) нужно, чтобы открыть это ограбление.
// theme       — обстановка: свет, оттенки, стол, набор предметов (поля — DEFAULT_THEME в src/scene.js). Нет — хранилище банка.
import { LEVELS } from './levels.js';

export const STARS_PER_LEVEL = 3;

export const HEISTS = [
  {
    id: 'pawnshop', unlockStars: 0, levels: [1, 2, 9, 3, 4, 10, 7, 11],
    // тёплая лампа, желтоватый полумрак, деревянный стол, стеллажи с вещами
    theme: { spotColor: 0xffdca6, fillSky: 0x6f7a4c, fillIntensity: 0.4, rimColor: 0xffa040, rimIntensity: 3, tint: { concrete: [1.15, 1.05, 0.82] }, table: 'wood', set: 'pawnshop' },
  },
  {
    id: 'museum', unlockStars: 12, levels: [12, 5, 13, 14, 15, 16, 17, 18],
    // холодный белый луч и синие тени, светлые стены, каменный стол
    theme: { spotColor: 0xe6eeff, spotIntensity: 12, fillSky: 0x5a7ad0, fillIntensity: 0.5, rimColor: 0x8fb0ff, rimIntensity: 2.5, fog: 0x05070c, tint: { concrete: [1.5, 1.6, 1.9], tiles: [1, 1.02, 1.12] }, table: 'stone', set: 'museum' },
  },
  {
    id: 'bank', unlockStars: 26, levels: [19, 20, 21, 22, 23, 24, 25, 26],
    // нейтральный белый свет, сталь: дверь хранилища, ячейки, стальной стол
    theme: { spotColor: 0xf4f6ff, fillSky: 0x7088a8, fillIntensity: 0.42, rimColor: 0xa8c0ff, rimIntensity: 2.5, table: 'steelTable', set: 'bank' },
  },
  {
    id: 'casino', unlockStars: 43, levels: [27, 6, 28, 8, 29, 30, 31, 32],
    // пурпур и изумруд, неон, зелёное сукно
    theme: { spotColor: 0xffe0f4, fillSky: 0x1f9a70, fillGround: 0x14061a, fillIntensity: 0.5, rimColor: 0xff46c0, rimIntensity: 3.5, fog: 0x08040c, tint: { concrete: [0.75, 0.55, 1.0], tiles: [0.9, 0.8, 1.1] }, table: 'felt', set: 'casino' },
  },
  {
    id: 'boss', unlockStars: 62, levels: [33, 34, 35, 36, 37, 38, 39, 40],
    // красное золото и глубокая тень, тёмный стол, дверь сейфа вплотную
    theme: { spotColor: 0xffd49a, fillSky: 0x7a2418, fillGround: 0x0a0406, fillIntensity: 0.45, rimColor: 0xffb030, rimIntensity: 4, fog: 0x0a0405, tint: { concrete: [1.05, 0.62, 0.55], tiles: [1.1, 0.85, 0.8], wood: [0.32, 0.22, 0.2] }, table: 'wood', set: 'boss' },   // стол — то же дерево, затемнённое почти до чёрного (отдельный лаковый материал стоил 5 % кадра)
  },
  {
    // Дополнительное ограбление после кампании: витрина с круглым отверстием, предел досягаемости и усталость руки.
    // bonus — в достижения «вся кампания» и «все звёзды» не входит (они про 40 уровней пяти ограблений).
    // Обстановка — зал музея: отдельного набора для «Витрины» нет.
    id: 'vitrine', unlockStars: 85, levels: [41, 42, 43], bonus: true,
    theme: { spotColor: 0xfff1d6, spotIntensity: 13, fillSky: 0x5a7ad0, fillIntensity: 0.45, rimColor: 0xffc070, rimIntensity: 3, fog: 0x05070c, tint: { concrete: [1.4, 1.45, 1.6], tiles: [1, 1.02, 1.12] }, table: 'stone', set: 'museum' },
  },
];

const byId = new Map(LEVELS.map((l) => [l.id, l]));
export const levelById = (id) => byId.get(id);

/** Все уровни кампании по порядку: [{ level, heist, number }], number — номер внутри ограбления с 1. */
export function campaignOrder() {
  const out = [];
  for (const heist of HEISTS) heist.levels.forEach((id, i) => { const level = byId.get(id); if (level) out.push({ level, heist, number: i + 1 }); });
  return out;
}

/** Место уровня в кампании: { level, heist, number } или null. */
export function placeOf(levelId) {
  return campaignOrder().find((e) => e.level.id === levelId) || null;
}

export function totalStars(save) {
  let n = 0;
  for (const e of campaignOrder()) n += save.best[e.level.id]?.stars || 0;
  return n;
}

export function heistStars(heist, save) {
  let n = 0;
  for (const id of heist.levels) n += save.best[id]?.stars || 0;
  return { have: n, max: heist.levels.length * STARS_PER_LEVEL };
}

export const isHeistUnlocked = (heist, save) => totalStars(save) >= heist.unlockStars;

/** Следующий уровень кампании после данного: { level, heist, number, locked } или null, если это последний. */
export function nextAfter(levelId, save) {
  const order = campaignOrder(), i = order.findIndex((e) => e.level.id === levelId);
  if (i < 0 || i + 1 >= order.length) return null;
  const next = order[i + 1];
  return { ...next, locked: !isHeistUnlocked(next.heist, save) };
}

/** С какого уровня продолжать: первый непройденный в открытых ограблениях, иначе самый первый. */
export function continueLevel(save) {
  const order = campaignOrder();
  const e = order.find((x) => isHeistUnlocked(x.heist, save) && !save.best[x.level.id]);
  return (e || order[0]).level;
}
