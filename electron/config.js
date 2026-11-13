// Настройки настольной версии — в одном месте.
module.exports = {
  productName: 'Golden Grab',       // название окна, exe и папки с данными игрока
  saveFolder: 'saves',              // подпапка в папке данных: сохранение и настройки (её отдают в Steam Auto-Cloud)

  // --- Steam
  // steamAppId — App ID игры из Steamworks. ПОКА ЗДЕСЬ ТЕСТОВЫЙ 480 (Spacewar): перед загрузкой сборки в Steam
  // сюда надо вписать настоящий номер. steamDevAppId — что используется при запуске из исходников.
  steamAppId: 480,
  steamDevAppId: 480,
  // Оверлей Steam (Shift+Tab). Включается, только если Steam найден при запуске. В Electron он работает нестабильно;
  // если мешает (чёрный экран, просадка кадров) — поставить false, на игру это не влияет.
  steamOverlay: true,
};
