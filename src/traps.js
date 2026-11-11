// Ловушки и реквизит внутри коробки: подставка, нажимная плита, лазеры, горячий слиток, карусель.
// Каждая ловушка: step(dt, ctx) — логика на шаге физики, update(time) — визуал, dispose().
// ctx = { game, hand, bar, audio, time } ; game.alarm(seconds, text) / game.fail(reason).
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { WORLD } from './config.js';
import { GROUP } from './box.js';

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
    const bar = ctx.bar, y = bar.body.position.y;
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
  constructor(def, env) { this.def = def; this.env = env; this.heat = 0; }
  step(dt, ctx) {
    if (ctx.hand.holding) {
      this.heat += dt / this.def.holdTime;
      if (this.heat >= 1) {
        ctx.hand.release('hot', this.def.cooldown);
        ctx.audio.sizzle();
        ctx.game.toast('Ай! Горячо!');
      }
    } else this.heat = Math.max(0, this.heat - dt / (this.def.cooldown * 0.9));
    ctx.game.hud.meter = { label: 'ЖАР', value: this.heat };
  }
  update(time) { this.env.bar.setGlow(0.5 + 0.2 * Math.sin(time * 5) + this.heat * 0.6); }
  dispose() { this.env.bar.setGlow(0); }
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
  update() { const q = this.body.quaternion; this.mesh.quaternion.set(q.x, q.y, q.z, q.w); }
  dispose() { this.env.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.env.world.removeBody(this.body); }
}

const TYPES = { plate: PlateTrap, lasers: LaserTrap, hot: HotTrap, spinner: SpinnerTrap };

export function createTraps(level, env) {
  return (level.traps || []).map((def) => new TYPES[def.type](def, env));
}
