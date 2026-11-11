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

// ---------------------------------------------------------------------------
// 1. Примитивы
// ---------------------------------------------------------------------------
function* wait(seconds) { for (let i = 0; i < seconds / DT; i++) yield; }
function* until(fn, timeout = 20) { for (let t = 0; t < timeout && !fn(); t += DT) yield; }

/** Вести цель кисти к точке со скоростью speed. Заканчивается, когда кисть рядом или вышло время. */
function* moveTo(g, [x, y, z], speed = 0.6, tol = 0.015, timeout = 5) {
  const h = g.hand; cur.copy(h.target); dst.set(x, y, z);
  for (let t = 0; t < timeout; t += DT) {
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
const along = (p, entry, d, y) => (entry.axis === 'x' ? [p.x + entry.dir * d, y, p.z] : [p.x, y, p.z + entry.dir * d]);

/** Ждать, пока все ловушки уровня ответят «безопасно» для данной фазы ('enter' | 'grab'). */
function* waitTraps(g, phase, item, entry, timeout = 30) {
  const ctx = { game: g, time: 0, item, axis: entry.axis };
  yield* until(() => { ctx.time = g.time; return g.traps.every((t) => !t.autoReady || t.autoReady(phase, ctx)); }, timeout);
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

/** Отверстие сверху: рука висит «клешнёй», предмет берётся кончиками пальцев и сразу несётся в «сейф». */
export function* claw(g, item, { liftSpeed = 0.6 } = {}) {
  const b = posOf(item), top = topOf(item), [sx, sz] = g.level.safe.pos;
  // кончики пальцев относительно центра ладони при текущем наклоне кисти
  const p = -g.hand.ang.pitch, dy = FINGER_REACH * Math.sin(p), dz = FINGER_REACH * Math.cos(p);
  const z = b.z + dz, high = g.level.box.size[1] + WORLD.tableY + dy + 0.1;
  yield* moveTo(g, [b.x, high, z], 0.6);
  yield* waitTraps(g, 'enter', item, { axis: 'z' });
  yield* moveTo(g, [b.x, top + dy - 0.02, z], 0.35, 0.01, 2.5); // упрётся пальцами в предмет
  yield* wait(0.25);
  yield* waitTraps(g, 'grab', item, { axis: 'z' });
  yield* grip(g, true);
  yield* moveTo(g, [b.x, top + dy + 0.08, z], liftSpeed, 0.02);
  yield* moveTo(g, [b.x, high, z], 0.6, 0.02);
  yield* moveTo(g, [sx, high, sz + dz], 0.7, 0.02);
  yield* moveTo(g, [sx, WORLD.tableY + heightOf(item) + 0.028 + dy, sz + dz], 0.5, 0.012, 3);
  yield* grip(g, false, 1.2);
}

/**
 * Боковое отверстие: ладонь ложится на предмет сверху, предмет вытаскивается вдоль предплечья.
 * Возвращает высоту, на которой предмет вынесен наружу (для deliver).
 *   speed — скорость руки; approachSpeed — скорость подхода к отверстию (по умолчанию = speed);
 *   outside — как далеко от предмета точка «снаружи»; lift — на сколько приподнять перед выносом;
 *   hover — если задано, ладонь не опускается на предмет, а висит на этой высоте над ним (движущийся предмет).
 */
export function* reach(g, item, entry, { speed = 0.6, approachSpeed = speed, outside = 0.34, lift = 0.03, hover = null, gripSettle = 0.4 } = {}) {
  const b = posOf(item), yGrab = topOf(item) + PALM_REST;
  const yIn = yGrab + (hover ?? 0.012);
  yield* moveTo(g, along(b, entry, outside + 0.25, yIn), approachSpeed);
  yield* waitTraps(g, 'enter', item, entry);
  yield* moveTo(g, [b.x, yIn, b.z], speed, 0.012);
  if (hover == null) yield* moveTo(g, [b.x, yGrab - 0.01, b.z], 0.2, 0.006, 0.6);
  yield* waitTraps(g, 'grab', item, entry);
  yield* grip(g, true, gripSettle);
  yield* moveTo(g, [b.x, yGrab + lift, b.z], Math.min(speed, 0.2), 0.008);
  yield* moveTo(g, along(b, entry, outside + 0.25, yGrab + lift), speed, 0.02);
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
  for (const item of targets(g)) {
    if (g.state !== 'playing') return;
    if (entry.mode === 'claw') yield* claw(g, item, o);
    else { const y = yield* reach(g, item, entry, o); yield* deliver(g, item, y, o.deliverSpeed); }
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
  // Карусель: висеть над платформой и сжать пальцы, когда слиток смотрит торцом на отверстие.
  8: { speed: 0.5, approachSpeed: 0.6, outside: 0.3, hover: 0.006, lift: 0.035, gripSettle: 0.35 },
};

/** Запустить сценарий уровня. Возвращает генератор для game.autopilot. */
export function autopilotFor(game) {
  const a = AUTO[game.level.id] || game.level.auto || {};
  return a.script ? a.script(game) : standard(game, a);
}
