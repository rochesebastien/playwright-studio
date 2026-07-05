import { Plug } from 'lucide-react';

/** Écran de repli affiché quand window.api est absente (lancement hors Electron). */
export default function NoElectron() {
  return (
    <div className="relative min-h-screen">
      <div className="blob" aria-hidden="true" />
      <div className="relative z-10 mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center px-6">
        <div className="w-full rounded-3xl border border-hair bg-white/90 p-10 shadow-sm backdrop-blur">
          <div className="mb-4 flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand/10 text-brand">
              <Plug size={22} />
            </span>
            <h1 className="text-2xl font-medium tracking-brand text-brand">
              Doit être lancé via Electron
            </h1>
          </div>
          <p className="text-base leading-relaxed text-ink">
            Cette interface communique avec un navigateur Chromium isolé piloté par le
            processus principal Electron. L'API <code className="font-mono text-brand">window.api</code>{' '}
            n'est pas disponible dans un navigateur classique.
          </p>
          <p className="mt-4 text-sm text-muted">
            Lancez l'application avec{' '}
            <code className="font-mono text-ink">npm run dev</code> (ou l'exécutable
            packagé).
          </p>
        </div>
      </div>
    </div>
  );
}
