/**
 * a2-runner.cjs — Variante A2 (fallback contexte avancé).
 *
 * Script CommonJS STANDALONE : aucune dépendance hors 'playwright' et modules
 * builtin Node. Spawné par le main via :
 *   execFile(process.execPath, [a2RunnerPath, JSON.stringify(config)], { env })
 * avec ELECTRON_RUN_AS_NODE=1 et PLAYWRIGHT_BROWSERS_PATH déjà dans l'env.
 *
 * config = {
 *   startUrl?: string,
 *   proxy?: { server: string, bypass?: string },  // undefined = héritage système
 *   viewport?: { width, height },
 *   extraHeaders?: Record<string,string>,
 *   browsersPath: string
 * }
 *
 * Isolation stricte : chromium.launch (contexte NON-persistant), JAMAIS
 * launchPersistentContext ni storageState.
 */

'use strict';

async function main() {
  const rawConfig = process.argv[2];
  if (!rawConfig) {
    throw new Error('a2-runner: configuration JSON manquante (argv[2]).');
  }

  /** @type {{ startUrl?: string, proxy?: { server: string, bypass?: string }, viewport?: { width: number, height: number }, extraHeaders?: Record<string,string>, browsersPath?: string }} */
  const config = JSON.parse(rawConfig);

  const { chromium } = require('playwright');

  const launchOptions = { headless: false };
  if (config.proxy && config.proxy.server) {
    launchOptions.proxy = { server: config.proxy.server };
    if (config.proxy.bypass) {
      launchOptions.proxy.bypass = config.proxy.bypass;
    }
  }

  const browser = await chromium.launch(launchOptions);

  const contextOptions = {};
  if (config.viewport) {
    contextOptions.viewport = config.viewport;
  }
  if (config.extraHeaders && Object.keys(config.extraHeaders).length > 0) {
    contextOptions.extraHTTPHeaders = config.extraHeaders;
  }

  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  if (config.startUrl && config.startUrl.trim() !== '') {
    await page.goto(config.startUrl);
  }

  // Ouvre l'inspecteur Playwright ; bloque jusqu'à reprise/fermeture par l'utilisateur.
  await page.pause();

  await context.close();
  await browser.close();
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
