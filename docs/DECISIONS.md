# DECISIONS — Playwright Studio

> Journal des arbitrages techniques. Chaque décision est adossée à une **preuve**
> (lecture de source, test réel, source web). Banc d'essai : `playwright@1.56.1`
> installé en scratchpad, `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`
> (Chromium révision **1194** = `141.0.7390.37`), navigation headed sous `xvfb-run`,
> navigation headless via l'API pour les tests réseau.

---

## Question 1 — `--proxy-server=direct://` neutralise-t-il l'héritage du proxy système ?

### Investigation menée

**a) Comment Playwright traduit l'option proxy en flags Chromium.**
Chaîne CLI → Chromium reconstituée dans les sources 1.56.1 :

- `lib/cli/program.js:363` — le flag CLI devient une option de launch :
  ```js
  if (options.proxyServer) {
    launchOptions.proxy = { server: options.proxyServer };
    if (options.proxyBypass) launchOptions.proxy.bypass = options.proxyBypass;
  }
  ```
- `lib/server/chromium/chromium.js:291-308` — **si et seulement si** `proxy` est
  défini, Playwright pousse `--proxy-server=<server>` (+ `--proxy-bypass-list`).
  Si **aucun** proxy n'est passé, le bloc `if (proxy)` est entièrement sauté :
  **aucun `--proxy-server` n'est émis** → Chromium consulte les réglages proxy
  du système (héritage sur Windows). Ce point est le mécanisme d'héritage lui-même.

- **Piège majeur** — `lib/server/browserContext.js:647` `normalizeProxySettings()`
  réécrit systématiquement le champ `server` :
  ```js
  url = new URL(server);
  if (!url.host || !url.protocol) url = new URL("http://" + server); // <-- direct:// tombe ici
  server = url.protocol + "//" + url.host;
  ```
  `new URL("direct://")` a un **host vide** → repassage par `new URL("http://direct://")`
  → host = `direct` → **`server` devient `http://direct`**. Le `direct://` est donc
  transformé en **proxy HTTP bidon pointant sur l'hôte `direct:80`**.

**b) Preuve empirique #1 — ligne de commande réelle du Chromium enfant.**
```
DEBUG=pw:browser xvfb-run -a node cli.js codegen --proxy-server=direct:// about:blank
```
La ligne `<launching> .../chrome ...` contient :
```
... --proxy-server=http://direct --proxy-bypass-list=<-loopback> --user-data-dir=/tmp/playwright_chromiumdev_profile-XXXX ...
```
→ confirme que codegen n'envoie **pas** `direct://` mais bien `http://direct`.
(Au passage : `--user-data-dir` pointe un profil temporaire jetable — l'isolation
profil est bien respectée.)

**c) Preuve empirique #2 — effet réseau réel (Chromium 1194, API, serveur HTTP
local sur IP non-loopback `192.0.2.2:8899` pour que le proxy s'applique vraiment).**

| Configuration                              | Résultat navigation |
|--------------------------------------------|---------------------|
| aucun proxy (`launch({})`)                 | **200 OK** (direct) |
| `proxy: { server: 'direct://' }`           | **`net::ERR_PROXY_CONNECTION_FAILED`** |
| `args: ['--proxy-server=direct://']` (arg brut) | **200 OK** (vrai direct) |
| `proxy: { server: 'http://direct' }`       | **`net::ERR_PROXY_CONNECTION_FAILED`** (isole la cause) |
| `args: ['--no-proxy-server']` (arg brut)   | **200 OK** |

→ La voie « option `proxy` » avec `direct://` **casse toute navigation non-loopback**.
La voie « argument Chromium brut » `--proxy-server=direct://` ou `--no-proxy-server`
fonctionne — parce qu'elle **contourne** `normalizeProxySettings()`.

**d) `codegen` expose-t-il `--proxy-bypass` ?** Oui (`cli.js codegen --help` et
`program.js:614`) : `--proxy-server <proxy>` et `--proxy-bypass <bypass>`. Il n'expose
**pas** `--no-proxy-server` ni d'injection d'arguments Chromium bruts.

**e) Documentation Chromium.** `--proxy-server="direct://"` est la valeur officielle
Chromium pour « connexion directe, en ignorant toute autre config proxy » — mais elle
doit **arriver telle quelle** au binaire, ce que Playwright 1.56.1 empêche via l'option
`proxy`.

### Verdict

- **Mécanisme d'héritage confirmé** : ne rien passer ⇒ pas de `--proxy-server` ⇒ Chromium
  hérite du proxy système. C'est exactement le comportement voulu pour le **mode `system`**.
