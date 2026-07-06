# Ressources de build (icône de l'application)

Ce dossier contient les ressources utilisées **au moment du packaging** par
electron-builder (`buildResources: build` dans `electron-builder.yml`).

## Ajouter le logo de l'application

Dépose **un seul fichier** ici :

```
build/icon.png
```

Contraintes :

- Format **PNG**, image **carrée**, **256×256 minimum** (512×512 ou plus
  recommandé pour un rendu net à toutes les tailles).
- Nom exact : `icon.png` (tout en minuscules).

C'est tout. Rien d'autre à modifier.

## Ce qui se passe automatiquement

- **Packaging Windows** : electron-builder détecte `build/icon.png`, génère le
  `.ico` correspondant et l'utilise comme icône de l'exécutable portable — elle
  apparaît sur le fichier `.exe`, dans la barre des tâches et dans la fenêtre.
- **Runtime (dev / `npm run dev`)** : la fenêtre de l'application utilise aussi
  `build/icon.png` s'il est présent (voir `getAppIconPath()` dans
  `src/main/paths.ts`).

## Absence tolérée

Tant que `build/icon.png` n'existe pas, l'application démarre et se package
normalement avec l'icône par défaut — aucune erreur, aucune CI cassée. Il suffit
d'ajouter le fichier pour que le logo soit pris en compte au prochain build.
