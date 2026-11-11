// Тексты интерфейса, добавленные вместе с кампанией, — в одном месте, чтобы игру было проще переводить.
// Названия уровней и подсказки лежат в src/levels.js, названия ограблений — в src/heists.js,
// названия добычи — в src/loot-types.js, косметики — в src/cosmetics.js.
// Функции — для строк с подстановкой чисел и названий.

export const T = {
  levelSelect: 'Ограбления',
  hudLevel: (heist, number, name) => `${heist} · ${number} · ${name}`,
  hudLevelPlain: (id, name) => `Уровень ${id} · ${name}`,
  hudLoot: 'Добыча',
  winTitle: (heist, number) => `${heist}, уровень ${number} пройден`,
  heistLocked: (need, have) => `Откроется за ${need} ★ — сейчас ${have}`,
  heistEmpty: 'Уровни этого ограбления ещё в работе',
  heistStars: (have, max) => `${have} / ${max} ★`,
  nextLocked: (heist, need, have) => `«${heist}» откроется за ${need} ★ — у тебя ${have}. Перепройди уровни на большее число звёзд.`,
  campaignDone: 'Это был последний уровень из готовых.',
  handLabel: 'Рука',
  itemBanked: (done, total) => `В сейфе ${done} из ${total}`,
  propLost: 'Реквизит упал со стола',
  slipped: 'Выскользнул!',
};
