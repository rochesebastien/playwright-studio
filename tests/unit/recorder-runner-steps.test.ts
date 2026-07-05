import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

// paths.ts importe electron : mock minimal (isPackaged false → require.resolve dev).
vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp',
    getAppPath: () => '/repo',
    isPackaged: false,
    get resourcesPath() {
      return '/resources';
    },
  },
}));

// Système de fichiers virtuel piloté par le test.
const vfs = vi.hoisted(() => ({
  content: undefined as string | undefined,
  written: undefined as string | undefined,
}));
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(async () => {
    if (vfs.content === undefined) throw new Error('ENOENT');
    return vfs.content;
  }),
  writeFile: vi.fn(async (_p: string, data: string) => {
    vfs.written = data;
  }),
}));

// Child process factice : aucun vrai spawn (pas de display requis).
const childHolder = vi.hoisted(() => ({ current: null as EmittingChild | null }));
class EmittingChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
}
vi.mock('node:child_process', () => ({
  execFile: vi.fn(() => {
    const c = new EmittingChild();
    childHolder.current = c;
    return c;
  }),
}));

import { PlaywrightRecorderRunner } from '../../src/main/recorder-runner';
import type { RecorderOptions } from '../../src/shared/types';

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const lines = (arr: string[]): string => arr.join('\n');
const S0 = lines([
  "import { test } from '@playwright/test';",
  '',
  "test('t', async ({ page }) => {",
  "  await page.goto('about:blank');",
  '});',
]);
const SNAP1 = lines([
  "import { test } from '@playwright/test';",
  '',
  "test('t', async ({ page }) => {",
  "  await page.goto('about:blank');",
  "  await page.getByRole('button').click();",
  '});',
]);
const FINAL = lines([
  "import { test } from '@playwright/test';",
  '',
  "test('t', async ({ page }) => {",
  "  await page.goto('about:blank');",
  "  await page.getByRole('button').click();",
  "  await page.getByLabel('x').fill('v');",
  '});',
]);

function options(over: Partial<RecorderOptions> = {}): RecorderOptions {
  return {
    engine: 'codegen',
    browser: 'chromium',
    target: 'playwright-test',
    outputPath: '/out/spec.ts',
    proxy: { mode: 'direct' },
    steps: { enabled: true, pattern: 'STEP {n} : {label}', labels: [] },
    ...over,
  };
}

beforeEach(() => {
  vfs.content = undefined;
  vfs.written = undefined;
  childHolder.current = null;
});

describe('PlaywrightRecorderRunner.checkpoint — gardes', () => {
  it('sans enregistrement actif → {ok:false}', async () => {
    const runner = new PlaywrightRecorderRunner();
    const r = await runner.checkpoint();
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it('mode étapes désactivé → {ok:false}', async () => {
    const runner = new PlaywrightRecorderRunner();
    await runner.start(options({ steps: { enabled: false, pattern: 'x', labels: [] } }));
    vfs.content = S0;
    const r = await runner.checkpoint();
    expect(r.ok).toBe(false);
    // nettoyage
    childHolder.current?.emit('exit', null);
  });

  it('fichier absent → {ok:false, "Aucune action enregistrée pour l\'instant"}', async () => {
    const runner = new PlaywrightRecorderRunner();
    await runner.start(options());
    vfs.content = undefined; // fichier pas encore écrit
    const r = await runner.checkpoint();
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Aucune action');
    childHolder.current?.emit('exit', null);
  });
});

describe('PlaywrightRecorderRunner — cycle S0 + checkpoint + injection à l’arrêt', () => {
  it('émet le code en direct, clôture l’étape 1 et réécrit le fichier avec STEP 1 & STEP 2', async () => {
    const runner = new PlaywrightRecorderRunner();
    const codes: string[] = [];
    runner.onCode((c) => codes.push(c));
    const statuses: import('../../src/shared/types').RecorderStatus[] = [];
    runner.onStatus((s) => statuses.push(s));

    await runner.start(options());

    // Le poller (500 ms) capture S0 dès l’apparition du fichier.
    vfs.content = S0;
    await delay(650);
    expect(codes.length).toBeGreaterThanOrEqual(1);

    // Étape 1 terminée : le fichier a grandi, checkpoint le fige.
    vfs.content = SNAP1;
    const cp = await runner.checkpoint();
    expect(cp).toEqual({ ok: true, step: 1 });
    expect(statuses.some((s) => s.state === 'recording' && s.currentStep === 2)).toBe(
      true,
    );

    // Étape 2 en cours puis arrêt : SIGTERM + exit.
    vfs.content = FINAL;
    await runner.stop();
    childHolder.current?.emit('exit', null);
    await delay(20); // laisse handleExit (async) se terminer

    // Le fichier a été réécrit avec les deux commentaires aux bonnes frontières.
    expect(vfs.written).toBeTruthy();
    expect(vfs.written).toContain('// STEP 1 : Étape 1');
    expect(vfs.written).toContain('// STEP 2 : Étape 2');
    const wl = (vfs.written as string).split('\n');
    const iStep1 = wl.findIndex((l) => l.includes('// STEP 1'));
    const iClick = wl.findIndex((l) => l.includes('.click()'));
    const iStep2 = wl.findIndex((l) => l.includes('// STEP 2'));
    const iFill = wl.findIndex((l) => l.includes('.fill('));
    expect(iStep1).toBeLessThan(iClick);
    expect(iStep2).toBeGreaterThan(iClick);
    expect(iStep2).toBeLessThan(iFill);

    // Le statut 'stopped' porte la preview enrichie.
    const stopped = statuses.find((s) => s.state === 'stopped');
    expect(stopped?.codePreview).toContain('// STEP 2');
  });
});
