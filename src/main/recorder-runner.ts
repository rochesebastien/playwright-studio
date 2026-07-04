import { execFile, type ChildProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import type {
  RecorderOptions,
  RecorderStatus,
  StartResult,
} from '../shared/types';
import { getPlaywrightCliPath, getA2RunnerPath, getBrowsersPath } from './paths';

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
      args.push('--proxy-server=direct://');
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
  };
  delete env.NODE_OPTIONS;
  delete env.ELECTRON_ENABLE_LOGGING;
  return env;
}

/** Config JSON passée au script A2. */
interface A2Config {
  startUrl?: string;
  proxy?: { server: string; bypass?: string };
  viewport?: { width: number; height: number };
  extraHeaders?: Record<string, string>;
  browsersPath: string;
}

/** Résout la config proxy des options en config Playwright (ou undefined). */
function resolveA2Proxy(
  o: RecorderOptions,
): { server: string; bypass?: string } | undefined {
  switch (o.proxy.mode) {
    case 'direct':
      return { server: 'direct://' };
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

export function buildA2Config(o: RecorderOptions, browsersPath: string): A2Config {
  return {
    startUrl: o.startUrl,
    proxy: resolveA2Proxy(o),
    viewport: o.viewport,
    extraHeaders: o.extraHeaders,
    browsersPath,
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
    this.currentOutputPath = options.outputPath;

    const browsersPath = getBrowsersPath();
    const env = buildChildEnv(browsersPath);

    let cmdArgs: string[];
    try {
      if (options.engine === 'api') {
        const a2Path = getA2RunnerPath();
        const config = buildA2Config(options, browsersPath);
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
    if (code === 0) {
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

    child.kill('SIGTERM');

    this.killTimer = setTimeout(() => {
      if (this.child === child) {
        child.kill('SIGKILL');
      }
    }, KILL_ESCALATE_MS);
  }
}
