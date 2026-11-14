// Предмет добычи: динамическое тело cannon-es + меш. Тип предмета (форма, масса, модель) — в loot-types.js.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { PHYS, WORLD } from './config.js';
import { GROUP } from './box.js';
import { LOOT } from './loot-types.js';

const rad = THREE.MathUtils.degToRad;
const _a = new THREE.Vector3(), _e = new THREE.Euler();

// Контактные материалы «предмет — статика» по значению трения. cannon-es не умеет удалять
// контактные материалы, поэтому на каждое значение трения заводится один и переиспользуется.
const contactCache = new Map();
function materialFor(world, staticMaterial, friction) {
  if (!contactCache.has(friction)) {
    const m = new CANNON.Material('loot');
    world.addContactMaterial(new CANNON.ContactMaterial(m, staticMaterial, { friction, restitution: PHYS.restitution }));
    contactCache.set(friction, m);
  }
  return contactCache.get(friction);
}

function shapeQuat(shape) {
  const q = new THREE.Quaternion();
  if (shape.rot) q.setFromEuler(_e.set(rad(shape.rot[0]), rad(shape.rot[1]), rad(shape.rot[2])));
  return q;
}

/** Расстояние от точки до примитива-коллайдера (0, если точка внутри). */
export function pointPrimDistance(p, col) {
  if (col.type === 'sphere') return Math.max(0, _a.copy(p).sub(col.c).length() - col.r);
  _a.copy(p).sub(col.c);
  if (col.qi) _a.applyQuaternion(col.qi);
  if (col.type === 'cyl') {
    const dr = Math.max(0, Math.hypot(_a.x, _a.z) - col.r), dy = Math.max(0, Math.abs(_a.y) - col.hh);
    return Math.hypot(dr, dy);
  }
  const h = col.h;
  const dx = Math.max(0, Math.abs(_a.x) - h.x), dy = Math.max(0, Math.abs(_a.y) - h.y), dz = Math.max(0, Math.abs(_a.z) - h.z);
  return Math.hypot(dx, dy, dz);
}

/** Запасная геометрия слитка: коробка с суженным верхом. */
function barFallbackGeometry(type) {
  const [l, h, w] = type.bounds, g = new THREE.BoxGeometry(l, h, w, 1, 1, 1), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) { p.setX(i, p.getX(i) * (type.topScale + 0.1)); p.setZ(i, p.getZ(i) * type.topScale); }
  g.computeVertexNormals();
  return g;
}

/** Запасная модель из тех же примитивов, что и физическая форма. */
function fallbackMesh(type, material) {
  if (type.topScale) return new THREE.Mesh(barFallbackGeometry(type), material);
  const group = new THREE.Group();
  for (const s of type.shapes) {
    const geo = s.type === 'box' ? new THREE.BoxGeometry(s.half[0] * 2, s.half[1] * 2, s.half[2] * 2)
      : s.type === 'cylinder' ? new THREE.CylinderGeometry(s.radius, s.radius, s.height, 24)
        : new THREE.SphereGeometry(s.radius, 20, 14);
    const m = new THREE.Mesh(geo, material);
    if (s.pos) m.position.fromArray(s.pos);
    m.quaternion.copy(shapeQuat(s));
    group.add(m);
  }
  return group;
}

export class Loot {
  /**
   * @param def    элемент из levelLoot(level): { type, pos, yaw, mass, friction, role }
   * @param metal  выбранный игроком металл слитка (запись из src/metals.js) или null
   * @param models загруженные GLB (имя → сцена или null)
   */
  constructor({ scene, world, M, models, level, def, index, staticMaterial, metal = null }) {
    this.scene = scene; this.world = world; this.def = def; this.index = index;
    this.typeName = def.type;
    const type = this.type = LOOT[def.type];
    this.role = def.role;
    // Металл слитка (запись из src/metals.js) — только у типов с пометкой metal. У золота density и slip равны 1,
    // поэтому с ним масса и хват в точности те же, что и без металлов.
    this.metal = type.metal ? metal : null;
    this.mass = def.mass * (this.metal?.density ?? 1);
    this.slipScale = this.metal?.slip ?? 1;
    this.maxSpeed = type.maxSpeed ?? PHYS.barMaxSpeed;
    this.held = false; this.banked = false; this.glowOwner = null; this.zoneTime = 0;
    this.cracks = 0; this.broken = false; this.impact = 0; this._pv = new CANNON.Vec3(); this._hitTime = -9;

    // --- физическое тело
    const halfY = type.bounds[1] / 2;
    this.body = new CANNON.Body({
      mass: this.mass, material: materialFor(world, staticMaterial, def.friction ?? PHYS.staticFriction), linearDamping: 0.03, angularDamping: 0.25,
      collisionFilterGroup: GROUP.BAR, collisionFilterMask: GROUP.STATIC | GROUP.HAND | GROUP.BAR,
    });
    // --- примитивы: форма для cannon-es и коллайдеры для решателя руки (мировые c, q обновляет colliders())
    this.prims = [];
    for (const s of type.shapes) {
      const lp = new THREE.Vector3(...(s.pos || [0, 0, 0])), lq = shapeQuat(s);
      let shape, prim;
      if (s.type === 'box') {
        shape = new CANNON.Box(new CANNON.Vec3(...s.half));
        prim = { type: 'box', h: new THREE.Vector3(...s.half) };
      } else if (s.type === 'cylinder') {
        shape = new CANNON.Cylinder(s.radius, s.radius, s.height, 16);
        prim = { type: 'cyl', r: s.radius, hh: s.height / 2 };
      } else if (s.type === 'sphere') {
        shape = new CANNON.Sphere(s.radius);
        prim = { type: 'sphere', r: s.radius };
      } else throw new Error('Unknown primitive ' + s.type);
      this.body.addShape(shape, new CANNON.Vec3(lp.x, lp.y, lp.z), new CANNON.Quaternion(lq.x, lq.y, lq.z, lq.w));
      Object.assign(prim, { kind: 'bar', lp, lq, c: new THREE.Vector3(), q: new THREE.Quaternion(), qi: new THREE.Quaternion() });
      this.prims.push(prim);
    }
    const [bx, by, bz] = def.pos;
    this.body.position.set(level.box.pos[0] + bx, WORLD.tableY + by + halfY + 0.001, level.box.pos[1] + bz);
    this.body.quaternion.setFromEuler(0, rad(def.yaw || 0), 0);
    this.body.userData = { kind: 'loot', loot: this };
    world.addBody(this.body);

    // --- сферы предмета в руке
    this.heldSpheres = type.held.map(([x, y, z, r]) => ({ p: new THREE.Vector3(x, y, z), r }));

    // --- модель (у каждого предмета своя копия материала: подсветка не должна зажигать соседей)
    this.material = (M[this.metal?.material] || M[type.material] || M.gold).clone();
    const glb = models?.[type.model];
    this.usedGlb = !!glb;
    this.mesh = glb ? glb.clone(true) : fallbackMesh(type, this.material);
    this.mesh.traverse((o) => { if (o.isMesh) { o.material = this.material; o.castShadow = true; o.receiveShadow = true; } });
    if (glb && type.modelScale) this.mesh.scale.fromArray(type.modelScale);
    scene.add(this.mesh);

    this._pos = new THREE.Vector3(); this._quat = new THREE.Quaternion();
    this.sync();
  }

