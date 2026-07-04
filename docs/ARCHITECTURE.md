# Architecture — Playwright Studio (recorder Playwright isolé, plan A)

> Ce document est le **contrat de référence**. Tout module doit s'y conformer.
> Toute déviation doit être documentée dans `docs/DECISIONS.md`.

## 1. Objectif

Application desktop autonome (Windows x64 en v1) qui lance un Chromium totalement
isolé (aucun profil, aucun cookie, aucun SSO, aucun proxy système hérité) et délègue
le recording + la génération de code à Playwright (`codegen`). L'app est un
**launcher produit** : elle contrôle environnement, isolation, packaging,
distribution — jamais la mécanique de recording elle-même.

## 2. Stack figée

| Composant     | Version figée | Justification |
|---------------|--------------|----------------|
| Playwright    | **1.56.1**   | Chromium revision **1194** ; version testée, ne pas suivre `latest`. Toute montée = re-test du lot 0. |
| Electron      | **38.8.6**   | Embarque Node 22.x — même runtime que Playwright 1.56 supporte ; sert aussi de runtime Node pour spawner le CLI (`ELECTRON_RUN_AS_NODE`). |
| Node (build)  | 22.x         | Aligné avec le Node embarqué d'Electron 38. |
| electron-vite | ^4           | Build main/preload/renderer. |
| React         | ^18          | UI de config minimale. |
| electron-builder | ^26       | Cible `portable` win x64. |
| vitest        | ^3           | Tests unitaires (main). |

## 3. Structure du dépôt

```
playwright-studio/
├── src/
│   ├── main/
│   │   ├── index.ts            # lifecycle app, fenêtre, enregistrement IPC
│   │   ├── recorder-runner.ts  # abstraction A1/A2 — interface unique
│   │   ├── paths.ts            # TOUTE résolution de chemin dev/packagé (browsers, cli, a2-runner)
│   │   ├── settings.ts         # lecture/écriture settings.json (userData)
│   │   └── ipc.ts              # handlers IPC (canaux §6)
│   ├── preload/
│   │   └── index.ts            # contextBridge → window.api (§7)
│   ├── renderer/
│   │   ├── index.html
│   │   └── src/
│   │       ├── main.tsx
│   │       ├── App.tsx
│   │       └── ...             # composants formulaire config + statut
│   └── shared/
│       └── types.ts            # types partagés main <-> renderer (§5)
├── resources/
│   ├── a2-runner.cjs           # script standalone variante A2 (spawné hors asar)
│   └── ms-playwright/          # Chromium embarqué (extraResources, peuplé par script, non commité)
├── scripts/
│   └── prepare-browsers.mjs    # télécharge Chromium 1194 dans resources/ms-playwright
├── tests/                      # vitest (unitaires + smoke)
├── docs/                       # ARCHITECTURE.md, DECISIONS.md, BUILD.md, VALIDATION-WINDOWS.md
├── .github/workflows/          # CI : typecheck+tests (linux) + build portable (windows)
├── electron.vite.config.ts
├── electron-builder.yml
├── .npmrc.example              # gabarit Nexus (registre interne)
└── package.json
```

Règles de structure :
- **`paths.ts` est le seul module** qui construit des chemins vers les browsers,
  `playwright/cli`, ou `a2-runner.cjs`. Il gère les 2 modes : dev (`node_modules`,
  `resources/`) et packagé (`app.asar.unpacked`, `process.resourcesPath`).
- **`recorder-runner.ts` expose une interface unique** quelle que soit la variante
  (A1 `codegen` / A2 API). Le renderer ne connaît que cette interface via IPC.

## 4. Isolation — règles non négociables

- **Jamais** `launchPersistentContext`, `--user-data-dir`, `--save-storage`,
  `--load-storage`, `storageState`, `--incognito`.
- Contexte non-persistant par défaut = user-data-dir temporaire jeté à la
  fermeture. Ne rien « activer », ne rien casser.
- Proxy : sur Windows, ne rien passer = héritage du proxy système. Pour forcer
  le direct (⚠️ validé empiriquement — voir DECISIONS.md Q1 : `direct://` seul est
  réécrit en `http://direct` par `normalizeProxySettings()` et casse la navigation) :
  - **A1** : `--proxy-server=direct:// --proxy-bypass=*` **+** env enfant
    `PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK=1` (sinon Playwright ajoute
    `<-loopback>` à la bypass-list et le trafic localhost passe par le proxy mort).
    Le serveur bidon est neutralisé par le wildcard `*` qui bypass tous les hôtes
    → connexions directes, y compris loopback.
  - **A2** : argument Chromium brut `args: ['--no-proxy-server']`, PAS l'option `proxy`.
  Mode `system` = ne rien passer (héritage assumé, explicite).
