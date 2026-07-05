import { execFile, type ChildProcess } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import type {
  RecorderOptions,
  RecorderStatus,
  StartResult,
  RecorderEngine,
  TargetLang,
  StepsConfig,
  CheckpointResult,
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
/** Cadence de polling du fichier --output pour le code en direct (A1). */
const POLL_MS = 500;

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

  // Navigateur : chromium (défaut) → rien ; msedge → --channel=msedge
  // (utilise le Edge système ; isolation identique, profil temporaire jeté).
  if (o.browser === 'msedge') {
    args.push('--channel=msedge');
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
  /** Channel Chromium à lancer (ex. 'msedge' = Edge système). Absent = Chromium embarqué. */
  channel?: string;
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
    channel: o.browser === 'msedge' ? 'msedge' : undefined,
    browsersPath,
    playwrightModulePath,
  };
}

/** Préfixe de commentaire de ligne selon le langage cible. */
function commentPrefix(target: TargetLang): string {
  return target === 'python' || target === 'python-pytest' ? '#' : '//';
}

/** Nombre de lignes du plus long préfixe commun (borné à min des longueurs). */
function commonPrefixLineCount(a: string[], b: string[]): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i++;
  return i;
}

/** Espaces/tabulations en tête de ligne (pour aligner le commentaire injecté). */
function leadingWhitespace(line: string): string {
  const m = /^[ \t]*/.exec(line);
  return m ? m[0] : '';
}

/**
 * Injecte les commentaires d'étape dans le code généré. Fonction PURE.
 *
 * `snapshots[0]` = S0 (contenu du fichier à sa première apparition) → frontière
 * du commentaire STEP 1 ; `snapshots[i>=1]` = fin de l'étape i → frontière du
 * commentaire STEP i+1.
 *
 * Frontière = plus long préfixe commun EN LIGNES entre le snapshot et
 * `finalContent`. Le commentaire est inséré à cet index de ligne, avec
 * l'indentation de la ligne suivante et une ligne vide avant lui si la ligne
 * précédente n'est pas vide. Les frontières identiques (étapes réellement vides)
 * empilent leurs commentaires. Robuste aux snapshots identiques ou plus longs
 * que le contenu final (préfixe commun borné).
 */
export function injectStepComments(
  finalContent: string,
  snapshots: string[],
  config: StepsConfig,
  target: TargetLang,
): string {
  if (snapshots.length === 0) return finalContent;

  const prefix = commentPrefix(target);
  const finalLines = finalContent.split('\n');

  // index de ligne → commentaires à insérer avant finalLines[index].
  const insertions = new Map<number, string[]>();
  for (let i = 0; i < snapshots.length; i++) {
    const n = i + 1; // numéro d'étape 1-based
    const snapLines = snapshots[i].split('\n');
    const boundary = commonPrefixLineCount(snapLines, finalLines);

    const label = config.labels[n - 1] ?? `Étape ${n}`;
    const text = config.pattern
      .replace(/\{n\}/g, String(n))
      .replace(/\{label\}/g, label);
    const indent =
      boundary < finalLines.length ? leadingWhitespace(finalLines[boundary]) : '';
    const commentLine = `${indent}${prefix} ${text}`;

    const list = insertions.get(boundary);
    if (list) list.push(commentLine);
    else insertions.set(boundary, [commentLine]);
  }

  const out: string[] = [];
  for (let idx = 0; idx <= finalLines.length; idx++) {
    const comments = insertions.get(idx);
    if (comments) {
      // Ligne vide avant le groupe si la ligne précédente n'est pas déjà vide.
      const prevLine = idx > 0 ? finalLines[idx - 1] : '';
      if (idx > 0 && prevLine.trim() !== '') {
        out.push('');
      }
      for (const c of comments) out.push(c);
    }
    if (idx < finalLines.length) out.push(finalLines[idx]);
  }

  return out.join('\n');
}

export interface RecorderRunner {
  start(options: RecorderOptions): Promise<StartResult>;
  stop(): Promise<void>;
  readonly running: boolean;
  onStatus(cb: (s: RecorderStatus) => void): void;
  /** Code généré en direct (A1). */
  onCode(cb: (content: string) => void): void;
  /** Mode étapes : clôture l'étape courante. */
  checkpoint(): Promise<CheckpointResult>;
}

export class PlaywrightRecorderRunner implements RecorderRunner {
  private child: ChildProcess | null = null;
  private stderrBuf = '';
  private listeners = new Set<(s: RecorderStatus) => void>();
  private codeListeners = new Set<(content: string) => void>();
  private currentOutputPath: string | undefined;
  private recordingTimer: NodeJS.Timeout | null = null;
  private killTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private markedRecording = false;
  private stopRequested = false;

  // Mode étapes / code en direct (A1 uniquement).
  private currentEngine: RecorderEngine = 'codegen';
  private currentTarget: TargetLang = 'playwright-test';
  private stepsConfig: StepsConfig | undefined;
  /** snapshots[0] = S0 (première apparition), puis fins d'étape (checkpoints). */
  private stepSnapshots: string[] = [];
  /** Étape en cours, 1-based. */
  private currentStep = 1;
  private s0Captured = false;
  private lastPolledContent: string | undefined;

