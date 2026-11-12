// Загрузка моделей из Blender (assets/models/*.glb). Любая модель может отсутствовать —
// тогда соответствующий модуль строит запасную геометрию из примитивов.
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const MODEL_DIR = './assets/models/';
const NAMES = ['hand', 'gold_bar', 'glass_box', 'table', 'pedestal', 'room', 'vase', 'crown', 'camera', 'set_bank', 'set_museum', 'coins', 'weight', 'shutter', 'chips', 'dice', 'diamond', 'set_casino', 'ring', 'watch', 'set_pawnshop', 'set_boss'];

export async function loadModels(onProgress) {
  const loader = new GLTFLoader();
  const out = {}, missing = [];
  let done = 0;
  await Promise.all(NAMES.map(async (name) => {
    try {
      const gltf = await loader.loadAsync(`${MODEL_DIR}${name}.glb`);
      out[name] = gltf.scene;
    } catch {
      out[name] = null; missing.push(name);
    }
    onProgress?.(++done / NAMES.length);
  }));
  return { models: out, missing };
}
