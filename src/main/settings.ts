import path from 'node:path';
import { writeFileSync, readFileSync, renameSync, mkdirSync } from 'node:fs';
import { app } from 'electron';
import type {
  Settings,
  ProxyConfig,
  ProxyMode,
  RecorderEngine,
  RecorderBrowser,
  StepsConfig,
  TargetLang,
} from '../shared/types';

const ENGINES: RecorderEngine[] = ['codegen', 'api'];
const BROWSERS: RecorderBrowser[] = ['chromium', 'msedge'];
const DEFAULT_STEP_PATTERN = 'STEP {n} : {label}';
const TARGETS: TargetLang[] = [
  'playwright-test',
  'javascript',
  'python',
  'python-pytest',
  'java',
  'csharp',
];
const PROXY_MODES: ProxyMode[] = ['direct', 'system', 'manual'];

function settingsFilePath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

export function defaultSettings(): Settings {
  return {
    engine: 'codegen',
    browser: 'chromium',
    startUrl: '',
    target: 'playwright-test',
    outputDir: app.getPath('documents'),
    proxy: { mode: 'direct' },
    steps: { enabled: false, pattern: DEFAULT_STEP_PATTERN, labels: [] },
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function validateProxy(raw: unknown): ProxyConfig {
  const fallback: ProxyConfig = { mode: 'direct' };
  if (!isObject(raw)) return fallback;
  const mode = raw.mode;
  if (typeof mode !== 'string' || !PROXY_MODES.includes(mode as ProxyMode)) {
    return fallback;
  }
  const proxy: ProxyConfig = { mode: mode as ProxyMode };
  if (typeof raw.server === 'string') proxy.server = raw.server;
  if (typeof raw.bypass === 'string') proxy.bypass = raw.bypass;
  return proxy;
}

function validateViewport(
  raw: unknown,
): { width: number; height: number } | undefined {
  if (!isObject(raw)) return undefined;
  const { width, height } = raw;
  if (
    typeof width === 'number' &&
    Number.isFinite(width) &&
    width > 0 &&
    typeof height === 'number' &&
    Number.isFinite(height) &&
    height > 0
  ) {
    return { width, height };
  }
  return undefined;
}

function validateExtraHeaders(
  raw: unknown,
): Record<string, string> | undefined {
  if (!isObject(raw)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string') out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Valide la config du mode étapes champ par champ.
 * enabled non booléen → false ; pattern non-string ou vide → défaut ;
 * labels non-array ou éléments non-string → filtrés.
 */
function validateSteps(raw: unknown): StepsConfig {
  const fallback: StepsConfig = {
    enabled: false,
    pattern: DEFAULT_STEP_PATTERN,
    labels: [],
  };
  if (!isObject(raw)) return fallback;

  const enabled = typeof raw.enabled === 'boolean' ? raw.enabled : fallback.enabled;
  const pattern =
    typeof raw.pattern === 'string' && raw.pattern.trim() !== ''
      ? raw.pattern
      : fallback.pattern;
  const labels = Array.isArray(raw.labels)
    ? raw.labels.filter((x): x is string => typeof x === 'string')
    : fallback.labels;

  return { enabled, pattern, labels };
}

/** Validation champ par champ : champ manquant/invalide → défaut, champ inconnu ignoré. */
export function validateSettings(raw: unknown): Settings {
  const d = defaultSettings();
  if (!isObject(raw)) return d;

  const engine =
    typeof raw.engine === 'string' && ENGINES.includes(raw.engine as RecorderEngine)
      ? (raw.engine as RecorderEngine)
      : d.engine;

  const browser =
    typeof raw.browser === 'string' && BROWSERS.includes(raw.browser as RecorderBrowser)
      ? (raw.browser as RecorderBrowser)
      : d.browser;

  const startUrl = typeof raw.startUrl === 'string' ? raw.startUrl : d.startUrl;

  const target =
    typeof raw.target === 'string' && TARGETS.includes(raw.target as TargetLang)
      ? (raw.target as TargetLang)
      : d.target;

  const outputDir =
    typeof raw.outputDir === 'string' && raw.outputDir.trim() !== ''
      ? raw.outputDir
      : d.outputDir;

  const settings: Settings = {
    engine,
    browser,
    startUrl,
    target,
    outputDir,
    proxy: validateProxy(raw.proxy),
    steps: validateSteps(raw.steps),
  };

  const viewport = validateViewport(raw.viewport);
  if (viewport) settings.viewport = viewport;

  if (typeof raw.device === 'string' && raw.device.trim() !== '') {
    settings.device = raw.device;
  }

  const extraHeaders = validateExtraHeaders(raw.extraHeaders);
  if (extraHeaders) settings.extraHeaders = extraHeaders;

  return settings;
}

/** Lecture tolérante : fichier absent/corrompu → défauts + réécriture. */
export function getSettings(): Settings {
  const file = settingsFilePath();
  let parsed: unknown;
  try {
    const content = readFileSync(file, 'utf8');
    parsed = JSON.parse(content);
  } catch {
    const d = defaultSettings();
    saveSettings(d);
    return d;
  }
  const validated = validateSettings(parsed);
  return validated;
}

/** Écriture atomique : write temp + rename. */
export function saveSettings(settings: Settings): void {
  const file = settingsFilePath();
  const dir = path.dirname(file);
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    // dir existe déjà
  }
  const tmp = path.join(dir, `settings.json.${process.pid}.tmp`);
  writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf8');
  renameSync(tmp, file);
}
