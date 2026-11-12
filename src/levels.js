// Описание уровней — только данные.
//
// Система координат: X вправо, Y вверх, Z на игрока. Стол: y = WORLD.tableY.
// box.pos    — [x, z] центра дна коробки в мире.
// box.size   — [ширина X, высота Y, глубина Z].
// inner      — внутренние перегородки коробки (см. innerFrame в src/box.js): [{ axis, at, from, to, height, hole? }].
// holes      — отверстия. wall: 'top' | 'front' (к игроку) | 'back' | 'left' | 'right'.
//              shape 'rect' (size: [u, v]) или 'circle' (radius). offset [u, v] от центра стенки.
//              Оси стенки: top — u=X, v=Z; front/back — u=X, v=Y; left/right — u=Z, v=Y.
// loot       — список предметов добычи: [{ type, pos, yaw, mass, friction, role }], типы — в src/loot-types.js.
//              Старая короткая запись для одного слитка: bar: { pos, yaw, mass, friction }.
// stages     — многоэтапный уровень: список этапов (см. stageDef ниже); добыча этапа в сейфе — начинается следующий.
// via        — у предмета добычи: номер отверстия коробки, через которое его достают (по умолчанию 0).
// blocked    — 'flat': предмет не должен проходить в отверстие плашмя, только ребром (проверяет tools/check_levels.mjs).
// bar.pos    — [x, y, z] нижней точки слитка относительно центра дна коробки. yaw в градусах
//              (0 — слиток лежит вдоль X, 90 — вдоль Z).
// approach   — поза, с которой автопилот начинает сценарий (pos — мир, yaw/pitch — градусы). Игрок её не видит:
//              каждый уровень и этап начинается в одной позе HAND_START (src/config.js), повернуть и наклонить
//              руку под отверстие — задача игрока.
// Названия и подсказки уровней — в словарях src/i18n/ (ключи level.<id>.name и level.<id>.hint,
//              у этапов финала — level.<id>.s<номер этапа>.hint).
// stars      — условия на 3 и 2 звезды (время, касания стекла). 1 звезда — просто пройти.

