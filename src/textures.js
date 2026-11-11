// Текстуры и материалы.
// Сначала пробуем загрузить PNG, запечённые в Blender (assets/textures/*.png).
// Если файла нет — рисуем ту же текстуру процедурно на Canvas 2D (запасной вариант).
import * as THREE from 'three';

const TEX_DIR = './assets/textures/';
const FALLBACK_SIZE = 512;
const loader = new THREE.TextureLoader();

// ---------------------------------------------------------------------------
// Процедурный запасной вариант
// ---------------------------------------------------------------------------
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

// Бесшовный value noise: решётка n×n со случайными значениями, плавная интерполяция.
function grid(n, rnd) {
  const g = new Float32Array(n * n);
  for (let i = 0; i < g.length; i++) g[i] = rnd();
  return g;
}
function sample(g, n, x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  let fx = x - xi, fy = y - yi;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const x0 = ((xi % n) + n) % n, x1 = (x0 + 1) % n;
  const y0 = ((yi % n) + n) % n, y1 = (y0 + 1) % n;
  const a = g[y0 * n + x0], b = g[y0 * n + x1], c = g[y1 * n + x0], d = g[y1 * n + x1];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
// fBm-поле size×size в диапазоне 0..1. fx, fy — базовые частоты (целые → бесшовно).
function fbm(size, fx, fy, octaves, seed) {
  const rnd = rng(seed);
  const out = new Float32Array(size * size);
  let amp = 1, total = 0;
  for (let o = 0; o < octaves; o++) {
    const nx = fx << o, ny = fy << o, n = Math.max(nx, ny);
    const g = grid(n, rnd);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) out[y * size + x] += amp * sample(g, n, (x / size) * nx, (y / size) * ny);
    }
    total += amp; amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}
function fieldFromCanvas(c) {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const f = new Float32Array(c.width * c.height);
  for (let i = 0; i < f.length; i++) f[i] = d[i * 4] / 255;
  return f;
}
// Случайные царапины линиями (бесшовность по краям обеспечиваем дублированием со сдвигом).
function scratches(size, count, seed, maxLen = 0.35, width = 1) {
  const c = canvas(size), g = c.getContext('2d'), rnd = rng(seed);
  g.fillStyle = '#000'; g.fillRect(0, 0, size, size);
  g.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    const x = rnd() * size, y = rnd() * size, a = rnd() * Math.PI * 2, len = (0.03 + rnd() * maxLen) * size;
    const v = Math.floor(90 + rnd() * 165);
    g.strokeStyle = `rgb(${v},${v},${v})`;
    g.lineWidth = width * (0.5 + rnd());
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      g.beginPath(); g.moveTo(x + ox, y + oy);
      g.lineTo(x + ox + Math.cos(a) * len, y + oy + Math.sin(a) * len); g.stroke();
    }
  }
  return fieldFromCanvas(c);
}

