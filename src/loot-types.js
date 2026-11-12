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
//   modelScale  — если задано: масштаб модели по осям [X, Y, Z] (одна модель для предметов разного размера)
//   model       — имя GLB в assets/models (без расширения); нет файла — рисуется запасная форма из примитивов
//   material    — имя материала из src/textures.js
//   dropImpact  — если задано: удар руки с предметом о стекло быстрее этого (м/с) выбивает предмет из пальцев
//   topScale    — только для слитка: сужение верхней грани (запасная геометрия и Blender)
//   fragile     — хрупкий предмет: { crackSpeed, breakSpeed, cracks } — удар быстрее crackSpeed (м/с) оставляет трещину,
//                 удар быстрее breakSpeed или трещина номер cracks разбивают его; failBreak — причина провала

/** Сетка сфер вдоль длины предмета: rows — смещения рядов по ширине, cols — число сфер в ряду. */
function gridSpheres(length, rows, cols, r) {
  const out = [], step = (length - 2 * r) / (cols - 1);
  for (const z of rows) for (let i = 0; i < cols; i++) out.push([-length / 2 + r + i * step, 0, z, r]);
  return out;
}

/** Кольцо из n брусков радиуса r (корона): half — полуразмеры бруска [вдоль кольца, высота, толщина]. */
function ringBoxes(n, r, half) {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * 360, t = (a * Math.PI) / 180;
    return { type: 'box', half, pos: [r * Math.cos(t), 0, r * Math.sin(t)], rot: [0, 90 - a, 0] };
  });
}
function ringSpheres(n, r, sphereR) {
  return Array.from({ length: n }, (_, i) => { const t = (i / n) * Math.PI * 2; return [r * Math.cos(t), 0, r * Math.sin(t), sphereR]; });
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
  // Большой слиток: 26 × 5,5 × 9 см, 6 кг. Тяжёлый — выскальзывает уже при небыстром движении.
  bigbar: {
    name: 'Большой слиток',
    failFall: 'Большой слиток упал со стола',
    bounds: [0.26, 0.055, 0.09],
    shapes: [{ type: 'box', half: [0.13, 0.0275, 0.045] }],
    held: gridSpheres(0.26, [-0.0175, 0, 0.0175], 9, 0.0275),
    mass: 6,
    friction: 0.6,
    slipSpeed: 0.9,
    model: 'gold_bar',
    modelScale: [0.26 / 0.22, 0.055 / 0.045, 0.09 / 0.075],   // та же модель слитка, увеличенная до габаритов
    material: 'gold',
    topScale: 0.78,
  },
  // Ваза: стоит вертикально, бьётся. Тулово ⌀8 см и горлышко ⌀4,4 см, общая высота 14 см.
  vase: {
    name: 'Ваза',
    failFall: 'Ваза упала со стола',
    failBreak: 'Ваза разбита',
    bounds: [0.08, 0.14, 0.08],
    shapes: [{ type: 'cylinder', radius: 0.04, height: 0.1, pos: [0, -0.02, 0] }, { type: 'cylinder', radius: 0.022, height: 0.04, pos: [0, 0.05, 0] }],
    held: [[0, -0.03, 0, 0.04], [0, 0.0, 0, 0.04], [0, 0.05, 0, 0.023]],
    mass: 0.7,
    friction: 0.7,
    fragile: { crackSpeed: 0.7, breakSpeed: 1.3, cracks: 2 },
    model: 'vase',
    material: 'vase',
  },
  // Корона: широкое низкое кольцо ⌀15 см, высота 5 см. В узкую щель проходит только ребром.
  crown: {
    name: 'Корона',
    failFall: 'Корона упала со стола',
    bounds: [0.15, 0.05, 0.15],
    shapes: ringBoxes(8, 0.067, [0.027, 0.025, 0.008]),
    held: ringSpheres(8, 0.055, 0.02),
    mass: 0.8,
    friction: 0.6,
    model: 'crown',
    material: 'crown',
  },
  // Стопка монет: маленький цилиндр ⌀4 см, высота 4 см.
  coins: {
    name: 'Стопка монет',
    failFall: 'Монеты упали со стола',
    bounds: [0.04, 0.04, 0.04],
    shapes: [{ type: 'cylinder', radius: 0.02, height: 0.04 }],
    held: [[0, 0, 0, 0.02]],
    mass: 0.3,
    friction: 0.7,
    model: 'coins',
    material: 'brass',
  },
  // Фишки казино: стопка из четырёх, ⌀4,4 см, высота 2 см.
  chips: {
    name: 'Фишки',
    failFall: 'Фишки упали со стола',
    bounds: [0.044, 0.02, 0.044],
    shapes: [{ type: 'cylinder', radius: 0.022, height: 0.02 }],
    held: [[0, 0, 0, 0.022]],
    mass: 0.1,
    friction: 0.7,
    model: 'chips',
    material: 'chips',
  },
  // Игральный кубик 3,5 см.
  dice: {
    name: 'Кубик',
    failFall: 'Кубик упал со стола',
    bounds: [0.035, 0.035, 0.035],
    shapes: [{ type: 'box', half: [0.0175, 0.0175, 0.0175] }],
    held: [[0, 0, 0, 0.02]],
    mass: 0.08,
    friction: 0.6,
    model: 'dice',
    material: 'dice',
  },
  // Бриллиант: крошечный и скользкий. Выскальзывает уже на небольшой скорости, выпадает от удара руки о стекло.
  diamond: {
    name: 'Бриллиант',
    failFall: 'Бриллиант упал со стола',
    bounds: [0.03, 0.022, 0.03],
    shapes: [{ type: 'box', half: [0.014, 0.011, 0.014] }],
    held: [[0, 0, 0, 0.016]],
    mass: 0.05,
    friction: 0.5,
    slipSpeed: 0.45,
    dropImpact: 0.25,
    model: 'diamond',
    material: 'diamond',
  },
  // Груз для подмены на весах: стальной брусок. В сейф не идёт (role: 'prop').
  weight: {
    name: 'Груз',
    failFall: 'Груз упал со стола',
    bounds: [0.07, 0.06, 0.07],
    shapes: [{ type: 'box', half: [0.035, 0.03, 0.035] }],
    held: [[0, 0, 0, 0.037]],
    mass: 2,
    friction: 0.7,
    model: 'weight',
    material: 'steel',
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
