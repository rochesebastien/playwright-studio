import type { ProxyMode } from '../../../shared/types';
import { inputCls, labelCls } from './ui';

interface ProxyTabProps {
  mode: ProxyMode;
  server: string;
  bypass: string;
  onMode: (m: ProxyMode) => void;
  onServer: (v: string) => void;
  onBypass: (v: string) => void;
}

interface Choice {
  value: ProxyMode;
  title: string;
  desc: string;
}

const CHOICES: ReadonlyArray<Choice> = [
  { value: 'direct', title: 'Direct', desc: 'Aucun proxy — recommandé pour un navigateur isolé.' },
  { value: 'system', title: 'Proxy système', desc: 'Hérite du proxy configuré sur le poste.' },
  { value: 'manual', title: 'Manuel', desc: 'Définir un serveur proxy et une liste de bypass.' },
];

function RadioCard({
  choice,
  checked,
  onSelect,
}: {
  choice: Choice;
  checked: boolean;
  onSelect: () => void;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition ${
        checked ? 'border-brand bg-brand/5' : 'border-gray-200 bg-white hover:border-gray-300'
      }`}
    >
      <input
        type="radio"
        name="proxyMode"
        className="mt-1 h-4 w-4 accent-[#0907f7]"
        checked={checked}
        onChange={onSelect}
      />
      <span>
        <span className="block text-base font-medium tracking-brand text-ink">
          {choice.title}
        </span>
        <span className="mt-0.5 block text-sm text-muted">{choice.desc}</span>
      </span>
    </label>
  );
}

export default function ProxyTab({
  mode,
  server,
  bypass,
  onMode,
  onServer,
  onBypass,
}: ProxyTabProps) {
  return (
    <div className="grid gap-3">
      {CHOICES.map((choice) => (
        <RadioCard
          key={choice.value}
          choice={choice}
          checked={mode === choice.value}
          onSelect={() => onMode(choice.value)}
        />
      ))}

      {mode === 'system' ? (
        <p className="rounded-xl border border-brand-yellow/60 bg-brand-yellow/10 px-4 py-3 text-sm text-ink">
          Avec le proxy système, l'isolation réseau n'est plus garantie (le proxy du poste
          est hérité).
        </p>
      ) : null}

      {mode === 'manual' ? (
        <div className="mt-1 grid gap-4 rounded-xl border border-gray-200 bg-gray-50 p-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <label htmlFor="proxyServer" className={labelCls}>
              Serveur
            </label>
            <input
              id="proxyServer"
              type="text"
              className={inputCls}
              placeholder="http://proxy:8080"
              value={server}
              onChange={(e) => onServer(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <label htmlFor="proxyBypass" className={labelCls}>
              Bypass
            </label>
            <input
              id="proxyBypass"
              type="text"
              className={inputCls}
              placeholder=".corp.local,localhost"
              value={bypass}
              onChange={(e) => onBypass(e.target.value)}
            />
            <span className="text-xs text-muted">Optionnel, séparé par des virgules.</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
