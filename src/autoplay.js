// Автопилот: сценарии, которые проходят каждый уровень теми же средствами, что и игрок
// (двигают целевую точку кисти, вращают запястье, сжимают пальцы). Нужен для проверки
// проходимости уровней: tools/test/play.mjs или в консоли браузера — __gg.autoTest(номер).
// Сценарий — генератор: один yield = один шаг физики.
import * as THREE from 'three';
import { PHYS, WORLD, BAR } from './config.js';

const DT = PHYS.step, rad = THREE.MathUtils.degToRad;
const cur = new THREE.Vector3(), dst = new THREE.Vector3();

function* wait(seconds) { for (let i = 0; i < seconds / DT; i++) yield; }

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
function* until(fn, timeout = 20) { for (let t = 0; t < timeout && !fn(); t += DT) yield; }

const barPos = (g) => g.bar.position().clone();
const barTop = (g) => g.bar.position().y + BAR.size[1] / 2;
const safeOf = (g) => g.level.safe.pos;

/** Положить слиток, который держим под ладонью, в «сейф». */
function* deliverFlat(g, carryY, speed = 0.7) {
  const [sx, sz] = safeOf(g);
  yield* moveTo(g, [sx, carryY, sz], speed, 0.02);
  yield* moveTo(g, [sx, WORLD.tableY + BAR.size[1] + 0.03, sz], 0.3, 0.012, 2.5);
  yield* grip(g, false, 1.2);
}

/** Уровни с отверстием сверху: рука висит «клешнёй», берём слиток кончиками пальцев. */
function* claw(g, liftSpeed = 0.6) {
  const b = barPos(g), top = barTop(g), [sx, sz] = safeOf(g);
  // кончики пальцев относительно центра ладони при текущем наклоне кисти
  const reachLen = 0.116, p = -g.hand.ang.pitch, dy = reachLen * Math.sin(p), dz = reachLen * Math.cos(p);
  const z = b.z + dz, high = g.level.box.size[1] + WORLD.tableY + dy + 0.1;
  yield* moveTo(g, [b.x, high, z], 0.6);
  yield* moveTo(g, [b.x, top + dy - 0.02, z], 0.35, 0.01, 2.5); // упрётся пальцами в слиток
  yield* wait(0.25);
  yield* grip(g, true);
  yield* moveTo(g, [b.x, top + dy + 0.08, z], liftSpeed, 0.02);
  yield* moveTo(g, [b.x, high, z], 0.6, 0.02);
  yield* moveTo(g, [sx, high, sz + dz], 0.7, 0.02);
  yield* moveTo(g, [sx, WORLD.tableY + BAR.size[1] + 0.028 + dy, sz + dz], 0.5, 0.012, 3);
  yield* grip(g, false, 1.2);
}

/**
 * Уровни с боковым отверстием: ладонь ложится на слиток сверху, слиток вытаскивается вдоль предплечья.
 * axis — ось, вдоль которой рука входит в коробку ('x' — справа, 'z' — спереди).
 */
function* reach(g, axis, { speed = 0.6, outside = 0.34, lift = 0.03, before } = {}) {
  const b = barPos(g), yGrab = barTop(g) + 0.022;
  const out = axis === 'x' ? [b.x + outside + 0.25, yGrab + 0.012, b.z] : [b.x, yGrab + 0.012, b.z + outside + 0.25];
  yield* moveTo(g, out, speed);
  if (before) yield* before();
  yield* moveTo(g, [b.x, yGrab + 0.012, b.z], speed, 0.012);
  yield* moveTo(g, [b.x, yGrab - 0.01, b.z], 0.2, 0.006, 0.6);
  yield* grip(g, true);
  yield* moveTo(g, [b.x, yGrab + lift, b.z], Math.min(speed, 0.2), 0.008);
  out[1] = yGrab + lift;
  yield* moveTo(g, out, speed, 0.02);
  return yGrab + lift;
}

