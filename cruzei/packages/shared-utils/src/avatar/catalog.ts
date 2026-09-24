// Catálogo do avatar Cruzei: ids, rótulos e tier de cada item/cor.
// Sem geometria aqui (isso fica no app) — backend valida/gera configs e o app desenha.
// Adicionar item = adicionar uma linha; o renderer só precisa conhecer o id.

import type { AvatarColorSlot, AvatarItemSlot, AvatarSlot, AvatarTier } from '@cruzei/shared-types';

export interface AvatarItemDef {
  id: string;
  label: string;
  tier: AvatarTier;
  /** dica visual pra grade de seleção (emoji); o app pode renderizar o item real em vez disso */
  emoji?: string;
}

export interface AvatarColorDef {
  id: string;
  label: string;
  hex: string;
  tier: AvatarTier;
}

export interface AvatarSlotDef<T> {
  slot: AvatarItemSlot | AvatarColorSlot;
  label: string;
  /** slot pode ficar vazio ('none') */
  optional: boolean;
  items: T[];
}

export const NONE = 'none';

// ---------------- itens ----------------

export const BODY_ITEMS: AvatarItemDef[] = [
  { id: 'slim', label: 'Esguio', tier: 'free' },
  { id: 'regular', label: 'Médio', tier: 'free' },
  { id: 'broad', label: 'Largo', tier: 'free' },
];

export const HAIR_ITEMS: AvatarItemDef[] = [
  { id: 'bald', label: 'Careca', tier: 'free' },
  { id: 'buzz', label: 'Raspado', tier: 'free' },
  { id: 'short', label: 'Curto', tier: 'free' },
  { id: 'side', label: 'Risca lateral', tier: 'free' },
  { id: 'quiff', label: 'Topete', tier: 'free' },
  { id: 'curly', label: 'Cacheado', tier: 'free' },
  { id: 'afro', label: 'Black power', tier: 'free' },
  { id: 'bob', label: 'Chanel', tier: 'free' },
  { id: 'long', label: 'Longo liso', tier: 'free' },
  { id: 'wavy', label: 'Ondulado', tier: 'free' },
  { id: 'ponytail', label: 'Rabo de cavalo', tier: 'free' },
  { id: 'bun', label: 'Coque', tier: 'free' },
  { id: 'braids', label: 'Tranças', tier: 'free' },
  { id: 'mohawk', label: 'Moicano', tier: 'premium' },
  { id: 'dreads', label: 'Dreads', tier: 'premium' },
];

export const FACE_ITEMS: AvatarItemDef[] = [
  { id: 'smile', label: 'Sorriso', tier: 'free' },
  { id: 'grin', label: 'Sorrisão', tier: 'free' },
  { id: 'calm', label: 'Tranquilo', tier: 'free' },
  { id: 'wink', label: 'Piscada', tier: 'free' },
  { id: 'laugh', label: 'Risada', tier: 'free' },
  { id: 'cool', label: 'Descolado', tier: 'free' },
  { id: 'blush', label: 'Tímido', tier: 'free' },
];

export const FACIAL_HAIR_ITEMS: AvatarItemDef[] = [
  { id: NONE, label: 'Nenhuma', tier: 'free' },
  { id: 'stubble', label: 'Barba rala', tier: 'free' },
  { id: 'beard', label: 'Barba cheia', tier: 'free' },
  { id: 'goatee', label: 'Cavanhaque', tier: 'free' },
  { id: 'mustache', label: 'Bigode', tier: 'free' },
];

export const TOP_ITEMS: AvatarItemDef[] = [
  { id: 'tee', label: 'Camiseta', tier: 'free' },
  { id: 'tank', label: 'Regata', tier: 'free' },
  { id: 'polo', label: 'Polo', tier: 'free' },
  { id: 'shirt', label: 'Camisa', tier: 'free' },
  { id: 'hoodie', label: 'Moletom', tier: 'free' },
  { id: 'sweater', label: 'Suéter', tier: 'free' },
  { id: 'jacket', label: 'Jaqueta', tier: 'free' },
  { id: 'crop', label: 'Cropped', tier: 'free' },
  { id: 'dress', label: 'Vestido', tier: 'free' },
  { id: 'neon_jacket', label: 'Jaqueta neon', tier: 'premium' },
  { id: 'jersey', label: 'Camisa 10', tier: 'event' },
];