// Карта нормалей из карты высот (оператор Собеля), формат OpenGL (+Y вверх).
function normalFromHeight(h, size, strength) {
  const c = canvas(size), g = c.getContext('2d');
  const img = g.createImageData(size, size), d = img.data;
  const at = (x, y) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const gy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      let nx = -gx * strength, ny = gy * strength, nz = 1;
      const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      const i = (y * size + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255; d[i + 1] = (ny * 0.5 + 0.5) * 255; d[i + 2] = (nz * 0.5 + 0.5) * 255; d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

function paint(size, fn) {
  const c = canvas(size), g = c.getContext('2d');
  const img = g.createImageData(size, size), d = img.data;
  for (let i = 0; i < size * size; i++) {
    const [r, gg, b, a = 255] = fn(i, i % size, Math.floor(i / size));
    d[i * 4] = r; d[i * 4 + 1] = gg; d[i * 4 + 2] = b; d[i * 4 + 3] = a;
  }
  g.putImageData(img, 0, 0);
  return c;
}
const mix = (a, b, t) => a + (b - a) * t;
const clamp01 = (x) => Math.min(1, Math.max(0, x));

// Каждая функция возвращает { albedo: canvas, rough: Float32Array, height: Float32Array, metal, normalStrength }.
const PROC = {
  gold(S) {
    const n = fbm(S, 4, 4, 5, 11), sc = scratches(S, 260, 12, 0.3, 1), fine = scratches(S, 500, 13, 0.08, 0.7);
    const albedo = paint(S, (i) => { const v = 0.9 + n[i] * 0.14 - sc[i] * 0.08; return [255 * v, 201 * v, 74 * v]; });
    const rough = n.map((v, i) => clamp01(0.16 + v * 0.1 + sc[i] * 0.3 + fine[i] * 0.15));
    const height = n.map((v, i) => 0.5 + v * 0.05 - sc[i] * 0.3 - fine[i] * 0.1);
    return { albedo, rough, height, metal: 1, normalStrength: 1.2 };
  },
  skin(S) {
    const n = fbm(S, 3, 3, 5, 21), pores = fbm(S, 64, 64, 2, 22), lines = scratches(S, 160, 23, 0.12, 0.8);
    const albedo = paint(S, (i) => { const v = 0.92 + n[i] * 0.16; const red = pores[i] * 0.06; return [222 * v, (170 - 20 * red) * v, (138 - 26 * red) * v]; });
    const rough = n.map((v, i) => clamp01(0.48 + v * 0.14 + pores[i] * 0.06));
    const height = pores.map((v, i) => 0.5 + (v - 0.5) * 0.5 - lines[i] * 0.25);
    return { albedo, rough, height, metal: 0, normalStrength: 1.0 };
  },
  glove(S) {
    const n = fbm(S, 4, 4, 4, 31);
    const weave = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      weave[y * S + x] = 0.5 + 0.25 * Math.sin((x / S) * Math.PI * 2 * 48) * Math.sin((y / S) * Math.PI * 2 * 48);
    }
    const albedo = paint(S, (i) => { const v = 26 + n[i] * 14 + weave[i] * 8; return [v, v, v * 1.06]; });
    const rough = n.map((v) => clamp01(0.78 + v * 0.15));
    return { albedo, rough, height: weave, metal: 0, normalStrength: 1.4 };
  },
  wood_table(S) {
    const grain = fbm(S, 2, 24, 5, 41), big = fbm(S, 2, 3, 3, 42);
    const albedo = paint(S, (i) => {
      const t = clamp01(grain[i] * 0.75 + big[i] * 0.45 - 0.1);
      const ring = 0.5 + 0.5 * Math.sin(t * 34);
      const v = mix(0.55, 1.0, ring * 0.5 + t * 0.5);
      return [74 * v, 40 * v, 22 * v];
    });
    const rough = grain.map((v) => clamp01(0.22 + v * 0.12));
    const height = grain.map((v) => 0.5 + (v - 0.5) * 0.15);
    return { albedo, rough, height, metal: 0, normalStrength: 0.5 };
  },
  wall_concrete(S) {
    const n = fbm(S, 3, 3, 6, 51), spots = fbm(S, 24, 24, 3, 52);
    const albedo = paint(S, (i) => { const v = 92 + n[i] * 60 - (spots[i] > 0.68 ? 22 : 0); return [v, v * 0.98, v * 0.95]; });
    const rough = n.map((v) => clamp01(0.8 + v * 0.15));
    const height = n.map((v, i) => v * 0.6 + (spots[i] > 0.68 ? -0.25 : 0) + 0.3);
    return { albedo, rough, height, metal: 0, normalStrength: 1.6 };
  },
  floor_tiles(S) {
    const n = fbm(S, 4, 4, 5, 61), T = 2, G = 0.012;
    const isGrout = (x, y) => { const u = ((x / S) * T) % 1, v = ((y / S) * T) % 1; return u < G || u > 1 - G || v < G || v > 1 - G; };
    const albedo = paint(S, (i, x, y) => { if (isGrout(x, y)) return [22, 21, 20]; const v = 30 + n[i] * 26; return [v, v * 1.02, v * 1.08]; });
    const rough = new Float32Array(S * S), height = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x, g = isGrout(x, y);
      rough[i] = g ? 0.85 : clamp01(0.12 + n[i] * 0.14); height[i] = g ? 0.2 : 0.6 + n[i] * 0.03;
    }
    return { albedo, rough, height, metal: 0, normalStrength: 1.5 };
  },
  velvet_red(S) {
    const n = fbm(S, 6, 6, 5, 71), fine = fbm(S, 96, 96, 2, 72);
    const albedo = paint(S, (i) => { const v = 0.75 + n[i] * 0.3 + fine[i] * 0.12; return [128 * v, 14 * v, 22 * v]; });
    const rough = fine.map((v) => clamp01(0.86 + v * 0.14));
    return { albedo, rough, height: fine, metal: 0, normalStrength: 0.8 };
  },
};

