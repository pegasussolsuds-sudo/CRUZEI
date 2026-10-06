// Config do avatar: padrão, validação/normalização (backend e app), tiers por plano, looks prontos e geração
// determinística (fakes, reserva).

import type { AvatarColorSlot, AvatarConfig, AvatarItemSlot, AvatarSlot, AvatarTier, Gender } from '@cruzei/shared-types';
import {
  AURA_AUTO,
  AVATAR_COLOR_SLOTS,
  AVATAR_ITEM_SLOTS,
  AVATAR_LOOK_SLOTS,
  AVATAR_PROTECTED_ITEMS,
  LEGACY_NECK_ACCESSORIES,
  NONE,
  avatarColor,
  avatarItem,
  avatarLook,
  avatarTierOf,
  petPosesOf,
} from './catalog';

export const DEFAULT_AVATAR: AvatarConfig = {
  v: 1,
  body: 'regular',
  skin: 's3',
  faceShape: 'oval',
  eyes: 'almond',
  eyeColor: 'e_dark',
  brows: 'soft',
  nose: 'soft',
  hair: 'short',
  hairColor: 'h_dark',
  face: 'smile',
  lines: NONE,
  faceDetail: NONE,
  facialHair: NONE,
  top: 'tee',
  topColor: 'c_black',
  outer: NONE,
  outerColor: 'c_navy',
  bottom: 'jeans',
  bottomColor: 'c_denim',
  shoes: 'sneakers',
  shoesColor: 'c_white',
  hat: NONE,
  hatColor: 'c_black',
  glasses: NONE,
  accessory: NONE,
  neck: NONE,
  bag: NONE,
  wrist: NONE,
  pride: NONE,
  prideFlag: 'rainbow',
  pronouns: NONE,
  aura: NONE,
  auraColor: AURA_AUTO,
  auraLevel: 'medium',
  backdrop: NONE,
  emote: NONE,
  pet: NONE,
  petPose: 'side',
  vehicle: NONE,
  vehicleColor: 'c_red',
  held: NONE,
};

const ITEM_SLOTS = AVATAR_ITEM_SLOTS.map((s) => s.slot as AvatarItemSlot);
const COLOR_SLOTS = AVATAR_COLOR_SLOTS.map((s) => s.slot as AvatarColorSlot);
const ALL_SLOTS: AvatarSlot[] = [...ITEM_SLOTS, ...COLOR_SLOTS];

/** Slots que chegaram na v1.1: config antiga sem eles continua válida (o normalize preenche o padrão). */
export const AVATAR_V11_SLOTS: readonly AvatarSlot[] = [
  'faceShape',
  'eyes',
  'eyeColor',
  'brows',
  'nose',
  'lines',
  'faceDetail',
  'outer',
  'outerColor',
  'neck',
  'pride',
  'prideFlag',
  'pronouns',
  'auraColor',
  'auraLevel',
  'backdrop',
  'emote',
  'pet',
  'petPose',
  'vehicle',
  'vehicleColor',
  'held',
];
const V11 = new Set<string>(AVATAR_V11_SLOTS);
const LEGACY_NECK = new Set<string>(LEGACY_NECK_ACCESSORIES);

/** Tamanho máximo aceito pelo backend (JSON serializado, em bytes UTF-8). */
export const AVATAR_CONFIG_MAX_BYTES = 2048;

// ---------------- tiers ----------------

export const FREE_TIERS: ReadonlySet<AvatarTier> = new Set<AvatarTier>(['free']);
/** Premium: free + premium */
export const PREMIUM_TIERS: ReadonlySet<AvatarTier> = new Set<AvatarTier>(['free', 'premium']);
/** Premium+: free + premium + plus */
export const PLUS_TIERS: ReadonlySet<AvatarTier> = new Set<AvatarTier>(['free', 'premium', 'plus']);
/** tudo, inclusive evento (render/normalize sem checar plano) */
export const ALL_TIERS: ReadonlySet<AvatarTier> = new Set<AvatarTier>(['free', 'premium', 'plus', 'event']);

/**
 * Tiers liberados pelo plano. premium → PREMIUM_TIERS; premium_plus → PLUS_TIERS; free, desconhecido ou vencido
 * (active = false) → FREE_TIERS. 'event' fica bloqueado pra todos até existir evento.
 */
export function avatarTiersFor(premiumTier: string | null | undefined, active = true): ReadonlySet<AvatarTier> {
  if (!active) return FREE_TIERS;
  if (premiumTier === 'premium') return PREMIUM_TIERS;
  if (premiumTier === 'premium_plus') return PLUS_TIERS;
  return FREE_TIERS;
}

