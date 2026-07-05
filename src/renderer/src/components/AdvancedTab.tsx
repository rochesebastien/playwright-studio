import type {
  RecorderBrowser,
  RecorderEngine,
  TargetLang,
} from '../../../shared/types';
import { BROWSER_OPTIONS, TARGET_OPTIONS, type HeaderPair } from '../helpers';
import { inputCls, selectCls, labelCls } from './ui';
import HeadersEditor from './HeadersEditor';
import StepsEditor from './StepsEditor';

interface AdvancedTabProps {
  browser: RecorderBrowser;
  onBrowser: (b: RecorderBrowser) => void;
  target: TargetLang;
  onTarget: (t: TargetLang) => void;
  engine: RecorderEngine;
  onEngine: (e: RecorderEngine) => void;
  headers: HeaderPair[];
  onHeaders: (h: HeaderPair[]) => void;
  viewportWidth: string;
  viewportHeight: string;
  device: string;
  onViewportWidth: (v: string) => void;
  onViewportHeight: (v: string) => void;
  onDevice: (v: string) => void;
  stepsEnabled: boolean;
  stepsPattern: string;
  onStepsPattern: (v: string) => void;
  stepsLabels: string[];
  onStepsLabels: (next: string[]) => void;
}

function RadioLine({
  name,
  checked,
  onSelect,
  children,
}: {
  name: string;
  checked: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <label
      className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-base transition ${
        checked ? 'border-brand bg-brand/5' : 'border-gray-200 bg-white hover:border-gray-300'
      }`}
    >
      <input
        type="radio"
        name={name}
        className="h-4 w-4 accent-[#0907f7]"
        checked={checked}
        onChange={onSelect}
      />
      <span className="text-ink">{children}</span>
    </label>
  );
}

export default function AdvancedTab(props: AdvancedTabProps) {
  const {
    browser,
    onBrowser,
    target,
    onTarget,
    engine,
    onEngine,
    headers,
    onHeaders,
    viewportWidth,
    viewportHeight,
    device,
    onViewportWidth,
    onViewportHeight,
    onDevice,
    stepsEnabled,
    stepsPattern,
    onStepsPattern,
    stepsLabels,
    onStepsLabels,
  } = props;

  const viewportFilled = viewportWidth.trim() !== '' || viewportHeight.trim() !== '';
  const deviceFilled = device.trim() !== '';

  return (
    <div className="grid gap-6">
      <div className="grid gap-6 md:grid-cols-2">
        {/* Navigateur */}
        <div className="grid content-start gap-2">
          <span className={labelCls}>Navigateur</span>
          <RadioLine
            name="browser"
            checked={browser === 'chromium'}
            onSelect={() => onBrowser('chromium')}
          >
            {BROWSER_OPTIONS[0].label}
          </RadioLine>
          <RadioLine
            name="browser"
            checked={browser === 'msedge'}
            onSelect={() => onBrowser('msedge')}
          >
            {BROWSER_OPTIONS[1].label}
          </RadioLine>
        </div>

        {/* Langage cible */}
        <div className="grid content-start gap-2">
          <label htmlFor="target" className={labelCls}>
            Langage cible
          </label>
          <select
            id="target"
            className={selectCls}
            value={target}
            onChange={(e) => onTarget(e.target.value as TargetLang)}
          >
            {TARGET_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Moteur */}
        <div className="grid content-start gap-2">
          <span className={labelCls}>Moteur</span>
          <RadioLine
            name="engine"
            checked={engine === 'codegen'}
            onSelect={() => onEngine('codegen')}
          >
            codegen (recommandé)
          </RadioLine>
          <RadioLine
            name="engine"
            checked={engine === 'api'}
            onSelect={() => onEngine('api')}
          >
            API (page.pause) — contexte avancé
          </RadioLine>
          {engine === 'api' ? (
            <div className="mt-1">
              <span className="mb-1.5 block text-sm font-medium tracking-brand text-muted">
                En-têtes HTTP (variante API)
              </span>
              <HeadersEditor headers={headers} onChange={onHeaders} />
            </div>
          ) : null}
        </div>

        {/* Viewport & Device (exclusifs) */}
        <div className="grid content-start gap-2">
          <span className={labelCls}>Viewport & Device</span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              className={`${inputCls} w-24`}
              aria-label="Largeur du viewport"
              placeholder="Largeur"
              value={viewportWidth}
              disabled={deviceFilled}
              onChange={(e) => onViewportWidth(e.target.value)}
            />
            <span aria-hidden="true" className="text-muted">
              ×
            </span>
            <input
              type="number"
              min={1}
              className={`${inputCls} w-24`}
              aria-label="Hauteur du viewport"
              placeholder="Hauteur"
              value={viewportHeight}
              disabled={deviceFilled}
              onChange={(e) => onViewportHeight(e.target.value)}
            />
          </div>
          <input
            type="text"
            className={inputCls}
            aria-label="Device"
            placeholder="Device (ex. iPhone 15)"
            value={device}
            disabled={viewportFilled}
            onChange={(e) => onDevice(e.target.value)}
          />
          <span className="text-xs text-muted">
            {deviceFilled
              ? 'Viewport désactivé : un device est renseigné.'
              : viewportFilled
                ? 'Device désactivé : un viewport est renseigné.'
                : 'Viewport et device sont mutuellement exclusifs.'}
          </span>
        </div>
      </div>

      {/* Section Étapes */}
      <div>
        {!stepsEnabled ? (
          <p className="mb-2 text-sm text-muted">
            Le mode étapes est désactivé. Activez-le (en haut à droite) pour insérer des
            commentaires d'étape dans le code généré. Les libellés ci-dessous sont
            conservés.
          </p>
        ) : null}
        <StepsEditor
          pattern={stepsPattern}
          labels={stepsLabels}
          onPattern={onStepsPattern}
          onLabels={onStepsLabels}
        />
      </div>
    </div>
  );
}
