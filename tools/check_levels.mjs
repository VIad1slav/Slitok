// Геометрическая проверка уровней (без браузера): отверстие пропускает руку и кулак с предметом,
// предмет достижим, «ловушки для обезьян» действительно не пускают предмет неправильной стороной,
// перегородки и «сейф» стоят корректно, кампания собрана без дыр.
//   node tools/check_levels.mjs
// Этапы многоэтапного уровня проверяются как отдельные уровни. Каждый предмет добычи проверяется
// против своего отверстия (поле via у предмета, по умолчанию — первое отверстие коробки).
import { levelName, levelHint, heistName, lootName } from '../src/i18n/index.js';
import { LEVELS, playable } from '../src/levels.js';
import { HAND_GEOM as G, WORLD } from '../src/config.js';
import { LOOT, levelLoot } from '../src/loot-types.js';
import { HEISTS, campaignOrder } from '../src/heists.js';

// размеры стенки в её плоскости (как wallFrame() в src/box.js, но без three.js)
const wallFrame = (wall, [w, h, d]) => (wall === 'top' ? { U: w, V: d } : wall === 'front' || wall === 'back' ? { U: w, V: h } : { U: d, V: h });
const holeExtents = (hole) => (hole.shape === 'circle' ? [hole.radius, hole.radius] : [hole.size[0] / 2, hole.size[1] / 2]);

const MARGIN = 0.008;
const forearmD = 2 * G.forearm.r1;                                           // самое толстое место предплечья
const palmW = 2 * (Math.max(...G.palm.map((s) => Math.abs(s.p[0]))) + G.palm[0].r);
const palmTop = G.palm[0].r;                                                 // верх ладони над линией запястья
const fingersLow = Math.max(...G.fingers.map((s) => -s.closed[1] + s.r));    // низ согнутых пальцев под линией запястья
const reach = G.forearmLength - G.upperArm.r + -G.pivot[2];                  // как глубоко центр ладони заходит за стенку

