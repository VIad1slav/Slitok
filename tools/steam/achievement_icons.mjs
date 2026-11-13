// Рисует иконки достижений 256×256 из моделей и материалов самой игры:
//   node tools/steam/achievement_icons.mjs
// Результат: docs/steam/achievements/<API Name>.png (цветная) и <API Name>_locked.png (серая).
// Что на иконке — поле icon у достижения в src/achievements.js: предмет, цвет ограбления, три звезды.
// Предмет рендерится движком игры (те же GLB и PBR-материалы), рамка и звёзды — простые векторные фигуры.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import { ACHIEVEMENTS } from '../../src/achievements.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'docs', 'steam', 'achievements');
mkdirSync(OUT, { recursive: true });
const SIZE = 256, RENDER = 768;
// цвет рамки — по ограблению (как свет в его обстановке); без ограбления — золото
const TINT = { pawnshop: '#e0a348', museum: '#8fb0ff', bank: '#b8c4d8', casino: '#ff46c0', boss: '#e0452c', none: '#ffc94a' };

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.glb': 'model/gltf-binary' };
const server = createServer(async (req, res) => {
  try { let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)); if (p.length < 2) p += 'index.html'; const body = await readFile(join(ROOT, p)); res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' }); res.end(body); } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 800, height: 800 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(`http://127.0.0.1:${server.address().port}/?dev=1`);
await page.waitForFunction(() => window.__gg && window.__gg.state === 'menu', null, { timeout: 60000 });

/** Отрисовать предмет на прозрачном фоне; возвращает PNG (data URL). */
const renderItem = (item) => page.evaluate(async ([item, px]) => {
  const THREE = await import('three'), g = window.__gg, M = g.M;
  const { RoomEnvironment } = await import('three/addons/environments/RoomEnvironment.js');
  const R = (window.__iconR ??= (() => {
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    r.setSize(px, px, false); r.toneMapping = THREE.ACESFilmicToneMapping; r.outputColorSpace = THREE.SRGBColorSpace; r.setClearColor(0x000000, 0);
    const pm = new THREE.PMREMGenerator(r); const env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    return { r, env };
  })());
  const scene = new THREE.Scene(); scene.environment = R.env;
  const key = new THREE.DirectionalLight(0xfff0d8, 3.2); key.position.set(1.5, 3, 2.5); scene.add(key);
  const rim = new THREE.DirectionalLight(0xffb060, 2.0); rim.position.set(-2.5, 1.5, -2); scene.add(rim);
  scene.add(new THREE.HemisphereLight(0x9fb4e0, 0x241a10, 0.9));
  const group = new THREE.Group(); scene.add(group);
  const model = (name, matName, scale = [1, 1, 1]) => {
    const src = g.models[name]; if (!src) return new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.05), M[matName]);
    const o = src.clone(true); o.scale.set(...scale);
    o.traverse((m) => { if (m.isMesh) { const n = (m.material?.name || '').toLowerCase(); m.material = n.includes('steel') ? M.steel : n.includes('metal') && matName !== 'gold' ? M.metal : n.includes('glow') ? M.lampGlow : M[matName]; } });
    return o;
  };
  const put = (o, x = 0, y = 0, z = 0, ry = 0, rz = 0, rx = 0) => { o.position.set(x, y, z); o.rotation.set(rx, ry, rz); group.add(o); return o; };
  let view = [0.9, 0.75, 1.3];
  if (item === 'bar') put(model('gold_bar', 'gold'), 0, 0, 0, 0.5);
  else if (item === 'bigbar') { put(model('gold_bar', 'gold', [1.18, 1.22, 1.2]), 0, 0, 0, 0.45); put(model('gold_bar', 'gold'), 0.01, 0.056, 0, -0.35); }
  else if (item === 'crown') put(model('crown', 'crown'), 0, 0, 0, 0.3);
  else if (item === 'coins') { put(model('coins', 'brass'), -0.03, 0, 0.01); put(model('coins', 'brass'), 0.03, 0, -0.01, 1); put(model('coins', 'brass'), 0, 0.04, 0, 2); }
  else if (item === 'chips') { put(model('chips', 'chips'), -0.035, 0, 0.015); put(model('chips', 'chips'), 0.02, 0, -0.02, 1); put(model('dice', 'dice'), 0.03, 0.005, 0.045, 0.6); }
  else if (item === 'diamond') {   // материал игры почти прозрачный — на иконке нужен плотный гранёный камень
    const d = put(model('diamond', 'diamond'), 0, 0, 0, 0.4), gem = new THREE.MeshPhysicalMaterial({ color: 0xbfe6ff, metalness: 0.1, roughness: 0.06, flatShading: true, envMapIntensity: 2.2, clearcoat: 1 });
    d.traverse((m) => { if (m.isMesh) m.material = gem; }); view = [0.5, 0.55, 1.2];
  }
  else if (item === 'vase') { put(model('vase', 'vase'), 0, 0, 0, 0, -0.5); view = [0.7, 0.45, 1.4]; }
  else if (item === 'watch') { put(model('watch', 'metal'), 0, 0, 0, 0.2, 0, 0.25); view = [0.3, 1.2, 0.9]; }
  else if (item === 'pile') { put(model('gold_bar', 'gold'), 0, 0, -0.03, 0.3); put(model('crown', 'crown'), -0.05, 0.045, -0.02, 0.2); put(model('diamond', 'diamond'), 0.09, 0, 0.07, 0.4); put(model('coins', 'brass'), -0.1, 0, 0.07); put(model('chips', 'chips'), 0.02, 0, 0.09, 1); }
  else if (item === 'glass') {
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), new THREE.MeshBasicMaterial({ map: M.cracks[2].map, transparent: true, color: 0xdff6ff, side: THREE.DoubleSide }));
    const back = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), new THREE.MeshBasicMaterial({ color: 0x6fd6b0, transparent: true, opacity: 0.16, side: THREE.DoubleSide })); back.position.z = -0.001;
    const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(0.3, 0.3)), new THREE.LineBasicMaterial({ color: 0x7dffc8 }));
    const gr = new THREE.Group(); gr.add(back, pane, frame); put(gr, 0, 0, 0, 0.35); view = [0, 0.05, 1.3];
  } else if (item === 'glove' || item === 'fist') {
    // настоящая рука игры: на время снимка переносим её в отдельную сцену
    const C = await import('/src/cosmetics.js'), h = g.hand, parent = h.group.parent;
    h.setSkin(C.cosmeticById(item === 'glove' ? 'glove_gold' : 'skin')); h.setAccessory(item === 'glove' ? C.cosmeticById('ring') : null, g.models);
    const keepCurl = h.curl; h.curl = item === 'fist' ? 1 : 0.15;
    h.wrist.set(0, 0, 0); h.quat.setFromEuler(new THREE.Euler(item === 'fist' ? -0.15 : -0.9, item === 'fist' ? 2.1 : 2.6, item === 'fist' ? 0.5 : 0, 'YXZ')); h.updateVisual(0);
    const hidden = h.group.children.filter((o) => o !== h.rig.root); for (const o of hidden) o.visible = false;   // рукав на иконке не нужен
    scene.add(h.group); h.group.updateMatrixWorld(true);
    if (item === 'fist') { const b = model('gold_bar', 'gold'); b.position.set(0, -0.04, -0.105); b.rotation.y = Math.PI / 2; h.group.add(b); window.__iconTmp = b; }
    const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 10), c = new THREE.Vector3(0, -0.01, -0.07).applyQuaternion(h.quat);
    cam.position.set(c.x + 0.05, c.y + 0.16, c.z + 0.5); cam.lookAt(c.x, c.y, c.z);
    R.r.render(scene, cam);
    const url = R.r.domElement.toDataURL('image/png');
    if (window.__iconTmp) { h.group.remove(window.__iconTmp); window.__iconTmp = null; }
    for (const o of hidden) o.visible = true;
    parent.add(h.group); h.curl = keepCurl; h.setSkin(C.cosmeticById(g.save.skin)); h.setAccessory(null); h.reset(g.level);
    return url;
  }
  // камера: предмет целиком в кадре
  const box = new THREE.Box3().setFromObject(group), c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3()).length();
  const cam = new THREE.PerspectiveCamera(28, 1, 0.01, 10), dir = new THREE.Vector3(...view).normalize();
  cam.position.copy(c).addScaledVector(dir, size * 1.75); cam.lookAt(c);
  R.r.render(scene, cam);
  return R.r.domElement.toDataURL('image/png');
}, [item, RENDER]);

