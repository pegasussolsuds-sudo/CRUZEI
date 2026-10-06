// Como cada chapéu convive com o cabelo. Contrato entre o cabelo (parts/hair.ts) e a chapelaria (parts/headwear.ts):
// o cabelo lê o modo do chapéu da config e decide o que desenhar; a chapelaria desenha o chapéu por cima.
//
//   none   sem chapéu: cabelo inteiro
//   band   tiara, faixa, auréola, chifrinhos, orelhas de gato: cabelo inteiro, o item senta em cima
//   crown  coroa, coroa neon, chapéu de festa: cabelo inteiro, o item senta no topo
//   cap    boné, boné virado, gorro, bucket, boina inglesa/francesa: o topo do cabelo achata sob o chapéu,
//          franja curta pode aparecer na testa (menos gorro), laterais e nuca aparecem
//   brim   fedora, panamá, palha, vaqueiro, cartola, bruxa: o crânio some sob a copa; laterais e nuca aparecem
//          abaixo da aba, cabelo longo cai normalmente atrás
//   wrap   turbante e durag: cobre o cabelo da testa à nuca (o black power fica contido no pano, sem tufo pros lados);
//          só cabelo solto e longo pode aparecer embaixo, atrás
//   full   hijab: nenhum cabelo aparece (nem de trás); o hijab emoldura o rosto e cobre pescoço e ombros

export type HatMode = 'none' | 'band' | 'crown' | 'cap' | 'brim' | 'wrap' | 'full';

const MODES: Record<string, HatMode> = {
  none: 'none',
  headband: 'band',
  tiara: 'band',
  halo: 'band',
  horns: 'band',
  cat_ears: 'band',
  crown: 'crown',
  neon_crown: 'crown',
  party: 'crown',
  cap: 'cap',
  cap_back: 'cap',
  beanie: 'cap',
  bucket: 'cap',
  flatcap: 'cap',
  beret: 'cap',
  durag: 'wrap',
  fedora: 'brim',
  panama: 'brim',
  straw: 'brim',
  cowboy: 'brim',
  top_hat: 'brim',
  witch: 'brim',
  turban: 'wrap',
  hijab: 'full',
};

/** modo do chapéu (id desconhecido = 'cap', o mais seguro pro cabelo não atravessar o chapéu) */
export function hatModeOf(hatId: string | null | undefined): HatMode {
  if (!hatId) return 'none';
  return MODES[hatId] ?? 'cap';
}

/** coroa, chapéu de festa e tiara sentam no crânio: a crista do moicano achata embaixo deles (senão o item flutua) */
export function hatFlattensCrest(hatId: string | null | undefined): boolean {
  return hatModeOf(hatId) === 'crown' || hatId === 'tiara';
}

/** o cabelo precisa sumir por completo (frente e trás)? */
export function hatHidesAllHair(hatId: string | null | undefined): boolean {
  return hatModeOf(hatId) === 'full';
}

/**
 * quanto cada chapéu sobe acima do topo do crânio (unidades da cabeça, pior caso medido com cabelo curto/careca/longo
 * em 3 corpos). Serve pro recorte do busto (anatomy.bustViewBox) reservar espaço pro chapéu.
 */
const HAT_LIFT: Record<string, number> = {
  headband: 0.5,
  flatcap: 1.0,
  durag: 1.7,
  bucket: 2.0,
  tiara: 2.2,
  hijab: 2.5,
  cap: 3.2,
  cap_back: 3.4,
  beret: 3.2,
  straw: 3.7,
  horns: 3.7,
  panama: 4.1,
  beanie: 4.3,
  cat_ears: 4.3,
  fedora: 5.0,
  turban: 5.3,
  cowboy: 5.5,
  neon_crown: 5.7,
  halo: 5.8,
  crown: 7.0,
  top_hat: 9.0,
  witch: 10.3,
  party: 10.8,
};

/**
 * topo do conjunto cabelo + chapéu acima do crânio (unidades da cabeça). `hairLift` = HAIR_LIFT do cabelo. Itens que
 * sentam em cima do cabelo (band/crown) somam ao volume dele; os que cobrem o cabelo ficam com o maior dos dois.
 */
export function hatLiftOf(hatId: string | null | undefined, hairLift: number): number {
  const mode = hatModeOf(hatId);
  if (mode === 'none') return hairLift;
  const h = HAT_LIFT[hatId as string] ?? 3.5;
  return mode === 'band' || mode === 'crown' ? hairLift + Math.max(0, h - 1.9) : Math.max(hairLift, h);
}