// ---------------- normalize / validação ----------------

/**
 * Normaliza qualquer entrada pra uma AvatarConfig completa e válida:
 * - id desconhecido (ou ausente) vira o padrão do slot;
 * - `allowedTiers` derruba item/cor de tier não liberado pro padrão (ex.: free tentando usar item premium);
 * - accessory legado de pescoço (necklace/chain/scarf) migra pro `neck` quando o neck está vazio, respeitando o tier,
 *   e o accessory vira 'none';
 * - petPose fica sempre numa posição aceita pelo pet (a primeira dele quando ausente ou não aceita).
 */
export function normalizeAvatarConfig(input: unknown, allowedTiers: ReadonlySet<AvatarTier> = ALL_TIERS): AvatarConfig {
  const src = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const out: AvatarConfig = { ...DEFAULT_AVATAR };
  for (const slot of ITEM_SLOTS) {
    const id = src[slot];
    if (typeof id === 'string' && avatarItem(slot, id) && allowedTiers.has(avatarTierOf(slot, id))) out[slot] = id;
  }
  for (const slot of COLOR_SLOTS) {
    const id = src[slot];
    if (typeof id === 'string' && avatarColor(slot, id) && allowedTiers.has(avatarTierOf(slot, id))) out[slot] = id;
  }

  // colar/corrente/cachecol moravam no accessory até a v1.1
  const acc = src.accessory;
  if (typeof acc === 'string' && LEGACY_NECK.has(acc)) {
    out.accessory = NONE;
    if (out.neck === NONE && avatarItem('neck', acc) && allowedTiers.has(avatarTierOf('neck', acc))) out.neck = acc;
  }

  // posição do pet: sem pet, guarda a escolha (vale pro próximo pet); com pet, só posições que ele aceita
  if (out.pet !== NONE) {
    const poses = petPosesOf(out.pet);
    const asked = src.petPose;
    if (poses.length && !(typeof asked === 'string' && (poses as string[]).includes(asked))) out.petPose = poses[0];
  }
  return out;
}

/**
 * true quando a config pode ser salva como veio (sem precisar normalizar) e sem itens fora dos tiers permitidos.
 * Tolerante a config antiga: chave v1.1 ausente é válida e accessory legado de pescoço (necklace/chain/scarf) é válido
 * se o tier dele estiver liberado. Fora isso é estrito: qualquer valor presente que o normalize mudaria invalida.
 */
export function isValidAvatarConfig(input: unknown, allowedTiers: ReadonlySet<AvatarTier> = ALL_TIERS): input is AvatarConfig {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return false;
  const src = input as Record<string, unknown>;
  if (src.v !== 1) return false;
  const normalized = normalizeAvatarConfig(src, allowedTiers);
  for (const slot of ALL_SLOTS) {
    const value = src[slot];
    if (value === undefined && V11.has(slot)) continue;
    if (slot === 'accessory' && typeof value === 'string' && LEGACY_NECK.has(value)) {
      if (!allowedTiers.has(avatarTierOf('neck', value))) return false;
      continue;
    }
    if (value !== normalized[slot]) return false;
  }
  return true;
}

/** Slots (de item e de cor) cujo valor atual exige um tier acima do permitido — pra UI mostrar o cadeado / paywall. */
export function lockedAvatarSlots(config: AvatarConfig, allowedTiers: ReadonlySet<AvatarTier>): AvatarSlot[] {
  return ALL_SLOTS.filter((slot) => !allowedTiers.has(avatarTierOf(slot, config[slot])));
}

// ---------------- looks prontos ----------------

const LOOK_SLOTS = new Set<string>(AVATAR_LOOK_SLOTS);

/** cor que acompanha cada item no look: se o item não entra (bloqueado/protegido), a cor dele também não */
const LOOK_PAIRED: Partial<Record<AvatarSlot, AvatarSlot>> = {
  topColor: 'top',
  outerColor: 'outer',
  bottomColor: 'bottom',
  shoesColor: 'shoes',
  hatColor: 'hat',
  vehicleColor: 'vehicle',
  auraColor: 'aura',
  auraLevel: 'aura',
  petPose: 'pet',
};

