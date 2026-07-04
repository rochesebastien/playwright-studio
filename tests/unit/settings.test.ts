import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Holder mutable pour piloter app.getPath depuis chaque test.
const state = vi.hoisted(() => ({ userData: '', documents: '' }));

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return state.userData;
      if (name === 'documents') return state.documents;
      return state.userData;
    },
    isPackaged: false,
    getAppPath: () => '/repo',
  },
}));

import {
  getSettings,
  saveSettings,
  defaultSettings,
  validateSettings,
} from '../../src/main/settings';
import type { Settings } from '../../src/shared/types';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'pwstudio-settings-'));
  state.userData = path.join(tmp, 'userData');
  state.documents = path.join(tmp, 'Documents');
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function settingsFile(): string {
  return path.join(state.userData, 'settings.json');
}

describe('defaultSettings', () => {
  it('correspond au contrat (§5/§12)', () => {
    const d = defaultSettings();
    expect(d.engine).toBe('codegen');
    expect(d.startUrl).toBe('');
    expect(d.target).toBe('playwright-test');
    expect(d.outputDir).toBe(state.documents);
    expect(d.proxy).toEqual({ mode: 'direct' });
  });
});

describe('getSettings — fichier absent', () => {
  it('retourne les défauts et écrit le fichier', () => {
    expect(existsSync(settingsFile())).toBe(false);
    const s = getSettings();
    expect(s).toEqual(defaultSettings());
    // réécriture : le fichier est désormais présent
    expect(existsSync(settingsFile())).toBe(true);
  });
});

describe('getSettings — fichier corrompu', () => {
  it('JSON invalide → défauts sans throw', () => {
    // écrit un fichier corrompu à l'emplacement attendu
    saveSettings(defaultSettings()); // crée le dossier
    writeFileSync(settingsFile(), '{ this is : not json', 'utf8');
    let s: Settings | undefined;
    expect(() => {
      s = getSettings();
    }).not.toThrow();
    expect(s).toEqual(defaultSettings());
  });
});

describe('round-trip save/load', () => {
  it('relit exactement ce qui a été écrit', () => {
    const custom: Settings = {
      engine: 'api',
      startUrl: 'https://corp.local',
      target: 'python',
      outputDir: path.join(tmp, 'out'),
      proxy: { mode: 'manual', server: 'http://p:8080', bypass: 'localhost' },
      viewport: { width: 1440, height: 900 },
      device: 'iPhone 15',
      extraHeaders: { 'X-Test': '1' },
    };
    saveSettings(custom);
    const loaded = getSettings();
    expect(loaded).toEqual(custom);
  });
});

describe('validateSettings — champs inconnus / manquants', () => {
  it('ignore les champs inconnus', () => {
    const s = validateSettings({
      engine: 'codegen',
      target: 'javascript',
      startUrl: 'x',
      outputDir: '/o',
      proxy: { mode: 'direct' },
      SOMETHING_UNKNOWN: 42,
      another: { nested: true },
    });
    expect('SOMETHING_UNKNOWN' in s).toBe(false);
    expect('another' in s).toBe(false);
    expect(s.target).toBe('javascript');
  });

  it('champ manquant → défaut', () => {
    const d = defaultSettings();
    const s = validateSettings({ target: 'java' });
    expect(s.engine).toBe(d.engine);
    expect(s.startUrl).toBe(d.startUrl);
    expect(s.outputDir).toBe(d.outputDir);
    expect(s.proxy).toEqual(d.proxy);
    expect(s.target).toBe('java');
  });

  it('valeur invalide (target hors énum) → défaut', () => {
    const s = validateSettings({ target: 'cobol' });
    expect(s.target).toBe('playwright-test');
  });

  it('proxy invalide → { mode: direct }', () => {
    expect(validateSettings({ proxy: { mode: 'nope' } }).proxy).toEqual({
      mode: 'direct',
    });
    expect(validateSettings({ proxy: 'garbage' }).proxy).toEqual({ mode: 'direct' });
  });

  it('viewport invalide (dimensions ≤ 0 ou non numériques) → absent', () => {
    expect(validateSettings({ viewport: { width: 0, height: 100 } }).viewport).toBeUndefined();
    expect(validateSettings({ viewport: { width: '10', height: 20 } }).viewport).toBeUndefined();
  });

  it('entrée non-objet → défauts complets', () => {
    expect(validateSettings(null)).toEqual(defaultSettings());
    expect(validateSettings('str')).toEqual(defaultSettings());
    expect(validateSettings([1, 2, 3])).toEqual(defaultSettings());
  });
});

describe('saveSettings — écriture atomique', () => {
  it('produit un JSON relisible et indenté', () => {
    saveSettings(defaultSettings());
    const raw = readFileSync(settingsFile(), 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
    expect(raw).toContain('\n'); // indenté (null, 2)
  });
});
