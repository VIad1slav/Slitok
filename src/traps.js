// Ловушки и реквизит внутри коробки: подставка, нажимная плита, лазеры, горячий слиток, карусель.
// Каждая ловушка: step(dt, ctx) — логика на шаге физики, update(time) — визуал, dispose().
// ctx = { game, hand, items, audio, time } ; game.alarm(seconds, text) / game.fail(reason).
// env.item — предмет добычи, за которым следит ловушка (номер в списке предметов уровня: def.item, по умолчанию 0).
// Необязательный autoReady(phase, ctx) — ответ автопилоту «сейчас безопасно?»:
//   phase 'enter' — перед тем как сунуть руку в отверстие, 'grab' — перед тем как сжать пальцы над предметом.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { WORLD } from './config.js';
import { GROUP } from './box.js';
import { T } from './strings.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

function staticBox(world, material, center, half, kind) {
  const body = new CANNON.Body({ type: CANNON.Body.STATIC, material, collisionFilterGroup: GROUP.STATIC, collisionFilterMask: GROUP.BAR });
  body.addShape(new CANNON.Box(new CANNON.Vec3(half.x, half.y, half.z)));
  body.position.set(center.x, center.y, center.z);
  body.userData = { kind };
  world.addBody(body);
  return body;
}

/** Подставка под слиток (бархатная или стальная). */
export class Pedestal {
  constructor({ scene, world, M, level, glbScene, staticMaterial }) {
    this.scene = scene; this.world = world;
    const p = level.pedestal, [w, h, d] = p.size;
    const c = new THREE.Vector3(level.box.pos[0] + p.pos[0], WORLD.tableY + h / 2, level.box.pos[1] + p.pos[1]);
    this.body = staticBox(world, staticMaterial, c, new THREE.Vector3(w / 2, h / 2, d / 2), 'pedestal');
    this.colliders = [{ type: 'box', kind: 'pedestal', c, h: new THREE.Vector3(w / 2, h / 2, d / 2), q: null, qi: null }];
    this.usedGlb = !!glbScene && !p.metal;
    if (this.usedGlb) {
      this.mesh = glbScene.clone(true);
      // модель сделана размером 0.3 × 0.05 × 0.16 с началом координат в центре дна
      this.mesh.scale.set(w / 0.3, h / 0.05, d / 0.16);
      this.mesh.position.set(c.x, WORLD.tableY, c.z);
      this.mesh.traverse((o) => {
        if (!o.isMesh) return;
        o.material = /velvet/i.test(o.material?.name || '') ? M.velvet : M.metal;
        o.castShadow = true; o.receiveShadow = true;
      });
    } else {
      this.mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), p.metal ? M.steel : M.velvet);
      this.mesh.position.copy(c); this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    }
    scene.add(this.mesh);
  }
  dispose() { this.scene.remove(this.mesh); this.world.removeBody(this.body); }
}