const SCRIPTS = {
  1: function* (g) { yield* claw(g); },
  2: function* (g) { const y = yield* reach(g, 'x'); yield* deliverFlat(g, y); },

  // Ловушка для обезьян: слиток лежит поперёк. Берём, приподнимаем, доворачиваем кистью, кладём — и так
  // «трещоткой», пока он не ляжет торцом к отверстию. Потом вытаскиваем вдоль предплечья.
  3: function* (g) {
    const b0 = barPos(g), yGrab = barTop(g) + 0.022;
    yield* moveTo(g, [b0.x, yGrab + 0.012, b0.z + 0.5], 0.6);
    const yawOfBar = () => { const e = new THREE.Vector3(1, 0, 0).applyQuaternion(g.bar.quaternion()); return Math.atan2(-e.z, e.x); }; // 0 — вдоль X, ±90° — вдоль Z
    for (let i = 0; i < 12; i++) {
      const a = yawOfBar(), left = Math.PI / 2 - Math.abs(a);
      if (left < rad(4)) break;
      const b = barPos(g), s = a >= 0 ? 1 : -1, stepA = Math.min(left + rad(1), rad(24));
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
    const y = yield* reach(g, 'z', { speed: 0.5 });
    yield* deliverFlat(g, y);
  },

  4: function* (g) { yield* claw(g, 0.08); },

  // Лазеры: ждём, пока мигающий луч погаснет, и успеваем войти и выйти за одну паузу.
  5: function* (g) {
    const beam = g.level.traps[0].beams[2], cycle = beam.on + beam.off;
    const y = yield* reach(g, 'x', { speed: 0.75, before: function* () { yield* until(() => g.time % cycle < 0.08); } });
    yield* deliverFlat(g, y);
  },

  6: function* (g) { const y = yield* reach(g, 'z', { speed: 0.3, lift: 0.025 }); yield* deliverFlat(g, y, 0.3); },

  // Горячий слиток: выносим из коробки, кладём на стол, ждём, пока рука остынет, и доносим.
  7: function* (g) {
    const y = yield* reach(g, 'x', { speed: 0.8, outside: 0.3 });
    yield* moveTo(g, [g.hand.pos.x, WORLD.tableY + BAR.size[1] + 0.03, g.hand.pos.z], 0.5, 0.012, 1);
    yield* grip(g, false, 1.4);
    const b = barPos(g), yGrab = barTop(g) + 0.022;
    yield* moveTo(g, [b.x, yGrab + 0.03, b.z], 0.5, 0.012);
    yield* moveTo(g, [b.x, yGrab - 0.01, b.z], 0.2, 0.006, 0.6);
    yield* grip(g, true);
    yield* moveTo(g, [b.x, yGrab + 0.04, b.z], 0.4, 0.01);
    yield* deliverFlat(g, yGrab + 0.04, 0.8);
  },

  // Карусель: зависаем над платформой и сжимаем пальцы в момент, когда слиток смотрит торцом на отверстие.
  8: function* (g) {
    const b = barPos(g), yGrab = barTop(g) + 0.022;
    yield* moveTo(g, [b.x, yGrab + 0.012, b.z + 0.55], 0.6);
    yield* moveTo(g, [b.x, yGrab + 0.006, b.z], 0.5, 0.012);
    const misalign = () => { const e = new THREE.Vector3(1, 0, 0).applyQuaternion(g.bar.quaternion()); return Math.abs(Math.atan2(e.x, Math.abs(e.z))); };
    const speed = g.level.traps[0].speed, lead = speed * 0.09; // пальцы сжимаются не мгновенно
    let prev = misalign();
    yield* until(() => { const m = misalign(), ok = m < prev && m < lead + rad(1.5); prev = m; return ok; }, 30);
    yield* grip(g, true, 0.35);
    yield* moveTo(g, [b.x, yGrab + 0.035, b.z], 0.2, 0.008);
    yield* moveTo(g, [b.x, yGrab + 0.035, b.z + 0.6], 0.45, 0.02);
    yield* deliverFlat(g, yGrab + 0.035);
  },
};

/** Запустить сценарий уровня. Возвращает генератор для game.autopilot. */
export function autopilotFor(game) {
  const script = SCRIPTS[game.level.id];
  return script ? script(game) : null;
}
