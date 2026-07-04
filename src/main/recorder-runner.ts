import { execFile, type ChildProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import type {
  RecorderOptions,
  RecorderStatus,
  StartResult,
} from '../shared/types';
import {
  getPlaywrightCliPath,
  getPlaywrightModulePath,
  getA2RunnerPath,
  getBrowsersPath,
} from './paths';

/** Taille max du buffer circulaire stderr. */
const STDERR_MAX = 2000;
/** Délai avant de considérer le process comme « recording » s'il n'a rien émis. */
const RECORDING_GRACE_MS = 1000;
/** Délai avant escalade SIGKILL après SIGTERM. */
const KILL_ESCALATE_MS = 5000;

/**
 * Construit les arguments de `playwright codegen` à partir des options.
 * Fonction PURE (aucune I/O) — testable unitairement.
 *
 * Interdits absolus : --user-data-dir, --save-storage, --load-storage, --incognito.
 */
export function buildCodegenArgs(o: RecorderOptions): string[] {
  const args: string[] = [];

  args.push('--target', o.target);
  args.push('--output', o.outputPath);

  switch (o.proxy.mode) {
    case 'direct':
      // `direct://` seul est réécrit en `http://direct` (proxy inexistant) par
      // normalizeProxySettings() de Playwright 1.56.1 et casse la navigation.
      // Le wildcard `--proxy-bypass=*` court-circuite le proxy pour TOUS les
      // hôtes → connexions directes. Nécessite aussi
      // PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK=1 dans l'env enfant
      // pour couvrir le loopback (cf. buildChildEnv et DECISIONS.md Q1).
      args.push('--proxy-server=direct://');
      args.push('--proxy-bypass=*');
      break;
    case 'manual':
      if (o.proxy.server) {
        args.push(`--proxy-server=${o.proxy.server}`);
      }
      if (o.proxy.bypass) {
        args.push(`--proxy-bypass=${o.proxy.bypass}`);
      }
      break;
    case 'system':
      // ne rien passer — héritage assumé
      break;
  }

  if (o.viewport) {
    args.push(`--viewport-size=${o.viewport.width},${o.viewport.height}`);
  }
  if (o.device) {
    args.push(`--device=${o.device}`);
  }

  if (o.startUrl && o.startUrl.trim() !== '') {
    args.push(o.startUrl);
  }

  return args;
}

/**
 * Construit l'environnement du process enfant.
 * Fonction PURE — testable unitairement.
 * Retire NODE_OPTIONS et ELECTRON_ENABLE_LOGGING, force ELECTRON_RUN_AS_NODE
 * et PLAYWRIGHT_BROWSERS_PATH.
 */
export function buildChildEnv(browsersPath: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    PLAYWRIGHT_BROWSERS_PATH: browsersPath,
    // Sans ceci, Playwright ajoute `<-loopback>` à la bypass-list dès qu'un
    // proxy est passé : le trafic localhost passerait alors par le proxy
    // factice du mode direct et échouerait (DECISIONS.md Q1).
    PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK: '1',
  };
  delete env.NODE_OPTIONS;
  delete env.ELECTRON_ENABLE_LOGGING;
  return env;
}

/** Config JSON passée au script A2. */
interface A2Config {
  startUrl?: string;
  /** Mode direct : argument Chromium brut --no-proxy-server (jamais l'option proxy). */
  noProxyServer?: boolean;
  proxy?: { server: string; bypass?: string };
  viewport?: { width: number; height: number };
  extraHeaders?: Record<string, string>;
  browsersPath: string;
  /**
   * Racine du module playwright à require() par le script — indispensable en
   * packagé où a2-runner.cjs (dans resources/) ne voit pas app.asar.unpacked.
   */
  playwrightModulePath?: string;
}

/** Résout la config proxy des options en config Playwright (ou undefined). */
function resolveA2Proxy(
  o: RecorderOptions,
): { server: string; bypass?: string } | undefined {
  switch (o.proxy.mode) {
    case 'direct':
      // Le direct passe par noProxyServer (arg brut), pas par l'option proxy
      // — `{ server: 'direct://' }` serait réécrit en `http://direct` et
      // casserait la navigation (DECISIONS.md Q1).
      return undefined;
    case 'manual':
      if (o.proxy.server) {
        return o.proxy.bypass
          ? { server: o.proxy.server, bypass: o.proxy.bypass }
          : { server: o.proxy.server };
      }
      return undefined;
    case 'system':
      return undefined;
  }
}

export function buildA2Config(
  o: RecorderOptions,
  browsersPath: string,
  playwrightModulePath?: string,
): A2Config {
  return {
    startUrl: o.startUrl,
    noProxyServer: o.proxy.mode === 'direct' ? true : undefined,
    proxy: resolveA2Proxy(o),
    viewport: o.viewport,
    extraHeaders: o.extraHeaders,
    browsersPath,
    playwrightModulePath,
  };
}

