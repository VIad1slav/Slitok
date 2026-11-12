// Рука: модель (hand.glb или примитивы), пружинное управление, коллизии со стеклом, захват слитка.
//
// Как это устроено:
//  * Кисть — кинематическое тело. Его позицию мы считаем сами: пружина-демпфер тянет кисть к целевой
//    точке, после чего набор сфер (ладонь, пальцы, предплечье, плечо, удерживаемый слиток) выталкивается
//    из стекла/стола. Поэтому рука физически не может пройти сквозь стенку.
//  * Свободный слиток — обычное динамическое тело cannon-es; рука толкает его кинематическими сферами.
//  * Захват — LockConstraint между кистью и слитком. Пока слиток в руке, он участвует в «сферной»
//    проверке вместе с кистью: кулак со слитком должен целиком пролезть в отверстие.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { HAND, HAND_GEOM as G, WORLD } from './config.js';
import { GROUP } from './box.js';
import { pointPrimDistance } from './loot.js';

const V = () => new THREE.Vector3();
const _a = V(), _b = V(), _c = V(), _n = V(), _best = V();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const PIVOT = new THREE.Vector3(...G.pivot);

// ---------------------------------------------------------------------------
// Коллизии «сфера против статического коллайдера»
// ---------------------------------------------------------------------------
/** Глубина проникновения сферы (центр s, радиус r) в коллайдер; нормаль пишется в out. 0 — нет контакта. */
export function sphereVsCollider(sx, sy, sz, r, col, out) {
  if (col.type === 'sphere') {
    const dx = sx - col.c.x, dy = sy - col.c.y, dz = sz - col.c.z, dist = Math.hypot(dx, dy, dz);
    if (dist >= r + col.r) return 0;
    if (dist > 1e-9) out.set(dx / dist, dy / dist, dz / dist); else out.set(0, 1, 0);
    return r + col.r - dist;
  }
  if (col.type === 'cyl') { // цилиндр вдоль своей оси Y (у статики — вертикальный, у добычи может быть повёрнут)
    _a.set(sx - col.c.x, sy - col.c.y, sz - col.c.z);
    if (col.qi) _a.applyQuaternion(col.qi);
    const dx = _a.x, dy = _a.y, dz = _a.z;
    const rad = Math.hypot(dx, dz), cy = clamp(dy, -col.hh, col.hh);
    let depth;
    if (rad <= col.r && Math.abs(dy) <= col.hh) { // центр внутри
      const pr = col.r - rad, py = col.hh - Math.abs(dy);
      if (py < pr) { out.set(0, Math.sign(dy) || 1, 0); depth = r + py; }
      else { out.set(dx / (rad || 1), 0, dz / (rad || 1)); depth = r + pr; }
    } else {
      const k = rad > col.r ? col.r / rad : 1;
      const ex = dx - dx * k, ey = dy - cy, ez = dz - dz * k, dist = Math.hypot(ex, ey, ez);
      if (dist >= r) return 0;
      out.set(ex / dist, ey / dist, ez / dist); depth = r - dist;
    }
    if (col.q) out.applyQuaternion(col.q);
    return depth;
  }
  _a.set(sx - col.c.x, sy - col.c.y, sz - col.c.z);
  if (col.qi) _a.applyQuaternion(col.qi);
  const h = col.h;
  const cx = clamp(_a.x, -h.x, h.x), cy = clamp(_a.y, -h.y, h.y), cz = clamp(_a.z, -h.z, h.z);
  const dx = _a.x - cx, dy = _a.y - cy, dz = _a.z - cz, d2 = dx * dx + dy * dy + dz * dz;
  if (d2 >= r * r) return 0;
  let depth;
  if (d2 > 1e-12) {
    const d = Math.sqrt(d2); out.set(dx / d, dy / d, dz / d); depth = r - d;
  } else { // центр сферы внутри бокса — выходим по кратчайшей оси
    const px = h.x - Math.abs(_a.x), py = h.y - Math.abs(_a.y), pz = h.z - Math.abs(_a.z);
    if (px <= py && px <= pz) { out.set(Math.sign(_a.x) || 1, 0, 0); depth = r + px; }
    else if (py <= pz) { out.set(0, Math.sign(_a.y) || 1, 0); depth = r + py; }
    else { out.set(0, 0, Math.sign(_a.z) || 1); depth = r + pz; }
  }
  if (col.q) out.applyQuaternion(col.q);
  return depth;
}