let failed = 0;
for (const lvl of playable()) {
  const problems = [], notes = [];
  const [w, h, d] = lvl.box.size;
  const label = lvl.stage ? `уровень ${lvl.id}, этап ${lvl.stage} «${levelName(lvl)}»` : `уровень ${lvl.id} «${levelName(lvl)}»`;

  // --- отверстия: в пределах стенки, рука пролезает
  lvl.box.holes.forEach((hole, i) => {
    const f = wallFrame(hole.wall, lvl.box.size), [a, b] = holeExtents(hole), [ou, ov] = hole.offset;
    if (Math.abs(ou) + a > f.U / 2 - 0.015 || Math.abs(ov) + b > f.V / 2 - 0.015) problems.push(`отверстие ${i} выходит за стенку`);
    if (2 * Math.min(a, b) < forearmD + MARGIN) problems.push(`в отверстие ${i} не пролезает рука`);
  });

  // --- каждый предмет добычи — против своего отверстия
  const seen = new Set();
  for (const item of levelLoot(lvl).filter((it) => it.role === 'target')) {
    const key = `${item.type}/${item.via ?? 0}`;
    const hole = lvl.box.holes[item.via ?? 0], type = LOOT[item.type];
    const [itemL, itemH, itemW] = type.bounds;
    const stackH = palmTop + Math.max(G.palm[0].r + itemH, fingersLow);      // кулак с предметом под ладонью
    const stackW = Math.max(palmW, itemW);
    const [a, b] = holeExtents(hole), [, ov] = hole.offset, circle = hole.shape === 'circle';
    const size = circle ? '⌀' + (2 * a).toFixed(3) : (2 * a).toFixed(2) + '×' + (2 * b).toFixed(2);
    if (hole.wall === 'top') {
      // сверху предмет вынимается «клешнёй», поперёк предплечья
      if (2 * a < itemL + 0.03 || 2 * b < itemW + 0.06) problems.push(`${lootName(type)}: не проходит в верхнее отверстие`);
      if (!seen.has(key)) notes.push(`${lootName(type)} — сверху ${size}`);
    } else {
      // сбоку предмет вынимается вдоль предплечья, под ладонью
      if (lvl.blocked === 'flat') {
        // предмет должен проходить только ребром (кисть повёрнута на 90°): плашмя — нет, ребром — да
        if (2 * a >= stackW + MARGIN) problems.push(`${lootName(type)}: ловушка не работает, проходит плашмя`);
        const edgeW = 2 * palmTop + itemH, edgeH = Math.max(itemL, palmW);
        if (2 * a < edgeW + MARGIN || 2 * b < edgeH + MARGIN) problems.push(`${lootName(type)}: ребром (${edgeW.toFixed(3)}×${edgeH.toFixed(3)}) не проходит`);
      } else {
        const fits = circle ? 2 * a >= Math.hypot(stackW, stackH) + MARGIN : 2 * a >= stackW + MARGIN && 2 * b >= stackH + MARGIN;
        if (!fits) problems.push(`${lootName(type)}: кулак с предметом (${stackW.toFixed(3)}×${stackH.toFixed(3)}) не проходит`);
      }
      if (lvl.monkey && 2 * a >= itemL + MARGIN) problems.push(`${lootName(type)}: ловушка для обезьян не работает, проходит поперёк`);
      // досягаемость: расстояние от плоскости отверстия до центра предмета
      const [bx, , bz] = item.pos;
      const depth = hole.wall === 'right' ? w / 2 - bx : hole.wall === 'left' ? w / 2 + bx : hole.wall === 'front' ? d / 2 - bz : d / 2 + bz;
      if (depth > reach) problems.push(`${lootName(type)}: слишком глубоко, ${depth.toFixed(3)} > ${reach.toFixed(3)}`);
      if (!seen.has(key)) notes.push(`${lootName(type)} — ${hole.wall} ${size}, глубина ${depth.toFixed(2)}${lvl.monkey ? ', поперёк не лезет' : ''}${lvl.blocked === 'flat' ? ', только ребром' : ''}`);
      void ov;
    }
    seen.add(key);
  }
  if (!levelLoot(lvl).some((it) => it.role === 'target')) problems.push('на уровне нет добычи');

  // --- внутренние перегородки: внутри коробки, не выше её, окно — внутри панели
  (lvl.box.inner || []).forEach((p, i) => {
    const along = p.axis === 'x' ? w : d, across = p.axis === 'x' ? d : w;
    if (p.from < -along / 2 - 1e-6 || p.to > along / 2 + 1e-6 || p.from >= p.to || Math.abs(p.at) > across / 2 - 0.02 || p.height > h + 1e-6) problems.push(`перегородка ${i} выходит за коробку`);
    if (p.hole) {
      const [a, b] = holeExtents(p.hole), [ou, ov] = p.hole.offset;
      if (Math.abs(ou) + a > (p.to - p.from) / 2 - 0.015 || Math.abs(ov) + b > p.height / 2 - 0.015) problems.push(`окно перегородки ${i} выходит за панель`);
      if (2 * Math.min(a, b) < forearmD + MARGIN) problems.push(`в окно перегородки ${i} не пролезает рука`);
    }
    notes.push(p.hole ? 'перегородка с окном' : `барьер ${(p.height * 100).toFixed(0)} см`);
  });

  // --- «сейф» и звёзды
  const [sx, sz] = lvl.safe.pos, r = lvl.safe.radius;
  if (Math.abs(sx) + r > WORLD.tableSize[0] / 2 || Math.abs(sz) + r > WORLD.tableSize[2] / 2) problems.push('«сейф» выходит за край стола');
  if (Math.abs(sx - lvl.box.pos[0]) < w / 2 + r && Math.abs(sz - lvl.box.pos[1]) < d / 2 + r) problems.push('«сейф» пересекается с коробкой');
  if (lvl.stars.three.time > lvl.stars.two.time) problems.push('условия звёзд перепутаны');
  if (lvl.timeLimit && lvl.stars.two.time > lvl.timeLimit) problems.push('две звезды недостижимы: порог больше лимита времени');
  if (levelHint(lvl).startsWith('level.')) problems.push('нет подсказки');

  if (problems.length) failed++;
  console.log(`${problems.length ? ' FAIL ' : '  ok  '} ${label}: ${problems.length ? problems.join('; ') : notes.join('; ')}`);
}

// кампания: каждый уровень стоит ровно в одном ограблении, id не повторяются
const ids = LEVELS.map((l) => l.id), placed = HEISTS.flatMap((h) => h.levels);
const dup = ids.filter((id, i) => ids.indexOf(id) !== i), twice = placed.filter((id, i) => placed.indexOf(id) !== i);
const lost = ids.filter((id) => !placed.includes(id)), ghost = placed.filter((id) => !ids.includes(id));
const campaignProblems = [dup.length && `повторяются id ${dup}`, twice.length && `уровни ${twice} стоят в двух ограблениях`, lost.length && `уровни ${lost} не входят ни в одно ограбление`, ghost.length && `в ограблениях есть несуществующие уровни ${ghost}`].filter(Boolean);
if (campaignProblems.length) failed++;
console.log(`${campaignProblems.length ? ' FAIL ' : '  ok  '} кампания: ${campaignProblems.length ? campaignProblems.join('; ') : `${campaignOrder().length} уровней в ${HEISTS.filter((h) => h.levels.length).length} ограблениях: ${HEISTS.map((h) => `${heistName(h)} ${h.levels.length}`).join(', ')}`}`);
console.log(`\nРука: ладонь ${palmW.toFixed(3)} м, предплечье ⌀${forearmD.toFixed(3)} м, досягаемость за стенку ${reach.toFixed(3)} м`);
process.exit(failed ? 1 : 0);
