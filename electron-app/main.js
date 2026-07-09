const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

// URL твоего рабочего сайта на Vercel (бэкенд остаётся там же, меняем только оболочку)
const APP_URL = process.env.APP_URL || 'https://yt-metrics-seven.vercel.app';
const PROTOCOL = 'ytmetrics';

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0d0f12',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(APP_URL);

  // Перехватываем переход на Google-логин и открываем его в обычном браузере,
  // а не внутри окна приложения (Google блокирует вход из встроенных окон)
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.includes('accounts.google.com') || url.includes('/api/auth/google')) {
      event.preventDefault();
      try {
        const target = new URL(url);
        if (target.pathname.includes('/api/auth/google')) {
          target.searchParams.set('origin', `${PROTOCOL}://auth-callback`);
        }
        shell.openExternal(target.toString());
      } catch (e) {
        shell.openExternal(url);
      }
    }
  });

  // Ссылки target="_blank" тоже открываем во внешнем браузере
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function handleAuthCallback(url) {
  if (!url || !url.startsWith(`${PROTOCOL}://`)) return;
  try {
    const parsed = new URL(url);
    const token = parsed.searchParams.get('token');
    const error = parsed.searchParams.get('error');
    if (!mainWindow) return;
    if (token) {
      mainWindow.loadURL(`${APP_URL}/?token=${encodeURIComponent(token)}`);
    } else if (error) {
      mainWindow.loadURL(`${APP_URL}/?error=${encodeURIComponent(error)}`);
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  } catch (e) {
    console.error('Не удалось разобрать auth callback:', e);
  }
}

app.setAsDefaultProtocolClient(PROTOCOL);

// Windows/Linux: второй запуск (по клику на ytmetrics://) шлёт данные в уже открытое приложение
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (event, argv) => {
    const url = argv.find((arg) => arg.startsWith(`${PROTOCOL}://`));
    handleAuthCallback(url);
  });

  app.whenReady().then(createWindow);
}

// macOS: тот же переход ловится через отдельное событие
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleAuthCallback(url);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