/**
 * Aplica um look pronto por cima da config. Só mexe nos slots de look (roupas, acessórios, efeitos, fundo, veículo,
 * pet, objeto e animação) — nunca em corpo, pele, rosto, cabelo, barba, pronomes ou bandeira — e nunca troca itens
 * protegidos (hijab, turbante, aparelho auditivo, cadeira de rodas).
 * Com `allowedTiers`, itens do look fora do plano ficam de fora (mantém o que a pessoa já usava).
 * Look desconhecido devolve a config normalizada sem mudanças.
 */
export function applyLook(cfg: AvatarConfig, lookId: string, allowedTiers?: ReadonlySet<AvatarTier>): AvatarConfig {
  const tiers = allowedTiers ?? ALL_TIERS;
  const base = normalizeAvatarConfig(cfg, ALL_TIERS);
  const look = avatarLook(lookId);
  if (!look) return normalizeAvatarConfig(base, tiers);
  const out: AvatarConfig = { ...base };
  const set = look.set as Partial<Record<AvatarSlot, string>>;
  const skipped = new Set<AvatarSlot>();
  const take = (slot: AvatarSlot): boolean => {
    const value = set[slot];
    if (value === undefined || !LOOK_SLOTS.has(slot)) return false;
    const keep = AVATAR_PROTECTED_ITEMS[slot as AvatarItemSlot];
    if (keep && keep.includes(base[slot])) return false;
    return tiers.has(avatarTierOf(slot, value));
  };
  // itens primeiro (decidem se a cor/chip pareado entra)
  for (const slot of Object.keys(set) as AvatarSlot[]) {
    if (LOOK_PAIRED[slot]) continue;
    if (take(slot)) out[slot] = set[slot]!;
    else skipped.add(slot);
  }
  for (const slot of Object.keys(set) as AvatarSlot[]) {
    const owner = LOOK_PAIRED[slot];
    if (!owner) continue;
    if (set[owner] !== undefined) {
      if (skipped.has(owner)) continue;
    } else if (AVATAR_PROTECTED_ITEMS[owner as AvatarItemSlot]?.includes(base[owner])) {
      continue; // a cor do hijab/turbante/cadeira é escolha da pessoa
    }
    if (take(slot)) out[slot] = set[slot]!;
  }
  return normalizeAvatarConfig(out, tiers);
}

// ---------------- geração determinística ----------------

function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32 — PRNG pequeno e determinístico */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rnd: () => number, list: readonly T[]): T {
  return list[Math.min(list.length - 1, Math.floor(rnd() * list.length))];
}

export interface RandomAvatarOptions {
  /** dá peso a cabelos/roupas mais comuns pro gênero informado (só preferência; qualquer combinação é válida) */
  gender?: Gender | null;
  /** só itens free (padrão) ou todos */
  tiers?: ReadonlySet<AvatarTier>;
}

// Listas congeladas do gerador: mudar ordem/tamanho muda o avatar de todo mundo que nunca editou o seu.
// Itens novos do catálogo NÃO entram aqui (o teste de regressão garante a mesma saída de antes da v1.1).
const HAIR_F = ['long', 'bob', 'wavy', 'ponytail', 'bun', 'braids', 'curly', 'afro', 'short'];
const HAIR_M = ['short', 'buzz', 'side', 'quiff', 'curly', 'afro', 'bald', 'wavy'];
const HAIR_ANY = ['short', 'buzz', 'side', 'quiff', 'curly', 'afro', 'bob', 'long', 'wavy', 'ponytail', 'bun', 'braids'];
const TOPS_F = ['tee', 'tank', 'crop', 'dress', 'hoodie', 'sweater', 'jacket', 'shirt'];
const TOPS_M = ['tee', 'polo', 'shirt', 'hoodie', 'sweater', 'jacket', 'tank'];
const TOPS_ANY = ['tee', 'tank', 'polo', 'shirt', 'hoodie', 'sweater', 'jacket', 'crop'];
const BOTTOMS_F = ['jeans', 'pants', 'shorts', 'skirt', 'leggings', 'joggers'];
const BOTTOMS_M = ['jeans', 'pants', 'shorts', 'joggers'];
const FACES = ['smile', 'grin', 'calm', 'wink', 'laugh', 'cool', 'blush'];
const NEUTRAL_CLOTH = ['c_black', 'c_white', 'c_gray', 'c_navy', 'c_beige', 'c_olive', 'c_brown'];
/** os 8 tons originais em ordem (o catálogo agora intercala s9..s14 por luminosidade) */
const RANDOM_SKINS = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];
/** os 10 tons naturais originais */
const RANDOM_HAIR_COLORS = [
  'h_black',
  'h_dark',
  'h_brown',
  'h_light',
  'h_blonde',
  'h_platinum',
  'h_red',
  'h_auburn',
  'h_gray',
  'h_white',
];
/** paleta de roupa original (21 cores, na ordem de antes); filtrada pelo tier como antes */
const RANDOM_CLOTH = [
  'c_black',
  'c_white',
  'c_gray',
  'c_navy',
  'c_denim',
  'c_lightdenim',
  'c_red',
  'c_coral',
  'c_orange',
  'c_yellow',
  'c_green',
  'c_teal',
  'c_blue',
  'c_purple',
  'c_pink',
  'c_beige',
  'c_brown',
  'c_olive',
  'c_lime',
  'c_magenta',
  'c_gold',
];

