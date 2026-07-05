import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type {
  Settings,
  RecorderOptions,
  RecorderStatus,
  StartResult,
  CheckpointResult,
  AppInfo,
} from '../shared/types';

export interface RendererApi {
  getSettings(): Promise<Settings>;
  saveSettings(s: Settings): Promise<void>;
  startRecording(o: RecorderOptions): Promise<StartResult>;
  stopRecording(): Promise<void>;
  /** Mode étapes : clôture l'étape courante (snapshot du fichier généré). */
  checkpoint(): Promise<CheckpointResult>;
  chooseOutputPath(defaultName: string): Promise<string | null>;
  getAppInfo(): Promise<AppInfo>;
  /** retourne une fonction de désabonnement */
  onStatus(cb: (s: RecorderStatus) => void): () => void;
  /** Code généré en direct pendant l'enregistrement. Désabonnement retourné. */
  onCode(cb: (content: string) => void): () => void;
}

const api: RendererApi = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (s) => ipcRenderer.invoke('settings:save', s),
  startRecording: (o) => ipcRenderer.invoke('recorder:start', o),
  stopRecording: () => ipcRenderer.invoke('recorder:stop'),
  checkpoint: () => ipcRenderer.invoke('recorder:checkpoint'),
  chooseOutputPath: (defaultName) =>
    ipcRenderer.invoke('dialog:chooseOutput', defaultName),
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  onStatus: (cb) => {
    const listener = (_evt: IpcRendererEvent, status: RecorderStatus): void => {
      cb(status);
    };
    ipcRenderer.on('recorder:status', listener);
    return () => {
      ipcRenderer.removeListener('recorder:status', listener);
    };
  },
  onCode: (cb) => {
    const listener = (_evt: IpcRendererEvent, content: string): void => {
      cb(content);
    };
    ipcRenderer.on('recorder:code', listener);
    return () => {
      ipcRenderer.removeListener('recorder:code', listener);
    };
  },
};

contextBridge.exposeInMainWorld('api', api);
