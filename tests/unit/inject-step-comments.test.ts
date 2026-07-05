import { describe, it, expect, vi } from 'vitest';

// recorder-runner importe ./paths qui importe 'electron' au chargement.
// injectStepComments est pure : le mock minimal suffit.
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

import { injectStepComments } from '../../src/main/recorder-runner';
import type { StepsConfig } from '../../src/shared/types';

/** Assemble des lignes en un contenu texte. */
const lines = (arr: string[]): string => arr.join('\n');

/** Index (0-based) de la première ligne contenant `needle`. */
function lineOf(content: string, needle: string): number {
  return content.split('\n').findIndex((l) => l.includes(needle));
}

const defaultConfig: StepsConfig = {
  enabled: true,
  pattern: 'STEP {n} : {label}',
  labels: [],
};

// --- Contenus de référence : S0 → snap1 → final (2 étapes). -----------------
const S0 = lines([
  "import { test, expect } from '@playwright/test';",
  '',
  "test('test', async ({ page }) => {",
  "  await page.goto('https://example.com/');",
  '});',
]);

const SNAP1 = lines([
  "import { test, expect } from '@playwright/test';",
  '',
  "test('test', async ({ page }) => {",
  "  await page.goto('https://example.com/');",
  "  await page.getByRole('button', { name: 'Login' }).click();",
  '});',
]);

const FINAL = lines([
  "import { test, expect } from '@playwright/test';",
  '',
  "test('test', async ({ page }) => {",
  "  await page.goto('https://example.com/');",
  "  await page.getByRole('button', { name: 'Login' }).click();",
  "  await page.getByLabel('User').fill('bob');",
  '});',
]);

describe('injectStepComments — cas nominal (S0 + 1 checkpoint → 2 commentaires)', () => {
  const out = injectStepComments(FINAL, [S0, SNAP1], defaultConfig, 'playwright-test');

  it('insère STEP 1 (frontière S0) et STEP 2 (frontière snap1)', () => {
    expect(out).toContain('// STEP 1 : Étape 1');
    expect(out).toContain('// STEP 2 : Étape 2');
  });

  it('STEP 1 se place entre le goto et le click', () => {
    expect(lineOf(out, '// STEP 1')).toBeGreaterThan(lineOf(out, '.goto('));
    expect(lineOf(out, '// STEP 1')).toBeLessThan(lineOf(out, '.click()'));
  });

  it('STEP 2 se place entre le click et le fill', () => {
    expect(lineOf(out, '// STEP 2')).toBeGreaterThan(lineOf(out, '.click()'));
    expect(lineOf(out, '// STEP 2')).toBeLessThan(lineOf(out, '.fill('));
  });

  it('reprend l’indentation de la ligne suivante (2 espaces)', () => {
    const step1Line = out.split('\n')[lineOf(out, '// STEP 1')];
    expect(step1Line).toBe('  // STEP 1 : Étape 1');
  });

  it('insère une ligne vide avant le commentaire (lisibilité)', () => {
    const outLines = out.split('\n');
    const i = lineOf(out, '// STEP 1');
    expect(outLines[i - 1]).toBe('');
  });

  it('conserve toutes les lignes de code d’origine', () => {
    expect(out).toContain("await page.getByRole('button', { name: 'Login' }).click();");
    expect(out).toContain("await page.getByLabel('User').fill('bob');");
  });
});

describe('injectStepComments — préfixe # en python', () => {
  it('utilise # au lieu de //', () => {
    const out = injectStepComments(FINAL, [S0, SNAP1], defaultConfig, 'python');
    expect(out).toContain('# STEP 1 : Étape 1');
    expect(out).toContain('# STEP 2 : Étape 2');
    expect(out).not.toContain('// STEP');
  });

  it('idem pour python-pytest', () => {
    const out = injectStepComments(FINAL, [S0, SNAP1], defaultConfig, 'python-pytest');
    expect(out).toContain('# STEP 1');
  });
});

describe('injectStepComments — libellés', () => {
  it('utilise labels[n-1] quand présent, sinon "Étape {n}"', () => {
    const config: StepsConfig = {
      enabled: true,
      pattern: '{label}',
      labels: ['Connexion'],
    };
    const out = injectStepComments(FINAL, [S0, SNAP1], config, 'playwright-test');
    expect(out).toContain('// Connexion'); // étape 1 = label fourni
    expect(out).toContain('// Étape 2'); // étape 2 = fallback
  });
});

describe('injectStepComments — pattern custom', () => {
  it('remplace {n} et {label} dans un pattern arbitraire', () => {
    const config: StepsConfig = {
      enabled: true,
      pattern: '=== Bloc {n} ({label}) ===',
      labels: ['A', 'B'],
    };
    const out = injectStepComments(FINAL, [S0, SNAP1], config, 'playwright-test');
    expect(out).toContain('// === Bloc 1 (A) ===');
    expect(out).toContain('// === Bloc 2 (B) ===');
  });
});

describe('injectStepComments — cas limites', () => {
  it('snapshots vide → contenu final inchangé', () => {
    expect(injectStepComments(FINAL, [], defaultConfig, 'playwright-test')).toBe(FINAL);
  });

  it('snapshot identique au final → frontière en fin de fichier, sans perte', () => {
    const out = injectStepComments(FINAL, [FINAL], defaultConfig, 'playwright-test');
    expect(out).toContain('// STEP 1 : Étape 1');
    // Toutes les lignes d’origine sont présentes.
    for (const l of FINAL.split('\n')) {
      expect(out).toContain(l);
    }
    // Le commentaire est placé en toute fin (après la dernière ligne de code).
    expect(lineOf(out, '// STEP 1')).toBeGreaterThan(lineOf(out, '});'));
  });

  it('snapshots identiques (étapes vides) → commentaires empilés à la même frontière', () => {
    const out = injectStepComments(FINAL, [S0, S0], defaultConfig, 'playwright-test');
    const i1 = lineOf(out, '// STEP 1');
    const i2 = lineOf(out, '// STEP 2');
    // Empilés : STEP 2 juste après STEP 1, sans ligne vide intercalée.
    expect(i2).toBe(i1 + 1);
  });

  it('fichier final plus court qu’un snapshot → préfixe commun borné, aucun crash', () => {
    const shortFinal = lines([
      "import { test, expect } from '@playwright/test';",
      '',
      "test('test', async ({ page }) => {",
      '});',
    ]);
    // SNAP1 est plus long que shortFinal.
    let out = '';
    expect(() => {
      out = injectStepComments(shortFinal, [SNAP1], defaultConfig, 'playwright-test');
    }).not.toThrow();
    expect(out).toContain('// STEP 1');
    // Les lignes du final court sont préservées.
    for (const l of shortFinal.split('\n')) {
      expect(out).toContain(l);
    }
  });
});
