// Автопилот: проходит уровни теми же средствами, что и игрок (двигает целевую точку кисти,
// вращает запястье, сжимает пальцы). Нужен для проверки проходимости: tools/test/play.mjs
// или в консоли браузера — __gg.runAuto(номер), __gg.autoTest(номер).
//
// Устроен в три слоя:
//   1. Примитивы — moveTo, turn, grip, wait, until. Один yield = один шаг физики.
//   2. Шаги — claw, reach, deliver, putDown, pickUp, ratchet. Все числа берут из данных уровня
//      и из самого предмета, поэтому годятся для любого уровня.
//   3. Сценарий уровня. По умолчанию — standard(): для каждого предмета добычи подойти к отверстию,
//      дождаться ловушек, взять, вынуть, донести. Свой сценарий нужен только особым уровням (таблица AUTO).
// Ловушки отвечают автопилоту, безопасно ли сейчас: метод autoReady(phase, ctx) в src/traps.js.
import * as THREE from 'three';
import { PHYS, WORLD } from './config.js';

const DT = PHYS.step, rad = THREE.MathUtils.degToRad;
const cur = new THREE.Vector3(), dst = new THREE.Vector3();
const PALM_REST = 0.022;   // центр ладони над верхом предмета, когда ладонь лежит на нём
const FINGER_REACH = 0.116; // от центра ладони до кончиков прямых пальцев
const FOREARM_R = 0.042;    // самое толстое место предплечья

// ---------------------------------------------------------------------------
// 1. Примитивы
// ---------------------------------------------------------------------------
function* wait(seconds) { for (let i = 0; i < seconds / DT; i++) yield; }
function* until(fn, timeout = 20) { for (let t = 0; t < timeout && !fn(); t += DT) yield; }

/**
 * Вести цель кисти к точке со скоростью speed. Заканчивается, когда кисть рядом или вышло время.
 * untilStall — закончить и тогда, когда кисть упёрлась и стоит (движение «до касания предмета»).
 */
function* moveTo(g, [x, y, z], speed = 0.6, tol = 0.015, timeout = 5, untilStall = false) {
  const h = g.hand; cur.copy(h.target); dst.set(x, y, z);
  let still = 0;
  for (let t = 0; t < timeout; t += DT) {
    if (untilStall && t > 0.3) { still = h.vel.length() < 0.02 ? still + DT : 0; if (still > 0.2) return false; }
    // ловушка просит замереть (камера смотрит): цель кисти — там, где кисть сейчас; время шага не тратится
    if (g.traps.some((tr) => tr.autoHold && tr.autoHold())) { h.target.copy(h.pos); t -= DT; yield; continue; }
    const d = cur.distanceTo(dst), step = speed * DT;
    if (d <= step) cur.copy(dst); else cur.lerp(dst, step / d);
    h.target.copy(cur);
    if (h.pos.distanceTo(dst) < tol && h.vel.length() < 0.2) return true;
    yield;
  }
  return false;
}

/** Повернуть кисть (градусы). */
function* turn(g, { yaw, pitch, roll }, timeout = 2) {
  const a = g.hand.angT;
  if (yaw != null) a.yaw = rad(yaw); if (pitch != null) a.pitch = rad(pitch); if (roll != null) a.roll = rad(roll);
  for (let t = 0; t < timeout; t += DT) {
    const c = g.hand.ang;
    if (Math.abs(c.yaw - a.yaw) + Math.abs(c.pitch - a.pitch) + Math.abs(c.roll - a.roll) < 0.02) return true;
    yield;
  }
  return false;
}

function* grip(g, on, settle = 0.4) { g.hand.setGrip(on); yield* wait(settle); }

// ---------------------------------------------------------------------------
// Геометрия из данных уровня
// ---------------------------------------------------------------------------
const posOf = (item) => item.position().clone();
const topOf = (item) => item.position().y + item.type.bounds[1] / 2;
const heightOf = (item) => item.type.bounds[1];

/** Как рука входит в коробку: { mode: 'claw' } для отверстия сверху или { mode: 'reach', axis, dir } для бокового. */
export function entryOf(level) {
  const wall = level.box.holes[0].wall;
  if (wall === 'top') return { mode: 'claw' };
  if (wall === 'right' || wall === 'left') return { mode: 'reach', axis: 'x', dir: wall === 'right' ? 1 : -1 };
  return { mode: 'reach', axis: 'z', dir: wall === 'front' ? 1 : -1 };
}

