// Avatar do Cruzei — identidade visual do usuário dentro do "universo" (mapa, perfil, match, chat).
// Config é um JSON pequeno (slot -> id de item) guardado em users.avatar_config e enviado nos payloads públicos.
// O catálogo de itens (ids, rótulos, tier) fica em @cruzei/shared-utils; a geometria (paths SVG) fica no app.

/** Slots de item (cada um aceita um id do catálogo daquele slot). */
export type AvatarItemSlot =
  | 'body'
  | 'hair'
  | 'face'
  | 'facialHair'
  | 'top'
  | 'bottom'
  | 'shoes'
  | 'hat'
  | 'glasses'
  | 'accessory'
  | 'bag'
  | 'wrist'
  | 'aura';

/** Slots de cor (cada um aceita um id de paleta). */
export type AvatarColorSlot = 'skin' | 'hairColor' | 'topColor' | 'bottomColor' | 'shoesColor' | 'hatColor';

export type AvatarSlot = AvatarItemSlot | AvatarColorSlot;

export type AvatarTier = 'free' | 'premium' | 'event';

export interface AvatarConfig {
  v: 1;
  body: string;
  skin: string;
  hair: string;
  hairColor: string;
  face: string;
  facialHair: string;
  top: string;
  topColor: string;
  bottom: string;
  bottomColor: string;
  shoes: string;
  shoesColor: string;
  hat: string;
  hatColor: string;
  glasses: string;
  accessory: string;
  bag: string;
  wrist: string;
  /** efeito especial em volta do avatar (itens premium/evento); 'none' por padrão */
  aura: string;
}
