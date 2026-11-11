// Комната-хранилище, стол, свет, пыль в луче, камера от первого лица и постобработка.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { WORLD } from './config.js';

export const LIGHT = {
  spotIntensity: 15, spotAngle: 0.5, spotPenumbra: 0.55,
  fillIntensity: 0.35, rimIntensity: 3, exposure: 1.0,
  bloom: { strength: 0.32, radius: 0.55, threshold: 0.92 },
  maxPixelRatio: 2,
};

function scaleUV(geo, su, sv) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return geo;
}

export class Stage {
  constructor(canvas, M, models) {
    this.M = M;
    const renderer = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, LIGHT.maxPixelRatio);
    renderer.setPixelRatio(this.pixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = LIGHT.exposure;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(0x030304);
    scene.fog = new THREE.FogExp2(0x050506, 0.09);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; // отражения на золоте и стекле
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(WORLD.fov, 1, 0.03, 30);
    this.eye = new THREE.Vector3(...WORLD.eye);
    this.lookAt = new THREE.Vector3(...WORLD.lookAt);
    this.sideBlend = 0; this.sideTarget = 0; this.sideUses = WORLD.sideCam.uses;
    this.sidePos = new THREE.Vector3(); this.sideLook = new THREE.Vector3();
    this.head = new THREE.Vector2();

    this._buildRoom(models);
    this._buildLights();
    this._buildDust();
    this._buildSafeZone();

    // Постобработка: MSAA-буфер → bloom (свечение золота и ламп) → тонмаппинг + sRGB.
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), LIGHT.bloom.strength, LIGHT.bloom.radius, LIGHT.bloom.threshold);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(this.pixelRatio);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Понизить разрешение рендера, если кадры проседают. */
  setPixelRatio(pr) { this.pixelRatio = pr; this.resize(); }

  _buildRoom(models) {
    const M = this.M, scene = this.scene, [rw, rh, rd] = WORLD.room, [tw, tt, td] = WORLD.tableSize, ty = WORLD.tableY;
    const byName = (o) => {
      const n = (o.material?.name || '').toLowerCase();
      if (n.includes('tile')) return M.tiles;
      if (n.includes('wood')) return M.wood;
      if (n.includes('glow')) return M.lampGlow;
      if (n.includes('steel')) return M.steel;
      if (n.includes('metal')) return M.metal;
      if (n.includes('velvet')) return M.velvet;
      return M.concrete;
    };
    const adopt = (root, cast) => {
      root.traverse((o) => { if (o.isMesh) { o.material = byName(o); o.castShadow = cast && o.material !== M.lampGlow; o.receiveShadow = true; } });
      scene.add(root);
    };
    this.usedGlb = { room: !!models.room, table: !!models.table };

    if (models.room) adopt(models.room, false);
    else {
      const floor = new THREE.Mesh(scaleUV(new THREE.PlaneGeometry(rw, rd), rw, rd), M.tiles);
      floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
      const walls = new THREE.Mesh(scaleUV(new THREE.BoxGeometry(rw, rh, rd), rw, rh), M.concrete);
      walls.material = M.concrete.clone(); walls.material.side = THREE.BackSide;
      walls.position.y = rh / 2; walls.receiveShadow = true; scene.add(walls);
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.16, 0.22, 24, 1, true), M.metal);
      lamp.position.set(...WORLD.spot); lamp.position.y += 0.1; scene.add(lamp);
      const bulb = new THREE.Mesh(new THREE.CircleGeometry(0.1, 24), M.lampGlow);
      bulb.rotation.x = Math.PI / 2; bulb.position.set(...WORLD.spot); scene.add(bulb);
    }

    if (models.table) adopt(models.table, true);
    else {
      const top = new THREE.Mesh(scaleUV(new THREE.BoxGeometry(tw, tt, td), tw, td), M.wood);
      top.position.y = ty - tt / 2; top.castShadow = true; top.receiveShadow = true; scene.add(top);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, ty - tt, 0.07), M.wood);
        leg.position.set(sx * (tw / 2 - 0.08), (ty - tt) / 2, sz * (td / 2 - 0.08)); leg.castShadow = true; scene.add(leg);
      }
    }
  }

  _buildLights() {
    const scene = this.scene;
    const spot = this.spot = new THREE.SpotLight(0xffe2b8, LIGHT.spotIntensity, 8, LIGHT.spotAngle, LIGHT.spotPenumbra, 1.6);
    spot.position.set(...WORLD.spot);
    spot.target.position.set(-0.05, WORLD.tableY, -0.08);
    spot.castShadow = true;
    spot.shadow.mapSize.set(2048, 2048);
    spot.shadow.camera.near = 0.6; spot.shadow.camera.far = 4;
    spot.shadow.bias = -0.0004; spot.shadow.normalBias = 0.012; spot.shadow.radius = 5;
    scene.add(spot, spot.target);

    this.fill = new THREE.HemisphereLight(0x6f86b8, 0x0b0a0c, LIGHT.fillIntensity); // холодный заполняющий
    scene.add(this.fill);
    const rim = new THREE.SpotLight(0xff9a4a, LIGHT.rimIntensity, 7, 0.7, 0.8, 1.5);     // тёплый контровой
    rim.position.set(-1.9, 1.9, -1.9); rim.target.position.set(0, WORLD.tableY, 0);
    scene.add(rim, rim.target);

    this.alarmLight = new THREE.PointLight(0xff1408, 0, 9, 1.4);
    this.alarmLight.position.set(0.6, 2.3, -0.9);
    scene.add(this.alarmLight);
    this.alarm = false;

    // «объёмный» конус луча
    const h = WORLD.spot[1] - WORLD.tableY, r = Math.tan(LIGHT.spotAngle) * h * 0.92;
    const coneGeo = new THREE.ConeGeometry(r, h, 40, 1, true); coneGeo.translate(0, -h / 2, 0);
    const cone = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.013, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    cone.position.copy(spot.position);
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), spot.target.position.clone().sub(spot.position).normalize());
    cone.renderOrder = 6;
    scene.add(cone);
    this.coneAxis = spot.target.position.clone().sub(spot.position).normalize();
    this.coneRadius = r; this.coneHeight = h;
  }

  _buildDust() {
    const N = 220, pos = new Float32Array(N * 3);
    this.dustSeed = new Float32Array(N * 3);
    const axis = this.coneAxis, side = new THREE.Vector3(1, 0, 0).cross(axis).normalize(), up = axis.clone().cross(side);
    for (let i = 0; i < N; i++) {
      const t = 0.25 + Math.random() * 0.75, a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * this.coneRadius * t;
      const p = this.spot.position.clone().addScaledVector(axis, t * this.coneHeight * 1.02).addScaledVector(side, Math.cos(a) * rr).addScaledVector(up, Math.sin(a) * rr);
      pos.set([p.x, Math.max(p.y, WORLD.tableY + 0.02), p.z], i * 3);
      this.dustSeed.set([Math.random() * 6.28, 0.3 + Math.random(), Math.random() * 6.28], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dustBase = pos.slice();
    const dc = document.createElement('canvas'); dc.width = dc.height = 32;
    const dg = dc.getContext('2d'), grad = dg.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    dg.fillStyle = grad; dg.fillRect(0, 0, 32, 32);
    this.dust = new THREE.Points(geo, new THREE.PointsMaterial({ map: new THREE.CanvasTexture(dc), color: 0xffe6c0, size: 0.0055, transparent: true, opacity: 0.38, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true, fog: false }));
    this.dust.renderOrder = 7;
    this.scene.add(this.dust);
  }

  _buildSafeZone() {
    const g = new THREE.Group();
    const mat = (o) => new THREE.MeshBasicMaterial({ color: 0xffc04a, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false });
    this.safeRing = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 64), mat(0.9));
    this.safeDisc = new THREE.Mesh(new THREE.CircleGeometry(0.93, 64), mat(0.07));
    for (const m of [this.safeRing, this.safeDisc]) { m.rotation.x = -Math.PI / 2; g.add(m); }
    g.position.y = WORLD.tableY + 0.002;
    g.renderOrder = 1;
    this.safe = g;
    this.scene.add(g);
  }

  /** Настроить сцену под уровень: положение «сейфа», боковая камера. */
  setLevel(level) {
    this.safe.position.x = level.safe.pos[0]; this.safe.position.z = level.safe.pos[1];
    this.safe.scale.setScalar(level.safe.radius);
    const [bx, bz] = level.box.pos, h = level.box.size[1], o = WORLD.sideCam.offset;
    this.sideLook.set(bx, WORLD.tableY + h * 0.45, bz);
    this.sidePos.set(bx + o[0], WORLD.tableY + h * 0.5 + o[1], bz + o[2]);
    this.sideBlend = this.sideTarget = 0; this.sideUses = WORLD.sideCam.uses;
    this.setAlarm(false);
  }

  /** Клавиша C. Возвращает false, если попытки кончились. */
  toggleSide() {
    if (this.sideTarget === 0) {
      if (this.sideUses <= 0) return false;
      this.sideUses--; this.sideTarget = 1;
    } else this.sideTarget = 0;
    return true;
  }

  setAlarm(on) { this.alarm = on; if (!on) this.alarmLight.intensity = 0; }

  update(dt, time, handPos, safePulse = 0) {
    // камера: дыхание, поворот головы за рукой, плавный переход на вид сбоку
    const cam = this.camera;
    this.sideBlend += (this.sideTarget - this.sideBlend) * (1 - Math.exp(-WORLD.sideCam.blend * dt));
    const hx = THREE.MathUtils.clamp((handPos.x - this.lookAt.x) / 0.75, -1, 1), hy = THREE.MathUtils.clamp((handPos.y - 1.12) / 0.5, -1, 1);
    this.head.x += (hx - this.head.x) * (1 - Math.exp(-3 * dt));
    this.head.y += (hy - this.head.y) * (1 - Math.exp(-3 * dt));
    _p.copy(this.eye); _p.y += Math.sin(time * 1.25) * 0.004; _p.x += Math.sin(time * 0.62) * 0.002;
    cam.position.copy(_p); cam.lookAt(this.lookAt);
    cam.rotateOnWorldAxis(_up, -this.head.x * WORLD.headTurn);
    cam.rotateX(this.head.y * WORLD.headTurn * 0.45);
    cam.rotateZ(Math.sin(time * 0.62) * 0.003);
    if (this.sideBlend > 0.001) {
      _q1.copy(cam.quaternion);
      const s = this.sideBlend * this.sideBlend * (3 - 2 * this.sideBlend);
      cam.position.lerp(this.sidePos, s);
      _m.lookAt(this.sidePos, this.sideLook, _up); _q2.setFromRotationMatrix(_m);
      cam.quaternion.copy(_q1).slerp(_q2, s);
    }

    // пылинки
    const p = this.dust.geometry.attributes.position, b = this.dustBase, sd = this.dustSeed;
    for (let i = 0; i < p.count; i++) {
      const k = i * 3, w = sd[k + 1];
      p.array[k] = b[k] + Math.sin(time * 0.21 * w + sd[k]) * 0.05;
      p.array[k + 1] = b[k + 1] + Math.sin(time * 0.13 * w + sd[k + 2]) * 0.06;
      p.array[k + 2] = b[k + 2] + Math.cos(time * 0.17 * w + sd[k]) * 0.05;
    }
    p.needsUpdate = true;

    // «сейф» пульсирует, тревога мигает
    this.safeRing.material.opacity = 0.55 + 0.3 * Math.sin(time * 3) + safePulse * 0.4;
    this.safeDisc.material.opacity = 0.05 + safePulse * 0.18;
    if (this.alarm) {
      const k = 0.5 + 0.5 * Math.sin(time * 9);
      this.alarmLight.intensity = 30 * k;
      this.spot.intensity = LIGHT.spotIntensity * (0.55 + 0.25 * (1 - k));
    } else this.spot.intensity = LIGHT.spotIntensity;
  }

  render() { this.composer.render(); }
}

const _p = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4();