/**
 * Avatar estável a partir de uma seed (ex.: userId) — mesma seed, mesmo avatar em todo cliente.
 * Os campos anteriores à v1.1 saem idênticos aos de antes (mesma sequência do PRNG); os novos ficam no padrão.
 * Colar/cachecol sorteados no accessory vão pro `neck` (migração do normalize).
 */
export function randomAvatarConfig(seed: string, opts: RandomAvatarOptions = {}): AvatarConfig {
  const rnd = prng(hashString(seed));
  const tiers = opts.tiers ?? FREE_TIERS;
  const freeCloth = RANDOM_CLOTH.filter((id) => tiers.has(avatarTierOf('topColor', id)));
  const g = opts.gender ?? null;
  const hair = pick(rnd, g === 'female' ? HAIR_F : g === 'male' ? HAIR_M : HAIR_ANY);
  const top = pick(rnd, g === 'female' ? TOPS_F : g === 'male' ? TOPS_M : TOPS_ANY);
  const bottom = pick(rnd, g === 'female' ? BOTTOMS_F : BOTTOMS_M);
  const facialHair = g === 'male' && rnd() < 0.4 ? pick(rnd, ['stubble', 'beard', 'goatee', 'mustache']) : NONE;
  // a ordem das chaves abaixo é a ordem das chamadas do PRNG — não reordene
  const cfg: Record<string, unknown> = {
    ...DEFAULT_AVATAR,
    body: pick(rnd, ['slim', 'regular', 'regular', 'broad']),
    skin: pick(rnd, RANDOM_SKINS),
    hair,
    hairColor: pick(rnd, RANDOM_HAIR_COLORS),
    face: pick(rnd, FACES),
    facialHair,
    top,
    topColor: pick(rnd, freeCloth),
    bottom,
    bottomColor: pick(rnd, ['c_denim', 'c_lightdenim', 'c_black', 'c_navy', 'c_beige', 'c_gray']),
    shoes: pick(rnd, ['sneakers', 'sneakers', 'hightops', 'boots', 'sandals']),
    shoesColor: pick(rnd, ['c_white', 'c_black', 'c_gray', 'c_red', 'c_blue', 'c_beige']),
    hat: rnd() < 0.25 ? pick(rnd, ['cap', 'cap_back', 'beanie', 'bucket', 'headband']) : NONE,
    hatColor: pick(rnd, NEUTRAL_CLOTH),
    glasses: rnd() < 0.3 ? pick(rnd, ['round', 'square', 'sun']) : NONE,
    accessory: rnd() < 0.35 ? pick(rnd, ['earrings', 'necklace', 'headphones', 'scarf', 'flower']) : NONE,
    bag: rnd() < 0.3 ? pick(rnd, ['backpack', 'crossbody']) : NONE,
    wrist: rnd() < 0.35 ? pick(rnd, ['watch', 'bracelet']) : NONE,
    aura: NONE,
  };
  return normalizeAvatarConfig(cfg, tiers);
}

/**
 * Chave curta e estável do visual (cache de imagens no mapa, em disco) — cobre todos os slots. Dois hashes de 32 bits
 * independentes (~64 bits): com 42 slots, uma colisão faria uma pessoa aparecer com o avatar de outra.
 */
export function avatarKey(config: AvatarConfig): string {
  const parts: string[] = [];
  for (const slot of ITEM_SLOTS) parts.push(config[slot]);
  for (const slot of COLOR_SLOTS) parts.push(config[slot]);
  const s = parts.join('|');
  let h2 = 0x9747b28c;
  for (let i = 0; i < s.length; i++) {
    h2 = Math.imul(h2 ^ s.charCodeAt(i), 0x5bd1e995);
    h2 ^= h2 >>> 15;
  }
  return hashString(s).toString(36).padStart(7, '0') + (h2 >>> 0).toString(36);
}
