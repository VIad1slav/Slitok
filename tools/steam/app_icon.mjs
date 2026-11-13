// Иконка приложения из ассетов игры: слиток, отрисованный движком (та же картинка, что у первого достижения).
//   node tools/steam/achievement_icons.mjs   — сначала рисуются иконки достижений
//   node tools/steam/app_icon.mjs            — из них собираются electron/icon.ico и electron/icon.png
// ICO собирается вручную: внутри него обычные PNG нескольких размеров (так умеет Windows начиная с Vista).
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(ROOT, 'docs', 'steam', 'achievements', 'HEIST_PAWNSHOP.png');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

const pngs = await Promise.all(SIZES.map((s) => sharp(SRC).resize(s, s, { kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toBuffer()));
const header = Buffer.alloc(6 + 16 * SIZES.length);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(SIZES.length, 4);
let offset = header.length;
SIZES.forEach((s, i) => {
  const e = 6 + 16 * i;
  header.writeUInt8(s === 256 ? 0 : s, e); header.writeUInt8(s === 256 ? 0 : s, e + 1);   // 0 означает 256
  header.writeUInt8(0, e + 2); header.writeUInt8(0, e + 3);
  header.writeUInt16LE(1, e + 4); header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(pngs[i].length, e + 8); header.writeUInt32LE(offset, e + 12);
  offset += pngs[i].length;
});
writeFileSync(join(ROOT, 'electron', 'icon.ico'), Buffer.concat([header, ...pngs]));
await sharp(SRC).resize(256, 256).png().toFile(join(ROOT, 'electron', 'icon.png'));
await sharp(SRC).resize(512, 512, { kernel: 'lanczos3' }).png().toFile(join(ROOT, 'electron', 'icon-512.png'));
console.log(`electron/icon.ico (${SIZES.join(', ')} пикс.), electron/icon.png`);
