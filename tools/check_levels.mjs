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
const fingerReach = Math.max(...G.fingers.map((s) => -s.open[2])) + G.pivot[2];   // от центра ладони до кончиков прямых пальцев
const MIN_CIRCLE = (forearmD + MARGIN) / 2;                                   // наименьший радиус круглого отверстия: пролезает предплечье

/**
 * Как глубоко за стенку заходит центр ладони на уровне с пределом досягаемости от плеча (поле reach.max).
 * Рука идёт по оси отверстия на высоте y; меньшее из двух: предел от плеча и длина предплечья.
 */
function palmDepth(lvl, hole, y) {
  if (!lvl.reach || hole.wall !== 'front') return reach;
  const [sx, sy, sz] = WORLD.shoulder, x = lvl.box.pos[0] + hole.offset[0], wallZ = lvl.box.pos[1] + lvl.box.size[2] / 2;
  const d2 = lvl.reach.max ** 2 - (x - sx) ** 2 - (y - sy) ** 2;
  return d2 > 0 ? Math.min(reach, wallZ - (sz - Math.sqrt(d2))) : -1;
}

let failed = 0;
for (const lvl of playable()) {
  const problems = [], notes = [];
  const [w, h, d] = lvl.box.size;
  const label = lvl.stage ? `уровень ${lvl.id}, этап ${lvl.stage} «${levelName(lvl)}»` : `уровень ${lvl.id} «${levelName(lvl)}»`;

  // --- отверстия: в пределах стенки, рука пролезает
  lvl.box.holes.forEach((hole, i) => {
    const f = wallFrame(hole.wall, lvl.box.size), [a, b] = holeExtents(hole), [ou, ov] = hole.offset;
    if (Math.abs(ou) + a > f.U / 2 - 0.015 || Math.abs(ov) + b > f.V / 2 - 0.015) problems.push(`отверстие ${i} выходит за стенку`);
    if (2 * Math.min(a, b) < forearmD + MARGIN) problems.push(`в отверстие ${i} не пролезает рука${hole.shape === 'circle' ? ` (радиус ${a.toFixed(3)} меньше ${MIN_CIRCLE.toFixed(3)})` : ''}`);
  });
  if (lvl.reach && lvl.box.holes[0].wall !== 'front') problems.push('предел досягаемости (reach) проверяется только для отверстия в передней стенке');
  if (lvl.fatigue && !lvl.reach) notes.push('усталость без предела досягаемости');

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
      let how = '';
      if (lvl.reach) {
        // Уровень с пределом досягаемости: ладонь может не доставать до середины предмета — тогда его берут пальцами
        // за ближний край и подтягивают. Достаточно, чтобы кончики пальцев заходили на предмет хотя бы на 2 см.
        const ped = lvl.pedestal ? lvl.pedestal.size[1] : 0, yHand = WORLD.tableY + ped + itemH + G.palm[0].r;
        const palm = palmDepth(lvl, hole, yHand);
        const yawAlong = Math.abs(Math.cos(((item.yaw || 0) * Math.PI) / 180)) < 0.5;      // предмет лежит длинной стороной вдоль руки
        const near = depth - (yawAlong ? itemL : itemW) / 2;                               // ближний к отверстию край
        if (palm < 0) problems.push(`предел досягаемости ${lvl.reach.max} м не доходит даже до стенки`);
        else if (near + 0.02 > palm + fingerReach) problems.push(`${lootName(type)}: не достать даже пальцами — ближний край на глубине ${near.toFixed(3)}, пальцы достают до ${(palm + fingerReach).toFixed(3)}`);
        how = palm >= depth ? `, ладонь достаёт (до ${palm.toFixed(2)} м)` : `, ладонь достаёт до ${palm.toFixed(2)} м — только пальцами (до ${(palm + fingerReach).toFixed(2)} м), подтянуть на ${(depth - palm + 0.03).toFixed(2)} м`;
      } else if (depth > reach) problems.push(`${lootName(type)}: слишком глубоко, ${depth.toFixed(3)} > ${reach.toFixed(3)}`);
      if (!seen.has(key)) notes.push(`${lootName(type)} — ${hole.wall} ${size}, глубина ${depth.toFixed(2)}${how}${lvl.monkey ? ', поперёк не лезет' : ''}${lvl.blocked === 'flat' ? ', только ребром' : ''}${lvl.fatigue ? ', усталость' : ''}`);
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
