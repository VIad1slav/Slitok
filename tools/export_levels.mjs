// Выгружает параметры уровней и мира из src/*.js в tools/blender/levels.json,
// чтобы Blender строил стеклянные коробки и комнату по тем же числам, что и игра.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { playable } from '../src/levels.js';
import { GLASS, WORLD } from '../src/config.js';
import { LOOT } from '../src/loot-types.js';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'blender', 'levels.json');
const data = {
  levels: playable().map((l) => ({ id: l.glassId ?? l.id, name: l.name, box: l.box })),   // этапы финала — отдельными коробками
  bar: { size: LOOT.bar.bounds, topScale: LOOT.bar.topScale },
  glass: { thickness: GLASS.thickness },
  world: { tableY: WORLD.tableY, tableSize: WORLD.tableSize, room: WORLD.room, spot: WORLD.spot, spotTarget: [-0.05, WORLD.tableY, -0.08] },
};
writeFileSync(out, JSON.stringify(data, null, 2));
console.log(`levels.json: ${data.levels.length} уровней → ${out}`);