/** Нажимная плита: резкий подъём слитка включает сирену и обратный отсчёт. */
class PlateTrap {
  constructor(def, env) {
    this.def = def; this.env = env; this.state = 'armed'; this.peak = 0;
    const p = env.level.pedestal, [w, h, d] = p.size;
    this.top = WORLD.tableY + h;
    this.restY = null;
    const geo = new THREE.BoxGeometry(w * 0.82, 0.006, d * 0.82);
    this.mat = new THREE.MeshStandardMaterial({ color: 0x202226, metalness: 0.8, roughness: 0.35, emissive: 0xff2a10, emissiveIntensity: 1.2 });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.position.set(env.level.box.pos[0] + p.pos[0], this.top + 0.001, env.level.box.pos[1] + p.pos[1]);
    env.scene.add(this.mesh);
  }
  step(dt, ctx) {
    const bar = this.env.item, y = bar.body.position.y;
    if (this.restY === null) { if (ctx.time > 0.3) { this.restY = y; this.restX = bar.body.position.x; this.restZ = bar.body.position.z; } return; }
    if (this.state !== 'armed') return;
    const lift = y - this.restY, slide = Math.hypot(bar.body.position.x - this.restX, bar.body.position.z - this.restZ);
    const speed = bar.speed();
    if (lift > 0.003 || slide > 0.01) this.peak = Math.max(this.peak, speed);
    this.tension = Math.min(1, Math.max(this.peak, speed) / this.def.maxLiftSpeed);
    if (lift > this.def.liftHeight || slide > 0.07) {
      if (this.peak > this.def.maxLiftSpeed) {
        this.state = 'tripped';
        ctx.audio.click();
        ctx.game.alarm(this.def.alarmSeconds, 'Датчик веса сработал!');
      } else {
        this.state = 'safe';
        ctx.audio.click();
        ctx.game.toast('Датчик обманут. Чистая работа.');
      }
    }
  }
  update(time) {
    const m = this.mat;
    if (this.state === 'safe') { m.emissive.set(0x18ff60); m.emissiveIntensity = 0.9; }
    else if (this.state === 'tripped') { m.emissive.set(0xff1010); m.emissiveIntensity = 1.5 + Math.sin(time * 20); }
    else { m.emissive.setRGB(1, 0.75 * (1 - (this.tension || 0)), 0.05); m.emissiveIntensity = 0.9 + 0.3 * Math.sin(time * 4); }
  }
  dispose() { this.env.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mat.dispose(); }
}

/** Лазерные лучи. Луч может мигать (on/off в секундах). */
class LaserTrap {
  constructor(def, env) {
    this.def = def; this.env = env; this.tripped = false;
    const o = new THREE.Vector3(env.level.box.pos[0], WORLD.tableY, env.level.box.pos[1]);
    this.group = new THREE.Group(); env.scene.add(this.group);
    this.beams = def.beams.map((b) => {
      const from = new THREE.Vector3(...b.from).add(o), to = new THREE.Vector3(...b.to).add(o);
      const len = from.distanceTo(to), dir = to.clone().sub(from).normalize();
      const mat = new THREE.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false });
      const core = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0022, len, 6), mat);
      const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, len, 8), mat.clone());
      glow.material.opacity = 0.16;
      for (const m of [core, glow]) {
        m.position.copy(from).lerp(to, 0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir); m.renderOrder = 4;
        this.group.add(m);
      }
      const dots = [from, to].map((p) => { const d = new THREE.Mesh(new THREE.SphereGeometry(0.007, 10, 8), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xff2020, emissiveIntensity: 2 })); d.position.copy(p); this.group.add(d); return d; });
      return { from, to, core, glow, dots, on: b.on, off: b.off, active: true };
    });
  }
  step(dt, ctx) {
    for (const b of this.beams) {
      if (b.on) { const cycle = b.on + b.off, t = ctx.time % cycle; b.active = t >= b.off; b.warn = !b.active && t > b.off - 0.6; }
      if (!b.active || this.tripped) continue;
      _c.copy(b.to).sub(b.from); const len2 = _c.lengthSq();
      let hit = false;
      ctx.hand.forEachArmSphere((x, y, z, r) => {
        if (hit) return;
        _a.set(x, y, z).sub(b.from);
        const t = Math.min(1, Math.max(0, _a.dot(_c) / len2));
        _b.copy(b.from).addScaledVector(_c, t);
        if (_b.distanceToSquared(_a.set(x, y, z)) < (r * 0.9) ** 2) hit = true;
      });
      if (hit) {
        this.tripped = true;
        ctx.audio.zap();
        ctx.game.alarm(this.def.failDelay, 'Лазер задет!', true);
      }
    }
  }
  /** Автопилоту: входить сразу после того, как мигающий луч погас (впереди вся пауза). */
  autoReady(phase, ctx) {
    if (phase !== 'enter') return true;
    return this.beams.every((b) => !b.on || ctx.time % (b.on + b.off) < 0.08);
  }
  update(time) {
    for (const b of this.beams) {
      const vis = b.active || (b.warn && Math.sin(time * 40) > 0.3);
      b.core.visible = b.glow.visible = vis;
      b.core.material.opacity = b.active ? 0.85 + 0.15 * Math.sin(time * 50) : 0.25;
      b.glow.material.opacity = b.active ? 0.16 : 0.04;
      for (const d of b.dots) d.material.emissiveIntensity = b.active ? 2.2 : 0.3;
    }
  }
  dispose() {
    this.env.scene.remove(this.group);
    this.group.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  }
}