- **Le mode `direct` tel que spécifié dans l'ARCHITECTURE (`--proxy-server=direct://` en A1,
  `proxy: { server: 'direct://' }` en A2) est CASSÉ en 1.56.1.** La valeur est réécrite en
  `http://direct` (proxy inexistant) → `ERR_PROXY_CONNECTION_FAILED` sur toute cible non-loopback.
  Il « isole » bien du proxy système, mais en rendant le navigateur inutilisable.
- **Correctif à appliquer :**
  - **A2 (script `a2-runner.cjs`)** : ne PAS utiliser l'option `proxy` pour le direct.
    Utiliser `chromium.launch({ args: ['--proxy-server=direct://'] })` (ou `['--no-proxy-server']`).
    Vérifié : navigation directe fonctionnelle. Les modes `manual`/`system` peuvent
    rester sur l'option `proxy` / rien.
  - **A1 (`codegen`)** : `codegen` **n'accepte aucun argument Chromium brut**. Il n'existe
    donc **aucun moyen propre** de forcer un vrai `direct://` via `codegen` en 1.56.1.
    Options réalistes :
    1. Implémenter le **mode `direct` par le même chemin de launch que A2** (script contrôlé
       passant `args:['--proxy-server=direct://']`) plutôt que par `codegen --proxy-server`.
    2. À défaut, documenter que « direct » via `codegen` est indisponible et n'exposer en A1
       que `system` (rien) et `manual` (`--proxy-server=<vrai proxy>`), le direct forcé
       basculant automatiquement en A2.
  - **Ne jamais** émettre `--proxy-server=direct://` via `codegen` ou via l'option `proxy` :
    c'est un piège silencieux qui casse la navigation.

### Addendum (orchestrateur) — solution A1 trouvée et validée : `--proxy-bypass=*`

L'impasse A1 ci-dessus a été levée par un test complémentaire : `codegen` expose
`--proxy-bypass`, et la **bypass-list Chromium accepte le wildcard `*`** (bypass de
tous les hôtes ⇒ connexions directes, quel que soit le serveur proxy — même bidon).

Preuves (banc identique : serveur HTTP local sur `192.0.2.2:8899`, cible non-loopback) :