// ---------------------------------------------------------------------------
// Модель руки
// ---------------------------------------------------------------------------
const FINGERS = ['index', 'middle', 'ring', 'pinky'];
const CURL = { finger: [1.2, 1.5, 1.0], thumb: [0.4, 0.55, 0.7] }; // радианы на фалангу при полном сжатии

/** Запасная рука из примитивов (если hand.glb не загрузился). Иерархия «костей» та же, что в GLB. */
function buildPrimitiveHand(material) {
  const root = new THREE.Group(), bones = {};
  const cap = (r, len) => { const g = new THREE.CapsuleGeometry(r, Math.max(0.001, len - r * 0.6), 6, 12); g.rotateX(-Math.PI / 2); g.translate(0, 0, -len / 2); return g; };
  const add = (geo, parent) => { const m = new THREE.Mesh(geo, material); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; };

  const fore = new THREE.CylinderGeometry(0.03, 0.043, 0.3, 20); fore.rotateX(Math.PI / 2); fore.scale(1, 0.82, 1); fore.translate(0, 0, 0.16);
  add(fore, root);
  const palm = new THREE.SphereGeometry(0.5, 24, 16); palm.scale(0.088, 0.034, 0.11); palm.translate(0.002, -0.002, -0.052);
  add(palm, root);

  const spec = {
    index: { at: [-0.03, 0, -0.095], yaw: 0.08, len: [0.04, 0.024, 0.021], r: 0.0088 },
    middle: { at: [-0.009, 0, -0.1], yaw: 0.02, len: [0.045, 0.027, 0.022], r: 0.009 },
    ring: { at: [0.012, 0, -0.096], yaw: -0.05, len: [0.041, 0.025, 0.022], r: 0.0085 },
    pinky: { at: [0.032, 0, -0.086], yaw: -0.14, len: [0.032, 0.018, 0.019], r: 0.0075 },
  };
  for (const name of FINGERS) {
    const s = spec[name]; let parent = root;
    s.len.forEach((len, i) => {
      const b = new THREE.Group(); b.name = `${name}_0${i + 1}`;
      if (i === 0) { b.position.fromArray(s.at); b.rotation.y = s.yaw; } else b.position.set(0, 0, -s.len[i - 1]);
      parent.add(b); add(cap(s.r * (1 - i * 0.08), len), b); bones[b.name] = b; parent = b;
    });
  }
  const tLen = [0.042, 0.032, 0.026]; let parent = root;
  tLen.forEach((len, i) => {
    const b = new THREE.Group(); b.name = `thumb_0${i + 1}`;
    if (i === 0) { b.position.set(-0.03, -0.008, -0.026); b.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), new THREE.Vector3(-0.62, -0.12, -0.78).normalize()); }
    else b.position.set(0, 0, -tLen[i - 1]);
    parent.add(b); add(cap(0.0115 - i * 0.001, len), b); bones[b.name] = b; parent = b;
  });
  return { root, bones, skinned: [] };
}

function rigFromGlb(gltfScene, material) {
  const root = gltfScene, bones = {}, skinned = [];
  root.traverse((o) => {
    if (o.isBone) bones[o.name] = o;
    if (o.isMesh) { o.material = material; o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; skinned.push(o); }
  });
  return { root, bones, skinned };
}

