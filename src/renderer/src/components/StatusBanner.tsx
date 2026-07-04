import { useState } from 'react';
import type { RecorderEngine, RecorderStatus } from '../../../shared/types';

interface StatusBannerProps {
  status: RecorderStatus;
  /** Moteur du run : en 'api' (A2) aucun fichier n'est écrit, le message diffère. */
  engine: RecorderEngine;
  /** Chemin de sortie composé par le formulaire, utilisé si le statut n'en fournit pas. */
  fallbackOutputPath: string;
}

const STATE_LABEL: Record<RecorderStatus['state'], string> = {
  idle: 'Prêt',
  starting: 'Lancement du navigateur…',
  recording: 'Enregistrement en cours — interagissez avec le navigateur',
  stopped: 'Terminé',
  error: 'Erreur',
};

export default function StatusBanner({ status, engine, fallbackOutputPath }: StatusBannerProps) {
  const [copied, setCopied] = useState(false);
  const isApiEngine = engine === 'api';
  const outputPath = isApiEngine ? undefined : status.outputPath || fallbackOutputPath;

  const copyCode = async () => {
    if (!status.codePreview) return;
    try {
      await navigator.clipboard.writeText(status.codePreview);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className={`status status-${status.state}`} aria-live="polite">
      <div className="status-head">
        <span className="status-dot" aria-hidden="true" />
        <span className="status-label">{STATE_LABEL[status.state]}</span>
      </div>

      {status.state === 'stopped' && outputPath ? (
        <p className="status-detail">
          Code écrit dans <code className="path">{outputPath}</code>
        </p>
      ) : null}

      {status.state === 'stopped' && isApiEngine ? (
        <p className="status-detail">
          Moteur API (page.pause) : aucun fichier n'est écrit — récupérez le code
          via le bouton « Copy » de l'inspecteur Playwright avant de le fermer.
        </p>
      ) : null}

      {status.state === 'stopped' && status.codePreview ? (
        <div className="code-panel">
          <div className="code-panel-head">
            <span>Code généré</span>
            <button type="button" className="btn btn-ghost btn-small" onClick={copyCode}>
              {copied ? 'Copié ✓' : 'Copier'}
            </button>
          </div>
          <pre className="code-pre">
            <code>{status.codePreview}</code>
          </pre>
        </div>
      ) : null}

      {status.state === 'error' ? (
        <pre className="error-pre">{status.message || 'Une erreur est survenue.'}</pre>
      ) : null}

      {status.state !== 'error' &&
      status.state !== 'stopped' &&
      status.message ? (
        <p className="status-detail">{status.message}</p>
      ) : null}
    </section>
  );
}