const star = (cx, cy, r) => { const p = []; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.42 : r; p.push(`${(cx + Math.cos(a) * rr).toFixed(1)},${(cy + Math.sin(a) * rr).toFixed(1)}`); } return `<polygon points="${p.join(' ')}"/>`; };
const background = (tint) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">
  <defs><radialGradient id="g" cx="50%" cy="42%" r="70%"><stop offset="0" stop-color="#2b2418"/><stop offset="0.6" stop-color="#121013"/><stop offset="1" stop-color="#050506"/></radialGradient>
  <radialGradient id="t" cx="50%" cy="45%" r="55%"><stop offset="0" stop-color="${tint}" stop-opacity="0.28"/><stop offset="1" stop-color="${tint}" stop-opacity="0"/></radialGradient></defs>
  <rect width="${SIZE}" height="${SIZE}" fill="url(#g)"/><rect width="${SIZE}" height="${SIZE}" fill="url(#t)"/></svg>`);
const frame = (tint, stars) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">
  <rect x="5" y="5" width="${SIZE - 10}" height="${SIZE - 10}" rx="18" fill="none" stroke="${tint}" stroke-width="6"/>
  <rect x="12" y="12" width="${SIZE - 24}" height="${SIZE - 24}" rx="12" fill="none" stroke="${tint}" stroke-opacity="0.35" stroke-width="1.5"/>
  ${stars ? `<g fill="#ffc94a" stroke="#3a2a08" stroke-width="2.5" stroke-linejoin="round">${star(84, 212, 21)}${star(128, 206, 25)}${star(172, 212, 21)}</g>` : ''}</svg>`);