/** Точка на расстоянии d от p вдоль оси входа (наружу из коробки). */
const along = (p, entry, d, y) => (entry.vec ? [p.x + entry.vec[0] * d, y, p.z + entry.vec[1] * d] : entry.axis === 'x' ? [p.x + entry.dir * d, y, p.z] : [p.x, y, p.z + entry.dir * d]);

/** Ждать, пока все ловушки уровня ответят «безопасно» для данной фазы ('enter' | 'grab'). */
function* waitTraps(g, phase, item, entry, timeout = 30) {
  const ctx = { game: g, time: 0, item, axis: entry.axis };
  yield* until(() => { ctx.time = g.time; return g.traps.every((t) => !t.autoReady || t.autoReady(phase, ctx)); }, timeout);
  // движущийся предмет (на карусели) — дождаться, пока он окажется под рукой
  if (phase === 'grab') yield* until(() => g.hand.grabItem === item || g.hand.holding, 16);
}

// ---------------------------------------------------------------------------
// 2. Шаги
// ---------------------------------------------------------------------------
/** Положить предмет, который держим под ладонью, в «сейф». */
export function* deliver(g, item, carryY, speed = 0.7) {
  const [sx, sz] = g.level.safe.pos;
  yield* moveTo(g, [sx, carryY, sz], speed, 0.02);
  yield* moveTo(g, [sx, WORLD.tableY + heightOf(item) + 0.03, sz], 0.3, 0.012, 2.5);
  yield* grip(g, false, 1.2);
}

/** Кончики пальцев относительно центра ладони при текущем наклоне и повороте кисти: ниже на dy и впереди на dh по (fx, fz). */
function fingerOffset(g) {
  const p = -g.hand.ang.pitch;
  return { p, dy: FINGER_REACH * Math.sin(p), dh: FINGER_REACH * Math.cos(p), fx: -Math.sin(g.hand.ang.yaw), fz: -Math.cos(g.hand.ang.yaw) };
}
/** Высота переноса «клешнёй»: предмет, висящий под пальцами, должен пройти над верхом коробки. */
const clawHigh = (g, item, dy) => g.level.box.size[1] + WORLD.tableY + dy + Math.max(0.1, heightOf(item) + 0.045);

/** «Клешня», первая половина: опуститься сверху, взять предмет кончиками пальцев и поднять на высоту переноса. */
export function* clawGrab(g, item, { liftSpeed = 0.6 } = {}) {
  const b = posOf(item), top = topOf(item), { dy, dh, fx, fz } = fingerOffset(g);
  const x = b.x - fx * dh, z = b.z - fz * dh, high = clawHigh(g, item, dy);
  yield* moveTo(g, [x, high, z], 0.6);
  yield* waitTraps(g, 'enter', item, { axis: 'z' });
  yield* moveTo(g, [x, top + dy - 0.02, z], 0.35, 0.01, 2.5); // упрётся пальцами в предмет
  yield* wait(0.25);
  yield* waitTraps(g, 'grab', item, { axis: 'z' });
  yield* grip(g, true);
  yield* moveTo(g, [x, top + dy + 0.08, z], liftSpeed, 0.02);
  yield* moveTo(g, [x, high, z], 0.6, 0.02);
}

/** «Клешня», вторая половина: перенести предмет в точку [x, z] и опустить на поверхность высотой baseY. */
export function* clawDrop(g, item, [tx, tz], baseY = WORLD.tableY, settle = 1.2) {
  const { dy, dh, fx, fz } = fingerOffset(g), high = clawHigh(g, item, dy);
  yield* moveTo(g, [tx - fx * dh, high, tz - fz * dh], 0.7, 0.02);
  yield* waitTraps(g, 'enter', item, { axis: 'z' });
  yield* moveTo(g, [tx - fx * dh, baseY + heightOf(item) + 0.028 + dy, tz - fz * dh], 0.5, 0.012, 3);
  yield* grip(g, false, settle);
}

