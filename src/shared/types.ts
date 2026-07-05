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

/**
 * Navigateur d'enregistrement.
 * - 'chromium' : le Chromium Playwright embarqué (défaut).
 * - 'msedge'   : le Microsoft Edge INSTALLÉ SUR LE SYSTÈME (channel Chromium
 *   msedge de codegen). L'isolation reste identique (profil temporaire jeté),
 *   mais requiert Edge présent sur la machine.
 */
export type RecorderBrowser = 'chromium' | 'msedge';

/** Configuration du mode étapes (checkpoints → commentaires dans le code). */
export interface StepsConfig {
  /** Mode étapes actif. */
  enabled: boolean;
  /**
   * Gabarit du commentaire injecté (sans le préfixe de commentaire, qui
   * dépend du langage cible). Placeholders : {n} = numéro d'étape (1-based),
   * {label} = libellé de l'étape. Défaut : "STEP {n} : {label}".
   */
  pattern: string;
  /** Libellés des étapes, dans l'ordre. Étapes au-delà : "Étape {n}". */
  labels: string[];
}

export interface RecorderOptions {
  engine: RecorderEngine;
  browser: RecorderBrowser;
  startUrl?: string;
  target: TargetLang;
  outputPath: string;
  proxy: ProxyConfig;
  viewport?: { width: number; height: number };
  device?: string;              // nom de device Playwright, ex. "iPhone 15"
  extraHeaders?: Record<string, string>; // A2 uniquement
  /** Mode étapes — codegen (A1) uniquement. */
  steps?: StepsConfig;
}

export interface Settings {
  engine: RecorderEngine;       // défaut 'codegen'
  browser: RecorderBrowser;     // défaut 'chromium'
  startUrl: string;             // défaut ''
  target: TargetLang;           // défaut 'playwright-test'
  outputDir: string;            // défaut: dossier Documents utilisateur
  proxy: ProxyConfig;           // défaut { mode: 'direct' }
  viewport?: { width: number; height: number };
  device?: string;
  extraHeaders?: Record<string, string>;
  steps: StepsConfig;           // défaut { enabled: false, pattern: 'STEP {n} : {label}', labels: [] }
}

export type RecorderState = 'idle' | 'starting' | 'recording' | 'stopped' | 'error';

export interface RecorderStatus {
  state: RecorderState;
  message?: string;             // erreur lisible ou info
  exitCode?: number | null;
  outputPath?: string;
  codePreview?: string;         // contenu du fichier généré après arrêt (si lisible)
  /** Numéro de l'étape en cours (1-based) quand le mode étapes est actif. */
  currentStep?: number;
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

export interface CheckpointResult {
  ok: boolean;
  /** Numéro de l'étape qui vient d'être clôturée (1-based). */
  step?: number;
  error?: string;
}