const bigStar = () => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}"><defs><linearGradient id="s" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="#fff2b8"/><stop offset="0.45" stop-color="#ffc94a"/><stop offset="1" stop-color="#b8771a"/></linearGradient></defs>
  <g fill="url(#s)" stroke="#3a2a08" stroke-width="4" stroke-linejoin="round">${star(128, 132, 86)}</g></svg>`);

for (const a of ACHIEVEMENTS) {
  const tint = TINT[a.icon.heist || 'none'];
  let layer;
  if (a.icon.item === 'star') layer = bigStar();
  else {
    const url = await renderItem(a.icon.item);
    const inner = a.icon.stars ? 176 : 208;
    layer = await sharp(Buffer.from(url.split(',')[1], 'base64')).trim().resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  }
  const top = a.icon.item === 'star' ? 0 : a.icon.stars ? 14 : Math.round((SIZE - 208) / 2);
  const left = a.icon.item === 'star' ? 0 : Math.round((SIZE - (a.icon.stars ? 176 : 208)) / 2);
  const color = await sharp(background(tint)).composite([{ input: layer, left, top }, { input: frame(tint, a.icon.stars) }]).png().toBuffer();
  await sharp(color).toFile(join(OUT, `${a.id}.png`));
  await sharp(color).greyscale().linear(0.55, 6).png().toFile(join(OUT, `${a.id}_locked.png`));
  console.log('  иконка', a.id);
}
// общий лист для просмотра
const cols = 6, rowsN = Math.ceil(ACHIEVEMENTS.length / cols);
await sharp({ create: { width: cols * SIZE, height: rowsN * SIZE * 2, channels: 3, background: '#000000' } })
  .composite(ACHIEVEMENTS.flatMap((a, i) => [{ input: join(OUT, `${a.id}.png`), left: (i % cols) * SIZE, top: Math.floor(i / cols) * SIZE * 2 }, { input: join(OUT, `${a.id}_locked.png`), left: (i % cols) * SIZE, top: Math.floor(i / cols) * SIZE * 2 + SIZE }]))
  .png().toFile(join(OUT, '_sheet.png'));
await browser.close(); server.close();
console.log(`Готово: ${ACHIEVEMENTS.length * 2} файлов в docs/steam/achievements/`);
