import type {
  Settings,
  TargetLang,
  ProxyMode,
  ProxyConfig,
  RecorderOptions,
  RecorderEngine,
} from '../../shared/types';

/** Type utilitaire : l'API preload, garantie non nulle une fois Electron détecté. */
export type Api = NonNullable<Window['api']>;

/** Une paire d'en-tête HTTP en cours d'édition (l'ordre et les clés vides sont tolérés). */
export interface HeaderPair {
  key: string;
  value: string;
}

/** Options du select « Langage cible » (contrat §5 : TargetLang). */
export const TARGET_OPTIONS: ReadonlyArray<{ value: TargetLang; label: string }> = [
  { value: 'playwright-test', label: 'Playwright Test (TypeScript)' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'python', label: 'Python' },
  { value: 'python-pytest', label: 'Pytest' },
  { value: 'java', label: 'Java' },
  { value: 'csharp', label: 'C#' },
];

/** Nom de fichier de sortie par défaut, cohérent avec le langage cible. */
export const DEFAULT_FILENAMES: Record<TargetLang, string> = {
  'playwright-test': 'scenario.spec.ts',
  javascript: 'scenario.js',
  python: 'scenario.py',
  'python-pytest': 'test_scenario.py',
  java: 'Scenario.java',
  csharp: 'Scenario.cs',
};

/** Ensemble des noms par défaut, pour savoir si l'utilisateur a personnalisé le nom. */
export const DEFAULT_FILENAME_SET: ReadonlySet<string> = new Set(
  Object.values(DEFAULT_FILENAMES),
);

export function defaultFilenameFor(target: TargetLang): string {
  return DEFAULT_FILENAMES[target];
}

/** Settings de repli avant le premier chargement / si getSettings échoue. */
export const FALLBACK_SETTINGS: Settings = {
  engine: 'codegen',
  startUrl: '',
  target: 'playwright-test',
  outputDir: '',
  proxy: { mode: 'direct' },
};

/**
 * Découpe un chemin complet (Windows `\` ou POSIX `/`) en dossier + nom de fichier.
 */
export function splitPath(full: string): { dir: string; name: string } {
  const idx = Math.max(full.lastIndexOf('/'), full.lastIndexOf('\\'));
  if (idx < 0) return { dir: '', name: full };
  return { dir: full.slice(0, idx), name: full.slice(idx + 1) };
}

/**
 * Recompose un chemin complet à partir d'un dossier et d'un nom.
 * Le séparateur est déduit du dossier (rétro-compat Windows).
 */
export function joinPath(dir: string, name: string): string {
  if (!dir) return name;
  const sep = dir.includes('\\') ? '\\' : '/';
  const trimmed = dir.replace(/[\\/]+$/, '');
  return `${trimmed}${sep}${name}`;
}

export function pairsToRecord(pairs: ReadonlyArray<HeaderPair>): Record<string, string> {
  const record: Record<string, string> = {};
  for (const { key, value } of pairs) {
    const k = key.trim();
    if (k) record[k] = value;
  }
  return record;
}

export function recordToPairs(record: Record<string, string> | undefined): HeaderPair[] {
  if (!record) return [];
  return Object.entries(record).map(([key, value]) => ({ key, value }));
}

export function buildProxy(
  mode: ProxyMode,
  server: string,
  bypass: string,
): ProxyConfig {
  if (mode !== 'manual') return { mode };
  const proxy: ProxyConfig = { mode };
  const s = server.trim();
  const b = bypass.trim();
  if (s) proxy.server = s;
  if (b) proxy.bypass = b;
  return proxy;
}

/** Viewport valide seulement si largeur ET hauteur sont des entiers > 0. */
export function parseViewport(
  width: string,
  height: string,
): { width: number; height: number } | undefined {
  const w = Number.parseInt(width, 10);
  const h = Number.parseInt(height, 10);
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    return { width: w, height: h };
  }
  return undefined;
}

/** État complet du formulaire, source unique pour composer Settings / RecorderOptions. */
export interface FormState {
  engine: RecorderEngine;
  startUrl: string;
  target: TargetLang;
  outputDir: string;
  fileName: string;
  proxyMode: ProxyMode;
  proxyServer: string;
  proxyBypass: string;
  viewportWidth: string;
  viewportHeight: string;
  device: string;
  headers: HeaderPair[];
}

export function toSettings(f: FormState): Settings {
  const viewport = parseViewport(f.viewportWidth, f.viewportHeight);
  const device = f.device.trim();
  const record = pairsToRecord(f.headers);

  const settings: Settings = {
    engine: f.engine,
    startUrl: f.startUrl,
    target: f.target,
    outputDir: f.outputDir,
    proxy: buildProxy(f.proxyMode, f.proxyServer, f.proxyBypass),
  };
  // viewport et device sont mutuellement exclusifs (viewport prioritaire).
  if (viewport) settings.viewport = viewport;
  else if (device) settings.device = device;
  if (Object.keys(record).length > 0) settings.extraHeaders = record;
  return settings;
}

export function toRecorderOptions(f: FormState): RecorderOptions {
  const viewport = parseViewport(f.viewportWidth, f.viewportHeight);
  const device = f.device.trim();
  const startUrl = f.startUrl.trim();
  const record = pairsToRecord(f.headers);

  const options: RecorderOptions = {
    engine: f.engine,
    target: f.target,
    outputPath: joinPath(f.outputDir, f.fileName),
    proxy: buildProxy(f.proxyMode, f.proxyServer, f.proxyBypass),
  };
  if (startUrl) options.startUrl = startUrl;
  if (viewport) options.viewport = viewport;
  else if (device) options.device = device;
  // extraHeaders : variante A2 (engine 'api') uniquement.
  if (f.engine === 'api' && Object.keys(record).length > 0) {
    options.extraHeaders = record;
  }
  return options;
}