// ---------------------------------------------------------------------------
export class Hand {
  constructor({ scene, world, M, glbScene }) {
    this.scene = scene; this.world = world; this.M = M;
    this.pos = V(); this.vel = V(); this.target = V();
    this.wrist = V(); this.prevWrist = V();
    this.quat = new THREE.Quaternion(); this.prevQuat = new THREE.Quaternion();
    this.ang = { yaw: 0, pitch: 0, roll: 0 }; this.angT = { yaw: 0, pitch: 0, roll: 0 };
    this.curl = 0; this.gripInput = false; this.gripLock = 0; this.gripPressTime = 99;
    this.holding = false; this.item = null; this.constraint = null;   // item — предмет в руке
    this.barRelPos = V(); this.barRelQuat = new THREE.Quaternion(); this.heldLocal = []; this.heldR = [];
    this.slipTimer = 0; this.regrab = 0; this.ghost = 0; this.grabReady = false;
    this.grabItem = null;   // предмет, который сейчас можно схватить (ближайший к линии хвата)
    this.lastItem = null;   // последний отпущенный предмет (рука ненадолго «прозрачна» для него)
    this.slipSpeed = HAND.slipSpeed;
    this.statics = [];
    this.events = [];
    this.contacts = [];
    this._rest = [];
    this.shoulder = new THREE.Vector3(...WORLD.shoulder);
    this.skin = 'skin';

    // --- сферы-коллайдеры в локальных координатах кисти
    this.local = [];
    for (const s of G.palm) this.local.push({ group: 'palm', p: new THREE.Vector3(...s.p), r: s.r });
    for (const s of G.fingers) this.local.push({ group: 'finger', p: new THREE.Vector3(...s.open), open: new THREE.Vector3(...s.open), closed: new THREE.Vector3(...s.closed), r: s.r });
    { const s = G.thumb; this.local.push({ group: 'finger', p: new THREE.Vector3(...s.open), open: new THREE.Vector3(...s.open), closed: new THREE.Vector3(...s.closed), r: s.r }); }
    for (let i = 0; i < G.forearm.count; i++) {
      const t = i / (G.forearm.count - 1);
      this.local.push({ group: 'forearm', p: new THREE.Vector3(0, 0, G.forearm.from + i * G.forearm.step), r: G.forearm.r0 + (G.forearm.r1 - G.forearm.r0) * t });
    }
    const maxSpheres = this.local.length + G.upperArm.count + HAND.maxHeldSpheres;
    this.off = new Float32Array(maxSpheres * 4); // смещение сферы от this.pos + радиус
    this.offGroup = new Uint8Array(maxSpheres);  // 0 кисть/рука, 1 слиток в руке
    this.count = 0;

    // --- кинематические тела для толкания слитка
    const mk = () => { const b = new CANNON.Body({ type: CANNON.Body.KINEMATIC, collisionFilterGroup: GROUP.HAND, collisionFilterMask: GROUP.BAR }); b.userData = { kind: 'hand' }; world.addBody(b); return b; };
    this.handBody = mk(); this.fingerBody = mk();
    for (const s of this.local) {
      const body = s.group === 'finger' ? this.fingerBody : this.handBody;
      body.addShape(new CANNON.Sphere(s.r), new CANNON.Vec3(s.p.x, s.p.y, s.p.z));
    }

    // --- визуальная часть
    this.group = new THREE.Group();
    scene.add(this.group);
    this.rig = glbScene ? rigFromGlb(glbScene, M.skin) : buildPrimitiveHand(M.skin);
    this.usedGlb = !!glbScene;
    this.group.add(this.rig.root);
    this._setupRig();
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.047, 0.052, 0.13, 20), M.sleeve);
    cuff.geometry.rotateX(Math.PI / 2); cuff.geometry.scale(1, 0.86, 1); cuff.position.set(0, 0, 0.27); cuff.castShadow = true;
    this.group.add(cuff);
    const upGeo = new THREE.CylinderGeometry(0.04, 0.05, 1, 16, 1, true); upGeo.translate(0, 0.5, 0);
    // Плечо рисуем коротким и растворяющимся в темноте: целиком оно загораживало бы обзор у самой камеры.
    const fc = document.createElement('canvas'); fc.width = 4; fc.height = 64;
    const fg = fc.getContext('2d'), grad = fg.createLinearGradient(0, 64, 0, 0);
    grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.3, '#ffffff'); grad.addColorStop(1, '#000000');
    fg.fillStyle = grad; fg.fillRect(0, 0, 4, 64);
    const upMat = M.sleeve.clone(); upMat.alphaMap = new THREE.CanvasTexture(fc); upMat.transparent = true;
    this.upper = new THREE.Mesh(upGeo, upMat); this.upper.renderOrder = 8;
    this.elbowBall = new THREE.Mesh(new THREE.SphereGeometry(0.054, 16, 12), M.sleeve); this.elbowBall.castShadow = true;
    scene.add(this.upper, this.elbowBall);
  }

  /** Запоминаем позу покоя костей и ось сгиба каждой фаланги (в локальных координатах кости). */
  _setupRig() {
    this.group.position.set(0, 0, 0); this.group.quaternion.identity();
    this.group.updateMatrixWorld(true);
    const B = this.rig.bones;
    this.joints = [];
    const setup = (names, toward, angles, phase) => {
      const b1 = B[names[0]], b2 = B[names[1]];
      if (!b1 || !b2) return;
      const d = b2.getWorldPosition(V()).sub(b1.getWorldPosition(V())).normalize();
      const axis = d.clone().cross(toward).normalize(); // вращение вокруг этой оси ведёт палец в сторону toward
      names.forEach((n, i) => {
        const bone = B[n]; if (!bone) return;
        const wq = bone.getWorldQuaternion(new THREE.Quaternion());
        this.joints.push({ bone, rest: bone.quaternion.clone(), axis: axis.clone().applyQuaternion(wq.invert()), angle: angles[i], phase });
      });
    };
    FINGERS.forEach((f, i) => setup([1, 2, 3].map((k) => `${f}_0${k}`), new THREE.Vector3(0, -1, 0), CURL.finger, i * 0.06));
    setup(['thumb_01', 'thumb_02', 'thumb_03'], new THREE.Vector3(0.75, -0.6, 0.2).normalize(), CURL.thumb, 0);
  }

  /** @param cosmetic запись из src/cosmetics.js вида 'hand': { id, material, tint? } */
  setSkin(cosmetic) {
    this.skin = cosmetic.id;
    let mat = this.M[cosmetic.material] || this.M.skin;
    if (cosmetic.tint != null) {             // подкрашенный вариант — своя копия материала, текстуры общие
      this._tinted ??= {};
      mat = this._tinted[cosmetic.id] ??= Object.assign(mat.clone(), { name: cosmetic.id });
      mat.color.set(cosmetic.tint);
    }
    this.rig.root.traverse((o) => { if (o.isMesh && !this._isAccessory(o)) o.material = mat; });
  }

  _isAccessory(o) { for (let p = o; p; p = p.parent) if (p === this.accessory) return true; return false; }

  /** Надеть украшение (запись вида 'accessory' из src/cosmetics.js) или снять (null). models — загруженные GLB. */
  setAccessory(cosmetic, models) {
    if (this.accessory) { this.accessory.parent?.remove(this.accessory); this.accessory = null; }
    if (!cosmetic) return;
    const M = this.M, src = models?.[cosmetic.model];
    let mesh;
    if (src) {
      mesh = src.clone(true);
      mesh.traverse((o) => { if (o.isMesh) { const n = (o.material?.name || '').toLowerCase(); o.material = n.includes('glow') ? M.lampGlow : n.includes('steel') ? M.steel : n.includes('metal') ? M.metal : M.brass; o.castShadow = true; } });
    } else {
      const f = cosmetic.fallback, rad = THREE.MathUtils.degToRad;
      mesh = new THREE.Mesh(new THREE.TorusGeometry(f.radius, f.tube, 10, 28), M[f.material] || M.brass);
      mesh.position.fromArray(f.pos); mesh.rotation.set(rad(f.rot[0]), rad(f.rot[1]), rad(f.rot[2])); mesh.scale.fromArray(f.scale);
    }
    // модель задана в координатах кисти в позе покоя: ставим пальцы в покой, кладём модель в кисть и «перевешиваем» на кость
    for (const j of this.joints) j.bone.quaternion.copy(j.rest);
    this.group.add(mesh); this.group.updateMatrixWorld(true);
    (this.rig.bones[cosmetic.bone] || this.rig.root).attach(mesh);
    this.accessory = mesh;
  }

  reset(level) {
    this._detach();
    this.pos.fromArray(level.hand.pos); this.target.copy(this.pos); this.vel.set(0, 0, 0);
    const rad = THREE.MathUtils.degToRad;
    this.ang.yaw = this.angT.yaw = rad(level.hand.yaw || 0);
    this.ang.pitch = this.angT.pitch = rad(level.hand.pitch || 0);
    this.ang.roll = this.angT.roll = rad(level.hand.roll || 0);
    this._quatFromAngles(this.quat);
    this.curl = 0; this.gripInput = false; this.gripLock = 0; this.regrab = 0; this.ghost = 0; this.slipTimer = 0;
    this.levelSlipSpeed = this.slipSpeed = level.grip?.slipSpeed ?? HAND.slipSpeed;
    this.grabItem = this.lastItem = null; this.grabReady = false;
    this._updateWrist();
    this.prevWrist.copy(this.wrist); this.prevQuat.copy(this.quat);
    this.events.length = 0;
    this.updateVisual(0);
  }

  // --- ввод -----------------------------------------------------------------
  moveTarget(dx, dy, dz) {
    const t = this.target, a = WORLD.reachMin, b = WORLD.reachMax;
    t.x = clamp(t.x + dx, a[0], b[0]); t.y = clamp(t.y + dy, a[1], b[1]); t.z = clamp(t.z + dz, a[2], b[2]);
  }
  rotate(dPitch, dRoll, dYaw = 0) {
    this.angT.pitch = clamp(this.angT.pitch + dPitch, ...HAND.pitchLimits);
    this.angT.roll = clamp(this.angT.roll + dRoll, ...HAND.rollLimits);
    this.angT.yaw = clamp(this.angT.yaw + dYaw, ...HAND.yawLimits);
  }
  setGrip(on) {
    if (on && !this.gripInput) this.gripPressTime = 0;
    this.gripInput = on;
  }

  // --- геометрия --------------------------------------------------------------
  _quatFromAngles(out) { return out.setFromEuler(_euler.set(this.ang.pitch, this.ang.yaw, this.ang.roll, 'YXZ')); }
  _updateWrist() { this.wrist.copy(PIVOT).negate().applyQuaternion(this.quat).add(this.pos); }

  /** Пересчитать смещения всех сфер относительно pos для ориентации quat. */
  _build(pos, quat) {
    const off = this.off; let n = 0;
    for (const s of this.local) {
      _a.copy(s.p).sub(PIVOT).applyQuaternion(quat);
      off[n * 4] = _a.x; off[n * 4 + 1] = _a.y; off[n * 4 + 2] = _a.z; off[n * 4 + 3] = s.r; this.offGroup[n] = 0; n++;
    }
    // плечо: от локтя к «плечу» игрока
    _b.set(0, 0, G.forearmLength).sub(PIVOT).applyQuaternion(quat);       // локоть относительно pos
    _c.copy(this.shoulder).sub(pos).sub(_b);
    const len = _c.length(); _c.multiplyScalar(1 / (len || 1));
    for (let i = 0; i < G.upperArm.count; i++) {
      const d = Math.min(len, G.upperArm.step * (i + 1));
      off[n * 4] = _b.x + _c.x * d; off[n * 4 + 1] = _b.y + _c.y * d; off[n * 4 + 2] = _b.z + _c.z * d; off[n * 4 + 3] = G.upperArm.r; this.offGroup[n] = 0; n++;
    }
    if (this.holding) {
      for (let k = 0; k < this.heldLocal.length; k++) {
        _a.copy(this.heldLocal[k]).sub(PIVOT).applyQuaternion(quat);
        off[n * 4] = _a.x; off[n * 4 + 1] = _a.y; off[n * 4 + 2] = _a.z; off[n * 4 + 3] = this.heldR[k]; this.offGroup[n] = 1; n++;
      }
    }
    this.count = n;
  }

  /** Вытолкнуть набор сфер из статических коллайдеров сдвигом pos. Возвращает остаточное проникновение. */
  _resolve(pos, items) {
    const off = this.off, n = this.count, statics = this.statics;
    this.contacts.length = 0;
    let residual = 0;
    // лежащие предметы держат ладонь сверху (чтобы рука не вдавливала их в подставку)
    const rest = this._rest; rest.length = 0;
    if (!this.holding) for (const it of items) if (!it.banked && it.speed() < 0.35) for (const c of it.colliders()) rest.push(c);
    for (let it = 0; it < HAND.collisionIterations; it++) {
      let deepest = 0, hit = null, hitGroup = 0;
      for (let i = 0; i < n; i++) {
        const sx = pos.x + off[i * 4], sy = pos.y + off[i * 4 + 1], sz = pos.z + off[i * 4 + 2], r = off[i * 4 + 3];
        for (let k = 0; k < statics.length; k++) {
          const d = sphereVsCollider(sx, sy, sz, r, statics[k], _n);
          if (d > deepest) { deepest = d; _best.copy(_n); hit = statics[k]; hitGroup = this.offGroup[i]; _c.set(sx, sy, sz).addScaledVector(_n, -r); }
        }
        if (rest.length && i < this.local.length && this.local[i].group !== 'forearm') {
          for (let k = 0; k < rest.length; k++) {
            const d = sphereVsCollider(sx, sy, sz, r, rest[k], _n);
            if (d > deepest && _n.y > 0.55) { deepest = d; _best.copy(_n); hit = rest[k]; hitGroup = 0; _c.set(sx, sy, sz); }
          }
        }
      }
      residual = deepest;
      if (deepest < 1e-4 || !hit) break;
      pos.addScaledVector(_best, deepest);
      this.contacts.push({ col: hit, n: _best.clone(), point: _c.clone(), byBar: hitGroup === 1 });
    }
    return residual;
  }

  // --- шаг симуляции ------------------------------------------------------------
  /** @param items предметы добычи уровня (Loot[]) */
  step(dt, items) {
    // тела cannon ставим точно в текущую позу (после world.step они могли чуть уплыть)
    this._syncBodies(this.wrist, this.quat);
    this._gripLogic(dt, items);

    this.prevWrist.copy(this.wrist); this.prevQuat.copy(this.quat);

    // 1) цель не убегает далеко от упёршейся кисти
    _a.copy(this.target).sub(this.pos);
    const far = _a.length();
    if (far > HAND.leash) this.target.copy(this.pos).addScaledVector(_a, HAND.leash / far);

    // 2) пружина-демпфер
    _a.copy(this.target).sub(this.pos).multiplyScalar(HAND.stiffness).addScaledVector(this.vel, -HAND.damping);
    this.vel.addScaledVector(_a, dt);
    const sp = this.vel.length();
    if (sp > HAND.maxSpeed) this.vel.multiplyScalar(HAND.maxSpeed / sp);
    const newPos = _newPos.copy(this.pos).addScaledVector(this.vel, dt);

    // 3) вращение запястья
    const prevAng = { ...this.ang };
    const follow = 1 - Math.exp(-HAND.rotFollow * dt), maxD = HAND.rotMaxRate * dt;
    let rotated = false;
    for (const k of ['yaw', 'pitch', 'roll']) {
      const d = clamp((this.angT[k] - this.ang[k]) * follow, -maxD, maxD);
      if (Math.abs(d) > 1e-6) { this.ang[k] += d; rotated = true; }
    }
    this._quatFromAngles(this.quat);

    // 4) коллизии
    this._build(newPos, this.quat);
    let residual = this._resolve(newPos, items);
    if (residual > 0.003 && rotated) { // поворот упёрся в стекло — отменяем его
      Object.assign(this.ang, prevAng); Object.assign(this.angT, prevAng);
      this.quat.copy(this.prevQuat);
      newPos.copy(this.pos).addScaledVector(this.vel, dt);
      this._build(newPos, this.quat);
      residual = this._resolve(newPos, items);
    }

    // 5) реакция скорости и события касаний
    for (const c of this.contacts) {
      const vn = this.vel.dot(c.n);
      if (vn < 0) {
        this.vel.addScaledVector(c.n, -vn);
        this.events.push({ type: 'contact', kind: c.col.kind, wall: c.col.wall, impact: -vn, point: c.point, byBar: c.byBar });
      } else {
        this.events.push({ type: 'contact', kind: c.col.kind, wall: c.col.wall, impact: 0, point: c.point, byBar: c.byBar });
      }
    }
    this.pos.copy(newPos);
    this._updateWrist();

    // 6) скорости кинематических тел: за world.step они приедут в новую позу
    this._setBodyVelocity(dt);

    // 7) проскальзывание
    if (this.holding) {
      this.slipTimer = this.vel.length() > this.slipSpeed ? this.slipTimer + dt : 0;
      _a.copy(this.barRelPos).applyQuaternion(this.prevQuat).add(this.prevWrist);
      const drift = _a.distanceTo(this.item.position());
      if (this.slipTimer > HAND.slipTime || drift > HAND.slipDrift) this.release('slip');
    }
  }

  _syncBodies(wrist, quat) {
    for (const b of [this.handBody, this.fingerBody]) {
      b.position.set(wrist.x, wrist.y, wrist.z); b.quaternion.set(quat.x, quat.y, quat.z, quat.w);
    }
  }

  _setBodyVelocity(dt) {
    _a.copy(this.wrist).sub(this.prevWrist).multiplyScalar(1 / dt);
    _q.copy(this.quat).multiply(_q2.copy(this.prevQuat).invert());
    if (_q.w < 0) { _q.x = -_q.x; _q.y = -_q.y; _q.z = -_q.z; _q.w = -_q.w; }
    const s = Math.hypot(_q.x, _q.y, _q.z), angle = 2 * Math.atan2(s, _q.w), k = s > 1e-9 ? angle / s / dt : 0;
    for (const b of [this.handBody, this.fingerBody]) {
      b.velocity.set(_a.x, _a.y, _a.z); b.angularVelocity.set(_q.x * k, _q.y * k, _q.z * k);
    }
  }

  _gripLogic(dt, items) {
    this.gripPressTime += dt; this.regrab -= dt;
    if (this.gripLock > 0) { this.gripLock -= dt; this.gripInput = false; }
    const want = this.gripInput ? 1 : 0;
    const rate = (want > this.curl ? HAND.gripCloseRate : HAND.gripOpenRate) * dt;
    this.curl = clamp(this.curl + clamp(want - this.curl, -rate, rate), 0, 1);

    // сферы пальцев едут вслед за сжатием
    for (const s of this.local) if (s.open) s.p.lerpVectors(s.open, s.closed, this.curl);

    // кандидат на захват — предмет, ближайший к линии хвата
    this.grabItem = null; this.grabReady = false;
    if (!this.holding) {
      let best = HAND.grabDistance;
      for (const it of items) {
        if (it.banked) continue;
        const d = this._grabDistance(it);
        if (d < best) { best = d; this.grabItem = it; }
      }
      this.grabReady = !!this.grabItem;
    }
    if (this.gripInput && !this.holding && this.curl >= HAND.grabThreshold && this.regrab <= 0 && this.gripPressTime < 0.6 && this.grabReady) this._attach(this.grabItem);
    if (!this.gripInput && this.holding) this.release('open');

    // после отпускания рука на мгновение «прозрачна» для слитка, чтобы не выстрелить им
    if (this.ghost > 0) {
      this.ghost -= dt;
      if (this.ghost <= 0 || !this._overlapsItem(this.lastItem)) this.ghost = 0;
    }
    const pushing = !this.holding && this.ghost <= 0;
    this.handBody.collisionFilterMask = pushing ? GROUP.BAR : 0;
    this.fingerBody.collisionFilterMask = pushing && this.curl < 0.3 ? GROUP.BAR : 0;
  }

  /** Расстояние от линии хвата ладони до поверхности предмета. */
  _grabDistance(item) {
    item.colliders();
    let best = Infinity;
    for (let i = 0; i <= 6; i++) {
      _b.fromArray(G.gripAxis[0]).lerp(_c.fromArray(G.gripAxis[1]), i / 6).applyQuaternion(this.quat).add(this.wrist);
      best = Math.min(best, item.distanceTo(_b));
    }
    return best;
  }

  _overlapsItem(item) {
    if (!item || item.banked) return false;
    const cols = item.colliders();
    for (const s of this.local) {
      _b.copy(s.p).applyQuaternion(this.quat).add(this.wrist);
      for (const col of cols) if (sphereVsCollider(_b.x, _b.y, _b.z, s.r, col, _n) > 0.004) return true;
    }
    return false;
  }

  _attach(item) {
    this.holding = true; this.item = item; this.slipTimer = 0;
    this.slipSpeed = Math.min(this.levelSlipSpeed, item.type.slipSpeed ?? Infinity);
    const qi = _q.copy(this.quat).invert();
    this.barRelQuat.copy(qi).multiply(item.quaternion());
    this.barRelPos.copy(item.position()).sub(this.wrist).applyQuaternion(qi);
    // сферы предмета — в системе координат кисти
    this.heldLocal.length = 0; this.heldR.length = 0;
    for (const s of item.heldSpheres.slice(0, HAND.maxHeldSpheres)) {
      this.heldLocal.push(s.p.clone().applyQuaternion(this.barRelQuat).add(this.barRelPos));
      this.heldR.push(s.r);
    }
    // подбираем сгиб пальцев так, чтобы они легли на предмет, а не прошли сквозь него
    // (самый сильный сгиб, при котором пальцы ещё касаются предмета; если не касаются нигде — где зазор минимален)
    const cols = item.collidersAt(this.barRelPos, this.barRelQuat);
    let touching = -1, nearest = 0.15, nearestGap = Infinity;
    for (let c = 0.1; c <= HAND.holdCurl + 1e-6; c += 0.05) {
      let deep = 0, gap = Infinity;
      for (const s of this.local) {
        if (!s.open) continue;
        _b.lerpVectors(s.open, s.closed, c);
        for (const col of cols) {
          deep = Math.max(deep, sphereVsCollider(_b.x, _b.y, _b.z, s.r, col, _n));
          gap = Math.min(gap, pointPrimDistance(_b, col) - s.r);
        }
      }
      if (deep > 0.012) continue;
      if (gap < 0.006) touching = c;
      if (gap < nearestGap) { nearestGap = gap; nearest = c; }
    }
    this.holdCurl = touching >= 0 ? touching : nearest;
    this.constraint = new CANNON.LockConstraint(this.handBody, item.body, { maxForce: HAND.lockMaxForce });
    this.world.addConstraint(this.constraint);
    item.setHeld(true);
    this.events.push({ type: 'grab', item });
  }

  _detach() {
    if (this.constraint) { this.world.removeConstraint(this.constraint); this.constraint = null; }
    if (this.item) { this.item.setHeld(false); this.lastItem = this.item; }
    this.holding = false; this.item = null; this.heldLocal.length = 0; this.heldR.length = 0;
  }

  /** reason: 'open' | 'slip' | 'hot' */
  release(reason = 'open', lock = 0) {
    if (!this.holding) return;
    const item = this.item;
    this._detach();
    this.regrab = HAND.regrabDelay; this.ghost = 1.0;
    if (lock > 0) this.gripLock = lock;
    this.events.push({ type: 'release', reason, item });
  }

  /** Задевает ли рука (вместе с предметом в ней) коллайдер? Для подвижных преград вроде заслонки. */
  touches(col, margin = 0) {
    const off = this.off;
    for (let i = 0; i < this.count; i++) {
      if (sphereVsCollider(this.pos.x + off[i * 4], this.pos.y + off[i * 4 + 1], this.pos.z + off[i * 4 + 2], off[i * 4 + 3] + margin, col, _n) > 0) return true;
    }
    return false;
  }

  /** Мировые центры сфер руки (для лазеров): callback(x, y, z, r). Слиток не считается. */
  forEachArmSphere(fn) {
    const off = this.off;
    for (let i = 0; i < this.count; i++) if (this.offGroup[i] === 0) fn(this.pos.x + off[i * 4], this.pos.y + off[i * 4 + 1], this.pos.z + off[i * 4 + 2], off[i * 4 + 3]);
  }

  // --- отрисовка ----------------------------------------------------------------
  updateVisual(time) {
    this.group.position.copy(this.wrist); this.group.quaternion.copy(this.quat);
    const shown = this.holding ? Math.min(this.curl, this.holdCurl) : this.curl;
    const shake = this.gripLock > 0 ? Math.sin(time * 60) * 0.08 : 0;
    for (const j of this.joints) {
      const idle = 0.07 + 0.015 * Math.sin(time * 1.7 + j.phase * 20);
      const c = clamp((shown - j.phase) / (1 - j.phase), 0, 1);
      j.bone.quaternion.copy(j.rest).multiply(_q.setFromAxisAngle(j.axis, j.angle * (idle + c * (1 - idle)) + shake));
    }
    // рукав от локтя к плечу
    _a.set(0, 0, G.forearmLength).applyQuaternion(this.quat).add(this.wrist);
    _b.copy(this.shoulder).sub(_a);
    const len = _b.length();
    this.elbowBall.position.copy(_a);
    this.upper.position.copy(_a);
    this.upper.quaternion.setFromUnitVectors(_c.set(0, 1, 0), _b.multiplyScalar(1 / len));
    this.upper.scale.set(1, Math.min(len, HAND.upperArmVisible), 1);
  }
}

const _newPos = V();
