// Config do avatar: default, validação/normalização (backend e app) e geração determinística (fakes, fallback).

import type { AvatarColorSlot, AvatarConfig, AvatarItemSlot, AvatarTier } from '@cruzei/shared-types';
import {
  AVATAR_COLOR_SLOTS,
  AVATAR_ITEM_SLOTS,
  CLOTH_COLORS,
  HAIR_COLORS,
  NONE,
  SKIN_COLORS,
  avatarColor,
  avatarItem,
  avatarTierOf,
} from './catalog';

export const DEFAULT_AVATAR: AvatarConfig = {
  v: 1,
  body: 'regular',
  skin: 's3',
  hair: 'short',
  hairColor: 'h_dark',
  face: 'smile',
  facialHair: NONE,
  top: 'tee',
  topColor: 'c_black',
  bottom: 'jeans',
  bottomColor: 'c_denim',
  shoes: 'sneakers',
  shoesColor: 'c_white',
  hat: NONE,
  hatColor: 'c_black',
  glasses: NONE,
  accessory: NONE,
  bag: NONE,
  wrist: NONE,
  aura: NONE,
};

const ITEM_SLOTS = AVATAR_ITEM_SLOTS.map((s) => s.slot as AvatarItemSlot);
const COLOR_SLOTS = AVATAR_COLOR_SLOTS.map((s) => s.slot as AvatarColorSlot);

/** Tamanho máximo aceito pelo backend (JSON serializado). */
export const AVATAR_CONFIG_MAX_BYTES = 1024;

/**
 * Normaliza qualquer entrada pra uma AvatarConfig válida: ids desconhecidos viram o default do slot.
 * `allowedTiers` derruba itens de tier não liberado (ex.: free tentando usar item premium) pro default.
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
  return out;
}

export const ALL_TIERS: ReadonlySet<AvatarTier> = new Set<AvatarTier>(['free', 'premium', 'event']);
export const FREE_TIERS: ReadonlySet<AvatarTier> = new Set<AvatarTier>(['free']);

/** true quando o objeto já é uma config válida e sem itens fora dos tiers permitidos (sem precisar normalizar). */
export function isValidAvatarConfig(input: unknown, allowedTiers: ReadonlySet<AvatarTier> = ALL_TIERS): input is AvatarConfig {
  if (typeof input !== 'object' || input === null) return false;
  const src = input as Record<string, unknown>;
  if (src.v !== 1) return false;
  const normalized = normalizeAvatarConfig(src, allowedTiers);
  return ([...ITEM_SLOTS, ...COLOR_SLOTS] as (AvatarItemSlot | AvatarColorSlot)[]).every((slot) => src[slot] === normalized[slot]);
}

/** Lista de slots cujo item atual exige um tier acima do permitido (pra UI mostrar o cadeado / paywall). */
export function lockedAvatarSlots(config: AvatarConfig, allowedTiers: ReadonlySet<AvatarTier>): AvatarItemSlot[] {
  return ITEM_SLOTS.filter((slot) => !allowedTiers.has(avatarTierOf(slot, config[slot])));
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

function pick<T>(rnd: () => number, list: T[]): T {
  return list[Math.min(list.length - 1, Math.floor(rnd() * list.length))];
}

export interface RandomAvatarOptions {
  /** dá peso a cabelos/roupas mais comuns pro gênero informado (só preferência; qualquer combinação é válida) */
  gender?: 'female' | 'male' | 'non_binary' | 'other' | null;
  /** só itens free (default) ou todos */
  tiers?: ReadonlySet<AvatarTier>;
}

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

/** Avatar estável a partir de uma seed (ex.: userId) — mesma seed, mesmo avatar em todo cliente. */
export function randomAvatarConfig(seed: string, opts: RandomAvatarOptions = {}): AvatarConfig {
  const rnd = prng(hashString(seed));
  const tiers = opts.tiers ?? FREE_TIERS;
  const freeCloth = CLOTH_COLORS.filter((c) => tiers.has(c.tier)).map((c) => c.id);
  const freeHair = HAIR_COLORS.filter((c) => tiers.has(c.tier)).map((c) => c.id);
  const g = opts.gender ?? null;
  const hair = pick(rnd, g === 'female' ? HAIR_F : g === 'male' ? HAIR_M : HAIR_ANY);
  const top = pick(rnd, g === 'female' ? TOPS_F : g === 'male' ? TOPS_M : TOPS_ANY);
  const bottom = pick(rnd, g === 'female' ? BOTTOMS_F : BOTTOMS_M);
  const facialHair = g === 'male' && rnd() < 0.4 ? pick(rnd, ['stubble', 'beard', 'goatee', 'mustache']) : NONE;
  const cfg: AvatarConfig = {
    v: 1,
    body: pick(rnd, ['slim', 'regular', 'regular', 'broad']),
    skin: pick(rnd, SKIN_COLORS).id,
    hair,
    hairColor: pick(rnd, freeHair.slice(0, 10)),
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

/** Chave curta e estável do visual (cache de imagens no mapa). */
export function avatarKey(config: AvatarConfig): string {
  const parts: string[] = [];
  for (const slot of ITEM_SLOTS) parts.push(config[slot]);
  for (const slot of COLOR_SLOTS) parts.push(config[slot]);
  return String(hashString(parts.join('|')).toString(36));
}
