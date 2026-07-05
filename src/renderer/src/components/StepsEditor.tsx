import { Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import { inputCls, labelCls } from './ui';

interface StepsEditorProps {
  pattern: string;
  labels: string[];
  onPattern: (v: string) => void;
  onLabels: (next: string[]) => void;
}

/** Éditeur du mode étapes : gabarit de commentaire + libellés ordonnés. */
export default function StepsEditor({
  pattern,
  labels,
  onPattern,
  onLabels,
}: StepsEditorProps) {
  const update = (i: number, value: string) =>
    onLabels(labels.map((l, idx) => (idx === i ? value : l)));
  const remove = (i: number) => onLabels(labels.filter((_, idx) => idx !== i));
  const add = () => onLabels([...labels, `Étape ${labels.length + 1}`]);
  const move = (i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= labels.length) return;
    const next = [...labels];
    [next[i], next[j]] = [next[j], next[i]];
    onLabels(next);
  };

  return (
    <div className="grid gap-4 rounded-xl border border-brand-yellow/50 bg-brand-yellow/[0.07] p-4">
      <div className="flex items-center gap-2">
        <span className="text-lg font-medium tracking-brand text-ink">Étapes</span>
      </div>

      <div className="grid gap-1.5">
        <label htmlFor="stepPattern" className={labelCls}>
          Gabarit du commentaire
        </label>
        <input
          id="stepPattern"
          type="text"
          className={inputCls}
          placeholder="STEP {n} : {label}"
          value={pattern}
          onChange={(e) => onPattern(e.target.value)}
        />
        <span className="text-xs text-muted">
          {'{n}'} = numéro d'étape, {'{label}'} = libellé.
        </span>
      </div>

      <div className="grid gap-2">
        <span className={labelCls}>Libellés des étapes</span>
        {labels.length === 0 ? (
          <p className="text-sm text-muted">
            Aucun libellé. Les étapes non nommées deviennent « Étape n ».
          </p>
        ) : null}
        {labels.map((label, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-6 shrink-0 text-right font-mono text-sm text-brand">
              {i + 1}
            </span>
            <input
              type="text"
              className={`${inputCls} flex-1`}
              placeholder={`Libellé de l'étape ${i + 1}`}
              value={label}
              onChange={(e) => update(i, e.target.value)}
            />
            <div className="flex shrink-0 flex-col">
              <button
                type="button"
                aria-label="Monter l'étape"
                disabled={i === 0}
                onClick={() => move(i, -1)}
                className="flex h-5 w-8 items-center justify-center rounded-t-md bg-gray-200 text-gray-600 transition hover:bg-gray-300 disabled:opacity-40"
              >
                <ChevronUp size={14} />
              </button>
              <button
                type="button"
                aria-label="Descendre l'étape"
                disabled={i === labels.length - 1}
                onClick={() => move(i, 1)}
                className="flex h-5 w-8 items-center justify-center rounded-b-md bg-gray-200 text-gray-600 transition hover:bg-gray-300 disabled:opacity-40"
              >
                <ChevronDown size={14} />
              </button>
            </div>
            <button
              type="button"
              aria-label="Supprimer l'étape"
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
          className="inline-flex w-fit items-center gap-2 rounded-xl bg-gray-200 px-4 py-2 text-sm font-medium tracking-brand text-gray-700 transition hover:bg-gray-300"
        >
          <Plus size={17} />
          Ajouter une étape
        </button>
      </div>
    </div>
  );
}
