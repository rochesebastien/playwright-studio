/**
 * Classes utilitaires partagées (Tailwind) pour garder un style cohérent
 * entre les composants sans dupliquer les longues chaînes de classes.
 */

/** Base commune des boutons : coins arrondis, padding généreux, icône alignée. */
export const btnBase =
  'inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-base ' +
  'font-medium tracking-brand transition-[filter,background-color,opacity] ' +
  'select-none disabled:opacity-50 disabled:cursor-not-allowed';

/** Variantes de couleur des boutons. */
export const btnVariant = {
  green: 'bg-brand-green text-white hover:brightness-110',
  red: 'bg-brand-red text-white hover:brightness-110',
  orange: 'bg-brand-orange text-white hover:brightness-110',
  blue: 'bg-brand text-white hover:brightness-125',
  ghost: 'bg-gray-200 text-gray-700 hover:bg-gray-300',
} as const;

/** Champ texte / URL / nombre standard. */
export const inputCls =
  'rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-base text-ink ' +
  'outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20 ' +
  'placeholder:text-gray-400 disabled:opacity-60 disabled:bg-gray-50';

/** Select standard (même habillage que les inputs). */
export const selectCls = inputCls + ' pr-8 cursor-pointer';

/** Label de section (noir, medium, serré). */
export const labelCls = 'block text-lg font-medium tracking-brand text-ink';
