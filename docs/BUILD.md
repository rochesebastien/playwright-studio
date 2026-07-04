# BUILD — Playwright Studio (build reproductible de l'`.exe` portable)

Guide de production du binaire portable Windows x64, y compris en environnement d'entreprise contraint (registre npm Nexus, miroirs internes). Objectif : **un tiers reproduit le build en suivant cette doc seule**.

## Vue d'ensemble de la chaîne

```
npm ci                → dépendances (dont playwright@1.56.1, en dependencies)
prepare-browsers      → Chromium 1194 téléchargé dans resources/ms-playwright/chromium-1194
electron-vite build   → compile main / preload / renderer dans out/
electron-builder      → package portable win x64 (asar + asarUnpack + extraResources)
                      → dist/Playwright Studio-<version>-portable-x64.exe
```

Commande unique de packaging (après `npm ci` et `prepare-browsers`) :

```bash
npm run dist:win      # = electron-vite build && electron-builder --win --x64
```

Points de packaging (définis dans `electron-builder.yml`, voir [ARCHITECTURE.md](ARCHITECTURE.md) §10) :

- `asar: true` avec `asarUnpack` de `node_modules/playwright/**` et `node_modules/playwright-core/**` — **obligatoire** pour que les assets de l'inspecteur soient lisibles hors archive.
- `extraResources` : `resources/ms-playwright` → `ms-playwright` (Chromium embarqué) et `resources/a2-runner.cjs` → `a2-runner.cjs` (script variante API).
- `win.target: portable`, `arch: x64`. Artefact nommé `Playwright Studio-<version>-portable-x64.exe`.

## Build derrière Nexus (poste ou CI d'entreprise)

En egress contraint, npm, le binaire Electron et les browsers Playwright doivent passer par les miroirs internes.

### 1. Registre npm interne

Copier le gabarit et renseigner les valeurs réelles :

```bash
cp .npmrc.example .npmrc
```