/** Отверстие сверху: рука висит «клешнёй», предмет берётся кончиками пальцев и сразу несётся в «сейф». */
export function* claw(g, item, o = {}) {
  yield* clawGrab(g, item, o);
  const { dy, dh, fx, fz } = fingerOffset(g), [sx, sz] = g.level.safe.pos, high = clawHigh(g, item, dy);
  yield* moveTo(g, [sx - fx * dh, high, sz - fz * dh], 0.7, 0.02);
  yield* moveTo(g, [sx - fx * dh, WORLD.tableY + heightOf(item) + 0.028 + dy, sz - fz * dh], 0.5, 0.012, 3);
  yield* grip(g, false, 1.2);
}

/**
 * «Нырок»: кисть наклонена, рука идёт вдоль собственной оси — сверху вниз через высокое боковое отверстие,
 * над внутренним барьером. Первая половина: дойти до предмета, взять его и выйти обратно по той же линии.
 *   back — на сколько отойти вдоль оси руки от точки хвата (наружу и вверх);
 *   inside — рука уже внутри коробки (только что положила другой предмет): не выходить наружу, а перешагнуть к предмету.
 */
export function* diveGrab(g, item, { speed = 0.5, back = 0.5, inside = false } = {}) {
  const b = posOf(item), top = topOf(item), { p, dy, dh, fx, fz } = fingerOffset(g);
  const T = [b.x - fx * dh, top + dy - 0.02, b.z - fz * dh];
  const S = [T[0] - fx * Math.cos(p) * back, T[1] + 0.02 + Math.sin(p) * back, T[2] - fz * Math.cos(p) * back];
  if (inside) {   // отойти вдоль оси руки на 9 см, сдвинуться к предмету на той же высоте
    const k = 0.09, h = g.hand.pos;
    yield* moveTo(g, [h.x - fx * Math.cos(p) * k, h.y + Math.sin(p) * k, h.z - fz * Math.cos(p) * k], speed, 0.012);
    yield* moveTo(g, [T[0] - fx * Math.cos(p) * k, T[1] + 0.02 + Math.sin(p) * k, T[2] - fz * Math.cos(p) * k], speed, 0.012);
  } else {
    yield* moveTo(g, [S[0], Math.max(S[1], g.hand.pos.y), S[2]], 0.6);
    yield* moveTo(g, S, 0.6);
    yield* waitTraps(g, 'enter', item, { axis: 'z' });
  }
  yield* moveTo(g, T, speed, 0.01, 3, true);                    // упрётся пальцами в предмет
  yield* wait(0.25);
  yield* waitTraps(g, 'grab', item, { axis: 'z' });
  yield* grip(g, true);
  yield* moveTo(g, S, speed, 0.02);
  return S;
}

/** «Нырок», вторая половина: положить предмет, который держим, в точку spot = [x, y, z] (y — высота поверхности). */
export function* diveDrop(g, item, spot, { speed = 0.5, back = 0.5, settle = 0.8, stay = false, outside = false } = {}) {   // outside — точка вне коробки: ловушек ждать не надо
  const { p, dy, dh, fx, fz } = fingerOffset(g);
  const T = [spot[0] - fx * dh, spot[1] + heightOf(item) + 0.028 + dy, spot[2] - fz * dh];
  const S = [T[0] - fx * Math.cos(p) * back, T[1] + Math.sin(p) * back, T[2] - fz * Math.cos(p) * back];
  yield* moveTo(g, [g.hand.pos.x, Math.max(S[1], g.hand.pos.y), g.hand.pos.z], 0.6, 0.02);
  yield* moveTo(g, [S[0], Math.max(S[1], g.hand.pos.y), S[2]], 0.6, 0.02);
  yield* moveTo(g, S, 0.6, 0.02);
  if (!outside) yield* waitTraps(g, 'enter', item, { axis: 'z' });
  yield* moveTo(g, T, speed, 0.012, 3);
  yield* grip(g, false, settle);
  if (!stay) yield* moveTo(g, S, speed, 0.02);
}

/**
 * Боковое отверстие: ладонь ложится на предмет сверху, предмет вытаскивается вдоль предплечья.
 * Возвращает высоту, на которой предмет вынесен наружу (для deliver).
 *   speed — скорость руки; approachSpeed — скорость подхода к отверстию (по умолчанию = speed);
 *   outside — как далеко от предмета точка «снаружи»; lift — на сколько приподнять перед выносом;
 *   hover — если задано, ладонь не опускается на предмет, а висит на этой высоте над ним (движущийся предмет);
 *   liftSpeed — скорость первого подъёма (нажимная плита требует плавности);
 *   rollOut — перед выносом повернуть кисть ребром (предмет, который в щель проходит только боком).
 */