| Configuration | Résultat |
|---|---|
| `proxy: { server: 'http://127.0.0.1:9' }` (proxy mort seul) | `ERR_PROXY_CONNECTION_FAILED` (proxy bien appliqué) |
| `proxy: { server: 'http://127.0.0.1:9', bypass: '*' }` | **200 OK (direct)** |
| `proxy: { server: 'direct://', bypass: '*' }` | **200 OK (direct)** |
| CLI : `screenshot --proxy-server=direct:// --proxy-bypass=*` (même chemin d'options que codegen) | **200 OK (direct)** |

Raffinement obligatoire : quand un proxy est passé, Playwright ajoute d'office
`<-loopback>` à la bypass-list (`chromium.js:304`) ⇒ le **localhost** passerait par
le proxy mort (`ERR_PROXY_CONNECTION_FAILED` vérifié sur `127.0.0.1:8898`). L'env
`PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK=1` supprime cet ajout —
vérifié : loopback **et** non-loopback passent alors en direct.

**Décision finale retenue (mode `direct`) :**
- **A1** : `--proxy-server=direct:// --proxy-bypass=*` + env enfant
  `PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK=1`. Surface 100 % publique,
  A1 reste le chemin par défaut avec sortie `--output` automatique.
- **A2** : `args: ['--no-proxy-server']` (arguments bruts disponibles au launch).

### À valider sous Windows

- Confirmer sur une machine Windows **avec proxy système configuré** que :
  - mode `system` (aucun flag) ⇒ le navigateur emprunte bien le proxy d'entreprise ;
  - mode `direct` **corrigé** (`args:['--proxy-server=direct://']`) ⇒ navigation directe
    fonctionnelle **malgré** le proxy système (procédure détaillée dans VALIDATION-WINDOWS.md).
- Confirmer que `HTTP_PROXY`/`HTTPS_PROXY` d'environnement ne sont **pas** appliqués au
  Chromium lancé (lus par Node seulement) — cohérent avec §4 de l'ARCHITECTURE.

---

## Question 2 — L'inspecteur (UI recorder) se résout-il hors asar depuis un binaire packagé ?

### Investigation menée

- **Localisation des assets** : `playwright-core/lib/vite/recorder/` — contient
  `index.html`, `assets/`, `playwright-logo.svg`. (Le trace viewer et le html report
  sont dans des dossiers voisins `lib/vite/traceViewer`, `lib/vite/htmlReport`.)
- **Code qui sert les assets** (`lib/server/recorder/recorderApp.js:78-90`) :
  ```js
  const uri  = route.request().url().substring("https://playwright/".length);
  const file = require.resolve("../../vite/recorder/" + uri);   // résolution RELATIVE au module
  import_fs.default.promises.readFile(file).then(buffer => route.fulfill({ ... }));
  ```
  L'UI recorder est chargée dans une page Chromium (`goto("https://playwright/index.html")`)
  dont les requêtes sont interceptées et **servies depuis le disque** via `require.resolve`
  (chemin **relatif au fichier `recorderApp.js`**) puis `fs.readFile`.
- **Conséquence packaging** : le chemin est calculé à partir de l'emplacement réel du
  module. Deux conditions pour que ça marche depuis un `.exe` :
  1. **`playwright-core/**` doit être `asarUnpack`é** (les assets `vite/recorder/*` sont des
     fichiers lus par `fs`, pas des modules JS chargés par le require d'Electron).
  2. **`cli.js` doit être lancé depuis `app.asar.unpacked`** (et non depuis `app.asar`),
     sinon `__dirname`/`require.resolve` pointent à l'intérieur de l'archive asar et
     `fs.readFile` dépend du shim asar d'Electron — **fragile sous `ELECTRON_RUN_AS_NODE`**.
     L'ARCHITECTURE fait déjà ce choix : `getPlaywrightCliPath()` remplace `app.asar` par
     `app.asar.unpacked` (§9). Ce point est donc **la clé** : ce n'est pas seulement
     « unpack », c'est aussi « lancer depuis le chemin unpacked ».
- **Recherche web** : les problèmes classiques « playwright + electron + asar » portent sur
  (a) l'exécution de binaires dans l'asar — seul `execFile` fonctionne, pas `spawn(command)` —
  et (b) les chemins calculés via `__dirname`. La solution retenue par la communauté est
  précisément `asarUnpack` de `playwright`/`playwright-core` + lancement du CLI depuis le
  chemin unpacked. `extraResources` n'est nécessaire que pour les **navigateurs** (binaires
  Chromium), ce que l'ARCHITECTURE fait déjà via `resources/ms-playwright`.

### Verdict

`asarUnpack: ["node_modules/playwright/**", "node_modules/playwright-core/**"]` **suffit
pour les assets de l'inspecteur**, à la **condition impérative** (déjà prévue) que `cli.js`
soit exécuté depuis `app.asar.unpacked/...`. Pas besoin de `extraResources` pour l'UI recorder.
Piège à ne pas oublier : unpacker **tout `playwright-core`** (pas seulement `cli.js`), car la
résolution `require.resolve("../../vite/recorder/...")` remonte l'arborescence du package.

### À valider sous Windows

- Lot 0 : depuis l'`.exe` portable, démarrer un enregistrement et **vérifier que l'UI de
  l'inspecteur s'affiche réellement** (pas d'erreur `ENOENT` / page blanche sur
  `https://playwright/index.html`). Voir VALIDATION-WINDOWS.md.

---

## Question 3 — Récupération programmatique du code généré en A2 (API + `page.pause()`)

### Investigation menée

- **`page.pause()` côté client** (`lib/client/page.js:645-653`) :
  ```js
  async pause(_options) { ... await this.context()._channel.pause(); }
  ```
  → `pause()` appelle le canal `pause`, qui ouvre l'inspecteur en **mode inspection/pause**.
  **Aucun `outputFile`** n'est transmis : ce chemin n'écrit jamais de fichier.
- **Le seul chemin qui écrit un fichier** est celui de `codegen`
  (`lib/cli/program.js:482-492`) :
  ```js
  await context._enableRecorder({
    language, launchOptions, contextOptions, device,
    mode: "recording",
    outputFile: outputFile ? path.resolve(outputFile) : void 0,
    ...
  });
  ```
- **`_enableRecorder`** existe côté client (`lib/client/browserContext.js:450`) :
  ```js
  async _enableRecorder(params, eventSink) { await this._channel.enableRecorder(params); }
  ```
  mais **il n'est PAS public** : `enableRecorder` = **0 occurrence** dans
  `playwright-core/types/types.d.ts` et dans `playwright/types/*.d.ts`. C'est une méthode
  préfixée `_`, non typée, non documentée (API interne susceptible de casser à toute montée
  de version).
- **Écriture fichier** (`lib/server/recorder/throttledFile.js`) : quand `outputFile` est
  fourni, un `ThrottledFile` écrit le code sur disque en continu (flush à 250 ms).

### Verdict

- **Il n'existe AUCUNE API publique** pour écrire le code généré dans un fichier via
  `page.pause()`. `page.pause()` n'ouvre que l'inspecteur ; la récupération se fait par le
  **bouton « copy » de l'inspecteur** (copie manuelle) — ce qui **confirme la limitation
  pressentie** et la §8 de l'ARCHITECTURE (A2 = copie manuelle).
- **Nuance** : la méthode **privée** `context._enableRecorder({ mode:'recording',
  outputFile, language, ... })` (celle qu'utilise `codegen` en interne) est techniquement
  appelable depuis un script Node et **donnerait** une sortie fichier automatique en A2,
  **sans** `page.pause()`. **Non recommandée** pour un produit : API `_`-préfixée, non typée,
  non contractuelle, cassable sans préavis.
- **Décision** : pour une **sortie fichier automatique**, **A1 (`codegen --output`) est la
  voie obligatoire**. A2 reste le fallback « contexte avancé » avec récupération **manuelle**
  du code depuis l'inspecteur. Ne pas s'appuyer sur `_enableRecorder` en production.

### À valider sous Windows

- Rien de spécifique Windows ici (comportement API, indépendant de l'OS). À re-vérifier
  uniquement lors d'une **montée de version** de Playwright (surface d'API interne).

---

## Question 4 — `@playwright/cli` : concurrent de `playwright codegen` ?

### Investigation menée

- `npm view @playwright/cli` : version **0.1.15** (publiée fin juin 2026), 23 versions
  (0.0.60 → 0.1.15, premières publications début 2026), bin **`playwright-cli`**,
  **dépend de `playwright@1.62.0-alpha` / `playwright-core@1.62.0-alpha`** (pré-release).
- README (`npm view @playwright/cli readme`) : « Playwright CLI **with SKILLS** ». Positionné
  explicitement pour les **agents de codage** (Claude Code, GitHub Copilot…), en
  **alternative token-efficient à Playwright MCP**. Commandes de pilotage impératif
  (`open`, `type`, `press`, `check`, `screenshot`).
- Point rédhibitoire pour ce projet : « **keeps the browser profile in memory by default…
  cookies and storage state are preserved between CLI calls**, `--persistent` pour persister
  sur disque » → **conserve l'état de session entre appels**, à l'opposé de notre exigence
  d'**isolation totale** (§4). C'est un outil d'automatisation piloté par agent, **pas** un
  enregistreur GUI produisant du code.
- Recherche web (blogs testcollab/testdino, 2026) : confirme le positionnement « alternative
  CLI à MCP pour agents IA », ~4× moins de tokens que MCP. `npx playwright codegen` reste
  l'outil d'enregistrement/génération classique.

### Verdict

`@playwright/cli` **ne remplace pas** `playwright codegen` : c'est un outil **orienté agents
IA** (pilotage + skills, alternative à MCP), en **pré-release 0.1.x adossée à un `1.62-alpha`**,
et il **préserve l'état de session** (incompatible avec notre isolation). **Aucune raison de
s'en préoccuper** pour Playwright Studio : **rester sur `codegen` classique** de 1.56.1.

### À valider sous Windows

- Aucun. Décision d'exclusion, sans dépendance runtime.

---

## Question 5 — Matrice de compatibilité de la stack figée

### Investigation menée

- **Chromium (moteur d'enregistrement)** : `playwright-core/browsers.json` →
  `chromium` revision **1194**, `browserVersion` **141.0.7390.37**. (Aussi présents :
  `chromium-headless-shell-1194`, `ffmpeg-1011`.)
- **Node supporté par Playwright 1.56.1** : `playwright/package.json` et
  `playwright-core/package.json` → `"engines": { "node": ">=18" }`.
- **Electron 38.8.6** : le paquet npm `electron@38.8.6` déclare `@types/node: ^22.7.7` →
  **Node 22.x embarqué**. La ligne Electron 38 est passée de Node **22.18.0** (38.0.0) à
  **22.19.0** (38.1.0), Chromium (UI Electron) **140.x**, V8 **14.0**. La version Node exacte
  de 38.8.6 (patch, courant 2026) est un **22.19.x/22.20.x** — non bloquante ; à confirmer au
  runtime via `process.versions.node`. Dans tous les cas **≥ 22.18 ⇒ satisfait `>=18`** de
  Playwright avec une large marge.
- **`ELECTRON_RUN_AS_NODE` + CLI Playwright** (recherche web) : pas d'incompatibilité de fond.
  Deux pièges connus, **déjà évités** par l'ARCHITECTURE :
  - Depuis Node ≥ 18.20.2 / 20.12.2, `child_process.spawn` d'un `.cmd`/`.bat` exige
    `shell:true`. L'ARCHITECTURE utilise **`execFile(process.execPath, [cli.js, ...])`** —
    on lance le binaire Electron-as-Node avec un `.js`, **pas** un `.cmd` → non concerné.
  - Exécuter des binaires **dans** l'asar échoue avec `spawn(command)`. On lance `cli.js`
    depuis **`app.asar.unpacked`** via `execFile` → non concerné.
  - Ne pas oublier de **nettoyer l'env enfant** (`ELECTRON_RUN_AS_NODE:'1'`, retrait de
    `ELECTRON_ENABLE_LOGGING`, `NODE_OPTIONS`) comme prévu §8.

### Verdict — Versions figées (matrice finale)

| Composant | Version | Node/Runtime | Notes de compatibilité |
|-----------|---------|--------------|------------------------|
| **Playwright** (core + test) | **1.56.1** | `engines.node >=18` | OK avec le Node 22 d'Electron |
| **Chromium (enregistrement, piloté par Playwright)** | rev **1194** = **141.0.7390.37** | — | Fourni via `PLAYWRIGHT_BROWSERS_PATH` / `extraResources ms-playwright` ; headless-shell 1194, ffmpeg 1011 |
| **Electron** | **38.8.6** | **Node 22.x** (≥ 22.18, probablement 22.19/22.20) ; Chromium UI **140.x** ; V8 **14.0** | Sert aussi de runtime Node pour spawner le CLI via `ELECTRON_RUN_AS_NODE` |
| **Node (build/CI)** | **22.x** | — | Aligné sur le Node embarqué d'Electron 38 |
| electron-vite | ^4 | — | Build main/preload/renderer |
| electron-builder | ^26 | — | Cible `portable` win x64 ; `asarUnpack` playwright(+core), `extraResources` browsers |

**Deux Chromium distincts à ne pas confondre** : celui d'**Electron 38 (UI, 140.x)** rend
l'interface de l'app ; celui de **Playwright (rev 1194, 141.0.7390.37)** est le navigateur
**enregistré**. Aucune interaction entre les deux (processus séparés).

**Aucune incompatibilité bloquante détectée.** La contrainte `node >=18` de Playwright est
largement couverte par le Node 22 d'Electron 38.8.6.

### À valider sous Windows

- Au premier lancement du `.exe`, relever `process.versions.node` / `.electron` /
  `.chrome` (exposés via `app:info`) et vérifier qu'ils correspondent à la matrice.

---

## Bonus — Comportement d'écriture du fichier `--output` (flush)

### Investigation menée

- `lib/server/recorder/throttledFile.js` : `setContent()` planifie un flush à **250 ms** ;
  `flush()` fait un `fs.writeFileSync` **synchrone**. L'écriture est donc **incrémentale**
  (« à chaud ») au fil de l'enregistrement, **pas** uniquement à la fermeture propre.
- **Test réel** (`codegen --output <fichier> about:blank` sous xvfb, **SIGTERM après 6 s,
  sans aucune interaction**, puis lecture du fichier) :
  ```
  --- fichier avant SIGTERM : -rw-r--r-- 122 octets
  --- fichier après SIGTERM : -rw-r--r-- 122 octets
  --- contenu :
      import { test, expect } from '@playwright/test';
      test('test', async ({ page }) => {
        await page.goto('about:blank');
      });
  code de sortie codegen = 143 (SIGTERM)
  ```

### Verdict

Le fichier `--output` est **écrit à chaud** (flush throttlé 250 ms) dès la première action
(ici la navigation initiale `about:blank`), **avant** tout arrêt. Un **SIGTERM brutal**
(code 143, sans clic sur « stop ») **laisse le fichier présent** avec le contenu déjà flushé.
On perd **au plus les actions des < 250 dernières ms** non encore flushées. Conséquence pour
`recorder-runner.ts` : lire `outputPath` pour `codePreview` est fiable non seulement sur
`exit 0` mais aussi après un `stop()`/kill — le fichier existe et reflète l'enregistrement
au dernier flush.