- Ne pas s'appuyer sur `HTTP_PROXY`/`HTTPS_PROXY` pour le proxy navigateur
  (lues par Node, pas appliquées au Chromium lancé).

## 5. Types partagés — `src/shared/types.ts` (contrat exact)

```ts
export type TargetLang =
  | 'playwright-test' | 'javascript' | 'python' | 'python-pytest'
  | 'java' | 'csharp';

export type ProxyMode = 'direct' | 'system' | 'manual';

export interface ProxyConfig {
  mode: ProxyMode;
  /** requis si mode === 'manual', ex. "http://proxy.corp:8080" */
  server?: string;
  /** liste bypass, ex. ".corp.local,localhost" */
  bypass?: string;
}

export type RecorderEngine = 'codegen' | 'api'; // A1 | A2

export interface RecorderOptions {
  engine: RecorderEngine;
  startUrl?: string;
  target: TargetLang;
  outputPath: string;
  proxy: ProxyConfig;
  viewport?: { width: number; height: number };
  device?: string;              // nom de device Playwright, ex. "iPhone 15"
  extraHeaders?: Record<string, string>; // A2 uniquement
}

export interface Settings {
  engine: RecorderEngine;       // défaut 'codegen'
  startUrl: string;             // défaut ''
  target: TargetLang;           // défaut 'playwright-test'
  outputDir: string;            // défaut: dossier Documents utilisateur
  proxy: ProxyConfig;           // défaut { mode: 'direct' }
  viewport?: { width: number; height: number };
  device?: string;
  extraHeaders?: Record<string, string>;
}

export type RecorderState = 'idle' | 'starting' | 'recording' | 'stopped' | 'error';

export interface RecorderStatus {
  state: RecorderState;
  message?: string;             // erreur lisible ou info
  exitCode?: number | null;
  outputPath?: string;
  codePreview?: string;         // contenu du fichier généré après arrêt (si lisible)
}

export interface AppInfo {
  appVersion: string;
  electron: string;
  playwright: string;           // version figée
  chromiumRevision: string;     // "1194"
  browsersPath: string;         // chemin résolu effectif
  packaged: boolean;
}

export interface StartResult { ok: boolean; error?: string }
```

## 6. Canaux IPC (invoke/handle sauf mention)

| Canal              | Sens              | Signature |
|--------------------|-------------------|-----------|
| `settings:get`     | renderer → main   | `() => Settings` |
| `settings:save`    | renderer → main   | `(s: Settings) => void` |
| `recorder:start`   | renderer → main   | `(o: RecorderOptions) => StartResult` |
| `recorder:stop`    | renderer → main   | `() => void` |
| `recorder:status`  | main → renderer (send/on) | `(s: RecorderStatus)` |
| `dialog:chooseOutput` | renderer → main | `(defaultName: string) => string \| null` |
| `app:info`         | renderer → main   | `() => AppInfo` |

## 7. API preload — `window.api` (contextIsolation: true, nodeIntegration: false)

```ts
export interface RendererApi {
  getSettings(): Promise<Settings>;
  saveSettings(s: Settings): Promise<void>;
  startRecording(o: RecorderOptions): Promise<StartResult>;
  stopRecording(): Promise<void>;
  chooseOutputPath(defaultName: string): Promise<string | null>;
  getAppInfo(): Promise<AppInfo>;
  /** retourne une fonction de désabonnement */
  onStatus(cb: (s: RecorderStatus) => void): () => void;
}
```

## 8. recorder-runner — spécification d'exécution

### Interface

```ts
export interface RecorderRunner {
  start(options: RecorderOptions): Promise<StartResult>;
  stop(): Promise<void>;
  readonly running: boolean;
  onStatus(cb: (s: RecorderStatus) => void): void;
}
```

Un seul enregistrement à la fois (`start` pendant `running` → `{ok:false, error}`).

### A1 (`engine: 'codegen'`) — chemin par défaut

```
execFile(process.execPath, [playwrightCliPath, 'codegen', ...args], {
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    PLAYWRIGHT_BROWSERS_PATH: browsersPath,
  },
  windowsHide: true,
})
```

- `playwrightCliPath` = `paths.getPlaywrightCliPath()` → `node_modules/playwright/cli.js`
  en dev, `app.asar.unpacked/node_modules/playwright/cli.js` packagé.
