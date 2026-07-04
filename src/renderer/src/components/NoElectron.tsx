/** Écran de repli affiché quand window.api est absente (lancement hors Electron). */
export default function NoElectron() {
  return (
    <div className="no-electron">
      <div className="no-electron-card">
        <h1>Doit être lancé via Electron</h1>
        <p>
          Cette interface communique avec un navigateur Chromium isolé piloté par le
          processus principal Electron. L'API <code>window.api</code> n'est pas
          disponible dans un navigateur classique.
        </p>
        <p className="field-hint">
          Lancez l'application avec <code>npm run dev</code> (ou l'exécutable packagé).
        </p>
      </div>
    </div>
  );
}
