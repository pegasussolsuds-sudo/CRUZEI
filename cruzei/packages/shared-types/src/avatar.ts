// Avatar do Metch — identidade visual do usuário dentro do "universo" (mapa, perfil, match, chat).
// Config é um JSON pequeno (slot -> id de item) guardado em users.avatar_config e enviado nos payloads públicos.
// O catálogo de itens (ids, rótulos, tier, raridade) fica em @cruzei/shared-utils; a geometria (paths SVG) fica no app.
//
// Compatibilidade: `v` continua 1. Os slots marcados "(v1.1)" foram adicionados depois — config antiga sem eles é
// válida e o normalize preenche o padrão. Cliente antigo ignora chave desconhecida (o normalize parte do padrão).

/** Slots de item (cada um aceita um id do catálogo daquele slot). */
export type AvatarItemSlot =
  | 'body'
  | 'hair'
  /** (v1.1) formato do rosto: oval, redondo, quadrado, coração, longo, diamante */
  | 'faceShape'
  /** (v1.1) formato dos olhos (amendoado, redondo, puxado, caído…) */
  | 'eyes'
  /** (v1.1) sobrancelhas */
  | 'brows'
  /** (v1.1) nariz */
  | 'nose'
  /** expressão (sorriso, piscada, beijinho…) */
  | 'face'
  /** (v1.1) marcas do tempo: nenhuma, linhas suaves, linhas marcadas (livre pra qualquer avatar) */
  | 'lines'
  /** (v1.1) sardas, pinta, vitiligo, maquiagem… */
  | 'faceDetail'
  | 'facialHair'
  | 'top'
  /** (v1.1) peça por cima: blazer, cardigã, jaqueta, capa… */
  | 'outer'
  | 'bottom'
  | 'shoes'
  | 'hat'
  | 'glasses'
  /** cabeça/orelhas: brincos, fone, flor, aparelho auditivo… (colares migraram pro `neck`) */
  | 'accessory'
  /** (v1.1) pescoço: colar, corrente, gravata, lenço… */
  | 'neck'
  /** bolsa e costas (mochila, asas, jetpack…) */
  | 'bag'
  | 'wrist'
  /** (v1.1) item de orgulho (pin, capa, pintura…) desenhado com as cores de `prideFlag` */
  | 'pride'
  /** (v1.1) bandeira usada pelos itens de orgulho (não aparece sozinha) */
  | 'prideFlag'
  /** (v1.1) placa de pronomes (só em telas grandes; nunca no mapa) */
  | 'pronouns'
  /** efeito especial em volta do avatar; 'none' por padrão */
  | 'aura'
  /** (v1.1) intensidade da aura: soft | medium | max */
  | 'auraLevel'
  /** (v1.1) fundo atrás do avatar (perfil, prévia, card) */
  | 'backdrop'
  /** (v1.1) animação assinatura (dança, beijo, reverência…) */
  | 'emote'
  /** (v1.1) bichinho junto do avatar */
  | 'pet'
  /** (v1.1) onde o pet fica: side | arms | shoulder | float (cada pet aceita alguns) */
  | 'petPose'
  /** (v1.1) veículo: carro, moto, bike, patinete, cadeira de rodas, tapete voador… */
  | 'vehicle'
  /** (v1.1) objeto na mão direita: flores, instrumento, troféu, varinha… */
  | 'held';

/** Slots de cor (cada um aceita um id de paleta). */
export type AvatarColorSlot =
  | 'skin'
  /** (v1.1) */
  | 'eyeColor'
  | 'hairColor'
  | 'topColor'
  /** (v1.1) */
  | 'outerColor'
  | 'bottomColor'
  | 'shoesColor'
  | 'hatColor'
  /** (v1.1) tinta da aura; 'a_auto' = cor original do efeito */
  | 'auraColor'
  /** (v1.1) */
  | 'vehicleColor';

export type AvatarSlot = AvatarItemSlot | AvatarColorSlot;

/**
 * Quem pode usar: free = todo mundo; premium = assinatura Premium ou Premium+; plus = só Premium+;
 * event = itens de evento (bloqueados pra todos até o evento existir).
 */
export type AvatarTier = 'free' | 'premium' | 'plus' | 'event';

/** Raridade (só visual: brilho/borda do item na loja). Sem sorteio: o tier é que decide o desbloqueio. */
export type AvatarRarity = 'common' | 'rare' | 'epic' | 'legendary';

/** Estilos pra agrupar itens e looks prontos. Nenhum item é restrito por idade ou gênero. */
export type AvatarStyleTag =
  | 'casual'
  | 'elegante'
  | 'urbano'
  | 'fantasia'
  | 'futurista'
  | 'festa'
  | 'atemporal'
  | 'esporte'
  | 'praia'
  | 'orgulho';

/**
 * Como o avatar vai no veículo:
 * cover = carro visto de frente, cobre da cintura pra baixo, mãos no volante;
 * straddle = moto/bike, pernas abertas, mãos no guidão;
 * stand = em pé sobre a prancha (patinete, skate, hoverboard);
 * seat = sentado (cadeira de rodas), pernas encurtadas;
 * hover = flutuando sobre algo (tapete, nuvem, disco), balanço suave.
 */
export type AvatarMountKind = 'cover' | 'straddle' | 'stand' | 'seat' | 'hover';

/** Onde o pet fica. */
export type AvatarPetPose = 'side' | 'arms' | 'shoulder' | 'float';

/** Categorias da loja/editor (cada uma agrupa slots). */
export type AvatarCategoryKey =
  | 'look'
  | 'hair'
  | 'clothes'
  | 'accessories'
  | 'pride'
  | 'effects'
  | 'emotes'
  | 'pets'
  | 'rides'
  | 'held';

export interface AvatarConfig {
  v: 1;
  body: string;
  skin: string;
  /** (v1.1) */
  faceShape: string;
  /** (v1.1) */
  eyes: string;
  /** (v1.1) */
  eyeColor: string;
  /** (v1.1) */
  brows: string;
  /** (v1.1) */
  nose: string;
  hair: string;
  hairColor: string;
  face: string;
  /** (v1.1) */
  lines: string;
  /** (v1.1) */
  faceDetail: string;
  facialHair: string;
  top: string;
  topColor: string;
  /** (v1.1) */
  outer: string;
  /** (v1.1) */
  outerColor: string;
  bottom: string;
  bottomColor: string;
  shoes: string;
  shoesColor: string;
  hat: string;
  hatColor: string;
  glasses: string;
  accessory: string;
  /** (v1.1) */
  neck: string;
  bag: string;
  wrist: string;
  /** (v1.1) */
  pride: string;
  /** (v1.1) */
  prideFlag: string;
  /** (v1.1) */
  pronouns: string;
  /** efeito especial em volta do avatar (itens premium/evento); 'none' por padrão */
  aura: string;
  /** (v1.1) */
  auraColor: string;
  /** (v1.1) */
  auraLevel: string;
  /** (v1.1) */
  backdrop: string;
  /** (v1.1) */
  emote: string;
  /** (v1.1) */
  pet: string;
  /** (v1.1) */
  petPose: string;
  /** (v1.1) */
  vehicle: string;
  /** (v1.1) */
  vehicleColor: string;
  /** (v1.1) */
  held: string;
}
