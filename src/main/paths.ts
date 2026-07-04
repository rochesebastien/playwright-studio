import path from 'node:path';
import { app } from 'electron';

/**
 * Racine du dépôt en mode dev. En dev, app.getAppPath() retourne la racine du
 * projet (là où se trouve package.json). En packagé cette fonction n'est pas
 * utilisée pour résoudre les browsers (on passe par process.resourcesPath).
 */
function repoRoot(): string {
  return app.getAppPath();
}

/**
 * Chemin effectif des browsers Playwright.
 * 1. PLAYWRIGHT_BROWSERS_PATH défini et non vide → le respecter (dev/CI).
 * 2. packagé → <resources>/ms-playwright.
 * 3. dev → <repoRoot>/resources/ms-playwright.
 */
export function getBrowsersPath(): string {
  const fromEnv = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (fromEnv && fromEnv.trim() !== '') {
    return fromEnv;
  }
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'ms-playwright');
  }
  return path.join(repoRoot(), 'resources', 'ms-playwright');
}

/**
 * Chemin du CLI Playwright (cli.js).
 * dev     : résolu depuis le package playwright, à côté de cli.js.
 * packagé : le chemin résolu pointe dans app.asar → réécrire vers
 *           app.asar.unpacked (playwright est dans asarUnpack).
 *
 * NB : le contrat §9 mentionne require.resolve('playwright/cli'), mais le
 * champ `exports` de playwright 1.56.1 n'expose PAS la sous-chemin './cli'
 * (ERR_PACKAGE_PATH_NOT_EXPORTED). On résout donc package.json (exposé) puis
 * on joint cli.js — équivalent fonctionnel, robuste à la restriction exports.
 */
export function getPlaywrightCliPath(): string {
  const pkgJson = require.resolve('playwright/package.json');
  const resolved = path.join(path.dirname(pkgJson), 'cli.js');
  if (app.isPackaged) {
    return resolved.replace('app.asar', 'app.asar.unpacked');
  }
  return resolved;
}

/**
 * Chemin du script standalone A2 (spawné hors asar).
 * dev     : <repoRoot>/resources/a2-runner.cjs.
 * packagé : <resources>/a2-runner.cjs (extraResources).
 */
export function getA2RunnerPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'a2-runner.cjs');
  }
  return path.join(repoRoot(), 'resources', 'a2-runner.cjs');
}