export const BOTTOM_ITEMS: AvatarItemDef[] = [
  { id: 'jeans', label: 'Jeans', tier: 'free' },
  { id: 'pants', label: 'Calça', tier: 'free' },
  { id: 'shorts', label: 'Shorts', tier: 'free' },
  { id: 'skirt', label: 'Saia', tier: 'free' },
  { id: 'joggers', label: 'Jogger', tier: 'free' },
  { id: 'leggings', label: 'Legging', tier: 'free' },
  { id: 'cargo', label: 'Cargo', tier: 'premium' },
];

export const SHOES_ITEMS: AvatarItemDef[] = [
  { id: 'sneakers', label: 'Tênis', tier: 'free' },
  { id: 'hightops', label: 'Cano alto', tier: 'free' },
  { id: 'boots', label: 'Bota', tier: 'free' },
  { id: 'sandals', label: 'Sandália', tier: 'free' },
  { id: 'runners', label: 'Tênis neon', tier: 'premium' },
];

export const HAT_ITEMS: AvatarItemDef[] = [
  { id: NONE, label: 'Sem chapéu', tier: 'free' },
  { id: 'cap', label: 'Boné', tier: 'free' },
  { id: 'cap_back', label: 'Boné virado', tier: 'free' },
  { id: 'beanie', label: 'Gorro', tier: 'free' },
  { id: 'bucket', label: 'Bucket', tier: 'free' },
  { id: 'headband', label: 'Faixa', tier: 'free' },
  { id: 'straw', label: 'Chapéu de palha', tier: 'premium' },
  { id: 'crown', label: 'Coroa', tier: 'event' },
];

export const GLASSES_ITEMS: AvatarItemDef[] = [
  { id: NONE, label: 'Sem óculos', tier: 'free' },
  { id: 'round', label: 'Redondo', tier: 'free' },
  { id: 'square', label: 'Quadrado', tier: 'free' },
  { id: 'sun', label: 'Escuro', tier: 'free' },
  { id: 'aviator', label: 'Aviador', tier: 'premium' },
  { id: 'visor', label: 'Visor neon', tier: 'premium' },
];

export const ACCESSORY_ITEMS: AvatarItemDef[] = [
  { id: NONE, label: 'Nenhum', tier: 'free' },
  { id: 'earrings', label: 'Brincos', tier: 'free' },
  { id: 'necklace', label: 'Colar', tier: 'free' },
  { id: 'headphones', label: 'Fone', tier: 'free' },
  { id: 'scarf', label: 'Cachecol', tier: 'free' },
  { id: 'flower', label: 'Flor no cabelo', tier: 'free' },
  { id: 'chain', label: 'Corrente dourada', tier: 'premium' },
];

export const BAG_ITEMS: AvatarItemDef[] = [
  { id: NONE, label: 'Sem bolsa', tier: 'free' },
  { id: 'backpack', label: 'Mochila', tier: 'free' },
  { id: 'crossbody', label: 'Transversal', tier: 'free' },
];

export const WRIST_ITEMS: AvatarItemDef[] = [
  { id: NONE, label: 'Nada', tier: 'free' },
  { id: 'watch', label: 'Relógio', tier: 'free' },
  { id: 'bracelet', label: 'Pulseira', tier: 'free' },
  { id: 'smartwatch', label: 'Smartwatch', tier: 'premium' },
];

export const AURA_ITEMS: AvatarItemDef[] = [
  { id: NONE, label: 'Sem efeito', tier: 'free' },
  { id: 'lime', label: 'Aura lima', tier: 'premium' },
  { id: 'magenta', label: 'Aura magenta', tier: 'premium' },
  { id: 'gold', label: 'Aura dourada', tier: 'premium' },
  { id: 'fest', label: 'Aura Cruzei Fest', tier: 'event' },
];

// ---------------- cores ----------------

