import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const A2_PATH = path.resolve(__dirname, '../../resources/a2-runner.cjs');
const source = readFileSync(A2_PATH, 'utf8');

/**
 * Retire les commentaires (bloc et ligne) pour ne vérifier que le code exécuté.
 * Le fichier documente volontairement les APIs interdites dans son en-tête
 * ("JAMAIS launchPersistentContext ni storageState") : ces mentions ne doivent
 * pas faire échouer le contrôle d'isolation, seul l'usage réel compte.
 */
const codeOnly = source
  .replace(/\/\*[\s\S]*?\*\//g, '') // commentaires bloc
  .replace(/^\s*\/\/.*$/gm, ''); // commentaires ligne pleine

describe('a2-runner.cjs — validité syntaxique', () => {
  it('compile sans erreur de syntaxe (sans exécuter)', () => {
    // new vm.Script compile/parse le code mais ne l'exécute pas :
    // aucun require('playwright') ni launch réel n'est déclenché.
    expect(() => new vm.Script(source, { filename: A2_PATH })).not.toThrow();
  });
});

describe('a2-runner.cjs — isolation stricte (§4)', () => {
  const forbidden = [
    'launchPersistentContext',
    'storageState',
    'user-data-dir',
    'userDataDir',
    'save-storage',
    'load-storage',
  ];

  for (const token of forbidden) {
    it(`n'utilise pas "${token}" dans le code exécuté`, () => {
      expect(codeOnly).not.toContain(token);
    });
  }

  it('utilise chromium.launch (contexte non-persistant)', () => {
    expect(codeOnly).toContain('chromium.launch');
  });

  it('ouvre l’inspecteur via page.pause()', () => {
    expect(codeOnly).toContain('page.pause()');
  });

  it('utilise newContext (contexte jetable)', () => {
    expect(codeOnly).toContain('newContext');
  });
});
