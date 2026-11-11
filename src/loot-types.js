// Типы добычи — только данные (без three.js и cannon-es: этот файл читают и проверки в Node).
//
// Локальные оси предмета: X — длина, Y — высота (вверх), Z — ширина. Начало координат — центр предмета.
//
// Поля типа:
//   name        — название для игрока
//   failFall    — причина провала, если предмет упал со стола
//   bounds      — габариты [X, Y, Z], м (для проверок геометрии и постановки на подставку)
//   shapes      — форма для физики и для руки: список примитивов
//                 { type: 'box', half: [x, y, z] } | { type: 'cylinder', radius, height } (ось Y) | { type: 'sphere', radius },
//                 у каждого необязательные pos: [x, y, z] и rot: [x, y, z] (градусы)
//   held        — сферы [x, y, z, r], которыми предмет участвует в проверке «кулак пролезает в отверстие», пока он в руке
//   mass, friction — значения по умолчанию (уровень может переопределить)
//   maxSpeed    — предел скорости, м/с (защита от пролёта сквозь стенки); по умолчанию PHYS.barMaxSpeed
//   slipSpeed   — если задано: скорость кисти, при которой предмет выскальзывает (иначе берётся из уровня / HAND)
//   model       — имя GLB в assets/models (без расширения); нет файла — рисуется запасная форма из примитивов
//   material    — имя материала из src/textures.js
//   topScale    — только для слитка: сужение верхней грани (запасная геометрия и Blender)

/** Сетка сфер вдоль длины предмета: rows — смещения рядов по ширине, cols — число сфер в ряду. */
function gridSpheres(length, rows, cols, r) {
  const out = [], step = (length - 2 * r) / (cols - 1);
  for (const z of rows) for (let i = 0; i < cols; i++) out.push([-length / 2 + r + i * step, 0, z, r]);
  return out;
}

export const LOOT = {
  bar: {
    name: 'Слиток',
    failFall: 'Слиток упал со стола',
    bounds: [0.22, 0.045, 0.075],
    shapes: [{ type: 'box', half: [0.11, 0.0225, 0.0375] }],
    held: gridSpheres(0.22, [-0.0125, 0, 0.0125], 9, 0.0225),
    mass: 1,
    friction: 0.6,
    model: 'gold_bar',
    material: 'gold',
    topScale: 0.78,
  },
};

/**
 * Список предметов уровня в едином виде. Старая запись уровня `bar: {...}` читается как один слиток.
 * Элемент: { type, pos: [x, y, z] (низ предмета относительно центра дна коробки), yaw (градусы), mass, friction, role }.
 * role: 'target' — добыча, которую надо донести в сейф; 'prop' — реквизит (например, груз для подмены).
 */
export function levelLoot(level) {
  const list = level.loot || (level.bar ? [{ type: 'bar', ...level.bar }] : []);
  return list.map((it) => {
    const type = LOOT[it.type];
    if (!type) throw new Error(`Неизвестный тип добычи «${it.type}» на уровне ${level.id}`);
    return { role: 'target', yaw: 0, ...it, mass: it.mass ?? type.mass, friction: it.friction ?? type.friction };
  });
}

/** Сколько предметов надо донести для победы. */
export function lootNeeded(level) {
  const targets = levelLoot(level).filter((it) => it.role === 'target').length;
  return Math.min(level.need ?? targets, targets);
}