// Разводы и отпечатки пальцев: значение = шероховатость стекла.
function procSmudges(S) {
  const dust = fbm(S, 5, 5, 5, 81), c = canvas(S), g = c.getContext('2d'), rnd = rng(82);
  g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
  for (let p = 0; p < 7; p++) { // отпечаток: эллипс из концентрических дуг
    const cx = (0.15 + rnd() * 0.7) * S, cy = (0.15 + rnd() * 0.7) * S, rot = rnd() * Math.PI, rx = S * 0.035, ry = S * 0.05;
    g.save(); g.translate(cx, cy); g.rotate(rot);
    g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = Math.max(1, S / 512);
    for (let k = 0.12; k <= 1; k += 0.11) {
      g.beginPath(); g.ellipse(0, ry * 0.25 * (1 - k), rx * k, ry * k, 0, Math.PI * (1.05 + rnd() * 0.1), Math.PI * (1.95 + rnd() * 0.1) + Math.PI); g.stroke();
    }
    g.restore();
  }
  const prints = fieldFromCanvas(c);
  return paint(S, (i) => { const v = clamp01(0.04 + Math.max(0, dust[i] - 0.55) * 0.8 + prints[i] * 0.4) * 255; return [v, v, v]; });
}

// Трещины: рекурсивные ломаные от точки удара. stage 1..3 — всё гуще.
function procCracks(S, stage) {
  const c = canvas(S), g = c.getContext('2d'), rnd = rng(90 + stage);
  g.clearRect(0, 0, S, S); g.lineCap = 'round';
  const branch = (x, y, a, len, w, depth) => {
    let px = x, py = y;
    const steps = 4 + Math.floor(rnd() * 4);
    for (let i = 0; i < steps; i++) {
      a += (rnd() - 0.5) * 0.7;
      const nx = px + Math.cos(a) * len / steps, ny = py + Math.sin(a) * len / steps;
      g.strokeStyle = `rgba(235,245,255,${0.55 + rnd() * 0.4})`; g.lineWidth = w;
      g.beginPath(); g.moveTo(px, py); g.lineTo(nx, ny); g.stroke();
      if (depth > 0 && rnd() < 0.45) branch(nx, ny, a + (rnd() < 0.5 ? 1 : -1) * (0.5 + rnd() * 0.6), len * 0.55, w * 0.7, depth - 1);
      px = nx; py = ny;
    }
  };
  const centers = [[0.42, 0.55], [0.68, 0.36], [0.3, 0.3]].slice(0, stage);
  for (const [cx, cy] of centers) {
    const rays = 5 + stage * 2;
    for (let r = 0; r < rays; r++) branch(cx * S, cy * S, (r / rays) * Math.PI * 2 + rnd(), S * (0.16 + 0.1 * stage + rnd() * 0.12), S / 300, 1 + stage);
  }
  return c;
}

function canvasTex(c, srgb) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return t;
}
function ormCanvas(S, rough, metal) {
  return paint(S, (i) => [255, rough[i] * 255, metal * 255]);
}

function setup(tex, srgb, repeat) {
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.flipY = false; // как в glTF
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  if (repeat) tex.repeat.set(repeat, repeat);
  tex.needsUpdate = true;
  return tex;
}

async function tryLoad(file) {
  try { return await loader.loadAsync(TEX_DIR + file); } catch { return null; }
}

/** Набор PBR-карт: { map, normalMap, ormMap, fallback }. */
export async function loadSet(name, repeat = 1) {
  const [a, n, o] = await Promise.all([tryLoad(`${name}_albedo.png`), tryLoad(`${name}_normal.png`), tryLoad(`${name}_orm.png`)]);
  if (a && n && o) return { map: setup(a, true, repeat), normalMap: setup(n, false, repeat), ormMap: setup(o, false, repeat), fallback: false, normalScale: 1 };
  const S = FALLBACK_SIZE, p = PROC[name](S);
  return {
    map: setup(canvasTex(p.albedo, true), true, repeat),
    normalMap: setup(canvasTex(normalFromHeight(p.height, S, 2.5), false), false, repeat),
    ormMap: setup(canvasTex(ormCanvas(S, p.rough, p.metal), false), false, repeat),
    fallback: true, normalScale: p.normalStrength,
  };
}

export async function loadGlassMaps() {
  const [sm, c1, c2, c3] = await Promise.all(['glass_smudges.png', 'glass_cracks_1.png', 'glass_cracks_2.png', 'glass_cracks_3.png'].map(tryLoad));
  const fallback = !(sm && c1 && c2 && c3);
  const smudges = setup(sm || canvasTex(procSmudges(FALLBACK_SIZE), false), false, 1);
  const cracks = [c1, c2, c3].map((t, i) => {
    const tex = setup(t || canvasTex(procCracks(FALLBACK_SIZE, i + 1), true), true, 1);
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  });
  return { smudges, cracks, fallback };
}

