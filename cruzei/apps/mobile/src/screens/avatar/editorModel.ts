// Lógica pura do editor/loja do avatar (sem React): categorias e abas, filtros, estado e rótulo acessível dos tiles,
// config de miniatura de cada item, itens bloqueados na prévia e o "Surpreender". Testada em __tests__/editorModel.test.ts.

import type { AvatarCategoryKey, AvatarColorSlot, AvatarConfig, AvatarItemSlot, AvatarRarity, AvatarSlot, AvatarTier, Gender } from '@cruzei/shared-types';
import {
  AVATAR_CATEGORIES,
  AVATAR_PROTECTED_ITEMS,
  RARITY_LABEL,
  avatarCategoryDef,
  avatarCategoryOf,
  avatarColor,
  avatarItem,
  avatarKey,
  avatarSlotDef,
  avatarUnlockText,
  lockedAvatarSlots,
  petPosesOf,
  randomAvatarConfig,
  type AvatarCategoryDef,
} from '@cruzei/shared-utils';

import { sceneFor } from '../../avatar';
import { buildAnatomy, restArmDelta } from '../../avatar/anatomy';
import { fillConfig } from '../../avatar/ctx';
import { emoteDef, emoteFaceAt } from '../../avatar/emotes';
import { NEUTRAL_VARIATION, type Pose } from '../../avatar/pose';

// ---------------------------------------------------------------------------------------------------------------
// categorias e abas
// ---------------------------------------------------------------------------------------------------------------

/** aba do segundo nível: slot de item, slot de cor (grade de bolinhas) ou os looks prontos */
export type EditorTab = AvatarItemSlot | AvatarColorSlot | 'looks';
export type EditorCatKey = AvatarCategoryKey | 'looks';

export interface EditorCategory {
  key: EditorCatKey;
  label: string;
  icon: string;
  tabs: EditorTab[];
  /** definição do catálogo (null nos Looks) */
  def: AvatarCategoryDef | null;
}

/** cores extras da categoria entram logo depois do item a que se referem (pele depois do corpo, olhos depois dos olhos) */
const EXTRA_AFTER: Partial<Record<AvatarColorSlot, AvatarItemSlot>> = { skin: 'body', eyeColor: 'eyes' };

function tabsOf(c: AvatarCategoryDef): EditorTab[] {
  const tabs: EditorTab[] = [...c.slots];
  for (const color of c.extraColors ?? []) {
    const at = tabs.indexOf(EXTRA_AFTER[color] as EditorTab);
    if (at >= 0) tabs.splice(at + 1, 0, color);
    else tabs.push(color);
  }
  return tabs;
}

export const EDITOR_CATEGORIES: EditorCategory[] = [
  { key: 'looks', label: 'Looks', icon: 'color-wand-outline', tabs: ['looks'], def: null },
  ...AVATAR_CATEGORIES.map((c) => ({ key: c.key, label: c.label, icon: c.icon, tabs: tabsOf(c), def: c })),
];

export function editorCategory(key: EditorCatKey): EditorCategory {
  return EDITOR_CATEGORIES.find((c) => c.key === key) ?? EDITOR_CATEGORIES[1];
}

/** categoria onde a aba mora (pra voltar no rascunho) */
export function categoryOfTab(tab: string): EditorCategory | null {
  return EDITOR_CATEGORIES.find((c) => (c.tabs as string[]).includes(tab)) ?? null;
}

export function tabLabel(tab: EditorTab): string {
  if (tab === 'looks') return 'Looks prontos';
  return avatarSlotDef(tab as AvatarSlot).label;
}

const COLOR_TABS: ReadonlySet<string> = new Set<AvatarColorSlot>(['skin', 'eyeColor', 'hairColor', 'topColor', 'outerColor', 'bottomColor', 'shoesColor', 'hatColor', 'auraColor', 'vehicleColor']);

/** como a aba desenha o conteúdo */
export type TabKind = 'items' | 'colors' | 'flags' | 'pronouns' | 'looks';

export function tabKind(tab: EditorTab): TabKind {
  if (tab === 'looks') return 'looks';
  if (tab === 'prideFlag') return 'flags';
  if (tab === 'pronouns') return 'pronouns';
  return COLOR_TABS.has(tab) ? 'colors' : 'items';
}

/**
 * Linhas secundárias contextuais em cima da grade: bolinhas de cor do item (só quando tem item pra pintar), chips de
 * intensidade da aura / posição do pet (só com aura / pet; só as posições que o pet aceita) e bandeira dos itens de orgulho.
 */
export interface SecondaryRows {
  color: AvatarColorSlot | null;
  chips: { slot: AvatarItemSlot; ids: string[] } | null;
  flags: boolean;
}

