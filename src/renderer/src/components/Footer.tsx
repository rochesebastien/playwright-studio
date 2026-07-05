import type { AppInfo } from '../../../shared/types';

interface FooterProps {
  info: AppInfo | null;
}

/**
 * Pied de page de la page (hors carte) : crédit à gauche, versions à droite.
 */
export default function Footer({ info }: FooterProps) {
  return (
    <footer className="mt-6 flex flex-col gap-2 px-1 text-sm sm:flex-row sm:items-center sm:justify-between">
      <p className="font-medium tracking-brand text-ink">
        Playwright Studio v.{info?.appVersion ?? '0.1.0'} - Roche Sébastien
      </p>
      {info ? (
        <p className="flex flex-wrap items-center gap-x-5 gap-y-1 font-medium tracking-brand text-gray-700">
          <span>Electron {info.electron}</span>
          <span>Playwright {info.playwright}</span>
          <span>Chromium r{info.chromiumRevision}</span>
        </p>
      ) : (
        <p className="font-medium tracking-brand text-muted">Chargement des versions…</p>
      )}
    </footer>
  );
}