export const SKIN_COLORS: AvatarColorDef[] = [
  { id: 's1', label: 'Pele 1', hex: '#F8D9C4', tier: 'free' },
  { id: 's2', label: 'Pele 2', hex: '#F2C6A6', tier: 'free' },
  { id: 's3', label: 'Pele 3', hex: '#E8B590', tier: 'free' },
  { id: 's4', label: 'Pele 4', hex: '#D39B72', tier: 'free' },
  { id: 's5', label: 'Pele 5', hex: '#B87A52', tier: 'free' },
  { id: 's6', label: 'Pele 6', hex: '#95583A', tier: 'free' },
  { id: 's7', label: 'Pele 7', hex: '#6E3E28', tier: 'free' },
  { id: 's8', label: 'Pele 8', hex: '#4A2A1C', tier: 'free' },
];

export const HAIR_COLORS: AvatarColorDef[] = [
  { id: 'h_black', label: 'Preto', hex: '#1B1B25', tier: 'free' },
  { id: 'h_dark', label: 'Castanho escuro', hex: '#3B2A20', tier: 'free' },
  { id: 'h_brown', label: 'Castanho', hex: '#6B4A32', tier: 'free' },
  { id: 'h_light', label: 'Castanho claro', hex: '#9C7150', tier: 'free' },
  { id: 'h_blonde', label: 'Loiro', hex: '#D9B26A', tier: 'free' },
  { id: 'h_platinum', label: 'Platinado', hex: '#EEE3C8', tier: 'free' },
  { id: 'h_red', label: 'Ruivo', hex: '#B5442A', tier: 'free' },
  { id: 'h_auburn', label: 'Acobreado', hex: '#8E3A2B', tier: 'free' },
  { id: 'h_gray', label: 'Grisalho', hex: '#9A9AA5', tier: 'free' },
  { id: 'h_white', label: 'Branco', hex: '#F1F1F1', tier: 'free' },
  { id: 'h_pink', label: 'Rosa', hex: '#FF6FB1', tier: 'premium' },
  { id: 'h_blue', label: 'Azul', hex: '#4C8DFF', tier: 'premium' },
  { id: 'h_purple', label: 'Roxo', hex: '#9B5CFF', tier: 'premium' },
  { id: 'h_green', label: 'Verde', hex: '#4CD97B', tier: 'premium' },
  { id: 'h_lime', label: 'Lima neon', hex: '#7FFF00', tier: 'premium' },
];

export const CLOTH_COLORS: AvatarColorDef[] = [
  { id: 'c_black', label: 'Preto', hex: '#16161E', tier: 'free' },
  { id: 'c_white', label: 'Branco', hex: '#F5F5F7', tier: 'free' },
  { id: 'c_gray', label: 'Cinza', hex: '#8A8A96', tier: 'free' },
  { id: 'c_navy', label: 'Marinho', hex: '#23305A', tier: 'free' },
  { id: 'c_denim', label: 'Jeans', hex: '#4A6FA5', tier: 'free' },
  { id: 'c_lightdenim', label: 'Jeans claro', hex: '#87A9D6', tier: 'free' },
  { id: 'c_red', label: 'Vermelho', hex: '#D93A3A', tier: 'free' },
  { id: 'c_coral', label: 'Coral', hex: '#FF6B57', tier: 'free' },
  { id: 'c_orange', label: 'Laranja', hex: '#FF8C3A', tier: 'free' },
  { id: 'c_yellow', label: 'Amarelo', hex: '#FFD23F', tier: 'free' },
  { id: 'c_green', label: 'Verde', hex: '#3BAF6E', tier: 'free' },
  { id: 'c_teal', label: 'Petróleo', hex: '#2BB3A3', tier: 'free' },
  { id: 'c_blue', label: 'Azul', hex: '#3A7BFF', tier: 'free' },
  { id: 'c_purple', label: 'Roxo', hex: '#7B57F5', tier: 'free' },
  { id: 'c_pink', label: 'Rosa', hex: '#FF5AA7', tier: 'free' },
  { id: 'c_beige', label: 'Bege', hex: '#D9C3A3', tier: 'free' },
  { id: 'c_brown', label: 'Marrom', hex: '#7A4E2D', tier: 'free' },
  { id: 'c_olive', label: 'Oliva', hex: '#6E7A3B', tier: 'free' },
  { id: 'c_lime', label: 'Lima Cruzei', hex: '#7FFF00', tier: 'premium' },
  { id: 'c_magenta', label: 'Magenta Cruzei', hex: '#FF1493', tier: 'premium' },
  { id: 'c_gold', label: 'Dourado', hex: '#FFD700', tier: 'premium' },
];

