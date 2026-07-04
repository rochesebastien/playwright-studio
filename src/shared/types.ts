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
