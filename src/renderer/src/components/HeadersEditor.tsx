import { Plus, Trash2 } from 'lucide-react';
import type { HeaderPair } from '../helpers';
import { inputCls, btnBase, btnVariant } from './ui';

interface HeadersEditorProps {
  headers: HeaderPair[];
  onChange: (next: HeaderPair[]) => void;
}

/** Éditeur d'en-têtes HTTP clé/valeur (variante API / A2). */
export default function HeadersEditor({ headers, onChange }: HeadersEditorProps) {
  const update = (i: number, patch: Partial<HeaderPair>) => {
    onChange(headers.map((h, idx) => (idx === i ? { ...h, ...patch } : h)));
  };
  const remove = (i: number) => onChange(headers.filter((_, idx) => idx !== i));
  const add = () => onChange([...headers, { key: '', value: '' }]);

  return (
    <div className="grid gap-2">
      {headers.map((h, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            type="text"
            className={`${inputCls} flex-1`}
            placeholder="En-tête (ex. Authorization)"
            value={h.key}
            onChange={(e) => update(i, { key: e.target.value })}
          />
          <input
            type="text"
            className={`${inputCls} flex-1`}
            placeholder="Valeur"
            value={h.value}
            onChange={(e) => update(i, { value: e.target.value })}
          />
          <button
            type="button"
            aria-label="Supprimer l'en-tête"
            onClick={() => remove(i)}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gray-200 text-gray-600 transition hover:bg-brand-red/10 hover:text-brand-red"
          >
            <Trash2 size={17} />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className={`${btnBase} ${btnVariant.ghost} w-fit py-2 text-sm`}
      >
        <Plus size={17} />
        Ajouter un en-tête
      </button>
    </div>
  );
}
