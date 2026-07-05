import { Code, Network, Settings, Layers } from 'lucide-react';

export type TabId = 'code' | 'proxy' | 'advanced';

interface TabsProps {
  active: TabId;
  onChange: (t: TabId) => void;
  stepsEnabled: boolean;
  onToggleSteps: (v: boolean) => void;
  /** Le toggle « Mode étapes » est un réglage → verrouillé pendant l'enregistrement. */
  toggleDisabled: boolean;
}

const TABS: ReadonlyArray<{ id: TabId; label: string; Icon: typeof Code }> = [
  { id: 'code', label: 'Code généré', Icon: Code },
  { id: 'proxy', label: 'Configuration Proxy', Icon: Network },
  { id: 'advanced', label: 'Paramètres avancés', Icon: Settings },
];

const pillBase =
  'inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-base font-medium ' +
  'tracking-brand transition select-none';

export default function Tabs({
  active,
  onChange,
  stepsEnabled,
  onToggleSteps,
  toggleDisabled,
}: TabsProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex flex-wrap items-center gap-3" role="tablist">
        {TABS.map(({ id, label, Icon }) => {
          const isActive = active === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onChange(id)}
              className={`${pillBase} ${
                isActive
                  ? 'bg-brand text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              <Icon size={18} />
              {label}
            </button>
          );
        })}
      </div>

      <label
        className={`flex items-center gap-2.5 text-base font-medium tracking-brand text-ink ${
          toggleDisabled ? 'opacity-50' : 'cursor-pointer'
        }`}
      >
        <Layers size={18} className="text-brand" />
        <span>Mode étapes</span>
        <span className="sr-only">Activer le mode étapes</span>
        <button
          type="button"
          role="switch"
          aria-checked={stepsEnabled}
          disabled={toggleDisabled}
          onClick={() => onToggleSteps(!stepsEnabled)}
          className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${
            stepsEnabled ? 'bg-brand-yellow' : 'bg-gray-300'
          } ${toggleDisabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
              stepsEnabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </label>
    </div>
  );
}
