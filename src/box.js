// Стеклянная коробка: видимые стенки, отверстия, коллайдеры, трещины и осколки.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { GLASS, WORLD } from './config.js';

export const WALLS = ['top', 'front', 'back', 'left', 'right'];
export const GROUP = { STATIC: 1, BAR: 2, HAND: 4 };

/** Система координат стенки в локальных координатах коробки (начало — центр дна). */
export function wallFrame(wall, [w, h, d]) {
  switch (wall) {
    case 'top': return { o: [0, h, 0], u: [1, 0, 0], v: [0, 0, 1], U: w, V: d };
    case 'front': return { o: [0, h / 2, d / 2], u: [1, 0, 0], v: [0, 1, 0], U: w, V: h };
    case 'back': return { o: [0, h / 2, -d / 2], u: [1, 0, 0], v: [0, 1, 0], U: w, V: h };
    case 'right': return { o: [w / 2, h / 2, 0], u: [0, 0, 1], v: [0, 1, 0], U: d, V: h };
    case 'left': return { o: [-w / 2, h / 2, 0], u: [0, 0, 1], v: [0, 1, 0], U: d, V: h };
    default: throw new Error('unknown wall ' + wall);
  }
}

/**
 * Система координат внутренней перегородки. Перегородка — стеклянная панель от дна коробки:
 *   { axis: 'x' | 'z' — вдоль какой оси идёт, at — где стоит по другой оси, from, to — края вдоль axis,
 *     height — высота, hole — необязательное окно в том же формате, что отверстия стенок (offset от центра панели) }.
 * Все координаты — относительно центра дна коробки.
 */
export function innerFrame(p) {
  const mid = (p.from + p.to) / 2, U = p.to - p.from;
  return p.axis === 'x'
    ? { o: [mid, p.height / 2, p.at], u: [1, 0, 0], v: [0, 1, 0], U, V: p.height }
    : { o: [p.at, p.height / 2, mid], u: [0, 0, 1], v: [0, 1, 0], U, V: p.height };
}

/** Габариты отверстия в плоскости стенки: полуразмеры a (по u) и b (по v). */
export function holeExtents(hole) {
  return hole.shape === 'circle' ? [hole.radius, hole.radius] : [hole.size[0] / 2, hole.size[1] / 2];
}

/**
 * Разбивает стенку с отверстием на прямоугольные куски-коллайдеры в плоскости (u, v).
 * Круглое отверстие приближается восьмиугольником (рамка + 4 повёрнутых уголка).
 */
export function wallPieces(frame, hole) {
  const U2 = frame.U / 2, V2 = frame.V / 2;
  if (!hole) return [{ cu: 0, cv: 0, hu: U2, hv: V2, rot: 0 }];
  const [a, b] = holeExtents(hole), [ou, ov] = hole.offset;
  const pieces = [];
  const add = (u0, u1, v0, v1) => { if (u1 - u0 > 1e-4 && v1 - v0 > 1e-4) pieces.push({ cu: (u0 + u1) / 2, cv: (v0 + v1) / 2, hu: (u1 - u0) / 2, hv: (v1 - v0) / 2, rot: 0 }); };
  add(-U2, ou - a, -V2, V2);
  add(ou + a, U2, -V2, V2);
  add(ou - a, ou + a, -V2, ov - b);
  add(ou - a, ou + a, ov + b, V2);
  if (hole.shape === 'circle') {
    const r = hole.radius, k = 1.2071 * r * Math.SQRT1_2;
    for (const [sx, sy] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
      pieces.push({ cu: ou + sx * k, cv: ov + sy * k, hu: 0.2071 * r, hv: 0.55 * r, rot: Math.atan2(sy, sx) });
    }
  }
  return pieces;
}

const _u = new THREE.Vector3(), _v = new THREE.Vector3(), _n = new THREE.Vector3(), _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3();
const _m = new THREE.Matrix4();

function frameMatrix(frame) {
  _u.fromArray(frame.u); _v.fromArray(frame.v); _n.crossVectors(_u, _v);
  return new THREE.Matrix4().makeBasis(_u, _v, _n).setPosition(...frame.o);
}

/** Запасная геометрия стенки (если нет glass_box.glb): экструзия контура с отверстием и фаской. */
function fallbackWallGeometry(frame, hole) {
  const U2 = frame.U / 2, V2 = frame.V / 2, t = GLASS.thickness, bev = 0.0015;
  const s = new THREE.Shape();
  s.moveTo(-U2, -V2); s.lineTo(U2, -V2); s.lineTo(U2, V2); s.lineTo(-U2, V2); s.closePath();
  if (hole) {
    const p = new THREE.Path(), [ou, ov] = hole.offset;
    if (hole.shape === 'circle') p.absarc(ou, ov, hole.radius, 0, Math.PI * 2, true);
    else {
      const [a, b] = holeExtents(hole);
      p.moveTo(ou - a, ov - b); p.lineTo(ou - a, ov + b); p.lineTo(ou + a, ov + b); p.lineTo(ou + a, ov - b); p.closePath();
    }
    s.holes.push(p);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: t - 2 * bev, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelOffset: -bev, bevelSegments: 2, curveSegments: 40 });
  g.translate(0, 0, -(t - 2 * bev) / 2);
  const pos = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / frame.U + 0.5, pos.getY(i) / frame.V + 0.5);
  g.applyMatrix4(frameMatrix(frame));
  return g;
}

