import { describe, it, expect } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * Smoke d'intégration : prouve que le VRAI codegen Playwright 1.56.1 se lance,
 * ouvre un Chromium isolé sous xvfb et écrit le fichier --output.
 *
 * Valide aussi indirectement que la recette du mode direct
 * (--proxy-server=direct:// --proxy-bypass=* + env
 * PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK=1) est acceptée par le CLI.
 * Utilise `node` directement (PAS electron) : ELECTRON_RUN_AS_NODE=1 est
 * fonctionnellement équivalent à un runtime Node.
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

/** Attend l'exit du child, ou résout 'timeout' après ms. */
function waitExit(
  child: ChildProcess,
  ms: number,
): Promise<'exited' | 'timeout'> {
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

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Attend que le fichier --output existe ET soit non vide, ou timeout.
 * codegen écrit le fichier dès que Chromium est prêt (validé par steps-smoke) :
 * on poll donc au lieu d'un délai fixe, robuste face à un runner CI lent.
 */
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

describe.skipIf(SKIP)('codegen smoke (real Playwright 1.56.1)', () => {
  it(
    'lance codegen sous xvfb, écrit --output, se ferme proprement au SIGTERM',
    async () => {
      const tmp = mkdtempSync(path.join(os.tmpdir(), 'pwstudio-smoke-'));
      const outPath = path.join(tmp, 'out.spec.ts');
      const browsersPath =
        process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';

      // detached: true → le child devient chef de son groupe ; on tuera tout le
      // groupe (xvfb-run + node + chromium) via kill(-pid).
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

      let earlyExit: { code: number | null; signal: string | null } | null =
        null;
      child.on('exit', (code, signal) => {
        if (earlyExit === null) earlyExit = { code, signal };
      });

      try {
        // Attend que codegen démarre Chromium et écrive le fichier --output.
        // Poll (jusqu'à 30s) au lieu d'un délai fixe : un runner CI lent peut
        // mettre plus de 9s à booter Chromium sous xvfb.
        const produced = await waitForFile(outPath, 30000);
        expect(
          produced,
          `codegen n'a pas produit de fichier --output (code=${earlyExit?.code}, signal=${earlyExit?.signal}). stderr:\n${stderr.slice(-2000)}`,
        ).not.toBeNull();

        // Le process ne doit PAS avoir crashé pendant la phase de démarrage.
        expect(
          child.exitCode === null && child.signalCode === null,
          `codegen a crashé prématurément (code=${earlyExit?.code}, signal=${earlyExit?.signal}). stderr:\n${stderr.slice(-2000)}`,
        ).toBe(true);

        // Arrêt propre : SIGTERM à tout le groupe de process.
        try {
          if (child.pid) process.kill(-child.pid, 'SIGTERM');
        } catch {
          child.kill('SIGTERM');
        }

        const result = await waitExit(child, 10000);
        // Escalade si nécessaire pour ne pas laisser de zombie.
        if (result === 'timeout' && child.pid) {
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch {
            child.kill('SIGKILL');
          }
          await waitExit(child, 3000);
        }
        expect(result).toBe('exited');

        // Le fichier de sortie existe et contient du code plausible.
        expect(existsSync(outPath)).toBe(true);
        const content = readFileSync(outPath, 'utf8');
        expect(content.length).toBeGreaterThan(0);
        expect(content.includes('test(') || content.includes('import')).toBe(
          true,
        );
      } finally {
        // Filet de sécurité : tue le groupe s'il tourne encore.
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