  get running(): boolean {
    return this.child !== null;
  }

  onStatus(cb: (s: RecorderStatus) => void): void {
    this.listeners.add(cb);
  }

  onCode(cb: (content: string) => void): void {
    this.codeListeners.add(cb);
  }

  private emit(s: RecorderStatus): void {
    for (const cb of this.listeners) {
      cb(s);
    }
  }

  private emitCode(content: string): void {
    for (const cb of this.codeListeners) {
      cb(content);
    }
  }

  /** Nombre de checkpoints réalisés (S0 exclu). */
  private checkpointCount(): number {
    return this.currentStep - 1;
  }

  /**
   * Enrichit le code brut des commentaires d'étape si le mode étapes est actif
   * et qu'au moins un checkpoint a eu lieu (sinon rien à injecter). Garantit que
   * la vue live et le fichier final restent identiques.
   */
  private decorate(content: string): string {
    if (this.stepsConfig?.enabled && this.checkpointCount() >= 1) {
      return injectStepComments(
        content,
        this.stepSnapshots,
        this.stepsConfig,
        this.currentTarget,
      );
    }
    return content;
  }

  /** Lit le fichier --output, capture S0 au besoin, émet le code en direct. */
  private async pollOutput(): Promise<void> {
    if (!this.currentOutputPath) return;
    let content: string;
    try {
      content = await readFile(this.currentOutputPath, 'utf8');
    } catch {
      return; // fichier pas encore présent
    }
    if (content === this.lastPolledContent) return;
    this.lastPolledContent = content;

    // S0 = contenu à la première apparition (non vide). Capturé avant tout checkpoint.
    if (!this.s0Captured && content.trim() !== '') {
      this.s0Captured = true;
      this.stepSnapshots.push(content);
    }

    this.emitCode(this.decorate(content));
  }

  async checkpoint(): Promise<CheckpointResult> {
    if (!this.running) {
      return { ok: false, error: 'Aucun enregistrement en cours.' };
    }
    if (this.currentEngine !== 'codegen') {
      return {
        ok: false,
        error: "Le mode étapes n'est disponible qu'en mode codegen.",
      };
    }
    if (!this.stepsConfig?.enabled) {
      return { ok: false, error: "Le mode étapes n'est pas activé." };
    }
    if (!this.currentOutputPath) {
      return { ok: false, error: "Aucune action enregistrée pour l'instant." };
    }

    let content: string;
    try {
      content = await readFile(this.currentOutputPath, 'utf8');
    } catch {
      return { ok: false, error: "Aucune action enregistrée pour l'instant." };
    }
    if (content.trim() === '') {
      return { ok: false, error: "Aucune action enregistrée pour l'instant." };
    }

    // S0 doit précéder tout checkpoint : si le poller ne l'a pas encore capturé
    // (course rare), on l'ancre sur le contenu courant.
    if (!this.s0Captured) {
      this.s0Captured = true;
      this.stepSnapshots.push(content);
    }

    const closedStep = this.currentStep;
    this.stepSnapshots.push(content); // fin de l'étape clôturée
    this.currentStep += 1;

    this.emit({
      state: 'recording',
      currentStep: this.currentStep,
      outputPath: this.currentOutputPath,
    });
    return { ok: true, step: closedStep };
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

    // Réinitialisation de l'état mode étapes / code en direct.
    this.currentEngine = options.engine;
    this.currentTarget = options.target;
    this.stepsConfig = options.steps;
    this.stepSnapshots = [];
    this.currentStep = 1;
    this.s0Captured = false;
    this.lastPolledContent = undefined;

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

    // Code en direct : polling du fichier --output (A1 seulement — A2 n'écrit rien).
    if (options.engine === 'codegen') {
      this.pollTimer = setInterval(() => void this.pollOutput(), POLL_MS);
    }

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
          let content = await readFile(this.currentOutputPath, 'utf8');
          // Mode étapes : injecter les commentaires et RÉÉCRIRE le fichier
          // (le child est mort — plus aucun risque d'écrasement par codegen).
          if (this.stepsConfig?.enabled && this.checkpointCount() >= 1) {
            const injected = injectStepComments(
              content,
              this.stepSnapshots,
              this.stepsConfig,
              this.currentTarget,
            );
            if (injected !== content) {
              try {
                await writeFile(this.currentOutputPath, injected, 'utf8');
              } catch {
                // écriture best-effort : on garde au moins la preview enrichie
              }
            }
            content = injected;
          }
          codePreview = content;
        } catch {
          codePreview = undefined;
        }
      }
      this.emit({
        state: 'stopped',
        exitCode: code,
        outputPath: this.currentOutputPath,
        codePreview,
        currentStep: this.stepsConfig?.enabled ? this.currentStep : undefined,
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
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
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
