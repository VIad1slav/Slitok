// Геометрическая проверка уровней (без браузера): отверстие пропускает руку и кулак со слитком,
// слиток достижим, «ловушка для обезьян» действительно не пускает слиток поперёк.
//   node tools/check_levels.mjs
import { LEVELS } from '../src/levels.js';
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

let failed = 0, lastStack = [0, 0];
for (const lvl of LEVELS) {
  const problems = [], notes = [];
  // проверяется первый предмет добычи уровня (на нынешних уровнях он один)
  const item = levelLoot(lvl).find((it) => it.role === 'target');
  const [barL, barH, barW] = LOOT[item.type].bounds;
  const stackH = palmTop + Math.max(G.palm[0].r + barH, fingersLow);           // кулак с предметом под ладонью
  const stackW = Math.max(palmW, barW);
  lastStack = [stackW, stackH];
  const [w, h, d] = lvl.box.size;
  for (const hole of lvl.box.holes) {
    const f = wallFrame(hole.wall, lvl.box.size), [a, b] = holeExtents(hole), [ou, ov] = hole.offset;
    const circle = hole.shape === 'circle';
    if (Math.abs(ou) + a > f.U / 2 - 0.015 || Math.abs(ov) + b > f.V / 2 - 0.015) problems.push('отверстие выходит за стенку');
    const minDim = 2 * Math.min(a, b);
    if (minDim < forearmD + MARGIN) problems.push(`рука не пролезает: ${minDim.toFixed(3)} < ${(forearmD + MARGIN).toFixed(3)}`);
    if (hole.wall === 'top') {
      // сверху слиток вынимается «клешнёй», поперёк предплечья
      if (2 * a < barL + 0.03 || 2 * b < barW + 0.06) problems.push('слиток не проходит в верхнее отверстие');
      notes.push(`сверху ${(2 * a).toFixed(2)}×${(2 * b).toFixed(2)}`);
    } else {
      // сбоку слиток вынимается вдоль предплечья, под ладонью
      if (lvl.blocked === 'flat') {
        // предмет должен проходить только ребром (кисть повёрнута на 90°): плашмя — нет, ребром — да
        if (2 * a >= stackW + MARGIN) problems.push('ловушка не работает: предмет проходит плашмя');
        const edgeW = 2 * palmTop + barH, edgeH = Math.max(barL, palmW);
        if (2 * a < edgeW + MARGIN || 2 * b < edgeH + MARGIN) problems.push(`ребром (${edgeW.toFixed(3)}×${edgeH.toFixed(3)}) предмет не проходит`);
        notes.push('только ребром');
      } else {
        const fits = circle ? 2 * a >= Math.hypot(stackW, stackH) + MARGIN : 2 * a >= stackW + MARGIN && 2 * b >= stackH + MARGIN;
        if (!fits) problems.push(`кулак с предметом (${stackW.toFixed(3)}×${stackH.toFixed(3)}) не проходит`);
      }
      const crossFits = 2 * a >= barL + MARGIN;
      if (lvl.monkey && crossFits) problems.push('ловушка для обезьян не работает: слиток проходит поперёк');
      // досягаемость: расстояние от плоскости отверстия до центра слитка
      const [bx, , bz] = item.pos;
      const depth = hole.wall === 'right' ? w / 2 - bx : hole.wall === 'left' ? w / 2 + bx : hole.wall === 'front' ? d / 2 - bz : d / 2 + bz;
      if (depth > reach) problems.push(`слиток слишком глубоко: ${depth.toFixed(3)} > ${reach.toFixed(3)}`);
      // слиток лежит на уровне отверстия
      const barTop = item.pos[1] + barH, holeLow = h / 2 + ov - b, holeHigh = h / 2 + ov + b;
      if (barTop + palmTop * 2 + 0.01 > holeHigh || barTop - barH - 0.06 > holeLow) notes.push('слиток надо приподнять/опустить к отверстию');
      notes.push(`${hole.wall} ${circle ? '⌀' + (2 * a).toFixed(3) : (2 * a).toFixed(2) + '×' + (2 * b).toFixed(2)}, глубина ${depth.toFixed(2)}${lvl.monkey ? ', поперёк не лезет' : ''}`);
    }
  }
  const [sx, sz] = lvl.safe.pos, r = lvl.safe.radius;
  if (Math.abs(sx) + r > WORLD.tableSize[0] / 2 || Math.abs(sz) + r > WORLD.tableSize[2] / 2) problems.push('«сейф» выходит за край стола');
  if (Math.abs(sx - lvl.box.pos[0]) < w / 2 + r && Math.abs(sz - lvl.box.pos[1]) < d / 2 + r) problems.push('«сейф» пересекается с коробкой');
  if (lvl.stars.three.time > lvl.stars.two.time) problems.push('условия звёзд перепутаны');
  if (problems.length) failed++;
  console.log(`${problems.length ? ' FAIL ' : '  ok  '} уровень ${lvl.id} «${lvl.name}»: ${problems.length ? problems.join('; ') : notes.join('; ')}`);
}
// кампания: каждый уровень стоит ровно в одном ограблении, id не повторяются
const ids = LEVELS.map((l) => l.id), placed = HEISTS.flatMap((h) => h.levels);
const dup = ids.filter((id, i) => ids.indexOf(id) !== i), twice = placed.filter((id, i) => placed.indexOf(id) !== i);
const lost = ids.filter((id) => !placed.includes(id)), ghost = placed.filter((id) => !ids.includes(id));
const campaignProblems = [dup.length && `повторяются id ${dup}`, twice.length && `уровни ${twice} стоят в двух ограблениях`, lost.length && `уровни ${lost} не входят ни в одно ограбление`, ghost.length && `в ограблениях есть несуществующие уровни ${ghost}`].filter(Boolean);
if (campaignProblems.length) failed++;
console.log(`${campaignProblems.length ? ' FAIL ' : '  ok  '} кампания: ${campaignProblems.length ? campaignProblems.join('; ') : `${campaignOrder().length} уровней в ${HEISTS.filter((h) => h.levels.length).length} ограблениях`}`);
const [stackW, stackH] = lastStack;
console.log(`\nКулак с предметом последнего уровня: ${stackW.toFixed(3)} × ${stackH.toFixed(3)} м, предплечье ⌀${forearmD.toFixed(3)} м, досягаемость ${reach.toFixed(3)} м`);
process.exit(failed ? 1 : 0);
