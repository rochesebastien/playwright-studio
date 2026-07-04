// Typage global de l'API exposée par le preload (contrat ARCHITECTURE.md §7).
// Recopié ici volontairement : le renderer ne dépend jamais du code preload,
// seulement des types partagés.
import type {
  Settings,
  RecorderOptions,
  StartResult,
  AppInfo,
  RecorderStatus,
} from '../../shared/types';

export interface RendererApi {
  getSettings(): Promise<Settings>;
  saveSettings(s: Settings): Promise<void>;
  startRecording(o: RecorderOptions): Promise<StartResult>;
  stopRecording(): Promise<void>;
  chooseOutputPath(defaultName: string): Promise<string | null>;
  getAppInfo(): Promise<AppInfo>;
  /** retourne une fonction de désabonnement */
  onStatus(cb: (s: RecorderStatus) => void): () => void;
}

declare global {
  interface Window {
    /** Injectée par le preload Electron. Absente hors Electron (dev navigateur). */
    api?: RendererApi;
  }
}
