# VALIDATION-WINDOWS — checklist opérationnelle

> Points **non tranchables sous Linux** (packaging `.exe`, isolation profil, proxy système
> Windows, SmartScreen/signature). À dérouler sur une **machine Windows 10/11 x64 vierge**
> (idéalement sans Playwright/Node installés, pour prouver l'autonomie du `.exe`).
> Cocher chaque étape ; noter version relevée, capture éventuelle, verdict PASS/FAIL.

Rappels issus de `DECISIONS.md` (lire avant de tester) :
- **`--proxy-server=direct://` via `codegen` / via l'option `proxy` est CASSÉ en 1.56.1**
  (réécrit en `http://direct` ⇒ `ERR_PROXY_CONNECTION_FAILED`). Le mode « direct » doit passer
  par un **argument Chromium brut** `--proxy-server=direct://` (ou `--no-proxy-server`) — voir
  lot 3. Tester la version **corrigée**, pas la version spec d'origine.
- L'UI de l'inspecteur n'est fonctionnelle que si `playwright-core/**` est unpacké **et** que
  `cli.js` est lancé depuis `app.asar.unpacked`.

---

## Pré-requis

- [ ] Machine Windows x64 vierge (VM propre recommandée, snapshot avant test).
- [ ] Aucun Node.js / Playwright / Chrome de dev installé (pour prouver l'autonomie).
- [ ] Récupérer le `.exe` portable produit par la CI (`win.target: portable`).
- [ ] Avoir sous la main l'accès **paramètres proxy Windows** (Paramètres → Réseau et
      Internet → Proxy) et de préférence droits admin (pour SmartScreen / signature).

---

## Lot 0 — L'`.exe` portable démarre et l'inspecteur est fonctionnel

1. [ ] Copier le `.exe` sur le Bureau d'un **compte utilisateur standard**. Le lancer.
2. [ ] La fenêtre de l'app s'ouvre (config minimale visible), **sans** écran d'erreur.
3. [ ] Ouvrir l'écran d'infos (`app:info`) et **relever** : `appVersion`, `electron`,
       `playwright` (= 1.56.1), `chromiumRevision` (= 1194), `browsersPath` (résolu),
       `packaged` = true. Vérifier la cohérence avec la matrice de `DECISIONS.md`.
4. [ ] Laisser les réglages par défaut, **démarrer un enregistrement** (engine `codegen`,
       `startUrl` = `https://example.com` par ex.).
5. [ ] **Un Chromium séparé s'ouvre** et **la fenêtre inspecteur/recorder s'affiche
       correctement** (barre d'outils recorder, code généré qui se remplit au fil des clics).
       → prouve la résolution **hors asar** des assets `vite/recorder`. En cas d'échec typique :
       page blanche / erreur sur `https://playwright/index.html` / `ENOENT` → l'`asarUnpack`
       ou le lancement depuis `app.asar.unpacked` est en défaut.
6. [ ] Cliquer quelques éléments : le code se génère ; si `--output` configuré, le fichier
       cible se remplit **pendant** l'enregistrement (écriture à chaud, cf. DECISIONS bonus).
7. [ ] Fermer le navigateur → l'app repasse en état `stopped` et lit le fichier
       (`codePreview` renseigné). Tester aussi `stop()` depuis l'UI : le fichier existe et
       reflète l'enregistrement.
8. [ ] Vérifier qu'il **n'y a plus de processus Chromium résiduel** après l'arrêt
       (Gestionnaire des tâches).

---

## Lot 1 — Isolation des cookies / session entre deux lancements

Objectif : prouver qu'aucun état (cookies, storage, SSO) ne survit d'un enregistrement à l'autre.

1. [ ] Démarrer un enregistrement, naviguer vers un site posant un cookie facilement
       observable (ex. se connecter à un service, ou visiter un site qui affiche « accepter
       les cookies » et l'accepter, ou poser un cookie via la console DevTools).
2. [ ] **Vérifier le profil temporaire** : dans le Gestionnaire des tâches / Process Explorer,
       inspecter la ligne de commande du `chrome.exe` enfant → elle doit contenir un
       `--user-data-dir=%TEMP%\playwright_chromiumdev_profile-XXXX` (profil jetable, **jamais**
       le profil Chrome de l'utilisateur, **jamais** un `--user-data-dir` fixe).
3. [ ] Fermer le navigateur (fin d'enregistrement).
4. [ ] Vérifier que le dossier de profil temporaire **a été supprimé** (`%TEMP%`).
5. [ ] **Relancer** un nouvel enregistrement vers le **même site** : l'utilisateur doit être
       **déconnecté / le cookie absent / la bannière re-affichée** → aucune persistance.
6. [ ] Confirmer dans les réglages qu'aucun `--user-data-dir`, `--save-storage`,
       `--load-storage`, `storageState`, `--incognito` n'est jamais passé (interdits §4).

**PASS** = état de session non partagé entre deux lancements + profil temporaire créé puis détruit.

---

## Lot 2 — Mode `system` : héritage du proxy système (comportement attendu)

1. [ ] Configurer un **proxy système Windows** pointant vers un proxy **réel et joignable**
       (ou un mitmproxy/Fiddler local sur `127.0.0.1:8888`). Paramètres → Proxy → « Utiliser
       un serveur proxy » activé.
2. [ ] Dans l'app, choisir le **mode proxy `system`** (aucun flag proxy émis).
3. [ ] Démarrer un enregistrement, naviguer vers un site externe.
4. [ ] **Vérifier que le trafic passe par le proxy** (logs Fiddler/mitmproxy montrent les
       requêtes du Chromium enregistré). → confirme l'héritage du proxy système quand rien
       n'est passé.
5. [ ] Vérifier dans la ligne de commande du `chrome.exe` enfant : **aucun `--proxy-server`**.

---

## Lot 3 — Mode `direct` : NON-héritage du proxy système (point critique)

> ⚠️ Tester l'implémentation **corrigée** du mode direct
> (`args:['--proxy-server=direct://']` ou `--no-proxy-server`), **pas** `codegen --proxy-server=direct://`.

**Préparer un proxy « bidon » pour prouver le contournement :**

1. [ ] Configurer un **proxy système Windows volontairement invalide / injoignable** :
       Paramètres → Proxy → adresse `http://127.0.0.1:9` (port fermé) ou `http://proxy.invalid:8080`.
2. [ ] **Contrôle négatif** (prouver que le proxy bidon casse bien) : lancer un enregistrement
       en mode `system`. La navigation vers un site externe doit **échouer**
       (`ERR_PROXY_CONNECTION_FAILED`) → le proxy système bidon est bien pris en compte.
3. [ ] **Test direct corrigé** : lancer un enregistrement en mode `direct`. La navigation vers
       le même site externe doit **RÉUSSIR** malgré le proxy système bidon → le mode direct
       **ignore** le proxy système (connexion directe).
4. [ ] Inspecter la ligne de commande du `chrome.exe` enfant : elle doit contenir
       **`--proxy-server=direct://`** (valeur **exacte**, non réécrite). Si l'on y lit
       **`--proxy-server=http://direct`**, c'est le **bug de `normalizeProxySettings`** →
       l'implémentation utilise encore l'option `proxy`/`codegen --proxy-server` : **FAIL**,
       repasser par l'argument Chromium brut (cf. DECISIONS Q1).
5. [ ] Cas `--no-proxy-server` (alternative acceptée) : même résultat attendu (navigation OK,
       flag `--no-proxy-server` présent).

**PASS** = mode `system` casse (proxy bidon appliqué) ET mode `direct` fonctionne (proxy ignoré),
avec `--proxy-server=direct://` **littéral** dans la ligne de commande.

**Nota** — mode `manual` : configurer `server` = vrai proxy joignable ; vérifier
`--proxy-server=<server>` (+ `--proxy-bypass-list` si bypass) dans la ligne de commande et le
trafic routé en conséquence.

---

## Lot 4 — SmartScreen / signature de code

1. [ ] Sur la VM vierge, télécharger l'`.exe` **via un navigateur** (pour porter le marquage
       « Mark-of-the-Web » / zone Internet), puis le lancer.
2. [ ] Observer **Windows SmartScreen** : « Windows a protégé votre PC » ?
       - [ ] Si l'`.exe` **n'est pas signé** : SmartScreen bloque (« Éditeur inconnu »),
             l'utilisateur doit « Informations complémentaires → Exécuter quand même ».
             → documenter comme friction de distribution.
       - [ ] Si l'`.exe` **est signé** (certificat OV/EV Authenticode) : relever l'éditeur
             affiché ; un cert **EV** ou une réputation établie réduit/annule l'alerte.
3. [ ] Vérifier la signature : clic droit → Propriétés → **Signatures numériques** (présence,
       validité, chaîne de confiance, horodatage). En ligne de commande :
       `signtool verify /pa /v chemin.exe` (si SDK dispo) ou
       `Get-AuthenticodeSignature .\chemin.exe` (PowerShell).
4. [ ] Décision de distribution : **signature Authenticode requise** pour éviter le blocage
       SmartScreen sur postes utilisateurs. Noter le type de certificat retenu (OV vs EV) et
       le délai de « réputation » éventuel.

---

## Lot 5 — Antivirus / SmartScreen App-Control (bonus)

1. [ ] Vérifier que Microsoft Defender ne met pas l'`.exe` (ou le Chromium extrait) en
       quarantaine au premier lancement.
2. [ ] Si l'app extrait les navigateurs dans `%LOCALAPPDATA%`/`resourcesPath`, vérifier les
       droits d'écriture sur un compte **standard** (pas admin).

---

## Récapitulatif à remplir

| Lot | Point validé | Verdict | Version/commande relevée | Remarque |
|-----|--------------|---------|--------------------------|----------|
| 0   | `.exe` + inspecteur | | | |
| 1   | Isolation session | | | |
| 2   | Proxy `system` hérité | | | |
| 3   | Proxy `direct` non hérité (corrigé) | | | |
| 4   | SmartScreen / signature | | | |
| 5   | AV / droits | | | |
