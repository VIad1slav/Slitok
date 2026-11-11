// Золотой слиток: динамическое тело cannon-es + меш.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { BAR, PHYS, WORLD } from './config.js';
import { GROUP } from './box.js';

function fallbackGeometry() {
  const [l, h, w] = BAR.size, g = new THREE.BoxGeometry(l, h, w, 1, 1, 1), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) { p.setX(i, p.getX(i) * (BAR.topScale + 0.1)); p.setZ(i, p.getZ(i) * BAR.topScale); }
  g.computeVertexNormals();
  return g;
}

export class Bar {
  constructor({ scene, world, M, glbScene, level, material }) {
    this.scene = scene; this.world = world;
    this.half = new THREE.Vector3(BAR.size[0] / 2, BAR.size[1] / 2, BAR.size[2] / 2);
    const [bx, by, bz] = level.bar.pos;
    this.body = new CANNON.Body({
      mass: level.bar.mass, material, linearDamping: 0.03, angularDamping: 0.25,
      collisionFilterGroup: GROUP.BAR, collisionFilterMask: GROUP.STATIC | GROUP.HAND,
    });
    this.body.addShape(new CANNON.Box(new CANNON.Vec3(this.half.x, this.half.y, this.half.z)));
    this.body.position.set(level.box.pos[0] + bx, WORLD.tableY + by + this.half.y + 0.001, level.box.pos[1] + bz);
    this.body.quaternion.setFromEuler(0, THREE.MathUtils.degToRad(level.bar.yaw || 0), 0);
    this.body.userData = { kind: 'bar' };
    world.addBody(this.body);

    this.usedGlb = !!glbScene;
    if (glbScene) {
      this.mesh = glbScene.clone(true);
      this.mesh.traverse((o) => { if (o.isMesh) { o.material = M.gold; o.castShadow = true; o.receiveShadow = true; } });
    } else {
      this.mesh = new THREE.Mesh(fallbackGeometry(), M.gold);
      this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    }
    this.material = M.gold;
    scene.add(this.mesh);

    this._pos = new THREE.Vector3(); this._quat = new THREE.Quaternion();
    this._col = { type: 'box', kind: 'bar', c: new THREE.Vector3(), h: this.half, q: new THREE.Quaternion(), qi: new THREE.Quaternion() };
    this.held = false;
    this.sync();
  }

  position() { const p = this.body.position; return this._pos.set(p.x, p.y, p.z); }
  quaternion() { const q = this.body.quaternion; return this._quat.set(q.x, q.y, q.z, q.w); }
  speed() { return this.body.velocity.length(); }
  collider() {
    this._col.c.copy(this.position()); this._col.q.copy(this.quaternion()); this._col.qi.copy(this._col.q).invert();
    return this._col;
  }

  setHeld(on) {
    this.held = on;
    // В руке слиток не сталкивается со статикой сам: за него это делает «сферный» решатель руки.
    this.body.collisionFilterMask = on ? 0 : (GROUP.STATIC | GROUP.HAND);
    this.body.wakeUp();
  }

  /** Вызывать после каждого шага физики: ограничение скорости. */
  postStep() {
    const v = this.body.velocity, s = v.length();
    if (s > PHYS.barMaxSpeed) v.scale(PHYS.barMaxSpeed / s, v);
    const w = this.body.angularVelocity, ws = w.length();
    if (ws > 25) w.scale(25 / ws, w);
  }

  sync() {
    this.mesh.position.copy(this.position());
    this.mesh.quaternion.copy(this.quaternion());
  }

  /** k: 0..1 — насколько слиток раскалён / подсвечен. */
  setGlow(k, color = 0xff5a10) {
    this.material.emissive.set(color);
    this.material.emissiveIntensity = k;
  }

  dispose() {
    this.world.removeBody(this.body);
    this.scene.remove(this.mesh);
    this.material.emissiveIntensity = 0;
    if (!this.usedGlb) this.mesh.geometry.dispose();
  }
}