Renseigner dans `.npmrc` : `registry` (URL Nexus), `_authToken` (token Nexus, **jamais commité** — `.npmrc` est ignoré par `.gitignore`), et si nécessaire `cafile` (CA d'entreprise), `proxy` / `https-proxy`.

### 2. Binaire Electron et browsers Playwright

`electron-builder` télécharge le binaire Electron ; `prepare-browsers` télécharge Chromium. Router les deux vers les miroirs internes.

### Tableau des variables d'environnement (build uniquement)

| Variable | Rôle | Moment |
|----------|------|--------|
| `registry` / `_authToken` (dans `.npmrc`) | Registre npm interne + auth | **install** (`npm ci`) |
| `ELECTRON_MIRROR` (ou `electron_mirror` dans `.npmrc`) | Miroir du binaire Electron | **install** (`npm ci`) |
| `PLAYWRIGHT_DOWNLOAD_HOST` | Miroir des browsers Playwright | **build** (`prepare-browsers`) |
| `ELECTRON_SKIP_BINARY_DOWNLOAD=1` | Ne pas télécharger le binaire Electron | **install** — dev sans packaging uniquement (⚠️ ne pas l'utiliser pour un build portable, le binaire est requis) |
| `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` | Ne pas télécharger les browsers à l'install | **install** (les browsers sont posés séparément par `prepare-browsers`) |
| `PLAYWRIGHT_BROWSERS_PATH` | Chemin des browsers | **build** / **runtime** (résolu par l'app ; en dev/CI, pointe le cache) |

> **`prepare-browsers` respecte `PLAYWRIGHT_DOWNLOAD_HOST`** et est idempotent : si `resources/ms-playwright/chromium-1194` existe déjà, il ne retélécharge rien.

> **Rappel critique** : ces variables ne servent **qu'au build**. L'`.exe` produit ne les lit jamais au runtime — le Chromium est embarqué dans `resources/ms-playwright`, résolu par `paths.getBrowsersPath()`. Le proxy du **navigateur enregistré** est piloté par l'UI, pas par `HTTP_PROXY` / `HTTPS_PROXY` (voir [ARCHITECTURE.md](ARCHITECTURE.md) §4).

### Enchaînement complet (poste Windows d'entreprise)

```bash
cp .npmrc.example .npmrc          # puis renseigner registry + token + miroirs
set PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
npm ci
set PLAYWRIGHT_DOWNLOAD_HOST=https://nexus.corp.example/repository/playwright/
npm run prepare-browsers
npm run dist:win
# → dist\Playwright Studio-<version>-portable-x64.exe
```

## Build via GitHub Actions (chemin recommandé)

Le workflow `.github/workflows/ci.yml` produit l'`.exe` du lot 0. Il se déclenche sur `push` (toutes branches) et `workflow_dispatch`, avec deux jobs.

### Job `test` (Ubuntu)

1. Checkout + Node 22 (cache npm).
2. `npm ci` avec `ELECTRON_SKIP_BINARY_DOWNLOAD=1` et `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` (les modules main sont testés en mockant `electron` ; le binaire Electron est inutile).
3. `npm run typecheck`.
4. Résolution d'un chemin browsers unique (`$HOME/pw-browsers`) exporté dans `GITHUB_ENV`, puis **cache** `actions/cache` avec clé figée `playwright-1.56.1-${runner.os}`.
5. `npx playwright install chromium --no-shell` (idempotent : no-op si le cache est restauré).
6. `xvfb-run -a npm test` (unitaires + smoke ; le smoke ouvre un vrai Chromium headed, d'où `xvfb`).

### Job `build-windows` (Windows, `needs: test`)

1. Checkout + Node 22 (cache npm).
2. `npm ci` avec `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` — **mais sans** skip Electron (le binaire est requis pour packager).
3. `npm run prepare-browsers` (Chromium 1194 → `resources/ms-playwright`).
4. `npm run dist:win` (build portable).
5. `actions/upload-artifact` : artefact **`playwright-studio-portable-win-x64`** = `dist/*.exe`, **rétention 14 jours**, `if-no-files-found: error`.

**Récupérer l'exe** : onglet **Actions** du dépôt → run concerné → section **Artifacts** → télécharger `playwright-studio-portable-win-x64` (archive zip contenant le `.exe`).

## Signature de code

État des lieux honnête : **l'`.exe` n'est pas signé**. Conséquence : au premier lancement (surtout après téléchargement via navigateur, marquage Mark-of-the-Web), **Windows SmartScreen** affiche « Éditeur inconnu » et l'utilisateur doit passer par « Informations complémentaires → Exécuter quand même ».

La signature Authenticode (certificat OV ou EV) supprime/atténue ce blocage mais **relève d'une décision IT** (choix du certificat, chaîne de confiance, horodatage, délai de réputation). Procédure de vérification et cadrage : [VALIDATION-WINDOWS.md](VALIDATION-WINDOWS.md) lot 4.

## Vérification post-build

Le build Linux/CI ne peut pas trancher le packaging Windows. Après production de l'`.exe`, dérouler la checklist [VALIDATION-WINDOWS.md](VALIDATION-WINDOWS.md) sur une **machine Windows vierge** : démarrage + inspecteur fonctionnel (lot 0), isolation de session (lot 1), proxy système hérité (lot 2), proxy direct non hérité (lot 3), SmartScreen (lot 4).

## Dépannage

| Symptôme | Cause probable | Correctif |
|----------|----------------|-----------|
| Inspecteur/recorder ne s'ouvre pas ; page blanche ou `ENOENT` sur `https://playwright/index.html` | `playwright` / `playwright-core` non `asarUnpack`és, **ou** `cli.js` lancé depuis `app.asar` au lieu de `app.asar.unpacked` | Vérifier `asarUnpack` dans `electron-builder.yml` et le remplacement `app.asar` → `app.asar.unpacked` dans `paths.getPlaywrightCliPath()` (voir [DECISIONS.md](DECISIONS.md) Q2) |
| Browsers introuvables au lancement de l'app | `PLAYWRIGHT_BROWSERS_PATH` mal résolu, ou `resources/ms-playwright` absent du package | Vérifier que `prepare-browsers` a peuplé `resources/ms-playwright/chromium-1194` avant le build, et le mapping `extraResources` ; l'app résout via `paths.getBrowsersPath()` (`process.resourcesPath/ms-playwright` en packagé) |
| `npm install` échoue sur le CDN Electron (egress bloqué) | Téléchargement du binaire Electron impossible | Pour du **dev sans packaging** : `ELECTRON_SKIP_BINARY_DOWNLOAD=1`. Pour un **build portable** : configurer `ELECTRON_MIRROR` vers Nexus (le binaire est indispensable au packaging) |
| Browsers non téléchargés à l'install | Egress bloqué / choix délibéré | `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` à l'install, puis `npm run prepare-browsers` (avec `PLAYWRIGHT_DOWNLOAD_HOST` si Nexus) |
| Les args Chromium contiennent `--proxy-bypass=*` en mode direct | **Comportement voulu**, pas un bug | Le wildcard court-circuite le proxy pour tous les hôtes → connexion directe ; `direct://` seul serait réécrit en `http://direct` et casserait la navigation (voir [DECISIONS.md](DECISIONS.md) Q1) |
