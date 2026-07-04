import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  AppInfo,
  ProxyMode,
  RecorderEngine,
  RecorderStatus,
  TargetLang,
} from '../../shared/types';
import {
  type Api,
  type FormState,
  type HeaderPair,
  DEFAULT_FILENAME_SET,
  FALLBACK_SETTINGS,
  TARGET_OPTIONS,
  defaultFilenameFor,
  joinPath,
  recordToPairs,
  splitPath,
  toRecorderOptions,
  toSettings,
} from './helpers';
import Field from './components/Field';
import Footer from './components/Footer';
import HeadersEditor from './components/HeadersEditor';
import NoElectron from './components/NoElectron';
import StatusBanner from './components/StatusBanner';

const SAVE_DEBOUNCE_MS = 400;

export default function App() {
  // window.api est injectée par le preload ; absente hors Electron.
  const api = window.api;
  if (!api) return <NoElectron />;
  return <Studio api={api} />;
}

function Studio({ api }: { api: Api }) {
  // --- État du formulaire (source unique) -----------------------------------
  const [engine, setEngine] = useState<RecorderEngine>(FALLBACK_SETTINGS.engine);
  const [startUrl, setStartUrl] = useState(FALLBACK_SETTINGS.startUrl);
  const [target, setTarget] = useState<TargetLang>(FALLBACK_SETTINGS.target);
  const [outputDir, setOutputDir] = useState(FALLBACK_SETTINGS.outputDir);
  const [fileName, setFileName] = useState(defaultFilenameFor(FALLBACK_SETTINGS.target));
  const [proxyMode, setProxyMode] = useState<ProxyMode>(FALLBACK_SETTINGS.proxy.mode);
  const [proxyServer, setProxyServer] = useState('');
  const [proxyBypass, setProxyBypass] = useState('');
  const [viewportWidth, setViewportWidth] = useState('');
  const [viewportHeight, setViewportHeight] = useState('');
  const [device, setDevice] = useState('');
  const [headers, setHeaders] = useState<HeaderPair[]>([]);

  // --- État applicatif ------------------------------------------------------
  const [status, setStatus] = useState<RecorderStatus>({ state: 'idle' });
  const [info, setInfo] = useState<AppInfo | null>(null);

  const loadedRef = useRef(false);

  // --- Chargement initial des settings --------------------------------------
  useEffect(() => {
    let cancelled = false;
    api
      .getSettings()
      .then((s) => {
        if (cancelled) return;
        setEngine(s.engine);
        setStartUrl(s.startUrl);
        setTarget(s.target);
        setOutputDir(s.outputDir);
        setFileName(defaultFilenameFor(s.target));
        setProxyMode(s.proxy.mode);
        setProxyServer(s.proxy.server ?? '');
        setProxyBypass(s.proxy.bypass ?? '');
        setViewportWidth(s.viewport ? String(s.viewport.width) : '');
        setViewportHeight(s.viewport ? String(s.viewport.height) : '');
        setDevice(s.device ?? '');
        setHeaders(recordToPairs(s.extraHeaders));
        loadedRef.current = true;
      })
      .catch(() => {
        loadedRef.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  // --- Infos versions -------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    api
      .getAppInfo()
      .then((i) => {
        if (!cancelled) setInfo(i);
      })
      .catch(() => {
        /* pied de page reste en « chargement » */
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  // --- Abonnement au statut du recorder -------------------------------------
  useEffect(() => {
    const unsubscribe = api.onStatus((s) => setStatus(s));
    return () => unsubscribe();
  }, [api]);

  // --- Composition + persistance debouncée ----------------------------------
  const form: FormState = useMemo(
    () => ({
      engine,
      startUrl,
      target,
      outputDir,
      fileName,
      proxyMode,
      proxyServer,
      proxyBypass,
      viewportWidth,
      viewportHeight,
      device,
      headers,
    }),
    [
      engine,
      startUrl,
      target,
      outputDir,
      fileName,
      proxyMode,
      proxyServer,
      proxyBypass,
      viewportWidth,
      viewportHeight,
      device,
      headers,
    ],
  );

  const settings = useMemo(() => toSettings(form), [form]);

  useEffect(() => {
    // On ne persiste qu'après le chargement initial (évite d'écraser avant lecture).
    if (!loadedRef.current) return;
    const id = window.setTimeout(() => {
      api.saveSettings(settings).catch(() => {
        /* échec de sauvegarde silencieux ; réessayé à la prochaine modif */
      });
    }, SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [api, settings]);

  // --- Dérivés --------------------------------------------------------------
  const busy = status.state === 'starting' || status.state === 'recording';
  const fullOutputPath = joinPath(outputDir, fileName);
  const viewportFilled = viewportWidth.trim() !== '' || viewportHeight.trim() !== '';
  const deviceFilled = device.trim() !== '';

  // --- Actions --------------------------------------------------------------
  const onTargetChange = (next: TargetLang) => {
    setTarget(next);
    // Si le nom est resté un défaut, l'aligner sur le nouveau langage.
    setFileName((prev) =>
      DEFAULT_FILENAME_SET.has(prev) ? defaultFilenameFor(next) : prev,
    );
  };

  const onBrowse = async () => {
    const defaultName = fileName || defaultFilenameFor(target);
    const chosen = await api.chooseOutputPath(defaultName);
    if (!chosen) return;
    const { dir, name } = splitPath(chosen);
    setOutputDir(dir);
    if (name) setFileName(name);
  };

  const onStart = async () => {
    setStatus({ state: 'starting' });
    try {
      const result = await api.startRecording(toRecorderOptions(form));
      if (!result.ok) {
        setStatus({
          state: 'error',
          message: result.error ?? 'Le démarrage de l\'enregistrement a échoué.',
        });
      }
    } catch (err) {
      setStatus({ state: 'error', message: String(err) });
    }
  };

  const onStop = async () => {
    try {
      await api.stopRecording();
    } catch (err) {
      setStatus({ state: 'error', message: String(err) });
    }
  };

  // --- Rendu ----------------------------------------------------------------
  return (
    <div className="app">
      <header className="app-header">
        <h1>Playwright Studio</h1>
        <p className="subtitle">
          Enregistrez un scénario dans un Chromium isolé et générez le code Playwright.
        </p>
      </header>

      <StatusBanner status={status} engine={engine} fallbackOutputPath={fullOutputPath} />

      <fieldset className="form" disabled={busy}>
        <legend className="sr-only">Configuration de l'enregistrement</legend>

        <Field label="URL de départ" htmlFor="startUrl" hint="Optionnel.">
          <input
            id="startUrl"
            type="url"
            className="input"
            placeholder="https://exemple.com"
            value={startUrl}
            onChange={(e) => setStartUrl(e.target.value)}
          />
        </Field>

        <Field label="Langage cible" htmlFor="target">
          <select
            id="target"
            className="input"
            value={target}
            onChange={(e) => onTargetChange(e.target.value as TargetLang)}
          >
            {TARGET_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Fichier de sortie"
          htmlFor="fileName"
          hint={
            <>
              Chemin retenu :{' '}
              <code className="path">{fullOutputPath || '(non défini)'}</code>
            </>
          }
        >
          <div className="output-row">
            <input
              id="fileName"
              type="text"
              className="input file-name"
              aria-label="Nom du fichier"
              placeholder={defaultFilenameFor(target)}
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
            />
            <button type="button" className="btn btn-ghost" onClick={onBrowse}>
              Parcourir…
            </button>
          </div>
        </Field>

        <fieldset className="subgroup">
          <legend>Proxy</legend>
          <label className="radio">
            <input
              type="radio"
              name="proxyMode"
              checked={proxyMode === 'direct'}
              onChange={() => setProxyMode('direct')}
            />
            <span>Direct (aucun proxy, recommandé)</span>
          </label>
          <label className="radio">
            <input
              type="radio"
              name="proxyMode"
              checked={proxyMode === 'system'}
              onChange={() => setProxyMode('system')}
            />
            <span>Proxy système</span>
          </label>
          {proxyMode === 'system' ? (
            <p className="field-hint warn">
              L'isolation réseau n'est alors plus garantie (le proxy système est hérité).
            </p>
          ) : null}
          <label className="radio">
            <input
              type="radio"
              name="proxyMode"
              checked={proxyMode === 'manual'}
              onChange={() => setProxyMode('manual')}
            />
            <span>Manuel</span>
          </label>
          {proxyMode === 'manual' ? (
            <div className="proxy-manual">
              <Field label="Serveur" htmlFor="proxyServer">
                <input
                  id="proxyServer"
                  type="text"
                  className="input"
                  placeholder="http://proxy:8080"
                  value={proxyServer}
                  onChange={(e) => setProxyServer(e.target.value)}
                />
              </Field>
              <Field label="Bypass" htmlFor="proxyBypass" hint="Optionnel, séparé par des virgules.">
                <input
                  id="proxyBypass"
                  type="text"
                  className="input"
                  placeholder=".corp.local,localhost"
                  value={proxyBypass}
                  onChange={(e) => setProxyBypass(e.target.value)}
                />
              </Field>
            </div>
          ) : null}
        </fieldset>

        <details className="advanced">
          <summary>Avancé</summary>
          <div className="advanced-body">
            <Field
              label="Viewport"
              hint={
                deviceFilled
                  ? 'Désactivé : un device est renseigné.'
                  : 'Optionnel. Largeur et hauteur en pixels.'
              }
            >
              <div className="viewport-row">
                <input
                  type="number"
                  min={1}
                  className="input viewport-input"
                  aria-label="Largeur du viewport"
                  placeholder="Largeur"
                  value={viewportWidth}
                  disabled={deviceFilled}
                  onChange={(e) => setViewportWidth(e.target.value)}
                />
                <span className="viewport-x" aria-hidden="true">
                  ×
                </span>
                <input
                  type="number"
                  min={1}
                  className="input viewport-input"
                  aria-label="Hauteur du viewport"
                  placeholder="Hauteur"
                  value={viewportHeight}
                  disabled={deviceFilled}
                  onChange={(e) => setViewportHeight(e.target.value)}
                />
              </div>
            </Field>

            <Field
              label="Device"
              htmlFor="device"
              hint={
                viewportFilled
                  ? 'Désactivé : un viewport est renseigné.'
                  : 'Optionnel. Nom d\'un device Playwright.'
              }
            >
              <input
                id="device"
                type="text"
                className="input"
                placeholder="iPhone 15"
                value={device}
                disabled={viewportFilled}
                onChange={(e) => setDevice(e.target.value)}
              />
            </Field>

            <fieldset className="subgroup">
              <legend>Moteur</legend>
              <label className="radio">
                <input
                  type="radio"
                  name="engine"
                  checked={engine === 'codegen'}
                  onChange={() => setEngine('codegen')}
                />
                <span>codegen (recommandé)</span>
              </label>
              <label className="radio">
                <input
                  type="radio"
                  name="engine"
                  checked={engine === 'api'}
                  onChange={() => setEngine('api')}
                />
                <span>API (page.pause) — contexte avancé</span>
              </label>
            </fieldset>

            {engine === 'api' ? (
              <Field label="En-têtes HTTP" hint="Envoyés par le contexte du navigateur (variante API).">
                <HeadersEditor headers={headers} onChange={setHeaders} />
              </Field>
            ) : null}
          </div>
        </details>
      </fieldset>

      <div className="actions">
        {status.state === 'recording' ? (
          <button type="button" className="btn btn-stop" onClick={onStop}>
            Arrêter
          </button>
        ) : status.state === 'starting' ? (
          <button type="button" className="btn btn-start" disabled>
            Lancement…
          </button>
        ) : (
          <button type="button" className="btn btn-start" onClick={onStart}>
            Démarrer l'enregistrement
          </button>
        )}
      </div>

      <Footer info={info} />
    </div>
  );
}