export function* reach(g, item, entry, { speed = 0.6, approachSpeed = speed, outside = 0.34, lift = 0.03, hover = null, gripSettle = 0.4, liftSpeed = Math.min(speed, 0.2), rollOut = false } = {}) {
  const b = posOf(item), yGrab = topOf(item) + PALM_REST;
  const yIn = yGrab + (hover ?? 0.012);
  // Рука входит и выходит по оси отверстия. Если предмет лежит в стороне от неё (съехал, пока его
  // разворачивали), рука сначала заходит по центру отверстия и только внутри сдвигается к предмету.
  const lat = entry.axis === 'z' ? 'x' : 'z', hole = g.level.box.holes[0];
  const axisPoint = b.clone();
  if (!entry.vec) {   // вход вдоль оси коробки; при входе под углом (entry.vec) рука идёт по прямой прямо к предмету
    axisPoint[lat] = g.level.box.pos[lat === 'x' ? 0 : 1] + hole.offset[0];
    // предплечье остаётся в отверстии, поэтому вбок кисть может уйти не дальше, чем пускает его ширина
    const slack = Math.max(0, (hole.shape === 'circle' ? hole.radius : hole.size[0] / 2) - FOREARM_R - 0.006);
    b[lat] = Math.min(axisPoint[lat] + slack, Math.max(axisPoint[lat] - slack, b[lat]));
  }
  yield* moveTo(g, along(axisPoint, entry, outside + 0.25, yIn), approachSpeed);
  yield* waitTraps(g, 'enter', item, entry);
  yield* moveTo(g, [axisPoint.x, yIn, axisPoint.z], speed, 0.012);
  yield* moveTo(g, [b.x, yIn, b.z], speed, 0.012);
  if (hover == null) yield* moveTo(g, [b.x, yGrab - 0.01, b.z], 0.2, 0.006, 0.6);
  yield* waitTraps(g, 'grab', item, entry);
  yield* grip(g, true, gripSettle);
  yield* moveTo(g, [b.x, yGrab + lift, b.z], liftSpeed, 0.008);
  yield* moveTo(g, [axisPoint.x, yGrab + lift, axisPoint.z], Math.min(speed, 0.3), 0.01);
  const exit = along(axisPoint, entry, outside + 0.25, yGrab + lift);
  if (rollOut) {
    // кисть ребром: предмет оказывается сбоку от ладони. Сдвигаем руку вбок так, чтобы середина
    // пары «ладонь + предмет» шла по центру отверстия.
    yield* turn(g, { roll: 90 });
    yield* wait(0.3);
    const holeLat = axisPoint[lat];
    const hl = g.hand.wrist[lat], il = item.position()[lat], t = heightOf(item) / 2;
    const shift = holeLat - (Math.min(hl - 0.03, il - t) + Math.max(hl + 0.03, il + t)) / 2;
    const p = g.hand.pos.clone(); p[lat] += shift;
    yield* moveTo(g, [p.x, p.y, p.z], 0.15, 0.006, 2);
    exit[lat === 'x' ? 0 : 2] = p[lat];
  }
  yield* moveTo(g, exit, speed, 0.02);
  return yGrab + lift;
}

/** Поставить предмет, который держим, на стол прямо под рукой и разжать пальцы. */
export function* putDown(g, item, settle = 1.4) {
  yield* moveTo(g, [g.hand.pos.x, WORLD.tableY + heightOf(item) + 0.03, g.hand.pos.z], 0.5, 0.012, 1);
  yield* grip(g, false, settle);
}

/** Взять лежащий на столе предмет ладонью сверху. Возвращает высоту переноса. */
export function* pickUp(g, item, lift = 0.04) {
  const b = posOf(item), yGrab = topOf(item) + PALM_REST;
  yield* moveTo(g, [b.x, yGrab + 0.03, b.z], 0.5, 0.012);
  yield* moveTo(g, [b.x, yGrab - 0.01, b.z], 0.2, 0.006, 0.6);
  yield* grip(g, true);
  yield* moveTo(g, [b.x, yGrab + lift, b.z], 0.4, 0.01);
  return yGrab + lift;
}

