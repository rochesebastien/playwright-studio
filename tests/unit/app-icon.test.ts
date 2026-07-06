import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Holder mutable : pilote app.getAppPath() (= racine du dépôt en dev) par test.
const state = vi.hoisted(() => ({ appPath: '' }));

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => state.appPath,
  },
}));

import { getAppIconPath } from '../../src/main/paths';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'pwstudio-icon-'));
  state.appPath = tmp;
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('getAppIconPath', () => {
  it('renvoie null quand build/icon.png est absent (icône par défaut)', () => {
    expect(getAppIconPath()).toBeNull();
  });

  it('renvoie le chemin de build/icon.png quand le fichier est présent', () => {
    mkdirSync(path.join(tmp, 'build'), { recursive: true });
    const iconPath = path.join(tmp, 'build', 'icon.png');
    writeFileSync(iconPath, 'fake-png');

    expect(getAppIconPath()).toBe(iconPath);
  });
});
