// prepare-browsers.mjs
// Télécharge Chromium 1194 dans resources/ms-playwright (extraResources du build).
// Cross-plateforme (Windows / Linux). Respecte PLAYWRIGHT_DOWNLOAD_HOST (Nexus).
// Ne s'exécute qu'au build — jamais au runtime.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROMIUM_DIR = 'chromium-1194';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const browsersPath = path.join(repoRoot, 'resources', 'ms-playwright');
const cliPath = path.join(repoRoot, 'node_modules', 'playwright', 'cli.js');

function alreadyInstalled() {
  return existsSync(path.join(browsersPath, CHROMIUM_DIR));
}

function buildChildEnv() {
  const env = { ...process.env };
  // Cible d'installation.
  env.PLAYWRIGHT_BROWSERS_PATH = browsersPath;
  // Ne PAS hériter du skip : on veut réellement télécharger ici.
  delete env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD;
  // PLAYWRIGHT_DOWNLOAD_HOST (miroir Nexus) est conservé s'il est défini.
  return env;
}

function run() {
  if (alreadyInstalled()) {
    console.log(
      `[prepare-browsers] ${CHROMIUM_DIR} déjà présent dans ${browsersPath} — skip.`,
    );
    return;
  }

  if (!existsSync(cliPath)) {
    console.error(
      `[prepare-browsers] cli Playwright introuvable : ${cliPath}\n` +
        'Lance "npm install" d\'abord.',
    );
    process.exit(1);
  }

  console.log(
    `[prepare-browsers] Installation de chromium dans ${browsersPath}` +
      (process.env.PLAYWRIGHT_DOWNLOAD_HOST
        ? ` (host=${process.env.PLAYWRIGHT_DOWNLOAD_HOST})`
        : '') +
      ' ...',
  );

  const child = spawn(
    process.execPath,
    [cliPath, 'install', 'chromium', '--no-shell'],
    {
      env: buildChildEnv(),
      stdio: 'inherit',
      windowsHide: true,
    },
  );

  child.on('error', (err) => {
    console.error(`[prepare-browsers] échec du spawn : ${err.message}`);
    process.exit(1);
  });

  child.on('exit', (code) => {
    if (code === 0) {
      console.log('[prepare-browsers] terminé.');
    } else {
      console.error(`[prepare-browsers] playwright install a échoué (code ${code}).`);
      process.exit(code ?? 1);
    }
  });
}

run();