export class GlassBox {
  /**
   * @param level   описание уровня
   * @param glbRoot сцена glass_box.glb (или null → запасная геометрия)
   */
  constructor({ scene, world, level, M, glbRoot, staticMaterial }) {
    this.scene = scene; this.world = world; this.level = level; this.M = M;
    this.size = level.box.size;
    this.origin = new THREE.Vector3(level.box.pos[0], WORLD.tableY, level.box.pos[1]);
    this.maxHealth = level.glass?.health ?? GLASS.health;
    this.hitSpeed = level.glass?.hitSpeed ?? GLASS.hitSpeed;
    this.damage = 0;
    this.broken = false;
    this.group = new THREE.Group();
    this.group.position.copy(this.origin);
    scene.add(this.group);
    this.walls = {};       // name → { meshes[], crack: Mesh|null, hits }
    this.colliders = [];   // для решателя руки: OBB в мировых координатах
    this.bodies = [];
    this.shards = null;
    this.usedGlb = false;

    for (const wall of WALLS) {
      const frame = wallFrame(wall, this.size);
      const hole = level.box.holes.find((h) => h.wall === wall) || null;
      this._buildVisual(wall, frame, hole, glbRoot);
      this._buildColliders(wall, frame, hole, staticMaterial);
    }
    // внутренние перегородки: то же стекло, те же коллайдеры; имена — inner0, inner1, …
    (level.box.inner || []).forEach((p, i) => {
      const frame = innerFrame(p);
      this._buildVisual(`inner${i}`, frame, p.hole || null, glbRoot);
      this._buildColliders(`inner${i}`, frame, p.hole || null, staticMaterial);
    });
  }

  _buildVisual(wall, frame, hole, glbRoot) {
    const entry = { meshes: [], crack: null, hits: 0, capGeometry: null };
    const src = glbRoot?.getObjectByName(`L${this.level.glassId ?? this.level.id}_${wall}`);
    if (src) {
      this.usedGlb = true;
      const node = src.clone(true);
      node.traverse((o) => {
        if (!o.isMesh) return;
        const edge = /edge/i.test(o.material?.name || '');
        o.material = edge ? this.M.glassEdge : this.M.glass;
        o.renderOrder = edge ? 3 : 2;
        o.castShadow = false; o.receiveShadow = false;
        if (!edge) entry.capGeometry = o.geometry;
        entry.meshes.push(o);
      });
      this.group.add(node);
    } else {
      const g = fallbackWallGeometry(frame, hole);
      const mesh = new THREE.Mesh(g, [this.M.glass, this.M.glassEdge]);
      mesh.renderOrder = 2;
      entry.capGeometry = g; entry.fallback = true;
      entry.meshes.push(mesh);
      this.group.add(mesh);
    }
    if (entry.capGeometry) { // слой пыли/отпечатков
      entry.dust = new THREE.Mesh(entry.capGeometry, entry.fallback ? [this.M.glassDust, HIDDEN] : this.M.glassDust);
      entry.dust.renderOrder = 4;
      this.group.add(entry.dust);
    }
    this.walls[wall] = entry;
  }

  _buildColliders(wall, frame, hole, staticMaterial) {
    const body = new CANNON.Body({ type: CANNON.Body.STATIC, material: staticMaterial, collisionFilterGroup: GROUP.STATIC, collisionFilterMask: GROUP.BAR });
    body.position.set(this.origin.x, this.origin.y, this.origin.z);
    body.userData = { kind: 'glass', wall };
    const ht = GLASS.colliderThickness / 2;
    for (const p of wallPieces(frame, hole)) {
      _u.fromArray(frame.u); _v.fromArray(frame.v);
      const c = Math.cos(p.rot), s = Math.sin(p.rot);
      _e1.copy(_u).multiplyScalar(c).addScaledVector(_v, s);
      _e2.copy(_u).multiplyScalar(-s).addScaledVector(_v, c);
      _n.crossVectors(_e1, _e2);
      const q = new THREE.Quaternion().setFromRotationMatrix(_m.makeBasis(_e1, _e2, _n));
      const local = new THREE.Vector3(...frame.o).addScaledVector(_u, p.cu).addScaledVector(_v, p.cv);
      body.addShape(new CANNON.Box(new CANNON.Vec3(p.hu, p.hv, ht)), new CANNON.Vec3(local.x, local.y, local.z), new CANNON.Quaternion(q.x, q.y, q.z, q.w));
      this.colliders.push({
        type: 'box', kind: 'glass', wall, c: local.clone().add(this.origin), h: new THREE.Vector3(p.hu, p.hv, ht),
        q, qi: q.clone().invert(),
      });
    }
    this.world.addBody(body);
    this.bodies.push(body);
  }