// ---------------------------------------------------------------------------
// Материалы
// ---------------------------------------------------------------------------
function pbr(set, extra = {}, physical = false) {
  const Mat = physical ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
  const m = new Mat({
    map: set.map, normalMap: set.normalMap, roughnessMap: set.ormMap, metalnessMap: set.ormMap, aoMap: set.ormMap,
    roughness: 1, metalness: 1, ...extra,
  });
  m.normalScale.setScalar(extra.normalStrength ?? set.normalScale ?? 1);
  return m;
}

export async function createMaterials() {
  const [gold, skin, glove, wood, concrete, tiles, velvet, glassMaps] = await Promise.all([
    loadSet('gold'), loadSet('skin'), loadSet('glove'), loadSet('wood_table', 1), loadSet('wall_concrete', 1),
    loadSet('floor_tiles', 1), loadSet('velvet_red', 1), loadGlassMaps(),
  ]);
  const sets = { gold, skin, glove, wood, concrete, tiles, velvet };
  const fallbacks = Object.entries(sets).filter(([, s]) => s.fallback).map(([k]) => k);
  if (glassMaps.fallback) fallbacks.push('glass');

  const M = {};
  // Золото: металл, отражения берёт из PMREM-окружения.
  M.gold = pbr(gold, { color: 0xffc94a, envMapIntensity: 1.5, clearcoat: 0.15, clearcoatRoughness: 0.3 }, true);
  if (!gold.fallback) M.gold.color.set(0xffffff); // запечённое albedo уже золотое
  // Стекло: пропускание + разводы в шероховатости.
  M.glass = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, metalness: 0, roughness: 1, roughnessMap: glassMaps.smudges,
    transmission: 1, thickness: 0.02, ior: 1.5, attenuationColor: new THREE.Color(0x9fe0c0), attenuationDistance: 0.35,
    envMapIntensity: 2.2, specularIntensity: 1, depthWrite: false, side: THREE.DoubleSide,
  });
  // Торцы стекла — зеленоватые.
  M.glassEdge = new THREE.MeshPhysicalMaterial({
    color: 0x2f8f6a, metalness: 0, roughness: 0.12, transparent: true, opacity: 0.55, envMapIntensity: 1.2,
    emissive: 0x0b3a28, emissiveIntensity: 0.6, depthWrite: false,
  });
  // Пыль и отпечатки, которые ловят свет: тонкий аддитивный слой поверх стекла.
  M.glassDust = new THREE.MeshBasicMaterial({
    color: 0xcfe6dc, alphaMap: glassMaps.smudges, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, fog: false,
  });
  M.cracks = glassMaps.cracks.map((t) => new THREE.MeshBasicMaterial({
    map: t, transparent: true, depthWrite: false, side: THREE.DoubleSide, color: 0xdfeeff, opacity: 0.9,
    polygonOffset: true, polygonOffsetFactor: -2, toneMapped: false,
  }));
  M.skin = pbr(skin, { envMapIntensity: 0.35, sheen: 0.35, sheenRoughness: 0.5, sheenColor: new THREE.Color(0xffb199) }, true);
  M.glove = pbr(glove, { envMapIntensity: 0.25 });
  M.wood = pbr(wood, { envMapIntensity: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.3 }, true);
  M.concrete = pbr(concrete, { envMapIntensity: 0.12 });
  M.tiles = pbr(tiles, { envMapIntensity: 0.6 });
  M.velvet = pbr(velvet, { envMapIntensity: 0.1, sheen: 1, sheenRoughness: 0.4, sheenColor: new THREE.Color(0xff5060) }, true);
  M.metal = new THREE.MeshStandardMaterial({ color: 0x2a2c30, metalness: 0.9, roughness: 0.38, envMapIntensity: 0.6 });
  M.steel = new THREE.MeshStandardMaterial({ color: 0xaab0b8, metalness: 1, roughness: 0.12, envMapIntensity: 1.0 });
  M.sleeve = new THREE.MeshStandardMaterial({ color: 0x060607, metalness: 0, roughness: 0.92, envMapIntensity: 0.15 });
  M.lampGlow = new THREE.MeshBasicMaterial({ color: 0xfff1d0, toneMapped: false });

  // Текстуры окружения тайлятся по мировым координатам: UV моделей заданы в метрах.
  wood.map.repeat.set(1.2, 1.2); wood.normalMap.repeat.set(1.2, 1.2); wood.ormMap.repeat.set(1.2, 1.2);
  for (const s of [concrete, tiles]) for (const k of ['map', 'normalMap', 'ormMap']) s[k].repeat.set(0.5, 0.5);
  for (const k of ['map', 'normalMap', 'ormMap']) velvet[k].repeat.set(6, 6);

  return { M, sets, glassMaps, fallbacks };
}
