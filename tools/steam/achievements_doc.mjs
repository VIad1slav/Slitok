// Собирает docs/steam_achievements.md — таблицу достижений для заведения в Steamworks:
//   node tools/steam/achievements_doc.mjs
// Имена (API Name) берутся из src/achievements.js, названия и описания — из словарей src/i18n/.
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACHIEVEMENTS, NO_TOUCH_LEVEL, SPEED_SECONDS, GLASS_BREAKS } from '../../src/achievements.js';
import en from '../../src/i18n/en.js';
import ru from '../../src/i18n/ru.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const rows = ACHIEVEMENTS.map((a, i) => `| ${i + 1} | \`${a.id}\` | ${en[`ach.${a.id}.name`]} | ${en[`ach.${a.id}.desc`]} | ${ru[`ach.${a.id}.name`]} | ${ru[`ach.${a.id}.desc`]} | \`${a.id}.png\` / \`${a.id}_locked.png\` |`);
const md = `# Достижения Steam

Таблица для заведения в Steamworks (раздел «Stats & Achievements»). Собрана командой
\`node tools/steam/achievements_doc.mjs\` из \`src/achievements.js\` и словарей \`src/i18n/\` — руками не правится.

- **API Name** вписывается в Steamworks буква в букву: игра отправляет именно его. После публикации менять нельзя.
- Иконки 256×256 лежат в \`docs/steam/achievements/\`: цветная — «получено», серая (\`_locked\`) — «не получено».
  Перерисовать: \`node tools/steam/achievement_icons.mjs\`.
- Все достижения обычные (не скрытые). Статистика Steam (Stats) не нужна: счётчики игра ведёт сама в сохранении.
- Всего достижений: ${ACHIEVEMENTS.length}.

| № | API Name | Name (EN) | Description (EN) | Название (RU) | Описание (RU) | Иконки |
| --- | --- | --- | --- | --- | --- | --- |
${rows.join('\n')}

## Точные условия

- \`HEIST_*\` — пройден каждый из 8 уровней ограбления (любое число звёзд).
- \`STARS_*\` — на каждом из 8 уровней ограбления по 3 звезды.
- \`ALL_LEVELS\` — пройдены все 40 уровней; \`ALL_STARS\` — 120 звёзд из 120.
- \`ALL_COSMETICS\` — набрано столько звёзд, сколько требует самая дорогая косметика (сейчас 90).
- \`MONKEY_TRAP\` — пройден уровень 3 «Ловушка для обезьян».
- \`NO_TOUCH\` — уровень ${NO_TOUCH_LEVEL} «Джекпот» пройден с нулём касаний стекла.
- \`SPEEDRUN\` — любой уровень пройден быстрее ${SPEED_SECONDS} секунд.
- \`BREAK_VASE\` — ваза разбита (на любом уровне).
- \`GLASS_BREAKER\` — стекло коробки разбито ${GLASS_BREAKS} раз за всё время игры.

Достижения, которые зависят от прогресса, выдаются и задним числом: при каждом запуске игра сверяет сохранение
и заново отправляет в Steam всё полученное. Если играть без Steam, достижения копятся в сохранении и уйдут
в Steam при первом запуске с ним.
`;
writeFileSync(join(ROOT, 'docs', 'steam_achievements.md'), md);
console.log(`docs/steam_achievements.md: достижений ${ACHIEVEMENTS.length}`);
