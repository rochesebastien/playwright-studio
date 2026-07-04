import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Tests main/Node uniquement — aucune dépendance au renderer/DOM.
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Défaut confortable pour les tests unitaires ; le smoke déclare son propre
    // timeout (60 s) au niveau du test.
    testTimeout: 10_000,
    hookTimeout: 10_000,
    // Chaque fichier isolé : les mocks vi.mock('electron') d'un fichier ne
    // fuient pas vers les autres.
    isolate: true,
  },
});
