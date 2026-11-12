// Косметика руки — только данные. Открывается по сумме звёзд (ничего не хранится в сохранении:
// что открыто, каждый раз считается из рекордов).
//
// kind: 'hand'      — вид самой руки (кожа или перчатка); выбран всегда ровно один
//       'accessory' — украшение поверх любой руки (кольцо, часы); можно снять
// material — имя материала из src/textures.js; tint — необязательная подкраска (цвет 0xRRGGBB)
// unlockStars — сколько звёзд всего нужно
// Названия — в словарях src/i18n/ (ключ cosmetic.<id>).

export const COSMETICS = [
  { id: 'skin', kind: 'hand', material: 'skin', unlockStars: 0 },
  { id: 'glove', kind: 'hand', material: 'glove', unlockStars: 0 },
  { id: 'glove_red', kind: 'hand', material: 'gloveLight', tint: 0x8c1512, unlockStars: 10 },
  { id: 'glove_white', kind: 'hand', material: 'gloveLight', tint: 0xd9d5c9, unlockStars: 22 },
  { id: 'glove_green', kind: 'hand', material: 'gloveLight', tint: 0x0f6b3c, unlockStars: 62 },
  { id: 'glove_gold', kind: 'hand', material: 'gloveLight', tint: 0xd8a032, unlockStars: 90 },
  // Украшения: модель из assets/models, прикреплена к кости руки (bone). fallback — запасной тор, если модели нет:
  // { radius, tube, pos, rot (градусы), scale } в координатах кисти (-Z вперёд, +Y тыльная сторона).
  { id: 'ring', kind: 'accessory', model: 'ring', bone: 'ring_01', unlockStars: 34,
    fallback: { radius: 0.0108, tube: 0.0022, pos: [0.0131, -0.0022, -0.1143], rot: [0, 0, 0], scale: [1, 1, 1], material: 'brass' } },
  { id: 'watch', kind: 'accessory', model: 'watch', bone: 'forearm', unlockStars: 48,
    fallback: { radius: 0.027, tube: 0.005, pos: [0, 0, 0.035], rot: [0, 0, 0], scale: [1.06, 0.78, 1], material: 'metal' } },
];

export const cosmeticById = (id) => COSMETICS.find((c) => c.id === id) || COSMETICS[0];

/** Варианты данного вида, открытые при таком числе звёзд. */
export const unlockedCosmetics = (kind, stars) => COSMETICS.filter((c) => c.kind === kind && stars >= c.unlockStars);
