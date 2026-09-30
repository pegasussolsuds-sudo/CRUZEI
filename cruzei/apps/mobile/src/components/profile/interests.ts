// Interesses (catálogo GET /interests): emoji de cada ícone e a regra de marcar/desmarcar com teto. Sem React.
import { PROFILE_LIMITS, type InterestItem } from '@cruzei/shared-types';

/** interests.icon (chave do catálogo) → emoji do chip; ícone novo sem emoji cai no ✨ */
export const INTEREST_EMOJI: Readonly<Record<string, string>> = {
  music: '🎵',
  travel: '✈️',
  sports: '⚽',
  food: '🍳',
  movies: '🎬',
  tv: '📺',
  books: '📚',
  gaming: '🎮',
  beach: '🏖️',
  fitness: '💪',
  yoga: '🧘',
  pets: '🐾',
  photography: '📸',
  art: '🎨',
  tech: '💻',
  business: '💼',
  beer: '🍺',
  wine: '🍷',
  coffee: '☕',
  dance: '💃',
};

export function interestEmoji(icon: string | null | undefined): string {
  return (icon && INTEREST_EMOJI[icon]) || '✨';
}

/** item do catálogo como veio (o servidor antigo mandava só id e nome) */
export type CatalogItem = Pick<InterestItem, 'id' | 'name'> & Partial<Pick<InterestItem, 'icon' | 'category'>>;

/**
 * Marca/desmarca pelo NOME (é o que o servidor grava). Cheio (teto) e tentando marcar outro: a lista não muda e
 * `full` avisa (a tela dá o toque de aviso).
 */
export function toggleInterest(
  list: readonly string[],
  name: string,
  max: number = PROFILE_LIMITS.interestsMax,
): { list: string[]; full: boolean } {
  if (list.includes(name)) return { list: list.filter((n) => n !== name), full: false };
  if (list.length >= max) return { list: [...list], full: true };
  return { list: [...list, name], full: false };
}
