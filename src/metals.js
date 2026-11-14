// Металлы слитков — только данные (без three.js: файл читают и проверки в Node).
//
// Игрок выбирает металл в меню; выбор хранится в сохранении (поле metal). Металл действует на типы добычи
// с пометкой metal: true в src/loot-types.js — это слиток (bar) и большой слиток (bigbar). Остальная добыча не меняется.
//
//   density     — плотность относительно золота. На неё умножается масса слитка: от массы зависят усталость руки,
//                 весы (порог веса умножается на ту же плотность — иначе лёгкий слиток сам поднимал бы тревогу)
//                 и то, как слиток «провисает» в руке.
//   slip        — множитель скорости, при которой слиток выскальзывает из пальцев: меньше 1 — держится хуже
//                 (тяжёлый), больше 1 — лучше (лёгкий). Число можно менять, не трогая ничего другого.
//   material    — имя материала из src/textures.js.
//   unlockStars — сколько звёзд всего нужно, чтобы металл появился в меню. Сейчас все доступны сразу (0);
//                 чтобы открывать за звёзды, достаточно поменять одну цифру — как в src/cosmetics.js.
//
// ЗОЛОТО — ЭТАЛОН: density 1 и slip 1. С ним игра ведёт себя точно так же, как до появления металлов,
// и время автопилота (BASELINE в tools/test/play.mjs) не меняется. Эти две единицы трогать нельзя.
// Названия — в словарях src/i18n/ (ключи metal.<id>.*).

export const METALS = [
  { id: 'gold', density: 1, slip: 1, material: 'gold', unlockStars: 0 },
  { id: 'platinum', density: 1.11, slip: 0.95, material: 'platinum', unlockStars: 0 },
  { id: 'silver', density: 0.54, slip: 1.2, material: 'silver', unlockStars: 0 },
  { id: 'bronze', density: 0.46, slip: 1.25, material: 'bronze', unlockStars: 0 },
];

export const DEFAULT_METAL = 'gold';

/** Металл по id; неизвестный id — золото. */
export const metalById = (id) => METALS.find((m) => m.id === id) || METALS[0];

/** Металлы, открытые при таком числе звёзд. */
export const unlockedMetals = (stars) => METALS.filter((m) => stars >= m.unlockStars);
