import { describe, it, expect, vi } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// injectStepComments est pure ; paths.ts (importé par recorder-runner) tire
// electron → mock minimal.
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

/**
 * Smoke d'intégration mode étapes : lance un VRAI codegen 1.56.1 sous xvfb vers
 * about:blank, attend l'apparition du fichier (= S0), simule un cycle checkpoint
 * (relit le fichier = snapshot fin d'étape), attend, SIGTERM, puis applique la
 * fonction pure injectStepComments au contenu final et vérifie que les
 * commentaires d'étape sont bien insérés.
 *
 * Comme about:blank ne reçoit AUCUNE interaction sous xvfb, codegen produit un
 * contenu stable : S0, le snapshot et le final sont identiques. C'est le pire
 * cas d'injection (frontières confondues) : les commentaires s'empilent en fin
 * de préfixe commun. On vérifie donc surtout que les deux commentaires sont
 * présents et l'ordre STEP 1 puis STEP 2 respecté.
 */

const CLI_PATH = path.resolve(__dirname, '../../node_modules/playwright/cli.js');

function hasXvfb(): boolean {
  if (process.platform !== 'linux') return false;
  try {
    return spawnSync('which', ['xvfb-run']).status === 0;
  } catch {
    return false;
  }
}

const SKIP = process.platform !== 'linux' || !hasXvfb();

function waitExit(child: ChildProcess, ms: number): Promise<'exited' | 'timeout'> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      return resolve('exited');
    }
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        resolve('timeout');
      }
    }, ms);
    child.on('exit', () => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        resolve('exited');
      }
    });
  });
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Attend que le fichier existe ET soit non vide, ou timeout. */
async function waitForFile(p: string, ms: number): Promise<string | null> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (existsSync(p)) {
      const c = readFileSync(p, 'utf8');
      if (c.trim() !== '') return c;
    }
    await delay(300);
  }
  return null;
}

describe.skipIf(SKIP)('steps smoke (real Playwright 1.56.1)', () => {
  it(
    'codegen réel → S0 + snapshot, puis injectStepComments insère STEP 1 & STEP 2',
    async () => {
      const tmp = mkdtempSync(path.join(os.tmpdir(), 'pwstudio-steps-'));
      const outPath = path.join(tmp, 'out.spec.ts');
      const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';

      const child = spawn(
        'xvfb-run',
        [
          '-a',
          'node',
          CLI_PATH,
          'codegen',
          '--target',
          'playwright-test',
          '--output',
          outPath,
          '--proxy-server=direct://',
          '--proxy-bypass=*',
          'about:blank',
        ],
        {
          env: {
            ...process.env,
            PLAYWRIGHT_BROWSERS_PATH: browsersPath,
            PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK: '1',
          },
          detached: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );

      let stderr = '';
      child.stderr?.on('data', (d: Buffer) => {
        stderr += d.toString();
      });

      try {
        // S0 : contenu du fichier à sa première apparition (capturé par le poller).
        const s0 = await waitForFile(outPath, 15000);
        expect(
          s0,
          `codegen n'a pas produit de fichier. stderr:\n${stderr.slice(-2000)}`,
        ).not.toBeNull();

        // Simule un cycle checkpoint : relit le fichier courant (= fin d'étape 1).
        await delay(2000);
        const snap1 = readFileSync(outPath, 'utf8');

        // Arrêt propre du groupe de process.
        try {
          if (child.pid) process.kill(-child.pid, 'SIGTERM');
        } catch {
          child.kill('SIGTERM');
        }
        const result = await waitExit(child, 10000);
        if (result === 'timeout' && child.pid) {
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch {
            child.kill('SIGKILL');
          }
          await waitExit(child, 3000);
        }
        expect(result).toBe('exited');

        // Contenu final réel produit par codegen.
        const finalContent = readFileSync(outPath, 'utf8');
        expect(finalContent.length).toBeGreaterThan(0);

        // Post-traitement : injection des commentaires d'étape (comme handleExit).
        const config: StepsConfig = {
          enabled: true,
          pattern: 'STEP {n} : {label}',
          labels: [],
        };
        const injected = injectStepComments(
          finalContent,
          [s0 as string, snap1],
          config,
          'playwright-test',
        );

        // Les deux commentaires sont présents, dans l'ordre.
        expect(injected).toContain('// STEP 1 : Étape 1');
        expect(injected).toContain('// STEP 2 : Étape 2');
        const iStep1 = injected.split('\n').findIndex((l) => l.includes('// STEP 1'));
        const iStep2 = injected.split('\n').findIndex((l) => l.includes('// STEP 2'));
        expect(iStep1).toBeGreaterThanOrEqual(0);
        expect(iStep2).toBeGreaterThan(iStep1);

        // Le code d'origine n'est pas altéré (toutes ses lignes subsistent).
        for (const l of finalContent.split('\n')) {
          expect(injected).toContain(l);
        }
      } finally {
        try {
          if (child.pid) process.kill(-child.pid, 'SIGKILL');
        } catch {
          /* déjà mort */
        }
        rmSync(tmp, { recursive: true, force: true });
      }
    },
    60_000,
  );
});
