// Достижения — данные и правила. Здесь нет ни Steam, ни интерфейса: только «что считается выполненным».
// Отправкой в Steam занимается src/platform.js (в браузере достижения просто запоминаются в сохранении).
//
// id — имя достижения в Steamworks (API Name): менять его после заведения в Steamworks нельзя.
// Названия и описания — в словарях src/i18n/ (ключи ach.<id>.name и ach.<id>.desc); таблица для Steamworks
// собирается из них же: node tools/steam/achievements_doc.mjs.
//
// Два вида правил:
//   progress(ctx) — выполнено ли по накопленному прогрессу (рекорды, счётчики). Проверяется при запуске и после каждой победы,
//                   поэтому такое достижение выдаётся и тем, кто выполнил условие до его появления;
//   event(name, data, ctx) — выполнено ли прямо сейчас, по событию игры: 'win' { level, time, touches, stars },
//                   'lootBroken' { type }, 'glassBroken'.
import { HEISTS, STARS_PER_LEVEL, totalStars } from './heists.js';
import { COSMETICS } from './cosmetics.js';

const heist = (id) => HEISTS.find((h) => h.id === id);
const heistDone = (id) => ({ best }) => heist(id).levels.every((l) => best[l]);
const heistPerfect = (id) => ({ best }) => heist(id).levels.every((l) => best[l]?.stars === STARS_PER_LEVEL);
const allLevels = () => HEISTS.filter((h) => !h.bonus).flatMap((h) => h.levels);   // кампания: 40 уровней пяти ограблений, без дополнительных

export const NO_TOUCH_LEVEL = 32;      // «Джекпот»: бриллиант на карусели, маленькое отверстие, свет гаснет
export const SPEED_SECONDS = 10;       // «быстрее десяти секунд»
export const GLASS_BREAKS = 10;        // сколько раз разбить стекло для шуточного достижения

export const ACHIEVEMENTS = [
  // --- прохождение ограблений
  { id: 'HEIST_PAWNSHOP', icon: { item: 'bar', heist: 'pawnshop' }, progress: heistDone('pawnshop') },
  { id: 'HEIST_MUSEUM', icon: { item: 'crown', heist: 'museum' }, progress: heistDone('museum') },
  { id: 'HEIST_BANK', icon: { item: 'coins', heist: 'bank' }, progress: heistDone('bank') },
  { id: 'HEIST_CASINO', icon: { item: 'chips', heist: 'casino' }, progress: heistDone('casino') },
  { id: 'HEIST_BOSS', icon: { item: 'bigbar', heist: 'boss' }, progress: heistDone('boss') },
  // --- все три звезды на каждом уровне ограбления
  { id: 'STARS_PAWNSHOP', icon: { item: 'bar', heist: 'pawnshop', stars: true }, progress: heistPerfect('pawnshop') },
  { id: 'STARS_MUSEUM', icon: { item: 'crown', heist: 'museum', stars: true }, progress: heistPerfect('museum') },
  { id: 'STARS_BANK', icon: { item: 'coins', heist: 'bank', stars: true }, progress: heistPerfect('bank') },
  { id: 'STARS_CASINO', icon: { item: 'chips', heist: 'casino', stars: true }, progress: heistPerfect('casino') },
  { id: 'STARS_BOSS', icon: { item: 'bigbar', heist: 'boss', stars: true }, progress: heistPerfect('boss') },
  // --- вся кампания
  { id: 'ALL_LEVELS', icon: { item: 'pile' }, progress: ({ best }) => allLevels().every((l) => best[l]) },
  { id: 'ALL_STARS', icon: { item: 'star' }, progress: ({ best }) => allLevels().every((l) => best[l]?.stars === STARS_PER_LEVEL) },
  { id: 'ALL_COSMETICS', icon: { item: 'glove' }, progress: ({ stars }) => stars >= Math.max(...COSMETICS.map((c) => c.unlockStars)) },
  // --- мастерство
  { id: 'MONKEY_TRAP', icon: { item: 'fist' }, progress: ({ best }) => !!best[3] },
  { id: 'NO_TOUCH', icon: { item: 'diamond' }, event: (name, d) => name === 'win' && d.level === NO_TOUCH_LEVEL && d.touches === 0 },
  { id: 'SPEEDRUN', icon: { item: 'watch' }, event: (name, d) => name === 'win' && d.time < SPEED_SECONDS },
  // --- шуточные
  { id: 'BREAK_VASE', icon: { item: 'vase' }, event: (name, d) => name === 'lootBroken' && d.type === 'vase' },
  { id: 'GLASS_BREAKER', icon: { item: 'glass' }, progress: ({ stats }) => (stats.glassBroken || 0) >= GLASS_BREAKS },
];

/**
 * Следит за достижениями одного игрока.
 * save.achievements — что уже получено ({ id: true }), save.stats — счётчики. onUnlock(id) вызывается один раз на достижение.
 */
export class Achievements {
  constructor(save, { onUnlock, onChange } = {}) {
    this.save = save; this.onUnlock = onUnlock; this.onChange = onChange;
  }
  _ctx() { return { best: this.save.best, stats: this.save.stats, stars: totalStars(this.save) }; }
  _grant(id) {
    if (this.save.achievements[id]) return false;
    this.save.achievements[id] = true;
    this.onUnlock?.(id);
    return true;
  }
  /** Событие игры. Возвращает список только что полученных достижений. */
  emit(name, data = {}) {
    if (name === 'glassBroken') this.save.stats.glassBroken = (this.save.stats.glassBroken || 0) + 1;
    const ctx = this._ctx(), got = [];
    for (const a of ACHIEVEMENTS) {
      if (this.save.achievements[a.id]) continue;
      if ((a.event && a.event(name, data, ctx)) || (a.progress && a.progress(ctx))) { this._grant(a.id); got.push(a.id); }
    }
    if (got.length || name === 'glassBroken') this.onChange?.();
    return got;
  }
  /** При запуске: выдать то, что уже заработано прогрессом, и вернуть полный список полученного (его заново отправляют в Steam). */
  sync() {
    this.emit('sync');
    return Object.keys(this.save.achievements).filter((id) => ACHIEVEMENTS.some((a) => a.id === id));
  }
}
