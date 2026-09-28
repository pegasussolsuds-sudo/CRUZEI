import type { PlaceKind } from '@cruzei/shared-types';

/** rótulo e ícone de cada tipo de lugar da cidade (lista da busca, card e pino no mapa) */
export const PLACE_KIND_META: Record<PlaceKind, { label: string; emoji: string }> = {
  nightclub: { label: 'balada', emoji: '🪩' },
  pub: { label: 'pub', emoji: '🍺' },
  bar: { label: 'bar', emoji: '🍻' },
  cocktail: { label: 'drinks', emoji: '🍸' },
  brewery: { label: 'cervejaria', emoji: '🍺' },
  lounge: { label: 'lounge', emoji: '🍸' },
  music: { label: 'casa de show', emoji: '🎵' },
  theatre: { label: 'teatro', emoji: '🎭' },
  events: { label: 'eventos', emoji: '🎉' },
  nightlife: { label: 'vida noturna', emoji: '🌙' },
  cafe: { label: 'café', emoji: '☕' },
  fastfood: { label: 'lanchonete', emoji: '🍔' },
  restaurant: { label: 'restaurante', emoji: '🍽️' },
  park: { label: 'parque', emoji: '🌳' },
  mall: { label: 'shopping', emoji: '🛍️' },
  museum: { label: 'museu', emoji: '🏛️' },
  gallery: { label: 'galeria', emoji: '🖼️' },
  beach: { label: 'praia', emoji: '🏖️' },
  cinema: { label: 'cinema', emoji: '🎬' },
  stadium: { label: 'estádio', emoji: '🏟️' },
  campus: { label: 'faculdade', emoji: '🎓' },
  landmark: { label: 'ponto turístico', emoji: '📸' },
  entertainment: { label: 'diversão', emoji: '🎉' },
  other: { label: 'lugar', emoji: '📍' },
};

export function placeKindMeta(kind: PlaceKind | undefined | null): { label: string; emoji: string } {
  return (kind && PLACE_KIND_META[kind]) || PLACE_KIND_META.other;
}
