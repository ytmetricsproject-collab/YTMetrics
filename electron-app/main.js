const { app, BrowserWindow, Menu, shell, session } = require('electron');
const path = require('path');

// ═══════════════════════════════════════════════════════════════════
// Адрес вашего сайта. Меняйте здесь, если фактический продакшн-домен
// отличается (сейчас взято из index.js: APP_URL).
// ═══════════════════════════════════════════════════════════════════
const APP_URL = process.env.YTMETRICS_URL || 'https://jakjuk523.github.io/youtube-analytics';

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadURL(APP_URL);

  // Внешние ссылки (не сам сайт) — открывать в обычном браузере,
  // а не создавать новое окно Electron.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(APP_URL)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(new URL(APP_URL).origin)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  Menu.setApplicationMenu(null);
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
