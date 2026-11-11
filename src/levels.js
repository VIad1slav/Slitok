// Описание уровней — только данные.
//
// Система координат: X вправо, Y вверх, Z на игрока. Стол: y = WORLD.tableY.
// box.pos    — [x, z] центра дна коробки в мире.
// box.size   — [ширина X, высота Y, глубина Z].
// holes      — отверстия. wall: 'top' | 'front' (к игроку) | 'back' | 'left' | 'right'.
//              shape 'rect' (size: [u, v]) или 'circle' (radius). offset [u, v] от центра стенки.
//              Оси стенки: top — u=X, v=Z; front/back — u=X, v=Y; left/right — u=Z, v=Y.
// bar.pos    — [x, y, z] нижней точки слитка относительно центра дна коробки. yaw в градусах
//              (0 — слиток лежит вдоль X, 90 — вдоль Z).
// hand       — стартовая поза кисти (pos — мир, yaw/pitch — градусы).
// stars      — условия на 3 и 2 звезды (время, касания стекла). 1 звезда — просто пройти.

export const LEVELS = [
  {
    id: 1,
    name: 'Разминка',
    hint: 'Мышь — двигать руку, колесо или W/S — вперёд-назад. Зажми ЛКМ над слитком и неси его в светящийся круг.',
    box: { pos: [-0.12, -0.1], size: [0.5, 0.3, 0.42], holes: [{ wall: 'top', shape: 'rect', size: [0.36, 0.32], offset: [0, 0.03] }] },
    pedestal: { size: [0.3, 0.05, 0.16], pos: [0, 0] },
    bar: { pos: [0, 0.05, 0], yaw: 0, mass: 1, friction: 0.6 },
    hand: { pos: [-0.12, 1.36, 0.0], yaw: 0, pitch: -60 },
    safe: { pos: [0.5, 0.2], radius: 0.16 },
    stars: { three: { time: 20, touches: 1 }, two: { time: 45, touches: 4 } },
  },
  {
    id: 2,
    name: 'Заход сбоку',
    hint: 'Отверстие справа. Заведи руку сбоку и не цепляй края. Q/E — поворот кисти.',
    box: { pos: [-0.2, -0.1], size: [0.58, 0.28, 0.4], holes: [{ wall: 'right', shape: 'rect', size: [0.24, 0.17], offset: [0, -0.02] }] },
    pedestal: { size: [0.32, 0.03, 0.14], pos: [-0.03, 0] },
    bar: { pos: [-0.03, 0.03, 0], yaw: 0, mass: 1.5, friction: 0.6 },
    hand: { pos: [0.38, 1.03, -0.1], yaw: 90, pitch: 0 },
    safe: { pos: [0.52, 0.22], radius: 0.16 },
    stars: { three: { time: 25, touches: 1 }, two: { time: 55, touches: 4 } },
  },
  {
    id: 3,
    name: 'Ловушка для обезьян',
    hint: 'Поперёк слиток в отверстие не пролезет. Разожми кулак, подтолкни слиток пальцами за край и разверни торцом к себе.',
    box: { pos: [-0.1, -0.12], size: [0.46, 0.28, 0.44], holes: [{ wall: 'front', shape: 'rect', size: [0.15, 0.125], offset: [0, -0.05] }] },
    pedestal: { size: [0.34, 0.02, 0.3], pos: [0, -0.02] },
    bar: { pos: [0, 0.02, -0.02], yaw: 0, mass: 1.5, friction: 0.5 },
    hand: { pos: [-0.1, 1.0, 0.36], yaw: 0, pitch: 0 },
    safe: { pos: [0.5, 0.2], radius: 0.16 },
    monkey: true,
    stars: { three: { time: 40, touches: 2 }, two: { time: 90, touches: 6 } },
  },
  {
    id: 4,
    name: 'Нажимная плита',
    hint: 'Слиток лежит на датчике веса. Поднимай плавно — рывок включит сирену, и останется всего 3 секунды.',
    box: { pos: [-0.12, -0.1], size: [0.5, 0.3, 0.42], holes: [{ wall: 'top', shape: 'rect', size: [0.32, 0.3], offset: [0, 0.03] }] },
    pedestal: { size: [0.24, 0.06, 0.18], pos: [0, 0], plate: true },
    bar: { pos: [0, 0.06, 0], yaw: 0, mass: 2, friction: 0.6 },
    hand: { pos: [-0.12, 1.36, 0.0], yaw: 0, pitch: -60 },
    safe: { pos: [0.42, 0.16], radius: 0.16 },
    traps: [{ type: 'plate', maxLiftSpeed: 0.24, alarmSeconds: 3, liftHeight: 0.03 }],
    stars: { three: { time: 25, touches: 1 }, two: { time: 55, touches: 4 } },
  },
  {
    id: 5,
    name: 'Лазеры',
    hint: 'Лучи нельзя задевать рукой. Вертикальный луч мигает: жди паузу или обходи его сбоку.',
    box: { pos: [-0.2, -0.1], size: [0.58, 0.3, 0.42], holes: [{ wall: 'right', shape: 'rect', size: [0.27, 0.2], offset: [0, -0.02] }] },
    pedestal: { size: [0.32, 0.03, 0.14], pos: [-0.035, 0] },
    bar: { pos: [-0.035, 0.03, 0], yaw: 0, mass: 1.5, friction: 0.6 },
    hand: { pos: [0.4, 1.03, -0.1], yaw: 90, pitch: 0 },
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
    stars: { three: { time: 30, touches: 1 }, two: { time: 60, touches: 4 } },
  },
  {
    id: 6,
    name: 'Скользкий тип',
    hint: 'Слиток в масле, стекло хрупкое. Двигай руку медленно: резкое движение — и он выскользнет.',
    box: { pos: [-0.1, -0.12], size: [0.46, 0.28, 0.44], holes: [{ wall: 'front', shape: 'rect', size: [0.21, 0.15], offset: [0, -0.045] }] },
    pedestal: { size: [0.2, 0.02, 0.32], pos: [0, -0.02], metal: true },
    bar: { pos: [0, 0.02, -0.02], yaw: 90, mass: 3, friction: 0.03 },
    hand: { pos: [-0.1, 1.0, 0.36], yaw: 0, pitch: 0 },
    safe: { pos: [0.5, 0.2], radius: 0.16 },
    glass: { health: 2, hitSpeed: 0.45 },
    grip: { slipSpeed: 0.6 },
    stars: { three: { time: 35, touches: 0 }, two: { time: 70, touches: 2 } },
  },
  {
    id: 7,
    name: 'Горячий слиток',
    hint: 'Только что из печи: держать можно не дольше 2 секунд. Переноси короткими перехватами.',
    box: { pos: [-0.22, -0.1], size: [0.62, 0.26, 0.38], holes: [{ wall: 'right', shape: 'rect', size: [0.25, 0.17], offset: [0, -0.025] }] },
    pedestal: null,
    bar: { pos: [-0.015, 0, 0], yaw: 0, mass: 1.5, friction: 0.6 },
    hand: { pos: [0.4, 1.0, -0.1], yaw: 90, pitch: 0 },
    safe: { pos: [0.54, 0.22], radius: 0.16 },
    traps: [{ type: 'hot', holdTime: 2, cooldown: 1.1 }],
    stars: { three: { time: 30, touches: 1 }, two: { time: 60, touches: 4 } },
  },
  {
    id: 8,
    name: 'Карусель',
    hint: 'Платформа вращается, отверстие маленькое, время идёт. Хватай, когда слиток смотрит торцом на тебя.',
    box: { pos: [-0.1, -0.12], size: [0.46, 0.3, 0.46], holes: [{ wall: 'front', shape: 'circle', radius: 0.088, offset: [0, -0.038] }] },
    pedestal: null,
    bar: { pos: [0, 0.03, -0.03], yaw: 20, mass: 1.5, friction: 0.7 },
    hand: { pos: [-0.1, 1.02, 0.38], yaw: 0, pitch: 0 },
    safe: { pos: [0.5, 0.2], radius: 0.16 },
    traps: [{ type: 'spinner', radius: 0.15, height: 0.03, pos: [0, -0.03], speed: 0.55 }],
    monkey: true,
    timeLimit: 90,
    stars: { three: { time: 35, touches: 2 }, two: { time: 65, touches: 5 } },
  },
];

export function starsFor(level, time, touches) {
  const s = level.stars;
  if (time <= s.three.time && touches <= s.three.touches) return 3;
  if (time <= s.two.time && touches <= s.two.touches) return 2;
  return 1;
}