/**
 * «Трещотка»: предмет лежит поперёк входа. Берём, приподнимаем, доворачиваем кистью, кладём —
 * и так, пока он не ляжет длинной стороной вдоль руки. Сейчас умеет только вход спереди (ось Z).
 */
export function* ratchet(g, item) {
  const b0 = posOf(item), yGrab = topOf(item) + PALM_REST;
  yield* moveTo(g, [b0.x, yGrab + 0.012, b0.z + 0.5], 0.6);
  const yawOf = () => { const e = new THREE.Vector3(1, 0, 0).applyQuaternion(item.quaternion()); return Math.atan2(-e.z, e.x); }; // 0 — вдоль X, ±90° — вдоль Z
  for (let i = 0; i < 12; i++) {
    const a = yawOf(), left = Math.PI / 2 - Math.abs(a);
    if (left < rad(4)) break;
    const b = posOf(item), s = a >= 0 ? 1 : -1, stepA = Math.min(left + rad(1), rad(24));
    yield* turn(g, { yaw: (-s * stepA * 0.5) / rad(1) });
    yield* moveTo(g, [b.x, yGrab + 0.012, b.z], 0.5, 0.012);
    yield* moveTo(g, [b.x, yGrab - 0.01, b.z], 0.2, 0.006, 0.5);
    yield* grip(g, true);
    yield* moveTo(g, [b0.x, yGrab + 0.02, b0.z], 0.2, 0.008, 2);
    yield* turn(g, { yaw: (s * stepA * 0.5) / rad(1) });
    yield* moveTo(g, [b0.x, yGrab + 0.004, b0.z], 0.2, 0.008, 1);
    yield* grip(g, false, 0.5);
    yield* moveTo(g, [b0.x, yGrab + 0.04, b0.z], 0.3, 0.01, 1);
  }
  yield* turn(g, { yaw: 0 });
}

// ---------------------------------------------------------------------------
// 3. Сценарии
// ---------------------------------------------------------------------------
/** Добыча уровня, которую ещё надо донести. */
const targets = (g) => g.items.filter((it) => it.role === 'target' && !it.banked);

/** Сценарий по умолчанию: каждый предмет добычи — взять через отверстие и донести в «сейф». */
export function* standard(g, o = {}) {
  const entry = entryOf(g.level);
  if (o.yaw != null) yield* turn(g, { yaw: o.yaw });        // щель требует повернуть кисть заранее
  // вход под углом: рука идёт по прямой туда, куда смотрит кисть (через два смещённых отверстия)
  if (o.angled) { entry.vec = [Math.sin(g.hand.ang.yaw), Math.cos(g.hand.ang.yaw)]; }
  for (const item of targets(g)) {
    if (g.state !== 'playing') return;
    if (o.dive) {
      yield* diveGrab(g, item, o);
      const [sx, sz] = g.level.safe.pos;
      yield* diveDrop(g, item, [sx, WORLD.tableY, sz], { ...o, settle: 1.2, stay: true, outside: true });
    } else if (entry.mode === 'claw') yield* claw(g, item, o);
    else {
      const y = yield* reach(g, item, entry, o);
      if (o.rollOut) yield* turn(g, { roll: 0 });
      yield* deliver(g, item, y, o.deliverSpeed);
    }
  }
}