/** Горячий слиток: держать можно не дольше holdTime секунд подряд. */
class HotTrap {
  constructor(def, env) { this.def = def; this.env = env; this.heat = 0; env.item.glowOwner = this; }
  step(dt, ctx) {
    if (ctx.hand.item === this.env.item) {
      this.heat += dt / this.def.holdTime;
      if (this.heat >= 1) {
        ctx.hand.release('hot', this.def.cooldown);
        ctx.audio.sizzle();
        ctx.game.toast('Ай! Горячо!');
      }
    } else this.heat = Math.max(0, this.heat - dt / (this.def.cooldown * 0.9));
    ctx.game.hud.meter = { label: 'ЖАР', value: this.heat };
  }
  update(time) { this.env.item.setGlow(0.5 + 0.2 * Math.sin(time * 5) + this.heat * 0.6); }
  dispose() { this.env.item.setGlow(0); this.env.item.glowOwner = null; }
}

/** Вращающаяся платформа. */
class SpinnerTrap {
  constructor(def, env) {
    this.def = def; this.env = env;
    const c = new THREE.Vector3(env.level.box.pos[0] + def.pos[0], WORLD.tableY + def.height / 2, env.level.box.pos[1] + def.pos[1]);
    const k = def.radius * 0.72;
    this.body = new CANNON.Body({ type: CANNON.Body.KINEMATIC, material: env.staticMaterial, collisionFilterGroup: GROUP.STATIC, collisionFilterMask: GROUP.BAR });
    this.body.addShape(new CANNON.Box(new CANNON.Vec3(k, def.height / 2, k)));
    this.body.position.set(c.x, c.y, c.z);
    this.body.angularVelocity.set(0, def.speed, 0);
    this.body.userData = { kind: 'platform' };
    env.world.addBody(this.body);
    this.colliders = [{ type: 'cyl', kind: 'platform', c, r: def.radius, hh: def.height / 2 }];
    const geo = new THREE.CylinderGeometry(def.radius, def.radius * 1.04, def.height, 48);
    this.mesh = new THREE.Mesh(geo, [env.M.metal, env.M.velvet, env.M.metal]);
    this.mesh.position.copy(c); this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    const mark = new THREE.Mesh(new THREE.BoxGeometry(def.radius * 0.5, 0.002, 0.008), new THREE.MeshBasicMaterial({ color: 0xffc04a, toneMapped: false }));
    mark.position.set(def.radius * 0.7, def.height / 2 + 0.001, 0); this.mesh.add(mark);
    env.scene.add(this.mesh);
  }
  step() { /* тело вращает сам cannon-es; слиток увлекается трением */ }
  /** Автопилоту: сжимать пальцы, когда предмет на платформе почти повернулся длинной стороной вдоль руки. */
  autoReady(phase, ctx) {
    if (phase !== 'grab') return true;
    _a.set(1, 0, 0).applyQuaternion(ctx.item.quaternion());
    const along = ctx.axis === 'x' ? _a.x : _a.z, across = ctx.axis === 'x' ? _a.z : _a.x;
    const mis = Math.abs(Math.atan2(across, Math.abs(along)));
    const lead = Math.abs(this.def.speed) * 0.09;            // пальцы сжимаются не мгновенно
    const ok = this._prevMis !== undefined && mis < this._prevMis && mis < lead + 0.026;
    this._prevMis = mis;
    return ok;
  }
  update() { const q = this.body.quaternion; this.mesh.quaternion.set(q.x, q.y, q.z, q.w); }
  dispose() { this.env.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.env.world.removeBody(this.body); }
}

