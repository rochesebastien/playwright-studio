import type { ReactNode } from 'react';

interface FieldProps {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  children: ReactNode;
}

/** Ligne de formulaire : libellé + contrôle + aide optionnelle. */
export default function Field({ label, htmlFor, hint, children }: FieldProps) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={htmlFor}>
        {label}
      </label>
      <div className="field-control">
        {children}
        {hint ? <p className="field-hint">{hint}</p> : null}
      </div>
    </div>
  );
}
