# Playwright Studio

Launcher desktop qui lance un Chromium Playwright **totalement isolé** pour enregistrer un scénario et en générer le code. L'application **contrôle l'environnement** (isolation, proxy, packaging, distribution) ; le moteur de capture et de génération des sélecteurs n'est **pas** réécrit — c'est Playwright (`codegen`) qui fait le recording.

## Pourquoi

Sur un poste d'entreprise, `playwright codegen` lancé « à la main » hérite du profil Chrome, des cookies, du SSO et du proxy système. Les scénarios enregistrés se retrouvent pollués par une session déjà authentifiée et un routage réseau non maîtrisé.

La réponse de Playwright Studio :

- **Chromium vierge à chaque lancement** : contexte **non-persistant**, profil temporaire jeté à la fermeture.
- **Aucun état hérité** : jamais de `user-data-dir` fixe, de `storageState`, de `--save-storage` / `--load-storage` ni de `--incognito`.
- **Proxy contrôlé** : mode `direct` par défaut (connexion réellement directe, y compris `localhost`), avec possibilité d'hériter du proxy système ou d'en configurer un manuellement — le choix est explicite.

## Utilisation

Distribution : un **`.exe` portable Windows x64** (aucune installation, aucun Node/Playwright requis sur la machine).

1. **Double-cliquer** sur l'exe portable. La fenêtre de configuration s'ouvre.
2. Renseigner le formulaire :
   - **URL de départ** (optionnel) : page sur laquelle démarrer l'enregistrement.
   - **Langage cible** : `playwright-test`, `javascript`, `python`, `python-pytest`, `java` ou `csharp`.
   - **Fichier de sortie** : nom + dossier (bouton « Parcourir… »). Le chemin retenu est affiché sous le champ.
   - **Proxy** (3 modes, **`direct` par défaut**) :
     - `direct` — aucun proxy, connexion directe (recommandé) ;
     - `système` — héritage du proxy Windows (avertissement affiché : l'isolation réseau n'est alors plus garantie) ;
     - `manuel` — serveur (`http://proxy:8080`) + liste de bypass optionnelle.
   - **Avancé** (repliable) : viewport (largeur × hauteur) **ou** device Playwright (`iPhone 15`…, mutuellement exclusifs), moteur, et en-têtes HTTP (moteur API uniquement).
3. Cliquer **« Démarrer l'enregistrement »**. Un **Chromium séparé** s'ouvre avec l'inspecteur/recorder Playwright.
4. **Interagir** dans le navigateur : le code se génère au fil des actions.
5. **Arrêter** (bouton « Arrêter » ou fermeture du navigateur) : l'app repasse en état « Terminé », le **code est écrit dans le fichier** de sortie et un **aperçu copiable** s'affiche (bouton « Copier »).

### Les deux moteurs

| Moteur | Rôle | Sortie du code |
|--------|------|----------------|
| **`codegen`** (recommandé, défaut) | Enregistreur standard `playwright codegen` | **Fichier automatique** via `--output`, écrit à chaud pendant l'enregistrement |
| **`api`** (`page.pause`) | Fallback pour un contexte avancé (en-têtes HTTP personnalisés) | **Pas de sortie fichier automatique** : le code se récupère via le **bouton « copy » de l'inspecteur** (limitation documentée — voir [DECISIONS.md](docs/DECISIONS.md) Q3) |

## Garanties d'isolation

Faits vérifiables (voir [ARCHITECTURE.md](docs/ARCHITECTURE.md) §4 et [VALIDATION-WINDOWS.md](docs/VALIDATION-WINDOWS.md) lots 1–3) :

- **Profil temporaire jeté** : Chromium tourne dans un `--user-data-dir` temporaire (`%TEMP%\playwright_chromiumdev_profile-XXXX`) créé au lancement et supprimé à la fermeture.
- **Jamais** de `user-data-dir` fixe, de `storageState`, de `--save-storage` / `--load-storage` ni de `--incognito` (interdits absolus).
- **Mode `direct` réellement direct**, y compris `localhost` : implémenté par `--proxy-server=direct:// --proxy-bypass=*` + env `PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK=1` (le `direct://` seul est réécrit et casse la navigation — voir [DECISIONS.md](docs/DECISIONS.md) Q1).
- **Mode `système` = héritage explicite et assumé** : aucun flag proxy n'est émis, Chromium reprend le proxy Windows. L'UI l'indique par un avertissement.
- **Aucune session partagée** entre deux enregistrements successifs.

## Développement

Prérequis : **Node 22.x** (aligné sur le Node embarqué d'Electron 38).

```bash
# Installation des dépendances.
# En egress contraint (CDN Electron / browsers Playwright bloqués), désactiver
# les téléchargements au moment de l'install :
#   ELECTRON_SKIP_BINARY_DOWNLOAD=1  → pas de binaire Electron (dev sans packaging)
#   PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 → pas de browsers à l'install
npm install

# Lancer l'app en mode développement (electron-vite).
npm run dev

# Tests unitaires + smoke (vitest).
# Le smoke lance un vrai Chromium headed → sous Linux, encapsuler dans xvfb :
xvfb-run -a npm test        # Linux
npm test                    # Windows / macOS

# Vérification de types (main).
npm run typecheck
```

Scripts npm réels : `dev`, `build`, `typecheck`, `test`, `prepare-browsers`, `dist:win`.

Le build de l'`.exe` portable est décrit dans [docs/BUILD.md](docs/BUILD.md).

## Versions figées

Ne pas suivre `latest`. La stack est figée et testée telle quelle.

| Composant | Version figée | Détail |
|-----------|---------------|--------|
| Playwright | **1.56.1** | Pilote le recording et le codegen |
| Chromium (enregistré) | révision **1194** = **141.0.7390.37** | Navigateur piloté par Playwright, embarqué via `resources/ms-playwright` |
| Electron | **38.8.6** | Embarque **Node 22.x** ; sert aussi de runtime Node pour spawner le CLI (`ELECTRON_RUN_AS_NODE`) |
| Node (build) | **22.x** | Aligné sur Electron 38 |

> Le Chromium **d'Electron** (UI de l'app, 140.x) et le Chromium **de Playwright** (rev 1194, 141.x, enregistré) sont deux processus distincts, sans interaction.

**Règle** : toute montée de version = **re-test complet du lot 0** (packaging, inspecteur hors asar, proxy, isolation). Justification dans [DECISIONS.md](docs/DECISIONS.md) Q5.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — contrat de référence, stack, IPC, isolation, packaging.
- [docs/DECISIONS.md](docs/DECISIONS.md) — les arbitrages techniques avec preuves (Q1 proxy direct, Q2 asar/inspecteur, Q3 sortie A2, Q4 `@playwright/cli`, Q5 matrice de versions).
- [docs/BUILD.md](docs/BUILD.md) — build reproductible (Nexus, CI GitHub Actions, signature, dépannage).
- [docs/VALIDATION-WINDOWS.md](docs/VALIDATION-WINDOWS.md) — checklist de validation sur machine Windows vierge.
