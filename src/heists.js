// Кампания: ограбления и порядок уровней в них — только данные и простые подсчёты
// (без three.js: файл читают и проверки в Node).
//
// levels      — id уровней из src/levels.js в порядке прохождения. Рекорды хранятся по id,
//               поэтому уровень можно переставить в другое ограбление, не потеряв сохранения.
// unlockStars — сколько звёзд всего (по всем ограблениям) нужно, чтобы открыть это ограбление.
import { LEVELS } from './levels.js';

export const STARS_PER_LEVEL = 3;

export const HEISTS = [
  { id: 'pawnshop', name: 'Ломбард', tagline: 'Обучение: слиток и первые ловушки', unlockStars: 0, levels: [1, 2, 3, 4, 7] },
  { id: 'museum', name: 'Музей', tagline: 'Лазеры, камера, хрупкая ваза', unlockStars: 12, levels: [5] },
  { id: 'bank', name: 'Банк', tagline: 'Перегородки, заслонка, весы', unlockStars: 26, levels: [] },
  { id: 'casino', name: 'Казино', tagline: 'Карусель, темнота, скользкая добыча', unlockStars: 43, levels: [6, 8] },
  { id: 'boss', name: 'Сейф босса', tagline: 'Всё вместе', unlockStars: 62, levels: [] },
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
