# Достижения Steam

Таблица для заведения в Steamworks (раздел «Stats & Achievements»). Собрана командой
`node tools/steam/achievements_doc.mjs` из `src/achievements.js` и словарей `src/i18n/` — руками не правится.

- **API Name** вписывается в Steamworks буква в букву: игра отправляет именно его. После публикации менять нельзя.
- Иконки 256×256 лежат в `docs/steam/achievements/`: цветная — «получено», серая (`_locked`) — «не получено».
  Перерисовать: `node tools/steam/achievement_icons.mjs`.
- Все достижения обычные (не скрытые). Статистика Steam (Stats) не нужна: счётчики игра ведёт сама в сохранении.
- Всего достижений: 18.

| № | API Name | Name (EN) | Description (EN) | Название (RU) | Описание (RU) | Иконки |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `HEIST_PAWNSHOP` | Small-Time | Complete every level of the Pawnshop. | Мелкая сошка | Пройди все уровни Ломбарда. | `HEIST_PAWNSHOP.png` / `HEIST_PAWNSHOP_locked.png` |
| 2 | `HEIST_MUSEUM` | After Hours | Complete every level of the Museum. | После закрытия | Пройди все уровни Музея. | `HEIST_MUSEUM.png` / `HEIST_MUSEUM_locked.png` |
| 3 | `HEIST_BANK` | Cash Withdrawal | Complete every level of the Bank. | Снятие наличных | Пройди все уровни Банка. | `HEIST_BANK.png` / `HEIST_BANK_locked.png` |
| 4 | `HEIST_CASINO` | The House Loses | Complete every level of the Casino. | Казино проигрывает | Пройди все уровни Казино. | `HEIST_CASINO.png` / `HEIST_CASINO_locked.png` |
| 5 | `HEIST_BOSS` | Nothing Personal | Complete every level of The Boss's Safe. | Ничего личного | Пройди все уровни Сейфа босса. | `HEIST_BOSS.png` / `HEIST_BOSS_locked.png` |
| 6 | `STARS_PAWNSHOP` | Top of the Class | Earn three stars on every Pawnshop level. | Отличник ломбарда | Получи три звезды на каждом уровне Ломбарда. | `STARS_PAWNSHOP.png` / `STARS_PAWNSHOP_locked.png` |
| 7 | `STARS_MUSEUM` | Art Connoisseur | Earn three stars on every Museum level. | Ценитель искусства | Получи три звезды на каждом уровне Музея. | `STARS_MUSEUM.png` / `STARS_MUSEUM_locked.png` |
| 8 | `STARS_BANK` | Vault Manager | Earn three stars on every Bank level. | Управляющий хранилищем | Получи три звезды на каждом уровне Банка. | `STARS_BANK.png` / `STARS_BANK_locked.png` |
| 9 | `STARS_CASINO` | Fortune's Favourite | Earn three stars on every Casino level. | Любимец фортуны | Получи три звезды на каждом уровне Казино. | `STARS_CASINO.png` / `STARS_CASINO_locked.png` |
| 10 | `STARS_BOSS` | The New Boss | Earn three stars on every level of The Boss's Safe. | Новый босс | Получи три звезды на каждом уровне Сейфа босса. | `STARS_BOSS.png` / `STARS_BOSS_locked.png` |
| 11 | `ALL_LEVELS` | Clean Sweep | Complete all 40 levels. | Подчистую | Пройди все 40 уровней. | `ALL_LEVELS.png` / `ALL_LEVELS_locked.png` |
| 12 | `ALL_STARS` | Perfectionist | Earn all 120 stars. | Перфекционист | Получи все 120 звёзд. | `ALL_STARS.png` / `ALL_STARS_locked.png` |
| 13 | `ALL_COSMETICS` | Dressed to Steal | Unlock every glove and accessory. | Одет с иголочки | Открой все перчатки и украшения. | `ALL_COSMETICS.png` / `ALL_COSMETICS_locked.png` |
| 14 | `MONKEY_TRAP` | Smarter Than a Monkey | Complete the "Monkey Trap" level. | Умнее обезьяны | Пройди уровень «Ловушка для обезьян». | `MONKEY_TRAP.png` / `MONKEY_TRAP_locked.png` |
| 15 | `NO_TOUCH` | Surgeon's Hands | Complete "Jackpot" without touching the glass once. | Руки хирурга | Пройди «Джекпот», ни разу не задев стекло. | `NO_TOUCH.png` / `NO_TOUCH_locked.png` |
| 16 | `SPEEDRUN` | Smash and Grab | Complete any level in under 10 seconds. | Хватай и беги | Пройди любой уровень быстрее чем за 10 секунд. | `SPEEDRUN.png` / `SPEEDRUN_locked.png` |
| 17 | `BREAK_VASE` | Priceless. Was. | Break the vase. | Бесценная. Была | Разбей вазу. | `BREAK_VASE.png` / `BREAK_VASE_locked.png` |
| 18 | `GLASS_BREAKER` | Bull in a China Shop | Shatter the glass 10 times. | Слон в посудной лавке | Разбей стекло 10 раз. | `GLASS_BREAKER.png` / `GLASS_BREAKER_locked.png` |

## Точные условия

- `HEIST_*` — пройден каждый из 8 уровней ограбления (любое число звёзд).
- `STARS_*` — на каждом из 8 уровней ограбления по 3 звезды.
- `ALL_LEVELS` — пройдены все 40 уровней; `ALL_STARS` — 120 звёзд из 120.
- `ALL_COSMETICS` — набрано столько звёзд, сколько требует самая дорогая косметика (сейчас 90).
- `MONKEY_TRAP` — пройден уровень 3 «Ловушка для обезьян».
- `NO_TOUCH` — уровень 32 «Джекпот» пройден с нулём касаний стекла.
- `SPEEDRUN` — любой уровень пройден быстрее 10 секунд.
- `BREAK_VASE` — ваза разбита (на любом уровне).
- `GLASS_BREAKER` — стекло коробки разбито 10 раз за всё время игры.

Достижения, которые зависят от прогресса, выдаются и задним числом: при каждом запуске игра сверяет сохранение
и заново отправляет в Steam всё полученное. Если играть без Steam, достижения копятся в сохранении и уйдут
в Steam при первом запуске с ним.