export interface RecorderRunner {
  start(options: RecorderOptions): Promise<StartResult>;
  stop(): Promise<void>;
  readonly running: boolean;
  onStatus(cb: (s: RecorderStatus) => void): void;
}

export class PlaywrightRecorderRunner implements RecorderRunner {
  private child: ChildProcess | null = null;
  private stderrBuf = '';
  private listeners = new Set<(s: RecorderStatus) => void>();
  private currentOutputPath: string | undefined;
  private recordingTimer: NodeJS.Timeout | null = null;
  private killTimer: NodeJS.Timeout | null = null;
  private markedRecording = false;
  private stopRequested = false;

  get running(): boolean {
    return this.child !== null;
  }

  onStatus(cb: (s: RecorderStatus) => void): void {
    this.listeners.add(cb);
  }

  private emit(s: RecorderStatus): void {
    for (const cb of this.listeners) {
      cb(s);
    }
  }

  private appendStderr(chunk: string): void {
    this.stderrBuf += chunk;
    if (this.stderrBuf.length > STDERR_MAX) {
      this.stderrBuf = this.stderrBuf.slice(this.stderrBuf.length - STDERR_MAX);
    }
  }

  private markRecording(): void {
    if (this.markedRecording || !this.child) return;
    this.markedRecording = true;
    if (this.recordingTimer) {
      clearTimeout(this.recordingTimer);
      this.recordingTimer = null;
    }
    this.emit({ state: 'recording', outputPath: this.currentOutputPath });
  }

  async start(options: RecorderOptions): Promise<StartResult> {
    if (this.running) {
      return { ok: false, error: 'Un enregistrement est déjà en cours.' };
    }

    this.stderrBuf = '';
    this.markedRecording = false;
    this.stopRequested = false;
    // A2 (page.pause) n'écrit AUCUN fichier (pas d'API publique, DECISIONS.md Q3) :
    // ne pas annoncer d'outputPath qui n'existera jamais.
    this.currentOutputPath =
      options.engine === 'api' ? undefined : options.outputPath;

    const browsersPath = getBrowsersPath();
    const env = buildChildEnv(browsersPath);

    let cmdArgs: string[];
    try {
      if (options.engine === 'api') {
        const a2Path = getA2RunnerPath();
        const config = buildA2Config(options, browsersPath, getPlaywrightModulePath());
        cmdArgs = [a2Path, JSON.stringify(config)];
      } else {
        const cliPath = getPlaywrightCliPath();
        cmdArgs = [cliPath, 'codegen', ...buildCodegenArgs(options)];
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }

    this.emit({ state: 'starting', outputPath: this.currentOutputPath });

    const child = execFile(process.execPath, cmdArgs, {
      env,
      windowsHide: true,
    });
    this.child = child;

    child.stderr?.on('data', (d: Buffer | string) => {
      this.appendStderr(typeof d === 'string' ? d : d.toString());
      this.markRecording();
    });
    child.stdout?.on('data', () => {
      this.markRecording();
    });

    // Passage à 'recording' après un délai de grâce sans exit.
    this.recordingTimer = setTimeout(() => this.markRecording(), RECORDING_GRACE_MS);

    child.on('error', (err) => {
      this.cleanupTimers();
      this.child = null;
      this.emit({
        state: 'error',
        message: err.message,
        outputPath: this.currentOutputPath,
      });
    });

    child.on('exit', (code) => {
      this.cleanupTimers();
      this.child = null;
      void this.handleExit(code);
    });

    return { ok: true };
  }

  private async handleExit(code: number | null): Promise<void> {
    // Un arrêt demandé via stop() tue le child par signal (exit code null) :
    // ce n'est pas une erreur. Le fichier --output est écrit en continu par
    // codegen (flush ~250 ms) et survit au SIGTERM — on le lit dans les deux cas.
    if (code === 0 || this.stopRequested) {
      let codePreview: string | undefined;
      if (this.currentOutputPath) {
        try {
          codePreview = await readFile(this.currentOutputPath, 'utf8');
        } catch {
          codePreview = undefined;
        }
      }
      this.emit({
        state: 'stopped',
        exitCode: code,
        outputPath: this.currentOutputPath,
        codePreview,
      });
    } else {
      const tail = this.stderrBuf.slice(-STDERR_MAX).trim();
      this.emit({
        state: 'error',
        exitCode: code,
        message: tail || `Le process s'est terminé avec le code ${code}.`,
        outputPath: this.currentOutputPath,
      });
    }
  }

  private cleanupTimers(): void {
    if (this.recordingTimer) {
      clearTimeout(this.recordingTimer);
      this.recordingTimer = null;
    }
    if (this.killTimer) {
      clearTimeout(this.killTimer);
      this.killTimer = null;
    }
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (!child) return;

    this.stopRequested = true;
    child.kill('SIGTERM');

    this.killTimer = setTimeout(() => {
      if (this.child === child) {
        child.kill('SIGKILL');
      }
    }, KILL_ESCALATE_MS);
  }
}