// Настройки и особые сценарии по id уровня. Нет записи — standard() с настройками по умолчанию.
const AUTO = {
  // Ловушка для обезьян: сначала развернуть слиток торцом к отверстию.
  3: { script: function* (g) { yield* ratchet(g, g.items[0]); yield* standard(g, { speed: 0.5 }); } },
  4: { liftSpeed: 0.08 },                               // нажимная плита: поднимать плавно
  5: { speed: 0.75 },                                   // лазеры: успеть за одну паузу мигающего луча
  6: { speed: 0.3, lift: 0.025, deliverSpeed: 0.3 },    // скользкий слиток: медленно
  // Горячий слиток: вынести из коробки, положить на стол, дать руке остыть и донести.
  7: {
    script: function* (g) {
      const item = g.items[0];
      yield* reach(g, item, entryOf(g.level), { speed: 0.8, outside: 0.3 });
      yield* putDown(g, item);
      const y = yield* pickUp(g, item);
      yield* deliver(g, item, y, 0.8);
    },
  },
  9: { yaw: 90 },                                       // узкая щель: рука ложится вдоль щели
  10: { lift: 0.05, liftSpeed: 0.1 },                   // плита в глубине: поднять плавно и повыше, потом выносить
  // Экзамен ломбарда: горячий слиток поперёк — развернуть перехватами, вынести, дать остыть, донести.
  11: {
    script: function* (g) {
      const item = g.items[0];
      yield* ratchet(g, item);
      yield* wait(1.2);
      yield* reach(g, item, entryOf(g.level), { speed: 0.8, outside: 0.3 });
      yield* putDown(g, item);
      const y = yield* pickUp(g, item);
      yield* deliver(g, item, y, 0.8);
    },
  },
  15: { rollOut: true, speed: 0.4 },                    // корона ребром
  17: { speed: 0.75 },                                  // камера + мигающий лазер
  18: { rollOut: true, speed: 0.4 },                    // зал короны
  20: { dive: true },                                    // барьер: нырок сверху вниз через высокое окно
  21: { speed: 0.75 },                                   // заслонка: войти и выйти за одно открытие
  // Подмена: сначала груз на весы, потом слиток.
  22: {
    script: function* (g) {
      const weight = g.items.find((it) => it.typeName === 'weight'), ped = g.level.pedestal;
      yield* clawGrab(g, weight);
      yield* clawDrop(g, weight, [g.level.box.pos[0] + ped.pos[0] + 0.09, g.level.box.pos[1] + ped.pos[1]], WORLD.tableY + ped.size[1], 0.8);
      yield* standard(g);
    },
  },
  23: { angled: true, speed: 0.5 },                      // два окна: рука под углом по прямой через оба
  24: { speed: 0.7 },                                    // монеты + заслонка
  25: { speed: 0.75 },                                   // три слитка под таймером заслонки
  // Хранилище: нырком пронести груз на весы за барьером и тут же забрать слиток.
  26: {
    script: function* (g) {
      const weight = g.items.find((it) => it.typeName === 'weight'), bar = g.items.find((it) => it.role === 'target'), ped = g.level.pedestal;
      yield* diveGrab(g, weight);
      // ждать открытия заслонки надо подальше от стенки (back): иначе груз под пальцами мешает ей закрыться
      yield* diveDrop(g, weight, [g.level.box.pos[0] + ped.pos[0] + 0.08, WORLD.tableY + ped.size[1], g.level.box.pos[1] + ped.pos[1]], { stay: true, back: 0.62 });
      yield* diveGrab(g, bar, { inside: true });
      const [sx, sz] = g.level.safe.pos;
      yield* diveDrop(g, bar, [sx, WORLD.tableY, sz], { settle: 1.2, stay: true, outside: true });
    },
  },
  28: { speed: 0.6 },                                    // перебои со светом (автопилот видит и в темноте)
  29: { speed: 0.5, approachSpeed: 0.6, outside: 0.3, hover: 0.006, lift: 0.035, gripSettle: 0.35 },   // кости на карусели
  30: { speed: 0.3, deliverSpeed: 0.3 },                 // бриллиант: медленно, иначе выскользнет
  31: { speed: 0.5, approachSpeed: 0.6, outside: 0.3, hover: 0.006, lift: 0.035, gripSettle: 0.35 },   // фишки на карусели в темноте
  32: { speed: 0.3, approachSpeed: 0.6, outside: 0.3, hover: 0.006, lift: 0.03, gripSettle: 0.35, deliverSpeed: 0.3 },   // бриллиант на карусели
  // Карусель: висеть над платформой и сжать пальцы, когда слиток смотрит торцом на отверстие.
  8: { speed: 0.5, approachSpeed: 0.6, outside: 0.3, hover: 0.006, lift: 0.035, gripSettle: 0.35 },
};

/** Запустить сценарий уровня. Возвращает генератор для game.autopilot. */
export function autopilotFor(game) {
  const a = AUTO[game.level.id] || game.level.auto || {};
  return a.script ? a.script(game) : standard(game, a);
}
