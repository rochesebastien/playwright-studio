import path from 'node:path';
import { app, BrowserWindow } from 'electron';
import { PlaywrightRecorderRunner } from './recorder-runner';
import { registerIpc } from './ipc';
import { getAppIconPath } from './paths';

let mainWindow: BrowserWindow | null = null;
const runner = new PlaywrightRecorderRunner();

function createWindow(): void {
  // Icône de la fenêtre si un logo est fourni (build/icon.png). Absent → l'app
  // utilise l'icône par défaut (en packagé Windows, l'exe fournit déjà la sienne).
  const iconPath = getAppIconPath();

  const win = new BrowserWindow({
    width: 1240,
    height: 860,
    minWidth: 1080,
    minHeight: 720,
    show: false,
    autoHideMenuBar: true,
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow = win;

  win.on('ready-to-show', () => {
    win.show();
  });

  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null;
    }
  });

  registerIpc(win, runner);

  // Chargement du renderer : dev = serveur electron-vite, prod = fichier build.
  const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
  if (!app.isPackaged && devServerUrl) {
    void win.loadURL(devServerUrl);
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Arrêt propre du runner si un enregistrement est actif au moment de quitter.
app.on('before-quit', () => {
  if (runner.running) {
    void runner.stop();
  }
});