export const LEVELS = [
  {
    id: 1,
    box: { pos: [-0.12, -0.1], size: [0.5, 0.3, 0.42], holes: [{ wall: 'top', shape: 'rect', size: [0.36, 0.32], offset: [0, 0.03] }] },
    pedestal: { size: [0.3, 0.05, 0.16], pos: [0, 0] },
    bar: { pos: [0, 0.05, 0], yaw: 0, mass: 1, friction: 0.6 },
    approach: { pos: [-0.12, 1.36, 0.0], yaw: 0, pitch: -60 },
    safe: { pos: [0.5, 0.2], radius: 0.16 },
    stars: { three: { time: 24, touches: 1 }, two: { time: 53, touches: 4 } },
  },
  {
    id: 2,
    box: { pos: [-0.2, -0.1], size: [0.58, 0.28, 0.4], holes: [{ wall: 'right', shape: 'rect', size: [0.24, 0.17], offset: [0, -0.02] }] },
    pedestal: { size: [0.32, 0.03, 0.14], pos: [-0.03, 0] },
    bar: { pos: [-0.03, 0.03, 0], yaw: 0, mass: 1.5, friction: 0.6 },
    approach: { pos: [0.38, 1.03, -0.1], yaw: 90, pitch: 0 },
    safe: { pos: [0.52, 0.22], radius: 0.16 },
    stars: { three: { time: 33, touches: 1 }, two: { time: 70, touches: 4 } },
  },
  {
    id: 3,
    box: { pos: [-0.1, -0.12], size: [0.46, 0.28, 0.44], holes: [{ wall: 'front', shape: 'rect', size: [0.15, 0.125], offset: [0, -0.05] }] },
    pedestal: { size: [0.34, 0.02, 0.3], pos: [0, -0.02] },
    bar: { pos: [0, 0.02, -0.02], yaw: 0, mass: 1.5, friction: 0.5 },
    approach: { pos: [-0.1, 1.0, 0.36], yaw: 0, pitch: 0 },
    safe: { pos: [0.5, 0.2], radius: 0.16 },
    monkey: true,
    stars: { three: { time: 45, touches: 2 }, two: { time: 100, touches: 6 } },
  },
  {
    id: 4,
    box: { pos: [-0.12, -0.1], size: [0.5, 0.3, 0.42], holes: [{ wall: 'top', shape: 'rect', size: [0.32, 0.3], offset: [0, 0.03] }] },
    pedestal: { size: [0.24, 0.06, 0.18], pos: [0, 0], plate: true },
    bar: { pos: [0, 0.06, 0], yaw: 0, mass: 2, friction: 0.6 },
    approach: { pos: [-0.12, 1.36, 0.0], yaw: 0, pitch: -60 },
    safe: { pos: [0.42, 0.16], radius: 0.16 },
    traps: [{ type: 'plate', maxLiftSpeed: 0.24, alarmSeconds: 3, liftHeight: 0.03 }],
    stars: { three: { time: 29, touches: 1 }, two: { time: 63, touches: 4 } },
  },
  {
    id: 5,
    box: { pos: [-0.2, -0.1], size: [0.58, 0.3, 0.42], holes: [{ wall: 'right', shape: 'rect', size: [0.27, 0.2], offset: [0, -0.02] }] },
    pedestal: { size: [0.32, 0.03, 0.14], pos: [-0.035, 0] },
    bar: { pos: [-0.035, 0.03, 0], yaw: 0, mass: 1.5, friction: 0.6 },
    approach: { pos: [0.4, 1.03, -0.1], yaw: 90, pitch: 0 },
    safe: { pos: [0.52, 0.22], radius: 0.16 },
    traps: [{
      type: 'lasers',
      failDelay: 1.3,
      beams: [ // координаты относительно центра дна коробки
        { from: [0.19, 0.2, -0.21], to: [0.19, 0.2, 0.21] },
        { from: [0.1, 0.018, -0.21], to: [0.1, 0.018, 0.21] },
        { from: [0.14, 0, 0], to: [0.14, 0.3, 0], on: 1.6, off: 3.4 },
      ],
    }],
    stars: { three: { time: 34, touches: 1 }, two: { time: 68, touches: 4 } },
  },
  {
    id: 6,
    box: { pos: [-0.1, -0.12], size: [0.46, 0.28, 0.44], holes: [{ wall: 'front', shape: 'rect', size: [0.21, 0.15], offset: [0, -0.045] }] },
    pedestal: { size: [0.2, 0.02, 0.32], pos: [0, -0.02], metal: true },
    bar: { pos: [0, 0.02, -0.02], yaw: 90, mass: 3, friction: 0.03 },
    approach: { pos: [-0.1, 1.0, 0.36], yaw: 0, pitch: 0 },
    safe: { pos: [0.5, 0.2], radius: 0.16 },
    glass: { health: 2, hitSpeed: 0.45 },
    grip: { slipSpeed: 0.6 },
    stars: { three: { time: 40, touches: 0 }, two: { time: 79, touches: 2 } },
  },
  {
    id: 7,
    box: { pos: [-0.22, -0.1], size: [0.62, 0.26, 0.38], holes: [{ wall: 'right', shape: 'rect', size: [0.25, 0.17], offset: [0, -0.025] }] },
    pedestal: null,
    bar: { pos: [-0.015, 0, 0], yaw: 0, mass: 1.5, friction: 0.6 },
    approach: { pos: [0.4, 1.0, -0.1], yaw: 90, pitch: 0 },
    safe: { pos: [0.54, 0.22], radius: 0.16 },
    traps: [{ type: 'hot', holdTime: 2, cooldown: 1.1 }],
    stars: { three: { time: 38, touches: 1 }, two: { time: 75, touches: 4 } },
  },
  {
    id: 8,
    box: { pos: [-0.1, -0.12], size: [0.46, 0.3, 0.46], holes: [{ wall: 'front', shape: 'circle', radius: 0.088, offset: [0, -0.038] }] },
    pedestal: null,
    bar: { pos: [0, 0.03, -0.03], yaw: 20, mass: 1.5, friction: 0.7 },
    approach: { pos: [-0.1, 1.02, 0.38], yaw: 0, pitch: 0 },
    safe: { pos: [0.5, 0.2], radius: 0.16 },
    traps: [{ type: 'spinner', radius: 0.15, height: 0.03, pos: [0, -0.03], speed: 0.55 }],
    monkey: true,
    timeLimit: 90,
    stars: { three: { time: 44, touches: 2 }, two: { time: 83, touches: 5 } },
  },
  // ------------------------------------------------------------------ Ломбард: новые уровни
  {
    id: 9,
    box: { pos: [-0.12, -0.1], size: [0.5, 0.3, 0.42], holes: [{ wall: 'top', shape: 'rect', size: [0.36, 0.14], offset: [0.03, 0] }] },
    pedestal: { size: [0.3, 0.05, 0.16], pos: [-0.02, 0] },
    bar: { pos: [-0.02, 0.05, 0], yaw: 0, mass: 1, friction: 0.6 },
    approach: { pos: [-0.12, 1.36, 0.0], yaw: 0, pitch: -60 },
    safe: { pos: [0.5, 0.2], radius: 0.16 },
    stars: { three: { time: 29, touches: 1 }, two: { time: 53, touches: 4 } },
  },
  {
    id: 10,
    box: { pos: [-0.2, -0.1], size: [0.58, 0.3, 0.4], holes: [{ wall: 'right', shape: 'rect', size: [0.24, 0.2], offset: [0, -0.005] }] },
    pedestal: { size: [0.24, 0.06, 0.18], pos: [-0.03, 0], plate: true },
    bar: { pos: [-0.03, 0.06, 0], yaw: 0, mass: 2, friction: 0.6 },
    approach: { pos: [0.38, 1.07, -0.1], yaw: 90, pitch: 0 },
    safe: { pos: [0.52, 0.22], radius: 0.16 },
    traps: [{ type: 'plate', maxLiftSpeed: 0.24, alarmSeconds: 3, liftHeight: 0.03 }],
    stars: { three: { time: 28, touches: 1 }, two: { time: 55, touches: 4 } },
  },
  {
    id: 11,
    box: { pos: [-0.1, -0.12], size: [0.46, 0.28, 0.44], holes: [{ wall: 'front', shape: 'rect', size: [0.15, 0.125], offset: [0, -0.05] }] },
    pedestal: { size: [0.34, 0.02, 0.3], pos: [0, -0.02] },
    bar: { pos: [0, 0.02, -0.02], yaw: 0, mass: 1.5, friction: 0.5 },
    approach: { pos: [-0.1, 1.0, 0.36], yaw: 0, pitch: 0 },
    safe: { pos: [0.5, 0.2], radius: 0.16 },
    monkey: true,
    traps: [{ type: 'hot', holdTime: 3, cooldown: 1.1 }],
    stars: { three: { time: 65, touches: 2 }, two: { time: 130, touches: 6 } },
  },
  // ------------------------------------------------------------------ Музей
  {
    id: 12,
    box: { pos: [-0.12, -0.1], size: [0.5, 0.34, 0.42], holes: [{ wall: 'top', shape: 'rect', size: [0.3, 0.3], offset: [0, 0.03] }] },
    pedestal: { size: [0.2, 0.05, 0.16], pos: [0, 0] },
    loot: [{ type: 'vase', pos: [0, 0.05, 0] }],
    approach: { pos: [-0.12, 1.44, 0.0], yaw: 0, pitch: -60 },
    safe: { pos: [0.5, 0.2], radius: 0.16 },
    stars: { three: { time: 28, touches: 1 }, two: { time: 52, touches: 4 } },
  },
  {
    id: 13,
    box: { pos: [-0.2, -0.1], size: [0.58, 0.28, 0.4], holes: [{ wall: 'right', shape: 'rect', size: [0.24, 0.17], offset: [0, -0.02] }] },
    pedestal: { size: [0.32, 0.03, 0.14], pos: [-0.03, 0] },
    bar: { pos: [-0.03, 0.03, 0], yaw: 0, mass: 1.5, friction: 0.6 },
    approach: { pos: [0.38, 1.03, -0.1], yaw: 90, pitch: 0 },
    safe: { pos: [0.52, 0.22], radius: 0.16 },
    traps: [{ type: 'camera', away: 5, warn: 0.8, watch: 2.5, phase: 2.5 }],   // phase: первое предупреждение — через 2,5 с после старта
    stars: { three: { time: 33, touches: 1 }, two: { time: 65, touches: 4 } },
  },
  {
    id: 14,
    box: { pos: [-0.1, -0.12], size: [0.46, 0.28, 0.44], holes: [{ wall: 'front', shape: 'rect', size: [0.21, 0.135], offset: [0, -0.0375] }] },
    pedestal: { size: [0.22, 0.02, 0.22], pos: [0, -0.02] },
    loot: [{ type: 'crown', pos: [0, 0.02, -0.02] }],
    approach: { pos: [-0.1, 1.0, 0.36], yaw: 0, pitch: 0 },
    safe: { pos: [0.5, 0.2], radius: 0.16 },
    stars: { three: { time: 25, touches: 1 }, two: { time: 50, touches: 4 } },
  },
  {
    id: 15,
    box: { pos: [-0.1, -0.12], size: [0.46, 0.28, 0.44], holes: [{ wall: 'front', shape: 'rect', size: [0.135, 0.2], offset: [0, -0.02] }] },
    pedestal: { size: [0.22, 0.02, 0.22], pos: [0, -0.02] },
    loot: [{ type: 'crown', pos: [0, 0.02, -0.02] }],
    approach: { pos: [-0.1, 1.0, 0.36], yaw: 0, pitch: 0 },
    safe: { pos: [0.5, 0.2], radius: 0.16 },
    blocked: 'flat',
    stars: { three: { time: 30, touches: 2 }, two: { time: 60, touches: 5 } },
  },
  {
    id: 16,
    box: { pos: [-0.12, -0.1], size: [0.5, 0.34, 0.42], holes: [{ wall: 'top', shape: 'rect', size: [0.3, 0.3], offset: [0, 0.03] }] },
    pedestal: { size: [0.2, 0.05, 0.16], pos: [0, 0] },
    loot: [{ type: 'vase', pos: [0, 0.05, 0] }],
    approach: { pos: [-0.12, 1.44, 0.0], yaw: 0, pitch: -60 },
    safe: { pos: [0.5, 0.2], radius: 0.16 },
    traps: [{
      type: 'lasers',
      failDelay: 1.3,
      beams: [
        { from: [-0.095, 0.26, -0.21], to: [-0.095, 0.26, 0.21] },
        { from: [0.095, 0.26, -0.21], to: [0.095, 0.26, 0.21] },
        { from: [-0.25, 0.29, 0.06], to: [0.25, 0.29, 0.06], on: 1.6, off: 4.2 },
      ],
    }],
    stars: { three: { time: 44, touches: 1 }, two: { time: 83, touches: 4 } },
  },
  {
    id: 17,
    box: { pos: [-0.2, -0.1], size: [0.58, 0.3, 0.42], holes: [{ wall: 'right', shape: 'rect', size: [0.27, 0.2], offset: [0, -0.02] }] },
    pedestal: { size: [0.32, 0.03, 0.14], pos: [-0.035, 0] },
    bar: { pos: [-0.035, 0.03, 0], yaw: 0, mass: 1.5, friction: 0.6 },
    approach: { pos: [0.4, 1.03, -0.1], yaw: 90, pitch: 0 },
    safe: { pos: [0.52, 0.22], radius: 0.16 },
    traps: [
      { type: 'lasers', failDelay: 1.3, beams: [
        { from: [0.19, 0.2, -0.21], to: [0.19, 0.2, 0.21] },
        { from: [0.1, 0.018, -0.21], to: [0.1, 0.018, 0.21] },
        { from: [0.14, 0, 0], to: [0.14, 0.3, 0], on: 1.6, off: 3.4 },
      ] },
      { type: 'camera', away: 6, warn: 0.8, watch: 2.2, autoNeed: 3.6 },
    ],
    stars: { three: { time: 49, touches: 1 }, two: { time: 98, touches: 4 } },
  },
  {
    id: 18,
    box: { pos: [-0.1, -0.12], size: [0.46, 0.28, 0.44], holes: [{ wall: 'front', shape: 'rect', size: [0.135, 0.2], offset: [0, -0.02] }] },
    pedestal: { size: [0.22, 0.02, 0.22], pos: [0, -0.02] },
    loot: [{ type: 'crown', pos: [0, 0.02, -0.02] }],
    approach: { pos: [-0.1, 1.0, 0.36], yaw: 0, pitch: 0 },
    safe: { pos: [0.5, 0.2], radius: 0.16 },
    blocked: 'flat',
    traps: [
      { type: 'lasers', failDelay: 1.3, beams: [
        { from: [-0.12, 0, 0.1], to: [-0.12, 0.28, 0.1] },
        { from: [0.12, 0, 0.1], to: [0.12, 0.28, 0.1] },
        { from: [-0.23, 0.235, -0.02], to: [0.23, 0.235, -0.02] },
      ] },
      { type: 'camera', away: 5.5, warn: 0.8, watch: 2.3 },
    ],
    stars: { three: { time: 40, touches: 2 }, two: { time: 79, touches: 5 } },
  },
  // ------------------------------------------------------------------ Банк
  {
    id: 19,
    box: { pos: [-0.12, -0.1], size: [0.5, 0.3, 0.5], holes: [{ wall: 'top', shape: 'rect', size: [0.4, 0.38], offset: [0, 0.04] }] },
    pedestal: { size: [0.34, 0.04, 0.26], pos: [0, 0] },
    loot: [
      { type: 'bar', pos: [0, 0.04, 0], yaw: 90 },
      { type: 'bar', pos: [0.1, 0.04, 0], yaw: 90 },
      { type: 'bar', pos: [-0.1, 0.04, 0], yaw: 90 },
    ],
    approach: { pos: [-0.12, 1.36, 0.0], yaw: 0, pitch: -60 },
    safe: { pos: [0.5, 0.2], radius: 0.17 },
    stars: { three: { time: 79, touches: 2 }, two: { time: 153, touches: 5 } },
  },
  {
    id: 20,
    box: {
      pos: [-0.1, -0.12], size: [0.46, 0.42, 0.44],
      holes: [{ wall: 'front', shape: 'rect', size: [0.27, 0.2], offset: [0, 0.09] }],
      inner: [{ axis: 'x', at: 0.1, from: -0.23, to: 0.23, height: 0.1 }],
    },
    pedestal: null,
    bar: { pos: [0, 0, -0.08], yaw: 0, mass: 1.5, friction: 0.6 },
    approach: { pos: [-0.1, 1.42, 0.4], yaw: 0, pitch: -40 },
    safe: { pos: [0.5, 0.2], radius: 0.16 },
    stars: { three: { time: 30, touches: 1 }, two: { time: 54, touches: 4 } },
  },
  {
    id: 21,
    box: { pos: [-0.2, -0.1], size: [0.58, 0.28, 0.4], holes: [{ wall: 'right', shape: 'rect', size: [0.24, 0.17], offset: [0, -0.02] }] },
    pedestal: { size: [0.32, 0.03, 0.14], pos: [-0.03, 0] },
    bar: { pos: [-0.03, 0.03, 0], yaw: 0, mass: 1.5, friction: 0.6 },
    approach: { pos: [0.4, 1.03, -0.1], yaw: 90, pitch: 0 },
    safe: { pos: [0.52, 0.22], radius: 0.16 },
    traps: [{ type: 'shutter', open: 4.5, warn: 0.7, closing: 0.5, closed: 2 }],
    stars: { three: { time: 29, touches: 1 }, two: { time: 58, touches: 4 } },
  },
  {
    id: 22,
    box: { pos: [-0.12, -0.1], size: [0.5, 0.3, 0.5], holes: [{ wall: 'top', shape: 'rect', size: [0.4, 0.38], offset: [0, 0.04] }] },
    pedestal: { size: [0.34, 0.05, 0.2], pos: [0, 0], plate: true },
    loot: [
      { type: 'bar', pos: [-0.07, 0.05, 0], yaw: 90, mass: 2 },
      { type: 'weight', pos: [0.42, 0, -0.14], role: 'prop', mass: 2 },
    ],
    approach: { pos: [-0.12, 1.36, 0.0], yaw: 0, pitch: -60 },
    safe: { pos: [0.5, 0.22], radius: 0.16 },
    traps: [{ type: 'scale', min: 1.6, grace: 0.4, alarmSeconds: 3 }],
    stars: { three: { time: 49, touches: 1 }, two: { time: 93, touches: 4 } },
  },
  {
    id: 23,
    box: {
      pos: [-0.1, -0.12], size: [0.5, 0.28, 0.44],
      holes: [{ wall: 'front', shape: 'rect', size: [0.17, 0.13], offset: [0, -0.05] }],
      inner: [{ axis: 'x', at: 0.08, from: -0.25, to: 0.25, height: 0.28, hole: { shape: 'rect', size: [0.17, 0.13], offset: [0.049, -0.05] } }],
    },
    pedestal: null,
    bar: { pos: [0.105, 0, -0.08], yaw: 70.7, mass: 1.5, friction: 0.6 },
    approach: { pos: [-0.2, 1.0, 0.42], yaw: -19.3, pitch: 0 },
    safe: { pos: [0.5, 0.2], radius: 0.16 },
    stars: { three: { time: 29, touches: 2 }, two: { time: 58, touches: 5 } },
  },
  {
    id: 24,
    box: { pos: [-0.1, -0.12], size: [0.46, 0.28, 0.44], holes: [{ wall: 'front', shape: 'circle', radius: 0.08, offset: [0, -0.04] }] },
    pedestal: { size: [0.16, 0.02, 0.3], pos: [0, 0.02] },
    loot: [
      { type: 'coins', pos: [0, 0.02, 0.1] },
      { type: 'coins', pos: [0, 0.02, 0.02] },
      { type: 'coins', pos: [0, 0.02, -0.06] },
    ],
    approach: { pos: [-0.1, 1.02, 0.4], yaw: 0, pitch: 0 },
    safe: { pos: [0.5, 0.2], radius: 0.16 },
    traps: [{ type: 'shutter', open: 4.5, warn: 0.7, closing: 0.5, closed: 2 }],
    stars: { three: { time: 74, touches: 1 }, two: { time: 143, touches: 4 } },
  },
  {
    id: 25,
    box: { pos: [-0.1, -0.12], size: [0.5, 0.28, 0.44], holes: [{ wall: 'front', shape: 'rect', size: [0.38, 0.135], offset: [0, -0.045] }] },
    pedestal: { size: [0.4, 0.02, 0.26], pos: [0, -0.02] },
    loot: [
      { type: 'bar', pos: [0, 0.02, -0.02], yaw: 90, mass: 1.5 },
      { type: 'bar', pos: [0.11, 0.02, -0.02], yaw: 90, mass: 1.5 },
      { type: 'bar', pos: [-0.11, 0.02, -0.02], yaw: 90, mass: 1.5 },
    ],
    approach: { pos: [-0.1, 1.0, 0.4], yaw: 0, pitch: 0 },
    safe: { pos: [0.52, 0.2], radius: 0.17 },
    traps: [{ type: 'shutter', open: 5, warn: 0.7, closing: 0.5, closed: 1.8, autoNeed: 4.3 }],
    stars: { three: { time: 79, touches: 1 }, two: { time: 153, touches: 4 } },
  },
  {
    id: 26,
    box: {
      pos: [-0.1, -0.12], size: [0.46, 0.42, 0.44],
      holes: [{ wall: 'front', shape: 'rect', size: [0.34, 0.2], offset: [0, 0.09] }],
      inner: [{ axis: 'x', at: 0.1, from: -0.23, to: 0.23, height: 0.07 }],
    },
    pedestal: { size: [0.32, 0.05, 0.24], pos: [0, -0.09], plate: true },
    loot: [
      { type: 'bar', pos: [-0.07, 0.05, -0.09], yaw: 90, mass: 2 },
      { type: 'weight', pos: [0.38, 0, 0.34], role: 'prop', mass: 2 },
    ],
    approach: { pos: [0.2, 1.42, 0.5], yaw: 0, pitch: -40 },
    safe: { pos: [0.52, 0.12], radius: 0.16 },
    traps: [
      { type: 'scale', min: 1.6, grace: 0.4, alarmSeconds: 3 },
      { type: 'shutter', open: 7, warn: 0.7, closing: 0.5, closed: 2, autoNeed: 5.5 },
    ],
    stars: { three: { time: 74, touches: 3 }, two: { time: 143, touches: 6 } },
  },
  // ------------------------------------------------------------------ Казино
  {
    id: 27,
    box: { pos: [-0.12, -0.1], size: [0.5, 0.3, 0.42], holes: [{ wall: 'top', shape: 'rect', size: [0.36, 0.32], offset: [0, 0.03] }] },
    pedestal: { size: [0.3, 0.05, 0.16], pos: [0, 0] },
    loot: [
      { type: 'chips', pos: [-0.03, 0.05, 0] }, { type: 'chips', pos: [0.03, 0.05, 0] },
      { type: 'chips', pos: [-0.09, 0.05, 0] }, { type: 'chips', pos: [0.09, 0.05, 0] },
    ],
    approach: { pos: [-0.12, 1.36, 0.0], yaw: 0, pitch: -60 },
    safe: { pos: [0.5, 0.2], radius: 0.17 },
    stars: { three: { time: 104, touches: 3 }, two: { time: 203, touches: 6 } },
  },
  {
    id: 28,
    box: { pos: [-0.2, -0.1], size: [0.58, 0.28, 0.4], holes: [{ wall: 'right', shape: 'rect', size: [0.24, 0.17], offset: [0, -0.02] }] },
    pedestal: { size: [0.32, 0.03, 0.14], pos: [-0.03, 0] },
    bar: { pos: [-0.03, 0.03, 0], yaw: 0, mass: 1.5, friction: 0.6 },
    approach: { pos: [0.38, 1.03, -0.1], yaw: 90, pitch: 0 },
    safe: { pos: [0.52, 0.22], radius: 0.16 },
    traps: [{ type: 'blackout', on: 3.5, warn: 0.5, dark: 2.2 }],
    stars: { three: { time: 28, touches: 1 }, two: { time: 55, touches: 4 } },
  },
  {
    id: 29,
    box: { pos: [-0.1, -0.12], size: [0.46, 0.3, 0.46], holes: [{ wall: 'front', shape: 'circle', radius: 0.09, offset: [0, -0.038] }] },
    pedestal: null,
    loot: [
      { type: 'dice', pos: [0.05, 0.03, -0.03] }, { type: 'dice', pos: [-0.025, 0.03, 0.0133] }, { type: 'dice', pos: [-0.025, 0.03, -0.0733] },
    ],
    approach: { pos: [-0.1, 1.03, 0.38], yaw: 0, pitch: 0 },
    safe: { pos: [0.5, 0.2], radius: 0.16 },
    traps: [{ type: 'spinner', radius: 0.15, height: 0.03, pos: [0, -0.03], speed: 0.9 }],
    timeLimit: 200,
    stars: { three: { time: 99, touches: 2 }, two: { time: 193, touches: 5 } },
  },
  {
    id: 30,
    box: { pos: [-0.2, -0.1], size: [0.58, 0.3, 0.42], holes: [{ wall: 'right', shape: 'rect', size: [0.27, 0.2], offset: [0, -0.02] }] },
    pedestal: { size: [0.2, 0.05, 0.14], pos: [-0.035, 0] },
    loot: [{ type: 'diamond', pos: [-0.035, 0.05, 0] }],
    approach: { pos: [0.4, 1.03, -0.1], yaw: 90, pitch: 0 },
    safe: { pos: [0.52, 0.22], radius: 0.16 },
    traps: [{ type: 'lasers', failDelay: 1.3, beams: [
      { from: [0.19, 0.22, -0.21], to: [0.19, 0.22, 0.21] },
      { from: [0.1, 0.018, -0.21], to: [0.1, 0.018, 0.21] },
    ] }],
    stars: { three: { time: 38, touches: 0 }, two: { time: 71, touches: 2 } },
  },
  {
    id: 31,
    box: { pos: [-0.1, -0.12], size: [0.46, 0.3, 0.46], holes: [{ wall: 'front', shape: 'circle', radius: 0.09, offset: [0, -0.038] }] },
    pedestal: null,
    loot: [
      { type: 'chips', pos: [0.05, 0.03, -0.03] }, { type: 'chips', pos: [-0.025, 0.03, 0.0133] }, { type: 'chips', pos: [-0.025, 0.03, -0.0733] },
    ],
    approach: { pos: [-0.1, 1.02, 0.38], yaw: 0, pitch: 0 },
    safe: { pos: [0.5, 0.2], radius: 0.16 },
    traps: [{ type: 'spinner', radius: 0.15, height: 0.03, pos: [0, -0.03], speed: 0.8 }, { type: 'blackout', on: 4, warn: 0.5, dark: 2 }],
    timeLimit: 240,
    stars: { three: { time: 114, touches: 2 }, two: { time: 223, touches: 5 } },
  },
  {
    id: 32,
    box: { pos: [-0.1, -0.12], size: [0.46, 0.3, 0.46], holes: [{ wall: 'front', shape: 'circle', radius: 0.075, offset: [0, -0.045] }] },
    pedestal: null,
    loot: [{ type: 'diamond', pos: [0.045, 0.03, -0.03] }],
    approach: { pos: [-0.1, 1.02, 0.38], yaw: 0, pitch: 0 },
    safe: { pos: [0.5, 0.2], radius: 0.16 },
    traps: [{ type: 'spinner', radius: 0.15, height: 0.03, pos: [0, -0.03], speed: 0.7 }, { type: 'blackout', on: 4, warn: 0.5, dark: 2 }],
    timeLimit: 120,
    stars: { three: { time: 39, touches: 1 }, two: { time: 78, touches: 3 } },
  },
  // ------------------------------------------------------------------ Сейф босса
  {
    id: 33,
    box: { pos: [-0.2, -0.1], size: [0.58, 0.28, 0.4], holes: [{ wall: 'right', shape: 'rect', size: [0.26, 0.2], offset: [0, -0.01] }] },
    pedestal: { size: [0.34, 0.03, 0.16], pos: [-0.03, 0] },
    loot: [{ type: 'bigbar', pos: [-0.03, 0.03, 0] }],
    approach: { pos: [0.4, 1.06, -0.1], yaw: 90, pitch: 0 },
    safe: { pos: [0.52, 0.22], radius: 0.18 },
    stars: { three: { time: 28, touches: 1 }, two: { time: 55, touches: 4 } },
  },
  {
    id: 34,
    box: { pos: [-0.2, -0.1], size: [0.58, 0.28, 0.4], holes: [{ wall: 'right', shape: 'rect', size: [0.24, 0.17], offset: [0, -0.02] }] },
    pedestal: { size: [0.32, 0.03, 0.14], pos: [-0.03, 0] },
    bar: { pos: [-0.03, 0.03, 0], yaw: 0, mass: 1.5, friction: 0.6 },
    approach: { pos: [0.4, 1.03, -0.1], yaw: 90, pitch: 0 },
    safe: { pos: [0.52, 0.22], radius: 0.16 },
    traps: [
      { type: 'shutter', open: 7, warn: 0.7, closing: 0.5, closed: 2, autoNeed: 6 },
      { type: 'camera', away: 7.4, warn: 0.8, watch: 2.0, phase: 3, autoNeed: 3.8 },
    ],
    stars: { three: { time: 29, touches: 1 }, two: { time: 58, touches: 4 } },
  },
  {
    id: 35,
    box: {
      pos: [-0.1, -0.12], size: [0.5, 0.42, 0.44],
      holes: [{ wall: 'front', shape: 'rect', size: [0.34, 0.2], offset: [0, 0.09] }],
      inner: [{ axis: 'x', at: 0.1, from: -0.25, to: 0.25, height: 0.1 }],
    },
    pedestal: null,
    loot: [{ type: 'bigbar', pos: [0, 0, -0.08], yaw: 0, mass: 4 }],
    approach: { pos: [-0.1, 1.42, 0.4], yaw: 0, pitch: -40 },
    safe: { pos: [0.52, 0.2], radius: 0.18 },
    traps: [{ type: 'hot', holdTime: 4, cooldown: 1.2 }],
    stars: { three: { time: 40, touches: 2 }, two: { time: 79, touches: 5 } },
  },
  {
    id: 36,
    box: {
      pos: [-0.12, -0.12], size: [0.56, 0.34, 0.46],
      holes: [
        { wall: 'top', shape: 'rect', size: [0.22, 0.3], offset: [-0.13, 0.03] },
        { wall: 'front', shape: 'rect', size: [0.22, 0.15], offset: [0.13, -0.075] },
      ],
    },
    pedestal: { size: [0.14, 0.05, 0.14], pos: [-0.13, 0] },
    loot: [
      { type: 'vase', pos: [-0.13, 0.05, 0] },
      { type: 'crown', pos: [0.13, 0, -0.05], via: 1 },
      { type: 'diamond', pos: [0.13, 0, 0.1], via: 1 },
    ],
    approach: { pos: [-0.25, 1.44, 0.0], yaw: 0, pitch: -60 },
    safe: { pos: [0.52, 0.2], radius: 0.18 },
    stars: { three: { time: 94, touches: 2 }, two: { time: 183, touches: 5 } },
  },
  {
    id: 37,
    box: { pos: [-0.12, -0.1], size: [0.5, 0.3, 0.5], holes: [{ wall: 'top', shape: 'rect', size: [0.4, 0.38], offset: [0, 0.04] }] },
    pedestal: { size: [0.34, 0.05, 0.2], pos: [0, 0], plate: true },
    loot: [
      { type: 'bar', pos: [-0.07, 0.05, 0], yaw: 90, mass: 2 },
      { type: 'weight', pos: [0.42, 0, -0.14], role: 'prop', mass: 2 },
    ],
    approach: { pos: [-0.12, 1.36, 0.0], yaw: 0, pitch: -60 },
    safe: { pos: [0.5, 0.22], radius: 0.16 },
    traps: [
      { type: 'scale', min: 1.6, grace: 0.4, alarmSeconds: 3 },
      { type: 'lasers', failDelay: 1.3, beams: [
        { from: [-0.17, 0.25, -0.25], to: [-0.17, 0.25, 0.25] },
        { from: [0.19, 0.25, -0.25], to: [0.19, 0.25, 0.25] },
      ] },
      { type: 'blackout', on: 4, warn: 0.5, dark: 2 },
    ],
    stars: { three: { time: 49, touches: 1 }, two: { time: 93, touches: 4 } },
  },
  {
    id: 38,
    box: { pos: [-0.1, -0.12], size: [0.46, 0.3, 0.46], holes: [{ wall: 'front', shape: 'circle', radius: 0.088, offset: [0, -0.038] }] },
    pedestal: null,
    bar: { pos: [0, 0.03, -0.03], yaw: 20, mass: 1.5, friction: 0.7 },
    approach: { pos: [-0.1, 1.02, 0.38], yaw: 0, pitch: 0 },
    safe: { pos: [0.5, 0.2], radius: 0.16 },
    traps: [
      { type: 'spinner', radius: 0.15, height: 0.03, pos: [0, -0.03], speed: 0.9 },
      { type: 'shutter', open: 8, warn: 0.7, closing: 0.5, closed: 2, autoNeed: 7 },
    ],
    monkey: true,
    timeLimit: 150,
    stars: { three: { time: 39, touches: 2 }, two: { time: 78, touches: 5 } },
  },
  {
    id: 39,
    box: { pos: [-0.1, -0.12], size: [0.46, 0.28, 0.44], holes: [{ wall: 'front', shape: 'rect', size: [0.15, 0.125], offset: [0, -0.05] }] },
    pedestal: { size: [0.34, 0.02, 0.3], pos: [0, -0.02] },
    bar: { pos: [0, 0.02, -0.02], yaw: 0, mass: 1.5, friction: 0.5 },
    approach: { pos: [-0.1, 1.0, 0.36], yaw: 0, pitch: 0 },
    safe: { pos: [0.5, 0.2], radius: 0.16 },
    monkey: true,
    traps: [
      { type: 'lasers', failDelay: 1.3, beams: [
        { from: [-0.14, 0, 0.14], to: [-0.14, 0.28, 0.14] },
        { from: [0.14, 0, 0.14], to: [0.14, 0.28, 0.14] },
        { from: [-0.23, 0.22, -0.02], to: [0.23, 0.22, -0.02] },
      ] },
      { type: 'camera', sweep: { from: [-0.34, 0.0], to: [0.34, 0.0], period: 10, radius: 0.13 }, phase: 2.5 },
    ],
    stars: { three: { time: 99, touches: 6 }, two: { time: 198, touches: 12 } },
  },
  {
    id: 40,
    stars: { three: { time: 209, touches: 5 }, two: { time: 408, touches: 10 } },
    stages: [
      {   // этап 1: заслонка и камера
        box: { pos: [-0.2, -0.1], size: [0.58, 0.28, 0.4], holes: [{ wall: 'right', shape: 'rect', size: [0.24, 0.17], offset: [0, -0.02] }] },
        pedestal: { size: [0.32, 0.03, 0.14], pos: [-0.03, 0] },
        loot: [{ type: 'bar', pos: [-0.03, 0.03, 0], mass: 1.5 }],
        approach: { pos: [0.4, 1.03, -0.1], yaw: 90, pitch: 0 },
        safe: { pos: [0.52, 0.22], radius: 0.16 },
        traps: [
          { type: 'shutter', open: 7, warn: 0.7, closing: 0.5, closed: 2, autoNeed: 6 },
          { type: 'camera', away: 7.4, warn: 0.8, watch: 2.0, phase: 3, autoNeed: 3.8 },
        ],
        auto: { speed: 0.75 },
      },
      {   // этап 2: весы в темноте
        box: { pos: [-0.12, -0.1], size: [0.5, 0.3, 0.5], holes: [{ wall: 'top', shape: 'rect', size: [0.4, 0.38], offset: [0, 0.04] }] },
        pedestal: { size: [0.34, 0.05, 0.2], pos: [0, 0], plate: true },
        loot: [
          { type: 'bar', pos: [-0.07, 0.05, 0], yaw: 90, mass: 2 },
          { type: 'weight', pos: [0.42, 0, -0.14], role: 'prop', mass: 2 },
        ],
        approach: { pos: [-0.12, 1.36, 0.0], yaw: 0, pitch: -60 },
        safe: { pos: [0.5, 0.22], radius: 0.16 },
        traps: [{ type: 'scale', min: 1.6, grace: 0.4, alarmSeconds: 3 }, { type: 'blackout', on: 4, warn: 0.5, dark: 2 }],
        auto: { swap: true },
      },
      {   // этап 3: большой слиток поперёк узкого отверстия
        box: { pos: [-0.1, -0.12], size: [0.5, 0.3, 0.46], holes: [{ wall: 'front', shape: 'rect', size: [0.17, 0.15], offset: [0, -0.06] }] },
        pedestal: { size: [0.4, 0.02, 0.34], pos: [0, -0.02] },
        loot: [{ type: 'bigbar', pos: [0, 0.02, -0.02], yaw: 0, mass: 4 }],
        approach: { pos: [-0.1, 1.02, 0.38], yaw: 0, pitch: 0 },
        safe: { pos: [0.52, 0.2], radius: 0.18 },
        monkey: true,
        auto: { ratchet: true, speed: 0.4 },
      },
    ],
  },
];

