import path from 'node:path';
import { app, BrowserWindow } from 'electron';
import { PlaywrightRecorderRunner } from './recorder-runner';
import { registerIpc } from './ipc';

let mainWindow: BrowserWindow | null = null;
const runner = new PlaywrightRecorderRunner();

function createWindow(): void {
  const win = new BrowserWindow({
    width: 900,
    height: 700,
    show: false,
    autoHideMenuBar: true,
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
