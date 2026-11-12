// Общий счётчик загрузки: через него идут все текстуры и модели, экран загрузки показывает его прогресс.
import * as THREE from 'three';

export const manager = new THREE.LoadingManager();

let best = 0;
/** Сообщать о прогрессе загрузки: fn(доля 0..1). Доля не убывает, даже если в очередь добавились новые файлы. */
export function onLoadProgress(fn) {
  manager.onProgress = (url, loaded, total) => { best = Math.max(best, total ? loaded / total : 0); fn(best); };
}
