// Косметика руки — только данные. Открывается по сумме звёзд (ничего не хранится в сохранении:
// что открыто, каждый раз считается из рекордов).
//
// kind: 'hand'      — вид самой руки (кожа или перчатка); выбран всегда ровно один
//       'accessory' — украшение поверх любой руки (кольцо, часы); можно снять
// material — имя материала из src/textures.js; tint — необязательная подкраска (цвет 0xRRGGBB)
// unlockStars — сколько звёзд всего нужно

export const COSMETICS = [
  { id: 'skin', kind: 'hand', name: 'кожа', material: 'skin', unlockStars: 0 },
  { id: 'glove', kind: 'hand', name: 'чёрная перчатка', material: 'glove', unlockStars: 0 },
  { id: 'glove_red', kind: 'hand', name: 'красная перчатка', material: 'gloveLight', tint: 0x8c1512, unlockStars: 10 },
  { id: 'glove_white', kind: 'hand', name: 'белая перчатка музейщика', material: 'gloveLight', tint: 0xd9d5c9, unlockStars: 22 },
];

export const cosmeticById = (id) => COSMETICS.find((c) => c.id === id) || COSMETICS[0];

/** Варианты данного вида, открытые при таком числе звёзд. */
export const unlockedCosmetics = (kind, stars) => COSMETICS.filter((c) => c.kind === kind && stars >= c.unlockStars);
