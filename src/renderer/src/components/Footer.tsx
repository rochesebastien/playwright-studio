import type { AppInfo } from '../../../shared/types';

interface FooterProps {
  info: AppInfo | null;
}

/** Pied de page discret : versions + rappel d'isolation. */
export default function Footer({ info }: FooterProps) {
  return (
    <footer className="footer">
      <p className="footer-isolation">
        Navigateur isolé : aucun profil ni cookie n'est conservé entre les sessions.
      </p>
      {info ? (
        <p className="footer-versions">
          <span>Playwright Studio v{info.appVersion}</span>
          <span>Electron {info.electron}</span>
          <span>Playwright {info.playwright}</span>
          <span>Chromium r{info.chromiumRevision}</span>
        </p>
      ) : (
        <p className="footer-versions footer-muted">Chargement des versions…</p>
      )}
    </footer>
  );
}