export function secondaryRows(cat: EditorCategory, tab: EditorTab, cfg: AvatarConfig): SecondaryRows {
  const out: SecondaryRows = { color: null, chips: null, flags: tab === 'pride' };
  if (tab === 'looks' || !cat.def) return out;
  const slot = tab as AvatarItemSlot;
  const color = cat.def.colorOf?.[slot];
  if (color && (slot === 'hair' || slot === 'facialHair' || cfg[slot] !== 'none')) out.color = color;
  const chip = cat.def.chipsOf?.[slot];
  if (chip === 'petPose') {
    const ids = petPosesOf(cfg.pet);
    if (ids.length > 1) out.chips = { slot: chip, ids };
  } else if (chip && cfg[slot] !== 'none') {
    out.chips = { slot: chip, ids: avatarSlotDef(chip).items.map((i) => i.id) };
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// filtros e estado dos itens
// ---------------------------------------------------------------------------------------------------------------

export type ItemFilter = 'all' | 'unlocked' | 'premium' | 'new';

export const ITEM_FILTERS: { key: ItemFilter; label: string }[] = [
  { key: 'all', label: 'Todos' },
  { key: 'unlocked', label: 'Liberados' },
  { key: 'premium', label: 'Premium' },
  { key: 'new', label: 'Novos' },
];

/** "Premium" junta Premium e Premium+ (evento fica de fora: não se libera assinando) */
export function filterItems<T extends { tier: AvatarTier; isNew?: boolean }>(items: readonly T[], filter: ItemFilter, allowed: ReadonlySet<AvatarTier>): T[] {
  switch (filter) {
    case 'unlocked':
      return items.filter((i) => allowed.has(i.tier));
    case 'premium':
      return items.filter((i) => i.tier === 'premium' || i.tier === 'plus');
    case 'new':
      return items.filter((i) => i.isNew === true);
    default:
      return [...items];
  }
}

export interface TileInfo {
  label: string;
  /** rótulo da categoria (Roupas, Acessórios…) */
  category: string;
  rarity: AvatarRarity;
  tier: AvatarTier;
  /** está na prévia agora */
  equipped: boolean;
  /** tier fora do plano da pessoa */
  locked: boolean;
  isNew?: boolean;
  animated?: boolean;
}

/** rótulo completo pro leitor de tela: nome, categoria, raridade, estado e como liberar */
export function tileA11yLabel(t: TileInfo): string {
  const parts = [t.label, t.category, RARITY_LABEL[t.rarity]];
  if (t.equipped) parts.push(t.locked ? 'Experimentando na prévia' : 'Equipado');
  parts.push(t.locked ? `Bloqueado. ${avatarUnlockText(t.tier)}` : 'Liberado');
  if (t.isNew) parts.push('Novo');
  if (t.animated) parts.push('Animado');
  return parts.join('. ');
}

export function categoryLabelOf(slot: AvatarSlot): string {
  return avatarCategoryDef(avatarCategoryOf(slot))?.label ?? '';
}

/** um item ou uma cor da config que o plano da pessoa ainda não libera */
export interface LockedEntry {
  slot: AvatarSlot;
  id: string;
  label: string;
  tier: AvatarTier;
}

export function lockedEntries(cfg: AvatarConfig, allowed: ReadonlySet<AvatarTier>): LockedEntry[] {
  return lockedAvatarSlots(cfg, allowed).map((slot) => {
    const id = cfg[slot];
    const item = avatarItem(slot as AvatarItemSlot, id);
    const color = item ? undefined : avatarColor(slot as AvatarColorSlot, id);
    const name = item?.label ?? color?.label ?? id;
    return { slot, id, label: color ? `${avatarSlotDef(slot).label}: ${name}` : name, tier: item?.tier ?? color?.tier ?? 'free' };
  });
}

/** só dá pra liberar assinando se pelo menos um bloqueado for Premium/Premium+ (evento não se compra) */
export function canUnlockWithPremium(entries: readonly LockedEntry[]): boolean {
  return entries.some((e) => e.tier === 'premium' || e.tier === 'plus');
}

// ---------------------------------------------------------------------------------------------------------------
// aplicar e miniaturas
// ---------------------------------------------------------------------------------------------------------------

/** troca um slot; trocar o pet acerta a posição pra uma que ele aceita */
export function applyItem(cfg: AvatarConfig, slot: AvatarSlot, id: string): AvatarConfig {
  if (cfg[slot] === id) return cfg;
  const next: AvatarConfig = { ...cfg, [slot]: id };
  if (slot === 'pet') {
    const poses = petPosesOf(id) as string[];
    if (poses.length && !poses.includes(next.petPose)) next.petPose = poses[0];
  }
  return next;
}

/** abas que a miniatura mostra no busto (o resto é corpo inteiro) */
const BUST_TABS: ReadonlySet<string> = new Set([
  'faceShape',
  'eyes',
  'brows',
  'nose',
  'face',
  'lines',
  'faceDetail',
  'hair',
  'facialHair',
  'hat',
  'glasses',
  'accessory',
  'skin',
  'eyeColor',
  'hairColor',
]);

/** abas de tronco e mão: corpo inteiro maior, cortado no joelho (colar, pulseira e objeto na mão ficam legíveis) */
const UPPER_TABS: ReadonlySet<string> = new Set(['top', 'topColor', 'outer', 'outerColor', 'neck', 'bag', 'wrist', 'pride', 'held', 'emote']);

/** enquadramento da miniatura: busto, corpo inteiro ou da cintura pra cima ('upper') */
export type TileFrame = 'bust' | 'full' | 'upper';

export function tileMode(tab: EditorTab): TileFrame {
  return BUST_TABS.has(tab) ? 'bust' : UPPER_TABS.has(tab) ? 'upper' : 'full';
}

/** abas de rosto e cabelo: a miniatura tira o chapéu (senão as opções ficam iguais por baixo do gorro) */
const NO_HAT_TABS: ReadonlySet<string> = new Set(['faceShape', 'eyes', 'brows', 'nose', 'face', 'lines', 'faceDetail', 'hair', 'facialHair', 'eyeColor', 'hairColor']);

/**
 * Config da miniatura de um item: a prévia atual com o item trocado, sem o que atrapalha a leitura daquele item
 * (veículo, pet e aura só aparecem nas próprias abas; chapéu e óculos saem nas abas de rosto). Trocar o item do mesmo
 * slot não muda a miniatura dos outros tiles (a chave do desenho fica igual e o SVG não é refeito).
 */
export function tilePreviewConfig(cfg: AvatarConfig, slot: AvatarSlot, id: string): AvatarConfig {
  const next = applyItem(cfg, slot, id);
  const out: AvatarConfig = next === cfg ? { ...cfg } : next;
  const def = slot === 'emote' ? emoteDef(id) : null;
  if (slot !== 'vehicle' && slot !== 'vehicleColor') out.vehicle = 'none';
  if (slot !== 'pet' && !def?.needsPet) out.pet = 'none';
  if (slot !== 'aura' && slot !== 'auraColor' && slot !== 'auraLevel') out.aura = 'none';
  if (NO_HAT_TABS.has(slot)) {
    out.hat = 'none';
    if (slot !== 'hair' && slot !== 'hairColor') out.glasses = 'none';
  }
  if (def) {
    out.face = emoteFaceAt(def, def.keyK) ?? out.face;
    if (def.prop && avatarItem('held', def.prop)) out.held = def.prop;
  }
  return out;
}

const poseCache = new Map<string, Pose | null>();

/**
 * pose parada do melhor quadro (keyK) da animação: miniatura do tile e movimento reduzido. Com `cfg`, a animação que
 * mexe os braços parte do braço solto DESTA pessoa (restArmDelta), como no palco e no mapa.
 */
export function emoteStillPose(id: string, cfg?: AvatarConfig): Pose | null {
  const key = cfg ? `${id}|${avatarKey(cfg)}` : id;
  if (poseCache.has(key)) return poseCache.get(key) ?? null;
  const def = emoteDef(id);
  let pose: Pose | null = null;
  if (def) {
    try {
      pose = def.pose(def.keyK, def.keyK * def.dur, NEUTRAL_VARIATION);
      if (cfg && def.usesArms) {
        const full = fillConfig(cfg);
        const d = restArmDelta(buildAnatomy(full, sceneFor(full)));
        pose = { ...pose, armL: { r: pose.armL.r + d.armL }, armR: { r: pose.armR.r + d.armR }, foreL: { r: (pose.foreL?.r ?? 0) + d.foreL }, foreR: { r: (pose.foreR?.r ?? 0) + d.foreR } };
      }
    } catch {
      pose = null;
    }
  }
  if (poseCache.size > 400) poseCache.clear();
  poseCache.set(key, pose);
  return pose;
}

// ---------------------------------------------------------------------------------------------------------------
// Surpreender
// ---------------------------------------------------------------------------------------------------------------

/** escolhas que são da pessoa e o sorteio não mexe: pronomes, bandeira e itens de orgulho */
const KEEP_ON_SURPRISE: readonly AvatarSlot[] = ['pronouns', 'prideFlag', 'pride'];
/** cor que acompanha um item protegido (hijab, turbante, cadeira de rodas) */
const PROTECTED_COLOR: Partial<Record<AvatarItemSlot, AvatarColorSlot>> = { hat: 'hatColor', vehicle: 'vehicleColor' };

/**
 * Visual sorteado dentro do plano da pessoa. Mantém pronomes, bandeira, itens de orgulho e os itens que fazem parte de
 * quem a pessoa é (hijab, turbante, aparelho auditivo, cadeira de rodas) com a cor deles.
 */
export function surpriseConfig(seed: string, current: AvatarConfig, gender: Gender | null | undefined, allowed: ReadonlySet<AvatarTier>): AvatarConfig {
  const next = randomAvatarConfig(seed, { gender: gender ?? null, tiers: allowed });
  for (const slot of KEEP_ON_SURPRISE) next[slot] = current[slot];
  for (const [slot, ids] of Object.entries(AVATAR_PROTECTED_ITEMS) as [AvatarItemSlot, readonly string[]][]) {
    if (!ids.includes(current[slot])) continue;
    next[slot] = current[slot];
    const color = PROTECTED_COLOR[slot];
    if (color) next[color] = current[color];
  }
  return next;
}
