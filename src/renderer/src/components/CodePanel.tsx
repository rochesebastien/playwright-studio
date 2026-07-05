import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { btnBase, btnVariant } from './ui';

interface CodePanelProps {
  code: string;
}

/** Panneau du code généré : gouttière de numéros de ligne bleus + bouton copier. */
export default function CodePanel({ code }: CodePanelProps) {
  const [copied, setCopied] = useState(false);
  const hasCode = code.trim().length > 0;
  const lines = hasCode ? code.replace(/\n$/, '').split('\n') : [];

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* presse-papiers indisponible : échec silencieux */
    }
  };

  return (
    <div className="relative h-[420px] overflow-hidden rounded-xl bg-gray-100">
      {hasCode ? (
        <div className="h-full overflow-auto">
          <div className="flex min-h-full font-mono text-[15px] leading-6">
            <div className="code-gutter shrink-0 select-none px-3 py-4">
              {lines.map((_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>
            <pre className="flex-1 overflow-x-auto py-4 pr-4 text-ink">
              <code>{lines.join('\n')}</code>
            </pre>
          </div>
        </div>
      ) : (
        <div className="flex h-full items-center justify-center px-6 text-center text-base text-muted">
          Le code généré apparaîtra ici pendant l'enregistrement.
        </div>
      )}

      {hasCode ? (
        <button
          type="button"
          onClick={onCopy}
          className={`${btnBase} ${btnVariant.blue} absolute bottom-4 right-4 py-2.5 text-sm shadow-lg`}
        >
          {copied ? <Check size={17} /> : <Copy size={17} />}
          {copied ? 'Copié' : 'Copier le code'}
        </button>
      ) : null}
    </div>
  );
}