// ---------------- slots ----------------

export const AVATAR_ITEM_SLOTS: AvatarSlotDef<AvatarItemDef>[] = [
  { slot: 'body', label: 'Corpo', optional: false, items: BODY_ITEMS },
  { slot: 'hair', label: 'Cabelo', optional: false, items: HAIR_ITEMS },
  { slot: 'face', label: 'Rosto', optional: false, items: FACE_ITEMS },
  { slot: 'facialHair', label: 'Barba', optional: true, items: FACIAL_HAIR_ITEMS },
  { slot: 'top', label: 'Parte de cima', optional: false, items: TOP_ITEMS },
  { slot: 'bottom', label: 'Parte de baixo', optional: false, items: BOTTOM_ITEMS },
  { slot: 'shoes', label: 'Calçado', optional: false, items: SHOES_ITEMS },
  { slot: 'hat', label: 'Cabeça', optional: true, items: HAT_ITEMS },
  { slot: 'glasses', label: 'Óculos', optional: true, items: GLASSES_ITEMS },
  { slot: 'accessory', label: 'Acessório', optional: true, items: ACCESSORY_ITEMS },
  { slot: 'bag', label: 'Bolsa', optional: true, items: BAG_ITEMS },
  { slot: 'wrist', label: 'Pulso', optional: true, items: WRIST_ITEMS },
  { slot: 'aura', label: 'Efeito', optional: true, items: AURA_ITEMS },
];

export const AVATAR_COLOR_SLOTS: AvatarSlotDef<AvatarColorDef>[] = [
  { slot: 'skin', label: 'Tom de pele', optional: false, items: SKIN_COLORS },
  { slot: 'hairColor', label: 'Cor do cabelo', optional: false, items: HAIR_COLORS },
  { slot: 'topColor', label: 'Cor da roupa', optional: false, items: CLOTH_COLORS },
  { slot: 'bottomColor', label: 'Cor da calça', optional: false, items: CLOTH_COLORS },
  { slot: 'shoesColor', label: 'Cor do calçado', optional: false, items: CLOTH_COLORS },
  { slot: 'hatColor', label: 'Cor do chapéu', optional: false, items: CLOTH_COLORS },
];

const itemIndex = new Map<string, Map<string, AvatarItemDef>>();
for (const s of AVATAR_ITEM_SLOTS) itemIndex.set(s.slot, new Map(s.items.map((i) => [i.id, i])));
const colorIndex = new Map<string, Map<string, AvatarColorDef>>();
for (const s of AVATAR_COLOR_SLOTS) colorIndex.set(s.slot, new Map(s.items.map((i) => [i.id, i])));

export function avatarItem(slot: AvatarItemSlot, id: string): AvatarItemDef | undefined {
  return itemIndex.get(slot)?.get(id);
}

export function avatarColor(slot: AvatarColorSlot, id: string): AvatarColorDef | undefined {
  return colorIndex.get(slot)?.get(id);
}

/** hex da cor de um slot (fallback: primeira cor do slot) */
export function avatarColorHex(slot: AvatarColorSlot, id: string): string {
  const def = avatarColor(slot, id);
  if (def) return def.hex;
  const first = AVATAR_COLOR_SLOTS.find((s) => s.slot === slot)?.items[0];
  return first ? first.hex : '#888888';
}

/** o tier necessário pra usar um item/cor ('free' quando o id não existe — o normalize já troca por default) */
export function avatarTierOf(slot: AvatarSlot, id: string): AvatarTier {
  return itemIndex.get(slot)?.get(id)?.tier ?? colorIndex.get(slot)?.get(id)?.tier ?? 'free';
}
