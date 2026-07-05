import { Play, TrafficCone, Ban, Pause, Layers } from 'lucide-react';
import type { RecorderStatus } from '../../../shared/types';
import { btnBase, btnVariant } from './ui';

interface HeaderProps {
  status: RecorderStatus;
  stepsEnabled: boolean;
  /** true = étape en pause (bouton vert « Étape suivante »). */
  stepPaused: boolean;
  onStart: () => void;
  onStop: () => void;
  onCheckpoint: () => void;
  onNextStep: () => void;
}

/** Pastille ronde d'état : cercle plein + anneau plus clair. */
function Pastille({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-4 w-4 shrink-0 rounded-full ${color}`}
    />
  );
}

/** En-tête « repos » : pastille + titre + sous-titre + bouton Lancer. */
function IdleHeader({
  pastille,
  title,
  titleClass,
  subtitle,
  startDisabled,
  onStart,
}: {
  pastille: string;
  title: string;
  titleClass: string;
  subtitle: string;
  startDisabled: boolean;
  onStart: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-7 pt-7">
      <div className="min-w-0">
        <div className="flex items-center gap-3">
          <span className="flex h-6 w-6 items-center justify-center">
            <Pastille color={pastille} />
          </span>
          <h2 className={`text-2xl font-medium tracking-brand sm:text-[28px] ${titleClass}`}>
            {title}
          </h2>
        </div>
        <p className="mt-2 max-w-2xl pl-9 text-base text-muted">{subtitle}</p>
      </div>
      <button
        type="button"
        className={`${btnBase} ${btnVariant.green} shrink-0 px-7 text-lg`}
        disabled={startDisabled}
        onClick={onStart}
      >
        Lancer
        <Play size={20} />
      </button>
    </div>
  );
}

export default function Header({
  status,
  stepsEnabled,
  stepPaused,
  onStart,
  onStop,
  onCheckpoint,
  onNextStep,
}: HeaderProps) {
  const state = status.state;

  if (state === 'recording') {
    return (
      <div className="stripes flex min-h-[96px] items-center justify-between gap-4 px-7 py-4">
        <div className="flex items-center gap-3">
          <TrafficCone size={30} className="shrink-0 text-white drop-shadow" />
          <h2 className="text-xl font-medium tracking-brand text-white drop-shadow sm:text-[28px]">
            Scénario en cours d'enregistrement
          </h2>
          {stepsEnabled && status.currentStep ? (
            <span className="ml-1 rounded-lg bg-black/35 px-2.5 py-1 text-sm font-medium tracking-brand text-white backdrop-blur-sm">
              Étape {status.currentStep}
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {stepsEnabled ? (
            stepPaused ? (
              <button
                type="button"
                className={`${btnBase} ${btnVariant.green} shadow`}
                onClick={onNextStep}
              >
                Étape suivante
                <Layers size={19} />
              </button>
            ) : (
              <button
                type="button"
                className={`${btnBase} ${btnVariant.yellow} shadow`}
                onClick={onCheckpoint}
              >
                Checkpoint d'étapes
                <Pause size={19} />
              </button>
            )
          ) : null}
          <button
            type="button"
            className={`${btnBase} ${btnVariant.red} shadow`}
            onClick={onStop}
          >
            Arrêter
            <Ban size={19} />
          </button>
        </div>
      </div>
    );
  }

  if (state === 'starting') {
    return (
      <IdleHeader
        pastille="bg-brand-yellow ring-4 ring-brand-yellow/30"
        title="Lancement du navigateur…"
        titleClass="text-brand"
        subtitle="Le navigateur isolé démarre, veuillez patienter."
        startDisabled
        onStart={onStart}
      />
    );
  }

  if (state === 'stopped') {
    return (
      <IdleHeader
        pastille="bg-gray-400 ring-4 ring-gray-400/30"
        title="Terminé"
        titleClass="text-brand"
        subtitle="Enregistrement terminé. Le code généré est disponible ci-dessous. Relancez pour un nouveau scénario."
        startDisabled={false}
        onStart={onStart}
      />
    );
  }

  if (state === 'error') {
    return (
      <div>
        <IdleHeader
          pastille="bg-brand-red ring-4 ring-brand-red/30"
          title="Erreur"
          titleClass="text-brand-red"
          subtitle="L'enregistrement a échoué. Consultez le détail ci-dessous, puis relancez."
          startDisabled={false}
          onStart={onStart}
        />
        {status.message ? (
          <pre className="mx-7 mt-4 max-h-40 overflow-auto rounded-xl border border-brand-red/30 bg-brand-red/5 p-4 font-mono text-sm whitespace-pre-wrap text-brand-red">
            {status.message}
          </pre>
        ) : null}
      </div>
    );
  }

  // idle
  return (
    <IdleHeader
      pastille="bg-brand-green ring-4 ring-brand-green/30"
      title="Prêt à enregistrer"
      titleClass="text-brand"
      subtitle="Enregistrer un scénario dans un navigateur isolé, de façon simplifiée et entièrement configurable."
      startDisabled={false}
      onStart={onStart}
    />
  );
}
