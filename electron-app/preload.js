// Пустой preload с изолированным контекстом — сайт открывается как есть,
// без доступа к Node.js API (безопаснее). Если позже понадобится
// прокидывать что-то из Electron в сайт (например, версию приложения
// для баннера обновлений), это делается здесь через contextBridge.
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('ytmetricsDesktop', {
  isDesktopApp: true,
});