- Construction des args (fonction pure exportée `buildCodegenArgs(o: RecorderOptions): string[]`
  — testable unitairement) :
  - `--target <target>` ; `--output <outputPath>`
  - proxy `direct` → `--proxy-server=direct://` **et** `--proxy-bypass=*` (cf. §4)
  - proxy `manual` → `--proxy-server=<server>` + si bypass `--proxy-bypass=<bypass>`
  - proxy `system` → rien
  - `--viewport-size=<w>,<h>` si viewport ; `--device=<device>` si device
  - `startUrl` en dernier argument positionnel si non vide
  - **Interdits** : `--user-data-dir`, `--save-storage`, `--load-storage`, `--browser` ≠ chromium
- Nettoyage env enfant : retirer `NODE_OPTIONS`, `ELECTRON_ENABLE_LOGGING`.
  Ajouter `PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK=1` (requis pour que
  le mode direct couvre aussi le loopback, cf. §4 ; sans effet dans les autres modes
  où l'utilisateur veut de toute façon son proxy, bypass explicite à sa main).
- Fin de process : exit 0 → état `stopped` + lecture du fichier output pour `codePreview` ;
  exit ≠ 0 → état `error` avec stderr (dernières ~2000 chars).
- `stop()` → SIGTERM (Windows : `child.kill()`), timeout 5 s puis kill forcé.

### A2 (`engine: 'api'`) — fallback contexte avancé

Spawn du script standalone `resources/a2-runner.cjs` (CommonJS, aucune dépendance
hors `playwright`) :

```
execFile(process.execPath, [a2RunnerPath, JSON.stringify(configA2)], { env: idem A1 })
```

Le script : `chromium.launch({ headless: false, ... })` — mode `direct` via
`args: ['--no-proxy-server']` (JAMAIS `proxy: { server: 'direct://' }`, cf. §4),
mode `manual` via l'option `proxy`, mode `system` sans rien →
`browser.newContext({ viewport, extraHTTPHeaders })` (non-persistant) →
`page.pause()` (ouvre l'inspecteur). Le code généré se récupère via le bouton
copy de l'inspecteur (limitation documentée dans DECISIONS.md — pas d'API
publique de sortie fichier en A2).

## 9. paths.ts — résolution des chemins

```ts
export function getBrowsersPath(): string
// 1. si process.env.PLAYWRIGHT_BROWSERS_PATH défini et non vide → le respecter (dev/CI)
// 2. si app.isPackaged → path.join(process.resourcesPath, 'ms-playwright')
// 3. sinon (dev)       → <repoRoot>/resources/ms-playwright

export function getPlaywrightCliPath(): string
// dev:      require.resolve('playwright/cli')
// packagé:  remplacer 'app.asar' par 'app.asar.unpacked' dans le chemin résolu

export function getA2RunnerPath(): string
// dev:      <repoRoot>/resources/a2-runner.cjs
// packagé:  path.join(process.resourcesPath, 'a2-runner.cjs')
```

## 10. Packaging — electron-builder.yml (points durs)

- `asar: true` + `asarUnpack: [ "node_modules/playwright/**", "node_modules/playwright-core/**" ]`
  (binaires + assets inspecteur inutilisables depuis l'asar).
- `extraResources`: `resources/ms-playwright` → `ms-playwright` ; `resources/a2-runner.cjs` → `a2-runner.cjs`.
- `win.target: portable`, arch x64. NSIS possible en parallèle plus tard.
- `playwright` est en **dependencies** (pas devDependencies) pour être embarqué.
- Avant build : `node scripts/prepare-browsers.mjs` (respecte `PLAYWRIGHT_DOWNLOAD_HOST`).

## 11. Environnement contraint (Nexus)

- `.npmrc.example` : gabarit registre Nexus à copier en `.npmrc`.
- `ELECTRON_MIRROR` + cache electron-builder → miroir interne.
- `PLAYWRIGHT_DOWNLOAD_HOST` → miroir browsers.
- Ces variables ne servent **qu'au build**, jamais au runtime.

## 12. Settings

- Fichier : `path.join(app.getPath('userData'), 'settings.json')`.
- Lecture tolérante : fichier absent/corrompu → défauts + réécriture.
- Validation à la main (pas de dépendance de schéma) : chaque champ inconnu ignoré,
  chaque champ manquant → défaut.

## 13. Sécurité fenêtre

`BrowserWindow` : `contextIsolation: true`, `nodeIntegration: false`,
`sandbox: false` (préload a besoin d'ipcRenderer), pas de `remote`.
CSP stricte dans `index.html`.