  /** Точка (мир) внутри коробки? margin > 0 — с запасом наружу. */
  contains(p, margin = 0) {
    const [w, h, d] = this.size, o = this.origin;
    return Math.abs(p.x - o.x) < w / 2 + margin && Math.abs(p.z - o.z) < d / 2 + margin && p.y - o.y < h + margin;
  }

  /** Сильный удар по стенке. Возвращает true, если стекло разбилось. */
  hit(wall) {
    if (this.broken) return true;
    this.damage++;
    if (this.damage >= this.maxHealth) { this.shatter(); return true; }
    const stage = Math.min(3, Math.max(1, Math.round((this.damage / (this.maxHealth - 1)) * 2)));
    const entry = this.walls[wall] || this.walls.front;
    entry.hits++;
    if (!entry.crack && entry.capGeometry) {
      const mat = entry.fallback ? [this.M.cracks[0], HIDDEN] : this.M.cracks[0];
      entry.crack = new THREE.Mesh(entry.capGeometry, mat);
      entry.crack.renderOrder = 5;
      this.group.add(entry.crack);
    }
    // Все уже треснувшие стенки переходят на текущую стадию.
    for (const e of Object.values(this.walls)) {
      if (!e.crack) continue;
      const m = this.M.cracks[stage - 1];
      e.crack.material = e.fallback ? [m, HIDDEN] : m;
    }
    return false;
  }

  shatter() {
    this.broken = true;
    this.group.visible = false;
    for (const b of this.bodies) this.world.removeBody(b);
    this.bodies.length = 0;
    this.colliders.length = 0;
    const N = 260, [w, h, d] = this.size;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.3, 0, 0.5, -0.2, 0, 0.1, 0.6, 0]), 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshPhysicalMaterial({ color: 0xd8fff0, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.55, side: THREE.DoubleSide, envMapIntensity: 2 });
    const mesh = new THREE.InstancedMesh(geo, mat, N);
    mesh.frustumCulled = false;
    const parts = [];
    for (let i = 0; i < N; i++) {
      const wall = WALLS[i % 5], f = wallFrame(wall, this.size);
      const p = new THREE.Vector3(...f.o).addScaledVector(_u.fromArray(f.u), (Math.random() - 0.5) * f.U).addScaledVector(_v.fromArray(f.v), (Math.random() - 0.5) * f.V).add(this.origin);
      const out = new THREE.Vector3(p.x - this.origin.x, 0.25 * (p.y - this.origin.y - h / 2), p.z - this.origin.z).normalize();
      parts.push({
        p, v: out.multiplyScalar(0.3 + Math.random() * 1.4).add(new THREE.Vector3(0, Math.random() * 1.2, 0)),
        r: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6),
        w: new THREE.Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14),
        s: 0.012 + Math.random() * 0.04, rest: false,
      });
    }
    this.shards = { mesh, parts, t: 0 };
    this.scene.add(mesh);
    void w; void d;
  }

  update(dt) {
    if (!this.shards) return;
    const { mesh, parts } = this.shards, dummy = _dummy;
    this.shards.t += dt;
    for (let i = 0; i < parts.length; i++) {
      const s = parts[i];
      if (!s.rest) {
        s.v.y += -9.81 * dt; s.p.addScaledVector(s.v, dt);
        s.r.x += s.w.x * dt; s.r.y += s.w.y * dt; s.r.z += s.w.z * dt;
        const onTable = Math.abs(s.p.x) < WORLD.tableSize[0] / 2 && Math.abs(s.p.z) < WORLD.tableSize[2] / 2;
        const floor = onTable ? WORLD.tableY + 0.003 : 0.003;
        if (s.p.y < floor) {
          s.p.y = floor;
          if (Math.abs(s.v.y) < 0.6) { s.rest = true; s.r.x = Math.PI / 2; s.r.y = 0; } else { s.v.y *= -0.3; s.v.x *= 0.5; s.v.z *= 0.5; }
        }
      }
      dummy.position.copy(s.p); dummy.rotation.copy(s.r); dummy.scale.setScalar(s.s); dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.group);
    for (const b of this.bodies) this.world.removeBody(b);
    for (const e of Object.values(this.walls)) if (e.fallback) e.capGeometry.dispose();
    if (this.shards) { this.scene.remove(this.shards.mesh); this.shards.mesh.geometry.dispose(); this.shards.mesh.material.dispose(); }
  }
}

const HIDDEN = new THREE.MeshBasicMaterial({ visible: false });
const _dummy = new THREE.Object3D();
