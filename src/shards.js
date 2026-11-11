// Осколки разбитой добычи (вазы): простые частицы без физики — летят, падают на стол и замирают.
import * as THREE from 'three';
import { WORLD } from './config.js';

const _dummy = new THREE.Object3D();

/**
 * @param center мировой центр предмета, @param bounds его габариты [x, y, z], @param color цвет осколков
 * @returns { update(dt), dispose() }
 */
export function spawnShards(scene, center, bounds, color, count = 70) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.3, 0, 0.5, -0.2, 0, 0.1, 0.6, 0]), 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.25, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.8 });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.frustumCulled = false;
  const parts = [];
  for (let i = 0; i < count; i++) {
    const p = new THREE.Vector3((Math.random() - 0.5) * bounds[0], (Math.random() - 0.5) * bounds[1], (Math.random() - 0.5) * bounds[2]);
    parts.push({
      v: p.clone().setY(0).normalize().multiplyScalar(0.2 + Math.random() * 0.9).add(new THREE.Vector3(0, 0.3 + Math.random() * 0.9, 0)),
      p: p.add(center),
      r: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6),
      w: new THREE.Vector3((Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16),
      s: 0.008 + Math.random() * 0.022, rest: false,
    });
  }
  scene.add(mesh);
  return {
    update(dt) {
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
        _dummy.position.copy(s.p); _dummy.rotation.copy(s.r); _dummy.scale.setScalar(s.s); _dummy.updateMatrix();
        mesh.setMatrixAt(i, _dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
    dispose() { scene.remove(mesh); geo.dispose(); mat.dispose(); },
  };
}
