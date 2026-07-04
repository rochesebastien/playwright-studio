import path from 'node:path';
import { ipcMain, dialog, app, BrowserWindow } from 'electron';
import type {
  Settings,
  RecorderOptions,
  RecorderStatus,
  StartResult,
  AppInfo,
} from '../shared/types';
import { getSettings, saveSettings } from './settings';
import { getBrowsersPath } from './paths';
import type { RecorderRunner } from './recorder-runner';

const CHROMIUM_REVISION = '1194';

function readPlaywrightVersion(): string {
  try {
    // node_modules/playwright/package.json — présent en dev et packagé (unpacked).
    const pkg = require('playwright/package.json') as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function buildAppInfo(): AppInfo {
  return {
    appVersion: app.getVersion(),
    electron: process.versions.electron ?? 'unknown',
    playwright: readPlaywrightVersion(),
    chromiumRevision: CHROMIUM_REVISION,
    browsersPath: getBrowsersPath(),
    packaged: app.isPackaged,
  };
}

/**
 * Enregistre tous les handlers IPC (§6) et relaie les statuts du runner vers
 * le renderer via 'recorder:status'.
 */
export function registerIpc(win: BrowserWindow, runner: RecorderRunner): void {
  // Relais des statuts du runner → renderer.
  runner.onStatus((status: RecorderStatus) => {
    if (!win.isDestroyed()) {
      win.webContents.send('recorder:status', status);
    }
  });

  ipcMain.handle('settings:get', (): Settings => {
    return getSettings();
  });

  ipcMain.handle('settings:save', (_evt, s: Settings): void => {
    saveSettings(s);
  });

  ipcMain.handle(
    'recorder:start',
    (_evt, o: RecorderOptions): Promise<StartResult> => {
      return runner.start(o);
    },
  );

  ipcMain.handle('recorder:stop', (): Promise<void> => {
    return runner.stop();
  });

  ipcMain.handle(
    'dialog:chooseOutput',
    async (_evt, defaultName: string): Promise<string | null> => {
      const settings = getSettings();
      const defaultPath = path.join(
        settings.outputDir || app.getPath('documents'),
        defaultName,
      );
      const result = await dialog.showSaveDialog(win, {
        title: 'Choisir le fichier de sortie',
        defaultPath,
      });
      if (result.canceled || !result.filePath) {
        return null;
      }
      return result.filePath;
    },
  );

  ipcMain.handle('app:info', (): AppInfo => {
    return buildAppInfo();
  });
}
