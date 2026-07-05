import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  AppInfo,
  ProxyMode,
  RecorderBrowser,
  RecorderEngine,
  RecorderStatus,
  TargetLang,
} from '../../shared/types';
import {
  type Api,
  type FormState,
  type HeaderPair,
  DEFAULT_FILENAME_SET,
  DEFAULT_STEP_PATTERN,
  FALLBACK_SETTINGS,
  defaultFilenameFor,
  joinPath,
  recordToPairs,
  splitPath,
  toRecorderOptions,
  toSettings,
} from './helpers';
import Header from './components/Header';
import Tabs, { type TabId } from './components/Tabs';
import CodePanel from './components/CodePanel';
import ProxyTab from './components/ProxyTab';
import AdvancedTab from './components/AdvancedTab';
import Footer from './components/Footer';
import NoElectron from './components/NoElectron';
import { inputCls, labelCls, btnBase, btnVariant } from './components/ui';

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
  const [browser, setBrowser] = useState<RecorderBrowser>(FALLBACK_SETTINGS.browser);
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
  const [stepsEnabled, setStepsEnabled] = useState(FALLBACK_SETTINGS.steps.enabled);
  const [stepsPattern, setStepsPattern] = useState(FALLBACK_SETTINGS.steps.pattern);
  const [stepsLabels, setStepsLabels] = useState<string[]>(FALLBACK_SETTINGS.steps.labels);

  // --- État applicatif ------------------------------------------------------
  const [status, setStatus] = useState<RecorderStatus>({ state: 'idle' });
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('code');
  const [liveCode, setLiveCode] = useState('');
  const [stepPaused, setStepPaused] = useState(false);

  const loadedRef = useRef(false);

  // --- Chargement initial des settings --------------------------------------
  useEffect(() => {
    let cancelled = false;
    api
      .getSettings()
      .then((s) => {
        if (cancelled) return;
        setEngine(s.engine);
        setBrowser(s.browser);
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
        setStepsEnabled(s.steps.enabled);
        setStepsPattern(s.steps.pattern || DEFAULT_STEP_PATTERN);
        setStepsLabels(s.steps.labels ?? []);
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

  // --- Abonnement au code généré en direct ----------------------------------
  useEffect(() => {
    const unsubscribe = api.onCode((content) => setLiveCode(content));
    return () => unsubscribe();
  }, [api]);

  // --- Réinitialise l'état « pause d'étape » hors enregistrement -------------
  useEffect(() => {
    if (status.state !== 'recording') setStepPaused(false);
  }, [status.state]);

  // --- Composition + persistance debouncée ----------------------------------
  const form: FormState = useMemo(
    () => ({
      engine,
      browser,
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
      stepsEnabled,
      stepsPattern,
      stepsLabels,
    }),
    [
      engine,
      browser,
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
      stepsEnabled,
      stepsPattern,
      stepsLabels,
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
  const displayCode =
    status.state === 'recording' ? liveCode : status.codePreview ?? liveCode;

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
    setLiveCode('');
    setStepPaused(false);
    setActiveTab('code');
    setStatus({ state: 'starting' });
    try {
      const result = await api.startRecording(toRecorderOptions(form));
      if (!result.ok) {
        setStatus({
          state: 'error',
          message: result.error ?? "Le démarrage de l'enregistrement a échoué.",
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

  const onCheckpoint = async () => {
    try {
      const res = await api.checkpoint();
      if (res.ok) setStepPaused(true);
    } catch {
      /* échec silencieux : l'enregistrement continue */
    }
  };

  const onNextStep = () => {
    // Purement UI : l'étape suivante démarre à la prochaine action enregistrée.
    setStepPaused(false);
  };

  // --- Rendu ----------------------------------------------------------------
  return (
    <div className="relative min-h-screen">
      <div className="blob" aria-hidden="true" />

      <div className="relative z-10 mx-auto w-full max-w-[1180px] px-6 pb-8 pt-9">
        {/* Titre posé sur le blob jaune */}
        <h1 className="text-[40px] font-medium leading-none tracking-brand text-brand">
          Playwright Studio
        </h1>

        {/* Carte principale */}
        <div className="mt-14 overflow-hidden rounded-3xl border border-hair bg-white shadow-sm">
          <Header
            status={status}
            stepsEnabled={stepsEnabled}
            stepPaused={stepPaused}
            onStart={onStart}
            onStop={onStop}
            onCheckpoint={onCheckpoint}
            onNextStep={onNextStep}
          />

          <div className="grid gap-6 p-7">
            {/* Champs de configuration — verrouillés pendant l'enregistrement */}
            <fieldset className="grid gap-5 border-0 p-0 disabled:opacity-70" disabled={busy}>
              <legend className="sr-only">Configuration de l'enregistrement</legend>

              {/* URL de base */}
              <div className="grid gap-2">
                <label htmlFor="startUrl" className={labelCls}>
                  URL de base :
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    id="startUrl"
                    type="url"
                    className={`${inputCls} w-full max-w-[55%] min-w-[240px] flex-1`}
                    placeholder="https://exemple.com"
                    value={startUrl}
                    onChange={(e) => setStartUrl(e.target.value)}
                  />
                  <span className="text-sm text-muted">
                    (Optionnel, vous pourrez rentrer l'URL après le lancement de
                    l'enregistrement)
                  </span>
                </div>
              </div>

              {/* Fichier de sortie */}
              <div className="grid gap-2">
                <label htmlFor="fileName" className={labelCls}>
                  Fichier de sortie :
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    id="fileName"
                    type="text"
                    aria-label="Nom du fichier"
                    className={`${inputCls} w-full max-w-[50%] min-w-[220px] flex-1`}
                    placeholder={defaultFilenameFor(target)}
                    value={fileName}
                    onChange={(e) => setFileName(e.target.value)}
                  />
                  <button
                    type="button"
                    className={`${btnBase} ${btnVariant.ghost} py-2.5`}
                    onClick={onBrowse}
                  >
                    Parcourir…
                  </button>
                  <span className="text-sm text-muted">
                    Chemin retenu:{' '}
                    <span className="font-semibold text-ink">
                      {fullOutputPath || '(non défini)'}
                    </span>
                  </span>
                </div>
              </div>
            </fieldset>

            {/* Onglets (toujours navigables, même pendant l'enregistrement) */}
            <Tabs
              active={activeTab}
              onChange={setActiveTab}
              stepsEnabled={stepsEnabled}
              onToggleSteps={setStepsEnabled}
              toggleDisabled={busy}
            />

            {/* Contenu de l'onglet */}
            <div>
              {activeTab === 'code' ? (
                <CodePanel code={displayCode} />
              ) : (
                <fieldset className="border-0 p-0 disabled:opacity-70" disabled={busy}>
                  {activeTab === 'proxy' ? (
                    <ProxyTab
                      mode={proxyMode}
                      server={proxyServer}
                      bypass={proxyBypass}
                      onMode={setProxyMode}
                      onServer={setProxyServer}
                      onBypass={setProxyBypass}
                    />
                  ) : (
                    <AdvancedTab
                      browser={browser}
                      onBrowser={setBrowser}
                      target={target}
                      onTarget={onTargetChange}
                      engine={engine}
                      onEngine={setEngine}
                      headers={headers}
                      onHeaders={setHeaders}
                      viewportWidth={viewportWidth}
                      viewportHeight={viewportHeight}
                      device={device}
                      onViewportWidth={setViewportWidth}
                      onViewportHeight={setViewportHeight}
                      onDevice={setDevice}
                      stepsEnabled={stepsEnabled}
                      stepsPattern={stepsPattern}
                      onStepsPattern={setStepsPattern}
                      stepsLabels={stepsLabels}
                      onStepsLabels={setStepsLabels}
                    />
                  )}
                </fieldset>
              )}
            </div>
          </div>
        </div>

        <Footer info={info} />
      </div>
    </div>
  );
}