  position() { const p = this.body.position; return this._pos.set(p.x, p.y, p.z); }
  quaternion() { const q = this.body.quaternion; return this._quat.set(q.x, q.y, q.z, q.w); }
  speed() { return this.body.velocity.length(); }

  /** Примитивы-коллайдеры в мировых координатах (для решателя руки). */
  colliders() {
    const p = this.position(), q = this.quaternion();
    for (const c of this.prims) {
      c.c.copy(c.lp).applyQuaternion(q).add(p);
      c.q.copy(q).multiply(c.lq);
      c.qi.copy(c.q).invert();
    }
    return this.prims;
  }

  /** Те же примитивы, но в системе координат, заданной позой предмета (pos, quat) — например, относительно кисти. */
  collidersAt(pos, quat) {
    return this.prims.map((c) => {
      const q = quat.clone().multiply(c.lq);
      return { ...c, c: c.lp.clone().applyQuaternion(quat).add(pos), q, qi: q.clone().invert() };
    });
  }

  /** Расстояние от точки до поверхности предмета. Перед серией вызовов обновить colliders(). */
  distanceTo(point) {
    let best = Infinity;
    for (const c of this.prims) best = Math.min(best, pointPrimDistance(point, c));
    return best;
  }

  setHeld(on) {
    this.held = on;
    // В руке предмет не сталкивается со статикой сам: за него это делает «сферный» решатель руки.
    this.body.collisionFilterMask = on ? 0 : (GROUP.STATIC | GROUP.HAND | GROUP.BAR);
    this.body.wakeUp();
  }

  /** Вызывать после каждого шага физики: ограничение скорости и, для хрупких, замер удара. */
  postStep() {
    const v = this.body.velocity, s = v.length();
    if (this.type.fragile) {
      // удар = скачок скорости за один шаг (минус то, что добавила сила тяжести); в руке удары считает решатель руки
      this.impact = this.held ? 0 : Math.max(0, Math.hypot(v.x - this._pv.x, v.y - this._pv.y, v.z - this._pv.z) - Math.abs(PHYS.gravity) * PHYS.step * 1.5);
      this._pv.copy(v);
    }
    if (s > this.maxSpeed) v.scale(this.maxSpeed / s, v);
    const w = this.body.angularVelocity, ws = w.length();
    if (ws > 25) w.scale(25 / ws, w);
  }

  sync() {
    this.mesh.position.copy(this.position());
    this.mesh.quaternion.copy(this.quaternion());
  }

  /** k: 0..1 — насколько предмет раскалён / подсвечен. */
  setGlow(k, color = 0xff5a10) {
    this.material.emissive.set(color);
    this.material.emissiveIntensity = k;
  }

  /**
   * Удар по хрупкому предмету со скоростью speed (м/с) в момент time. Возвращает 'crack', 'break' или null.
   * crackMaterial — материал трещин (рисуется вторым слоем поверх модели).
   */
  hit(speed, time, crackMaterial) {
    const f = this.type.fragile;
    if (!f || this.broken || speed < f.crackSpeed || time - this._hitTime < 0.3) return null;
    this._hitTime = time;
    this.cracks++;
    if (speed >= f.breakSpeed || this.cracks >= f.cracks) { this.broken = true; this.banked = true; this._remove(); return 'break'; }
    if (!this.crackLayer && crackMaterial) {
      this.crackLayer = [];
      this.mesh.traverse((o) => { if (o.isMesh) this.crackLayer.push(o); });
      for (const o of this.crackLayer) { const m = new THREE.Mesh(o.geometry, crackMaterial); m.renderOrder = 5; o.add(m); }
    }
    return 'crack';
  }

  /** Предмет донесён в сейф: убрать из мира (счётчик ведёт игра). */
  bank() {
    this.banked = true;
    this._remove();
  }

  _remove() {
    if (this._removed) return;
    this._removed = true;
    this.world.removeBody(this.body);
    this.scene.remove(this.mesh);
  }

  dispose() {
    this._remove();
    this.material.dispose();
    if (!this.usedGlb) this.mesh.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
  }
}