// Пороги звёзд новых уровней поставлены по правилу от времени автопилота T (эталон в tools/test/play.mjs):
// 3 звезды — не дольше max(20 с, 3·T), 2 звезды — не дольше max(40 с, 6·T), с округлением вверх до 5 с.
// Исключения — уровни, где автопилот разворачивает слиток перехватами (3, 11 и 39): он там заведомо медленнее человека
// и чаще задевает стекло; и «Карусель с заслонкой» (38), где время зависит от того, как повернулась платформа.
// Это заглушка до игры живых людей.
/** Сколько этапов в уровне (обычный уровень — один). */
export const stageCount = (level) => (level.stages ? level.stages.length : 1);

/**
 * Описание этапа многоэтапного уровня в виде обычного уровня. У такого уровня есть список `stages`:
 * каждый этап задаёт свою коробку, добычу, ловушки и руку; id и пороги звёзд — общие.
 * glassId — под каким именем лежат стенки этого этапа в glass_box.glb.
 */
export function stageDef(level, index = 0) {
  if (!level.stages) return level;
  const { stages, ...common } = level;
  return { ...common, ...stages[index], id: level.id, glassId: `${level.id}s${index + 1}`, stage: index + 1, stageCount: stages.length };
}

/** Все уровни и этапы подряд в виде обычных уровней — для проверок и экспорта в Blender. */
export const playable = () => LEVELS.flatMap((l) => Array.from({ length: stageCount(l) }, (_, i) => stageDef(l, i)));

export function starsFor(level, time, touches) {
  const s = level.stars;
  if (time <= s.three.time && touches <= s.three.touches) return 3;
  if (time <= s.two.time && touches <= s.two.touches) return 2;
  return 1;
}
