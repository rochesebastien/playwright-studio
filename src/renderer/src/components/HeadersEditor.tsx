import type { HeaderPair } from '../helpers';

interface HeadersEditorProps {
  headers: HeaderPair[];
  onChange: (headers: HeaderPair[]) => void;
}

/** Éditeur de paires clé/valeur d'en-têtes HTTP (variante API / A2). */
export default function HeadersEditor({ headers, onChange }: HeadersEditorProps) {
  const update = (index: number, patch: Partial<HeaderPair>) => {
    onChange(headers.map((h, i) => (i === index ? { ...h, ...patch } : h)));
  };
  const remove = (index: number) => {
    onChange(headers.filter((_, i) => i !== index));
  };
  const add = () => {
    onChange([...headers, { key: '', value: '' }]);
  };

  return (
    <div className="headers-editor">
      {headers.length === 0 ? (
        <p className="field-hint">Aucun en-tête. Ajoutez-en si besoin.</p>
      ) : (
        <ul className="headers-list">
          {headers.map((pair, index) => (
            // eslint-disable-next-line react/no-array-index-key
            <li key={index} className="headers-row">
              <input
                type="text"
                className="input header-key"
                placeholder="Nom (ex. Authorization)"
                aria-label="Nom de l'en-tête"
                value={pair.key}
                onChange={(e) => update(index, { key: e.target.value })}
              />
              <input
                type="text"
                className="input header-value"
                placeholder="Valeur"
                aria-label="Valeur de l'en-tête"
                value={pair.value}
                onChange={(e) => update(index, { value: e.target.value })}
              />
              <button
                type="button"
                className="btn btn-icon"
                aria-label="Supprimer cet en-tête"
                title="Supprimer"
                onClick={() => remove(index)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="btn btn-ghost" onClick={add}>
        + Ajouter un en-tête
      </button>
    </div>
  );
}