/**
 * Камера наблюдения. Цикл: не смотрит (away, с) → предупреждение (warn) → смотрит (watch).
 * Пока смотрит, рука должна стоять: полоска «замечен» растёт, когда кисть движется быстрее speedLimit (м/с)
 * или вращается быстрее rotLimit (рад/с), и убывает, когда рука неподвижна. Заполнилась — тревога и провал.
 *   fillTime — за сколько секунд полоска заполняется при движении 0,25 м/с; phase — сдвиг начала цикла, с;
 *   autoNeed — автопилоту: сколько секунд «не смотрит» должно оставаться, чтобы начинать вход.
 */
class CameraTrap {
  constructor(def, env) {
    this.def = { away: 5, warn: 0.8, watch: 2.5, speedLimit: 0.04, rotLimit: 0.15, fillTime: 0.5, phase: 0, failDelay: 1.2, autoNeed: 0, ...def };
    this.env = env; this.state = 'away'; this.meter = 0; this.left = 0; this.tripped = false; this.aim = 0;
    this.prevQuat = new THREE.Quaternion(); this.hasPrev = false;
    const lvl = env.level, [w, h, d] = lvl.box.size;
    const foot = new THREE.Vector3(...(def.pos ? [def.pos[0], WORLD.tableY, def.pos[1]] : [lvl.box.pos[0] - w / 2 - 0.1, WORLD.tableY, lvl.box.pos[1] - d / 2 - 0.06]));
    this.target = new THREE.Vector3(lvl.box.pos[0], WORLD.tableY + h * 0.4, lvl.box.pos[1]);
    const poleH = 0.52;
    this.group = new THREE.Group(); this.group.position.copy(foot); env.scene.add(this.group);
    const src = env.models?.camera, base = src?.getObjectByName('cam_base'), head = src?.getObjectByName('cam_head');
    this.usedGlb = !!(base && head);
    if (this.usedGlb) {
      const b = base.clone(true); b.position.set(0, 0, 0); this.group.add(b);
      this.head = head.clone(true);
      for (const o of [b, this.head]) o.traverse((m) => { if (m.isMesh) { m.material = /steel/i.test(m.material?.name || '') ? env.M.steel : env.M.metal; m.castShadow = true; } });
    } else {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, poleH, 12), env.M.metal); pole.position.y = poleH / 2; pole.castShadow = true;
      this.group.add(pole);
      this.head = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.11), env.M.metal); body.castShadow = true;
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.024, 0.03, 16), env.M.steel); lens.rotation.x = Math.PI / 2; lens.position.z = 0.065;
      this.head.add(body, lens);
    }
    this.head.position.set(0, poleH, 0); this.group.add(this.head);
    this.led = new THREE.Mesh(new THREE.SphereGeometry(0.009, 10, 8), new THREE.MeshBasicMaterial({ color: 0x20ff60, toneMapped: false }));
    this.led.position.set(0, 0.034, 0.03); this.head.add(this.led);
    // видимый луч камеры
    const len = foot.clone().setY(foot.y + poleH).distanceTo(this.target) + 0.1;
    const cone = new THREE.ConeGeometry(0.3, len, 28, 1, true); cone.translate(0, -len / 2, 0); cone.rotateX(-Math.PI / 2);
    this.beam = new THREE.Mesh(cone, new THREE.MeshBasicMaterial({ color: 0xff2a18, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false }));
    this.beam.renderOrder = 6; this.head.add(this.beam);
    // стойка — препятствие для руки и добычи
    const c = foot.clone().setY(foot.y + poleH / 2), half = new THREE.Vector3(0.018, poleH / 2, 0.018);
    this.body = staticBox(env.world, env.staticMaterial, c, half, 'prop');
    this.colliders = [{ type: 'box', kind: 'prop', c, h: half, q: null, qi: null }];
    this._q0 = new THREE.Quaternion(); this._q1 = new THREE.Quaternion();
    const m = new THREE.Matrix4().lookAt(this.target, this.head.getWorldPosition(new THREE.Vector3()), new THREE.Vector3(0, 1, 0));
    this._q1.setFromRotationMatrix(m);                                              // смотрит на коробку
    this._q0.copy(this._q1).premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1.9)); // отвернулась
    this._phase(0);
  }
  _phase(time) {
    const d = this.def, cycle = d.away + d.warn + d.watch, t = (((time + d.phase) % cycle) + cycle) % cycle;
    const prev = this.state;
    if (t < d.away) { this.state = 'away'; this.left = d.away - t; this.aim = Math.max(0, 1 - t / 0.6); }
    else if (t < d.away + d.warn) { this.state = 'warn'; this.left = d.away + d.warn - t; this.aim = (t - d.away) / d.warn; }
    else { this.state = 'watch'; this.left = cycle - t; this.aim = 1; }
    return prev !== this.state;
  }
  step(dt, ctx) {
    const changed = this._phase(ctx.time), d = this.def, h = ctx.hand;
    if (changed && !this.tripped) {
      if (this.state === 'warn') { ctx.audio.beep(660, 0.12, 0.09); ctx.audio.beep(880, 0.12, 0.09, 0.25); ctx.audio.beep(1100, 0.14, 0.12, 0.5); ctx.game.toast(T.cameraWarn); }
      else if (this.state === 'watch') { ctx.audio.beep(110, 0.3, 0.5, 0, 'sawtooth'); ctx.game.toast(T.cameraWatch); }
      else ctx.audio.beep(520, 0.08, 0.06);
    }
    // угловая скорость кисти
    let rot = 0;
    if (this.hasPrev) rot = 2 * Math.acos(Math.min(1, Math.abs(this.prevQuat.dot(h.quat)))) / dt;
    this.prevQuat.copy(h.quat); this.hasPrev = true;
    if (this.state === 'watch' && !this.tripped) {
      const move = Math.max(0, h.vel.length() - d.speedLimit) / (0.25 - d.speedLimit) + Math.max(0, rot - d.rotLimit) / 1.5;
      this.meter = move > 0 ? this.meter + (Math.min(move, 3) * dt) / d.fillTime : Math.max(0, this.meter - dt * 1.5);
      if (this.meter >= 1) { this.tripped = true; ctx.game.alarm(d.failDelay, T.cameraFail, true, T.cameraFail); }
    } else if (!this.tripped) this.meter = Math.max(0, this.meter - dt * 1.5);
    if (this.state === 'watch' || this.meter > 0) ctx.game.hud.meter = { label: T.cameraMeter, value: this.meter };
  }
  /** Автопилоту: замереть, пока камера поворачивается или смотрит. */
  autoHold() { return this.state !== 'away'; }
  autoReady(phase) { return this.state === 'away' && (phase !== 'enter' || this.left >= this.def.autoNeed); }
  update(time) {
    const s = this.aim * this.aim * (3 - 2 * this.aim);
    this.head.quaternion.copy(this._q0).slerp(this._q1, s);
    const watching = this.state === 'watch';
    this.led.material.color.set(watching ? 0xff2010 : this.state === 'warn' ? (Math.sin(time * 30) > 0 ? 0xffc020 : 0x402800) : 0x20ff60);
    this.beam.material.color.set(watching ? 0xff2a18 : 0xffb020);
    this.beam.material.opacity = watching ? 0.07 + 0.015 * Math.sin(time * 12) : this.state === 'warn' ? 0.03 * this.aim : 0;
    this.beam.visible = this.beam.material.opacity > 0;   // невидимый луч не рисуем вовсе
    this.env.stage.watch = watching ? 1 : 0;
  }
  dispose() {
    this.env.scene.remove(this.group); this.env.world.removeBody(this.body); this.env.stage.watch = 0;
    this.led.geometry.dispose(); this.led.material.dispose(); this.beam.geometry.dispose(); this.beam.material.dispose();
  }
}

const TYPES = { plate: PlateTrap, lasers: LaserTrap, hot: HotTrap, spinner: SpinnerTrap, camera: CameraTrap };

export function createTraps(level, env) {
  return (level.traps || []).map((def) => new TYPES[def.type](def, { ...env, item: env.items[def.item ?? 0] }));
}
