// Catálogo do avatar Metch: ids, rótulos, tier, raridade, estilos, dicas e categorias de cada item/cor.
// Sem geometria aqui (isso fica no app) — backend valida/gera configs e o app desenha.
// Adicionar item = adicionar uma linha; o renderer só precisa conhecer o id.
//
// Regras do catálogo:
// - ids são contrato: configs salvas continuam valendo (nunca renomeie nem remova um id; no máximo mude de slot com migração).
// - nenhum item é restrito por idade ou gênero e nenhuma identidade é presumida;
// - desbloqueio só pelo plano (free / Premium / Premium+); não existe moeda nem sorteio — a raridade é só visual.

import type {
  AvatarCategoryKey,
  AvatarColorSlot,
  AvatarConfig,
  AvatarItemSlot,
  AvatarMountKind,
  AvatarPetPose,
  AvatarRarity,
  AvatarSlot,
  AvatarStyleTag,
  AvatarTier,
} from '@cruzei/shared-types';

export interface AvatarItemDef {
  id: string;
  label: string;
  tier: AvatarTier;
  /** raridade visual (borda/brilho na loja); padrão pelo tier — use avatarRarityOf() */
  rarity?: AvatarRarity;
  /** estilos pra filtros e looks prontos */
  tags?: AvatarStyleTag[];
  /** frase curta e charmosa pra prévia do item */
  desc?: string;
  /** item novo (selo "Novo" na loja) */
  isNew?: boolean;
  /** só veículos: como o avatar vai montado */
  mount?: AvatarMountKind;
  /** só pets: posições aceitas, a primeira é a padrão */
  petPoses?: AvatarPetPose[];
  /** item que se mexe (aura animada, animação) */
  animated?: boolean;
  /** dica visual pra grade de seleção (emoji); o app pode renderizar o item real em vez disso */
  emoji?: string;
}

export interface AvatarColorDef {
  id: string;
  label: string;
  hex: string;
  tier: AvatarTier;
  /** descrição acessível (ex.: subtom da pele) */
  desc?: string;
  isNew?: boolean;
}

export interface AvatarSlotDef<T> {
  slot: AvatarItemSlot | AvatarColorSlot;
  label: string;
  /** slot pode ficar vazio ('none') */
  optional: boolean;
  items: T[];
  /** categoria do editor onde o slot aparece */
  category: AvatarCategoryKey;
  /** dica curta mostrada no editor */
  hint?: string;
}

/** Bandeira de orgulho: listras horizontais de cima pra baixo (w = peso relativo, padrão 1) + desenho extra opcional. */
export interface AvatarFlagDef {
  id: string;
  label: string;
  stripes: { hex: string; w?: number }[];
  /**
   * progress = chevron Progress Pride (preto, marrom, azul, rosa e branco) à esquerda;
   * intersex = anel roxo no centro; demi = chevron preto à esquerda; ally = chevron arco-íris (A) no centro.
   */
  overlay?: 'progress' | 'intersex' | 'demi' | 'ally';
}

/** Categoria do editor/loja: agrupa slots e diz quais cores e chips aparecem junto de cada slot. */
export interface AvatarCategoryDef {
  key: AvatarCategoryKey;
  label: string;
  /** nome de ícone do Ionicons 5 (@expo/vector-icons) */
  icon: string;
  /** slots de item mostrados como abas/listas, em ordem */
  slots: AvatarItemSlot[];
  /** paleta de cor que acompanha cada slot de item */
  colorOf?: Partial<Record<AvatarItemSlot, AvatarColorSlot>>;
  /** slot de item pequeno mostrado como chips abaixo do slot (ex.: intensidade da aura, posição do pet) */
  chipsOf?: Partial<Record<AvatarItemSlot, AvatarItemSlot>>;
  /** paletas da categoria que não pertencem a um slot específico (ex.: pele e cor dos olhos) */
  extraColors?: AvatarColorSlot[];
}

/** Look pronto: só mexe em roupas, acessórios, efeitos, fundo, veículo, pet, objeto e animação. */
export interface AvatarLookDef {
  id: string;
  label: string;
  desc: string;
  tag: AvatarStyleTag;
  set: Partial<AvatarConfig>;
}

export const NONE = 'none';

// ---------------- rótulos ----------------

export const TIER_LABEL: Record<AvatarTier, string> = {
  free: 'Grátis',
  premium: 'Premium',
  plus: 'Premium+',
  event: 'Evento',
};

export const RARITY_LABEL: Record<AvatarRarity, string> = {
  common: 'Comum',
  rare: 'Raro',
  epic: 'Épico',
  legendary: 'Lendário',
};

export const STYLE_TAG_LABEL: Record<AvatarStyleTag, string> = {
  casual: 'Casual',
  elegante: 'Elegante',
  urbano: 'Urbano',
  fantasia: 'Fantasia',
  futurista: 'Futurista',
  festa: 'Festa',
  atemporal: 'Atemporal',
  esporte: 'Esporte',
  praia: 'Praia',
  orgulho: 'Orgulho',
};

/** Raridade padrão de cada tier (quando o item não declara uma). */
export const RARITY_BY_TIER: Record<AvatarTier, AvatarRarity> = {
  free: 'common',
  premium: 'rare',
  plus: 'legendary',
  event: 'epic',
};

/** Texto de desbloqueio pro detalhe do item. */
export function avatarUnlockText(tier: AvatarTier): string {
  switch (tier) {
    case 'free':
      return 'Liberado pra todo mundo';
    case 'premium':
      return 'Incluído no Premium e no Premium+';
    case 'plus':
      return 'Exclusivo do Premium+';
    case 'event':
      return 'Item de evento — chega em breve';
  }
}

// ---------------- construtores ----------------

type ItemExtra = Pick<AvatarItemDef, 'rarity' | 'tags' | 'mount' | 'petPoses' | 'animated'>;

/** item que já existia antes da v1.1 */
function item(id: string, label: string, tier: AvatarTier, emoji: string, desc: string, extra: ItemExtra = {}): AvatarItemDef {
  const def: AvatarItemDef = {
    id,
    label,
    tier,
    rarity: extra.rarity ?? RARITY_BY_TIER[tier],
    emoji,
    desc,
  };
  if (extra.tags) def.tags = extra.tags;
  if (extra.mount) def.mount = extra.mount;
  if (extra.petPoses) def.petPoses = extra.petPoses;
  if (extra.animated) def.animated = true;
  return def;
}

/** item novo (v1.1): ganha o selo "Novo" — exceto o 'none' de slots novos, que não é novidade pra ninguém */
function novo(id: string, label: string, tier: AvatarTier, emoji: string, desc: string, extra: ItemExtra = {}): AvatarItemDef {
  const def = item(id, label, tier, emoji, desc, extra);
  if (id !== NONE) def.isNew = true;
  return def;
}

const tags = (...t: AvatarStyleTag[]): AvatarStyleTag[] => t;
const EPIC: AvatarRarity = 'epic';

// ---------------- visual ----------------

export const BODY_ITEMS: AvatarItemDef[] = [
  item('slim', 'Esguio', 'free', '🧍', 'Silhueta leve e alongada.'),
  item('regular', 'Médio', 'free', '🙂', 'Proporções equilibradas, no ponto certo.'),
  item('broad', 'Largo', 'free', '🧱', 'Ombros largos e presença marcante.'),
  novo('plus', 'Plus size', 'free', '🤗', 'Corpo mais cheio, com estilo e conforto.'),
  novo('curvy', 'Curvilíneo', 'free', '⏳', 'Cintura marcada e curvas generosas.'),
  novo('athletic', 'Atlético', 'free', '🏋️', 'Definido de quem vive se mexendo.'),
];

export const FACE_SHAPE_ITEMS: AvatarItemDef[] = [
  novo('oval', 'Oval', 'free', '🥚', 'O formato clássico, equilibrado.'),
  novo('round', 'Redondo', 'free', '🌕', 'Traços suaves e bochechas fofas.'),
  novo('square', 'Quadrado', 'free', '🔲', 'Maxilar marcado e firme.'),
  novo('heart', 'Coração', 'free', '💗', 'Testa mais larga e queixo delicado.'),
  novo('long', 'Alongado', 'free', '📏', 'Rosto comprido e elegante.'),
  novo('diamond', 'Diamante', 'free', '💎', 'Maçãs do rosto em destaque.'),
];

export const EYES_ITEMS: AvatarItemDef[] = [
  novo('almond', 'Amendoados', 'free', '👁️', 'Formato amendoado, versátil e expressivo.'),
  novo('round', 'Redondos', 'free', '👀', 'Olhos grandes e brilhantes.'),
  novo('upturned', 'Levantados', 'free', '✨', 'Cantinho externo pra cima, olhar marcante.'),
  novo('downturned', 'Caídos', 'free', '🥺', 'Cantinho pra baixo, olhar doce.'),
  novo('monolid', 'Monolid', 'free', '🙂', 'Pálpebra lisa, sem dobra aparente.'),
  novo('hooded', 'Pálpebra marcada', 'free', '😌', 'Pálpebra mais encoberta, olhar profundo.'),
];

export const BROWS_ITEMS: AvatarItemDef[] = [
  novo('soft', 'Naturais', 'free', '〰️', 'Do jeitinho que nasceram.'),
  novo('thick', 'Grossas', 'free', '🖌️', 'Presença forte no olhar.'),
  novo('thin', 'Finas', 'free', '✏️', 'Traço delicado e elegante.'),
  novo('arched', 'Arqueadas', 'free', '🌙', 'Arco definido, pura atitude.'),
  novo('straight', 'Retas', 'free', '➖', 'Linha reta, ar sereno.'),
  novo('bushy', 'Cheias', 'free', '🌿', 'Volumosas e cheias de personalidade.'),
];

export const NOSE_ITEMS: AvatarItemDef[] = [
  novo('soft', 'Suave', 'free', '👃', 'Discreto e harmonioso.'),
  novo('button', 'Arrebitado', 'free', '🔘', 'Pontinha pra cima, cheio de charme.'),
  novo('straight', 'Reto', 'free', '📐', 'Linha reta e clássica.'),
  novo('wide', 'Largo', 'free', '🫶', 'Base larga e marcante.'),
  novo('aquiline', 'Aquilino', 'free', '🦅', 'Perfil com uma curvinha elegante.'),
  novo('small', 'Pequeno', 'free', '🤏', 'Pequenino e delicado.'),
];

export const FACE_ITEMS: AvatarItemDef[] = [
  item('smile', 'Sorriso', 'free', '😊', 'Sorriso leve de quem tá de boa.'),
  item('grin', 'Sorrisão', 'free', '😁', 'Sorrisão de orelha a orelha.'),
  item('calm', 'Tranquilo', 'free', '😌', 'Tranquilidade total.'),
  item('wink', 'Piscada', 'free', '😉', 'Uma piscadinha marota.'),
  item('laugh', 'Risada', 'free', '😆', 'Rindo à toa.'),
  item('cool', 'Descolado', 'free', '😎', 'Pose de quem sabe o que quer.'),
  item('blush', 'Tímido', 'free', '☺️', 'Bochechas coradas de timidez.'),
  novo('kiss', 'Beijinho', 'free', '😘', 'Mandando um beijinho no ar.'),
  novo('serene', 'Sereno', 'free', '😇', 'Paz de espírito no olhar.'),
  novo('smirk', 'Sorriso de canto', 'free', '😏', 'Sorriso de canto, meio misterioso.'),
  novo('surprised', 'Surpreso', 'free', '😮', 'Uau! Não esperava por essa.'),
  novo('starry', 'Olhos de estrela', 'premium', '🤩', 'Olhos brilhando de empolgação.'),
  novo('hearts', 'Apaixonado', 'premium', '😍', 'Coraçõezinhos no olhar.'),
];

export const LINES_ITEMS: AvatarItemDef[] = [
  novo(NONE, 'Nenhuma', 'free', '✨', 'Pele lisinha.', { tags: tags('atemporal') }),
  novo('soft', 'Linhas suaves', 'free', '🌿', 'Marquinhas leves de quem sorri muito.', { tags: tags('atemporal') }),
  novo('marked', 'Linhas marcadas', 'free', '🍂', 'Histórias bem vividas contadas no rosto.', { tags: tags('atemporal') }),
];

export const FACE_DETAIL_ITEMS: AvatarItemDef[] = [
  novo(NONE, 'Nenhum', 'free', '🙂', 'Rosto limpinho.'),
  novo('freckles', 'Sardas', 'free', '🌟', 'Pontinhos de charme espalhados.'),
  novo('mole', 'Pinta', 'free', '⚫', 'Uma pintinha que é marca registrada.'),
  novo('vitiligo', 'Vitiligo', 'free', '🤍', 'Manchas únicas que fazem parte de você.'),
  novo('lipstick', 'Batom', 'free', '💄', 'Boca com cor e atitude.'),
  novo('liner', 'Delineado', 'free', '🖋️', 'Traço de gatinho no olhar.'),
  novo('glam', 'Make glam', 'premium', '💋', 'Make completa pra brilhar na festa.', { tags: tags('festa') }),
  novo('glitter', 'Glitter', 'premium', '✨', 'Brilho no rosto, alegria no coração.', { tags: tags('festa') }),
  novo('star_cheek', 'Estrelinha', 'premium', '⭐', 'Uma estrelinha desenhada na bochecha.', { tags: tags('festa', 'fantasia') }),
];

// ---------------- cabelo ----------------

export const HAIR_ITEMS: AvatarItemDef[] = [
  item('bald', 'Careca', 'free', '🧑‍🦲', 'Cabeça lisinha e cheia de estilo.'),
  item('buzz', 'Raspado', 'free', '💈', 'Máquina baixinha, prático e moderno.'),
  item('short', 'Curto', 'free', '💇', 'Curtinho e fácil de cuidar.'),
  item('side', 'Risca lateral', 'free', '📐', 'Risca de lado bem alinhada.', { tags: tags('elegante') }),
  item('quiff', 'Topete', 'free', '🌪️', 'Topete pra cima com volume.'),
  item('curly', 'Cacheado', 'free', '🌀', 'Cachos definidos e cheios de vida.'),
  item('afro', 'Black power', 'free', '✊', 'Volume poderoso e cheio de orgulho.'),
  item('bob', 'Chanel', 'free', '✂️', 'Corte reto na altura do queixo.', { tags: tags('elegante') }),
  item('long', 'Longo liso', 'free', '💁', 'Fios longos e soltos.'),
  item('wavy', 'Ondulado', 'free', '🌊', 'Ondas naturais e despojadas.', { tags: tags('praia') }),
  item('ponytail', 'Rabo de cavalo', 'free', '🎀', 'Preso no alto, pronto pra tudo.', { tags: tags('esporte') }),
  item('bun', 'Coque', 'free', '🍩', 'Coque no alto, prático e charmoso.'),
  item('braids', 'Tranças', 'free', '🪢', 'Tranças longas cheias de estilo.'),
  item('mohawk', 'Moicano', 'premium', '🤘', 'Crista pra cima, atitude punk.', { tags: tags('urbano') }),
  item('dreads', 'Dreads', 'premium', '🌳', 'Dreads longos com muita personalidade.'),
  novo('receding', 'Entradas', 'free', '🌅', 'Entradinhas na testa, com muito charme.', { tags: tags('atemporal') }),
  novo('thinning', 'Topo ralo', 'free', '🍃', 'Fios mais ralos no alto, estilo natural.', { tags: tags('atemporal') }),
  novo('classic', 'Clássico penteado', 'free', '🎩', 'Penteado alinhado de cavalheiro de cinema.', { tags: tags('atemporal', 'elegante') }),
  novo('pixie', 'Pixie', 'free', '🧚', 'Curtinho repicado, leve e ousado.'),
  novo('updo', 'Coque elegante', 'free', '💫', 'Preso com elegância pras ocasiões especiais.', { tags: tags('elegante', 'atemporal') }),
  novo('low_bun', 'Coque baixo', 'free', '🌾', 'Coque baixinho na nuca, sóbrio e lindo.', { tags: tags('atemporal') }),
  novo('curtain', 'Franja cortina', 'free', '🎭', 'Franja aberta no meio, emoldurando o rosto.'),
  novo('twists', 'Twists', 'free', '🌀', 'Mechas torcidas cheias de textura.'),
  novo('cornrows', 'Nagô', 'free', '〽️', 'Tranças rentes desenhando a cabeça.', { tags: tags('urbano') }),
  novo('space_buns', 'Coquinhos', 'free', '🐼', 'Dois coquinhos no alto, pura diversão.', { tags: tags('festa') }),
  novo('undercut', 'Undercut', 'free', '⚡', 'Laterais raspadas e volume em cima.', { tags: tags('urbano') }),
  novo('long_curly', 'Cacheado longo', 'free', '🌺', 'Cachos longos e volumosos.'),
  novo('afro_puff', 'Puff', 'free', '☁️', 'Black preso num puff fofo no alto.'),
  novo('pompadour', 'Pompadour', 'premium', '🕺', 'Topete clássico, polido e com muito brilho.', { tags: tags('elegante') }),
  novo('mullet', 'Mullet', 'premium', '🎸', 'Curto na frente, longo atrás: estilo sem medo.', { tags: tags('urbano') }),
  novo('side_shave', 'Raspado lateral', 'premium', '🔥', 'Um lado raspado e o outro solto.', { tags: tags('urbano') }),
  novo('braid_crown', 'Trança coroa', 'premium', '👑', 'Trança em volta da cabeça feito coroa.', { rarity: EPIC, tags: tags('fantasia', 'festa') }),
];

export const FACIAL_HAIR_ITEMS: AvatarItemDef[] = [
  item(NONE, 'Nenhuma', 'free', '🙂', 'Rosto sem barba.'),
  item('stubble', 'Barba rala', 'free', '🧔', 'Barba por fazer, charme despretensioso.'),
  item('beard', 'Barba cheia', 'free', '🧔', 'Barba cheia e bem cuidada.'),
  item('goatee', 'Cavanhaque', 'free', '🐐', 'Só no queixo, com estilo.'),
  item('mustache', 'Bigode', 'free', '👨', 'O bigode clássico.'),
  novo('chevron', 'Bigode grosso', 'free', '🥸', 'Bigodão grosso, retrô e marcante.'),
  novo('handlebar', 'Bigode guidão', 'premium', '🎩', 'Pontas curvadas pra cima, pura elegância.', { tags: tags('elegante') }),
  novo('van_dyke', 'Van Dyke', 'free', '🎨', 'Bigode e cavanhaque separados, ar de artista.', { tags: tags('elegante') }),
  novo('long_beard', 'Barba longa', 'free', '🧙', 'Barba longa e respeitável.', { tags: tags('atemporal') }),
  novo('boxed', 'Barba aparada', 'free', '✂️', 'Contorno bem desenhado e alinhado.', { tags: tags('elegante') }),
  novo('sideburns', 'Costeletas', 'free', '🕺', 'Costeletas longas, estilo anos 70.'),
];

// ---------------- roupas ----------------

export const TOP_ITEMS: AvatarItemDef[] = [
  item('tee', 'Camiseta', 'free', '👕', 'O básico que combina com tudo.', { tags: tags('casual') }),
  item('tank', 'Regata', 'free', '🎽', 'Fresquinha pros dias de calor.', { tags: tags('casual', 'praia') }),
  item('polo', 'Polo', 'free', '👕', 'Gola e botões, casual arrumado.', { tags: tags('casual') }),
  item('shirt', 'Camisa', 'free', '👔', 'Camisa de botão, sempre bem.', { tags: tags('elegante', 'atemporal') }),
  item('hoodie', 'Moletom', 'free', '🧥', 'Capuz e conforto pra qualquer hora.', { tags: tags('urbano', 'casual') }),
  item('sweater', 'Suéter', 'free', '🧶', 'Quentinho e aconchegante.', { tags: tags('atemporal', 'casual') }),
  item('jacket', 'Jaqueta', 'free', '🧥', 'Uma jaqueta pra qualquer rolê.', { tags: tags('casual') }),
  item('crop', 'Cropped', 'free', '✂️', 'Curtinho e cheio de atitude.', { tags: tags('festa', 'urbano') }),
  item('dress', 'Vestido', 'free', '👗', 'Leve e lindo pra qualquer ocasião.', { tags: tags('casual', 'festa') }),
  item('neon_jacket', 'Jaqueta neon', 'premium', '⚡', 'Brilha no escuro do rolê.', { tags: tags('futurista', 'festa') }),
  item('jersey', 'Camisa 10', 'event', '⚽', 'Camisa de craque pra torcer junto.', { tags: tags('esporte') }),
  novo('striped', 'Listrada', 'free', '⚓', 'Listras clássicas de marinheiro.', { tags: tags('casual', 'praia') }),
  novo('graphic', 'Estampada', 'free', '🎨', 'Estampa divertida no peito.', { tags: tags('casual', 'urbano') }),
  novo('flannel', 'Xadrez', 'free', '🍁', 'Camisa xadrez aconchegante.', { tags: tags('casual') }),
  novo('turtleneck', 'Gola alta', 'free', '🖤', 'Gola alta, sofisticação silenciosa.', { tags: tags('elegante', 'atemporal') }),
  novo('linen', 'Camisa de linho', 'free', '🌾', 'Linho leve pra brisa do fim de tarde.', { tags: tags('atemporal', 'praia') }),
  novo('blouse', 'Blusa', 'free', '👚', 'Blusa leve com caimento fluido.', { tags: tags('elegante', 'atemporal') }),
  novo('tunic', 'Bata', 'free', '🌼', 'Bata soltinha e fresca.', { tags: tags('praia', 'atemporal') }),
  novo('oversized', 'Oversized', 'free', '🛹', 'Larguinha e confortável, do jeito urbano.', { tags: tags('urbano') }),
  novo('basket', 'Regata de basquete', 'free', '🏀', 'Pronta pra enterrar na quadra.', { tags: tags('esporte', 'urbano') }),
  novo('hawaiian', 'Camisa florida', 'free', '🌺', 'Flores e clima de férias.', { tags: tags('praia', 'festa') }),
  novo('pride_tee', 'Camiseta do orgulho', 'free', '🏳️‍🌈', 'As listras da sua bandeira estampadas com orgulho.', { tags: tags('orgulho') }),
  novo('tux', 'Smoking', 'premium', '🤵', 'Black tie impecável pra noite de gala.', { tags: tags('elegante', 'festa') }),
  novo('gown', 'Vestido de gala', 'premium', '👗', 'Longo, fluido e digno de tapete vermelho.', { rarity: EPIC, tags: tags('elegante', 'festa') }),
  novo('satin', 'Camisa de cetim', 'premium', '🌙', 'Cetim com brilho suave.', { tags: tags('festa', 'elegante') }),
  novo('sequin', 'Paetê', 'premium', '🪩', 'Paetês que refletem todas as luzes da pista.', { rarity: EPIC, tags: tags('festa') }),
  novo('cyber', 'Top cyber', 'premium', '🤖', 'Linhas de neon e tecido tecnológico.', { tags: tags('futurista') }),
  novo('armor', 'Armadura', 'premium', '🛡️', 'Armadura brilhante digna de lenda.', { rarity: EPIC, tags: tags('fantasia') }),
  novo('wizard', 'Túnica de mago', 'premium', '🧙', 'Túnica estrelada cheia de magia.', { tags: tags('fantasia') }),
  novo('royal', 'Traje real', 'plus', '👑', 'Bordados dourados de realeza.', { tags: tags('fantasia', 'elegante') }),
  novo('holo', 'Jaqueta holográfica', 'plus', '🌈', 'Muda de cor a cada passo.', { tags: tags('futurista') }),
];

export const OUTER_ITEMS: AvatarItemDef[] = [
  novo(NONE, 'Nada', 'free', '➖', 'Sem nada por cima.'),
  novo('blazer', 'Blazer', 'free', '🧥', 'Corte alinhado pra qualquer compromisso.', { tags: tags('elegante', 'atemporal') }),
  novo('cardigan', 'Cardigã', 'free', '🧶', 'Um abraço de tricô por cima da roupa.', { tags: tags('atemporal', 'casual') }),
  novo('vest', 'Colete', 'free', '🎻', 'Colete ajustado, ar clássico.', { tags: tags('elegante', 'atemporal') }),
  novo('denim', 'Jaqueta jeans', 'free', '👖', 'Jeans por cima, curinga do guarda-roupa.', { tags: tags('casual') }),
  novo('leather', 'Jaqueta de couro', 'free', '🏍️', 'Atitude rock em qualquer look.', { tags: tags('urbano') }),
  novo('bomber', 'Bomber', 'free', '✈️', 'Bomber com punho de ribana.', { tags: tags('urbano') }),
  novo('varsity', 'Jaqueta college', 'free', '🎓', 'Estilo de time universitário.', { tags: tags('esporte', 'casual') }),
  novo('trench', 'Sobretudo', 'premium', '🕵️', 'Sobretudo longo de filme clássico.', { tags: tags('elegante', 'atemporal') }),
  novo('puffer', 'Puffer', 'premium', '☁️', 'Fofinha e quentinha.', { tags: tags('urbano') }),
  novo('kimono', 'Kimono', 'premium', '🌸', 'Kimono leve e estampado.', { tags: tags('festa') }),
  novo('cape', 'Capa de herói', 'premium', '🦸', 'Pronta pra salvar o dia.', { rarity: EPIC, tags: tags('fantasia') }),
  novo('mecha', 'Ombreiras mecha', 'premium', '🤖', 'Ombreiras robóticas de piloto do futuro.', { tags: tags('futurista') }),
  novo('mantle', 'Manto real', 'plus', '👑', 'Manto de veludo com bordas douradas.', { tags: tags('fantasia') }),
];

export const BOTTOM_ITEMS: AvatarItemDef[] = [
  item('jeans', 'Jeans', 'free', '👖', 'O jeans de todo dia.', { tags: tags('casual') }),
  item('pants', 'Calça', 'free', '👖', 'Calça reta, curinga.', { tags: tags('atemporal', 'casual') }),
  item('shorts', 'Shorts', 'free', '🩳', 'Pernas livres pro calor.', { tags: tags('praia', 'casual') }),
  item('skirt', 'Saia', 'free', '💃', 'Saia leve e soltinha.', { tags: tags('casual') }),
  item('joggers', 'Jogger', 'free', '🏃', 'Conforto de moletom com estilo.', { tags: tags('urbano', 'esporte') }),
  item('leggings', 'Legging', 'free', '🧘', 'Pronta pro treino ou pro rolê.', { tags: tags('esporte') }),
  item('cargo', 'Cargo', 'premium', '🎒', 'Bolsos pra tudo, estilo urbano.', { tags: tags('urbano') }),
  novo('tailored', 'Alfaiataria', 'free', '📐', 'Calça de alfaiataria com vinco.', { tags: tags('elegante', 'atemporal') }),
  novo('pleated', 'Saia plissada', 'free', '🪭', 'Pregas que dançam a cada passo.', { tags: tags('atemporal', 'elegante') }),
  novo('midi', 'Saia midi', 'free', '🌷', 'Comprimento midi, elegante e confortável.', { tags: tags('atemporal') }),
  novo('wide', 'Pantalona', 'free', '🌬️', 'Pernas amplas e fluidas.', { tags: tags('elegante', 'festa') }),
  novo('bermuda', 'Bermuda', 'free', '🩳', 'Bermuda na altura do joelho.', { tags: tags('casual', 'praia') }),
  novo('ripped', 'Jeans rasgado', 'free', '🤘', 'Rasgos estratégicos com atitude.', { tags: tags('urbano') }),
  novo('kilt', 'Kilt', 'free', '🏴', 'Kilt xadrez cheio de tradição.', { tags: tags('festa') }),
  novo('metallic', 'Calça metalizada', 'premium', '🪐', 'Brilho metálico de outro planeta.', { tags: tags('futurista', 'festa') }),
  novo('tutu', 'Saia tutu', 'premium', '🩰', 'Camadas de tule pra rodopiar.', { tags: tags('festa', 'fantasia') }),
];

export const SHOES_ITEMS: AvatarItemDef[] = [
  item('sneakers', 'Tênis', 'free', '👟', 'Confortável pra ir a qualquer lugar.', { tags: tags('casual') }),
  item('hightops', 'Cano alto', 'free', '👟', 'Tênis de cano alto, estilo quadra.', { tags: tags('urbano') }),
  item('boots', 'Bota', 'free', '🥾', 'Bota firme pra qualquer terreno.', { tags: tags('casual') }),
  item('sandals', 'Sandália', 'free', '🩴', 'Pés livres e fresquinhos.', { tags: tags('praia') }),
  item('runners', 'Tênis neon', 'premium', '⚡', 'Corrida com brilho neon.', { tags: tags('esporte', 'futurista') }),
  novo('loafers', 'Mocassim', 'free', '👞', 'Confortável e sofisticado.', { tags: tags('elegante', 'atemporal') }),
  novo('oxford', 'Sapato social', 'free', '👞', 'Sapato social bem engraxado.', { tags: tags('elegante') }),
  novo('flats', 'Sapatilha', 'free', '🥿', 'Levinha e confortável.', { tags: tags('atemporal') }),
  novo('heels', 'Salto', 'free', '👠', 'Salto pra arrasar na pista.', { tags: tags('festa', 'elegante') }),
  novo('combat', 'Coturno', 'free', '🥾', 'Coturno robusto, pura atitude.', { tags: tags('urbano') }),
  novo('texan', 'Bota texana', 'free', '🤠', 'Bota bordada pro arraiá ou pro rodeio.', { tags: tags('festa') }),
  novo('slides', 'Chinelo', 'free', '🩴', 'O clássico da praia.', { tags: tags('praia') }),
  novo('platform', 'Plataforma', 'premium', '🎤', 'Sola alta pra ver o show lá de cima.', { tags: tags('festa') }),
  novo('skates', 'Patins', 'premium', '🛼', 'Rodinhas pra deslizar no rolê.', { tags: tags('festa', 'esporte') }),
  novo('glass', 'Sapatinho de cristal', 'premium', '✨', 'Brilha até depois da meia-noite.', { rarity: EPIC, tags: tags('fantasia') }),
  novo('hover', 'Botas antigravidade', 'plus', '🚀', 'Flutuam uns centímetros acima do chão.', { tags: tags('futurista') }),
];

// ---------------- acessórios ----------------

export const HAT_ITEMS: AvatarItemDef[] = [
  item(NONE, 'Sem chapéu', 'free', '🙂', 'Cabeça livre.'),
  item('cap', 'Boné', 'free', '🧢', 'Boné com a aba pra frente.', { tags: tags('casual', 'esporte') }),
  item('cap_back', 'Boné virado', 'free', '🧢', 'Aba pra trás, estilo despojado.', { tags: tags('urbano') }),
  item('beanie', 'Gorro', 'free', '🧶', 'Gorrinho de tricô quentinho.', { tags: tags('casual', 'urbano') }),
  item('bucket', 'Bucket', 'free', '🪣', 'Chapéu bucket, clássico do verão.', { tags: tags('urbano', 'praia') }),
  item('headband', 'Faixa', 'free', '🎽', 'Faixa na testa, pronta pro treino.', { tags: tags('esporte') }),
  item('straw', 'Chapéu de palha', 'premium', '👒', 'Sombra fresca na praia.', { tags: tags('praia') }),
  item('crown', 'Coroa', 'event', '👑', 'Realeza de evento especial.', { tags: tags('fantasia', 'festa') }),
  novo('fedora', 'Fedora', 'free', '🎩', 'Aba curta e charme de cinema.', { tags: tags('elegante', 'atemporal') }),
  novo('flatcap', 'Boina inglesa', 'free', '🧐', 'Boina de tweed, ar de passeio no parque.', { tags: tags('atemporal') }),
  novo('beret', 'Boina francesa', 'free', '🥖', 'Boina inclinada, très chic.', { tags: tags('elegante') }),
  novo('panama', 'Panamá', 'free', '🌴', 'Palha fina com faixa escura.', { tags: tags('atemporal', 'praia') }),
  novo('cowboy', 'Chapéu de vaqueiro', 'free', '🤠', 'Pronto pro rodeio.', { tags: tags('festa') }),
  novo('party', 'Chapéu de festa', 'free', '🥳', 'Cone colorido de aniversário.', { tags: tags('festa') }),
  novo('turban', 'Turbante', 'free', '🧣', 'Tecido enrolado com elegância.', { tags: tags('elegante', 'atemporal') }),
  novo('hijab', 'Hijab', 'free', '🧕', 'Lenço que cobre o cabelo com elegância.', { tags: tags('elegante', 'atemporal') }),
  novo('durag', 'Durag', 'free', '🖤', 'Durag de cetim: estilo e cuidado com o cabelo.', { tags: tags('urbano') }),
  novo('tiara', 'Tiara', 'premium', '💎', 'Tiara delicada com brilho.', { tags: tags('festa', 'elegante') }),
  novo('top_hat', 'Cartola', 'premium', '🎩', 'Cartola de gala ou de mágico.', { tags: tags('elegante', 'festa') }),
  novo('witch', 'Chapéu de bruxa', 'premium', '🧙', 'Ponta alta e muita magia.', { tags: tags('fantasia') }),
  novo('cat_ears', 'Orelhas de gato', 'premium', '🐱', 'Orelhinhas de gato. Miau!', { tags: tags('festa') }),
  novo('horns', 'Chifrinhos', 'premium', '😈', 'Chifrinhos travessos.', { tags: tags('fantasia') }),
  novo('halo', 'Auréola', 'premium', '😇', 'Brilho angelical sobre a cabeça.', { rarity: EPIC, tags: tags('fantasia') }),
  novo('neon_crown', 'Coroa neon', 'plus', '👑', 'Coroa de luz pra quem reina na pista.', { tags: tags('futurista', 'festa') }),
];

export const GLASSES_ITEMS: AvatarItemDef[] = [
  item(NONE, 'Sem óculos', 'free', '🙂', 'Olhar livre.'),
  item('round', 'Redondo', 'free', '👓', 'Armação redonda, ar intelectual.', { tags: tags('atemporal') }),
  item('square', 'Quadrado', 'free', '👓', 'Armação quadrada, clássica.', { tags: tags('casual') }),
  item('sun', 'Escuro', 'free', '🕶️', 'Lentes escuras pro sol.', { tags: tags('praia') }),
  item('aviator', 'Aviador', 'premium', '✈️', 'O clássico dos pilotos.', { tags: tags('urbano') }),
  item('visor', 'Visor neon', 'premium', '🥽', 'Visor futurista de neon.', { tags: tags('futurista') }),
  novo('reading', 'Meia-lua', 'free', '📖', 'Óculos de leitura na pontinha do nariz.', { tags: tags('atemporal') }),
  novo('cat_eye', 'Gatinho', 'free', '🐈', 'Pontinhas pra cima, charme retrô.', { tags: tags('elegante') }),
  novo('rimless', 'Sem aro', 'free', '🔍', 'Leve, quase invisível.', { tags: tags('atemporal', 'elegante') }),
  novo('big', 'Grandões', 'free', '🤓', 'Armação gigante e divertida.', { tags: tags('festa') }),
  novo('round_gold', 'Redondo dourado', 'premium', '🌟', 'Aro fino dourado, puro requinte.', { tags: tags('elegante') }),
  novo('heart', 'Coração', 'premium', '💖', 'Lentes de coração pra ver tudo com amor.', { tags: tags('festa') }),
  novo('star', 'Estrela', 'premium', '⭐', 'Lentes de estrela, brilho de pop star.', { tags: tags('festa') }),
  novo('monocle', 'Monóculo', 'premium', '🧐', 'Monóculo com correntinha, muito distinto.', { tags: tags('elegante', 'fantasia') }),
  novo('cyber', 'Óculos cyber', 'premium', '🤖', 'Lente única com HUD de neon.', { rarity: EPIC, tags: tags('futurista') }),
];

/** Acessórios de cabeça e orelha. necklace, chain e scarf saíram daqui e foram pro `neck` (o normalize migra). */
export const ACCESSORY_ITEMS: AvatarItemDef[] = [
  item(NONE, 'Nenhum', 'free', '🙂', 'Sem enfeite.'),
  item('earrings', 'Brincos', 'free', '💎', 'Brilhinho nas orelhas.', { tags: tags('casual') }),
  item('headphones', 'Fone', 'free', '🎧', 'Trilha sonora sempre ligada.', { tags: tags('urbano') }),
  item('flower', 'Flor no cabelo', 'free', '🌺', 'Uma flor atrás da orelha.', { tags: tags('praia', 'festa') }),
  novo('hearing_aid', 'Aparelho auditivo', 'free', '🦻', 'Aparelho auditivo discreto atrás da orelha.'),
  novo('hoops', 'Argolas', 'free', '⭕', 'Argolas douradas de presença.', { tags: tags('urbano', 'festa') }),
  novo('pearl_earrings', 'Brincos de pérola', 'free', '🦪', 'Pérolas clássicas, elegância atemporal.', { tags: tags('elegante', 'atemporal') }),
  novo('nose_ring', 'Piercing', 'free', '💍', 'Piercing delicado no nariz.', { tags: tags('urbano') }),
  novo('ear_cuff', 'Ear cuff', 'free', '✨', 'Brilho subindo pela orelha.', { tags: tags('urbano') }),
  novo('headset', 'Headset neon', 'premium', '🎮', 'Headset com luz neon, modo gamer.', { tags: tags('futurista') }),
  novo('butterflies', 'Borboletas', 'premium', '🦋', 'Borboletinhas pousadas no cabelo.', { tags: tags('fantasia') }),
  novo('flower_crown', 'Coroa de flores', 'premium', '🌸', 'Coroa de flores de festival.', { tags: tags('festa', 'fantasia') }),
];

/** Ids de pescoço que já viveram no slot `accessory` (config antiga). */
export const LEGACY_NECK_ACCESSORIES: readonly string[] = ['necklace', 'chain', 'scarf'];

export const NECK_ITEMS: AvatarItemDef[] = [
  novo(NONE, 'Nada', 'free', '➖', 'Pescoço livre.'),
  item('necklace', 'Colar', 'free', '📿', 'Um colar delicado.', { tags: tags('casual') }),
  item('chain', 'Corrente dourada', 'premium', '⛓️', 'Corrente dourada de respeito.', { tags: tags('urbano') }),
  item('scarf', 'Cachecol', 'free', '🧣', 'Cachecol quentinho.', { tags: tags('casual', 'atemporal') }),
  novo('pearls', 'Colar de pérolas', 'free', '🦪', 'Pérolas que nunca saem de moda.', { tags: tags('elegante', 'atemporal') }),
  novo('tie', 'Gravata', 'free', '👔', 'Nó perfeito pra ocasião certa.', { tags: tags('elegante') }),
  novo('bowtie', 'Gravata-borboleta', 'free', '🎀', 'Gravata-borboleta charmosa.', { tags: tags('elegante', 'festa') }),
  novo('silk', 'Lenço de seda', 'free', '🧣', 'Lenço de seda amarrado com charme.', { tags: tags('elegante', 'atemporal') }),
  novo('bandana', 'Bandana', 'free', '🤠', 'Bandana no pescoço, estilo de rua.', { tags: tags('urbano') }),
  novo('lei', 'Colar havaiano', 'free', '🌺', 'Aloha! Flores no pescoço.', { tags: tags('praia', 'festa') }),
  novo('choker', 'Choker', 'free', '🖤', 'Choker justinho no pescoço.', { tags: tags('urbano') }),
  novo('medal', 'Medalha de ouro', 'premium', '🥇', 'Lugar mais alto do pódio.', { tags: tags('esporte') }),
  novo('amulet', 'Amuleto mágico', 'premium', '🔮', 'Amuleto que brilha com magia antiga.', { rarity: EPIC, tags: tags('fantasia') }),
];

export const BAG_ITEMS: AvatarItemDef[] = [
  item(NONE, 'Sem bolsa', 'free', '🙂', 'Costas livres.'),
  item('backpack', 'Mochila', 'free', '🎒', 'Mochila pronta pra aventura.', { tags: tags('casual') }),
  item('crossbody', 'Transversal', 'free', '👜', 'Bolsa transversal, mãos livres.', { tags: tags('casual', 'urbano') }),
  novo('tote', 'Ecobag', 'free', '🛍️', 'Ecobag pra feira ou pra vida.', { tags: tags('casual') }),
  novo('clutch', 'Clutch', 'free', '👛', 'Pequenina e elegante pra noite.', { tags: tags('elegante', 'festa') }),
  novo('fanny', 'Pochete', 'free', '👝', 'Pochete cruzada no peito.', { tags: tags('urbano') }),
  novo('guitar_back', 'Violão nas costas', 'free', '🎸', 'Sempre pronto pra uma roda de violão.', { tags: tags('casual') }),
  novo('wings_angel', 'Asas de anjo', 'premium', '👼', 'Asas brancas e fofinhas.', { rarity: EPIC, tags: tags('fantasia') }),
  novo('wings_butterfly', 'Asas de borboleta', 'premium', '🦋', 'Asas coloridas e translúcidas.', { rarity: EPIC, tags: tags('fantasia', 'festa') }),
  novo('wings_dragon', 'Asas de dragão', 'premium', '🐉', 'Asas de dragão, poder ancestral.', { rarity: EPIC, tags: tags('fantasia') }),
  novo('jetpack', 'Jetpack', 'premium', '🚀', 'Propulsores prontos pra decolar.', { tags: tags('futurista') }),
  novo('wings_neon', 'Asas neon', 'plus', '✨', 'Asas feitas de pura luz.', { tags: tags('futurista') }),
];

export const WRIST_ITEMS: AvatarItemDef[] = [
  item(NONE, 'Nada', 'free', '🙂', 'Pulsos livres.'),
  item('watch', 'Relógio', 'free', '⌚', 'Pontualidade com estilo.', { tags: tags('atemporal') }),
  item('bracelet', 'Pulseira', 'free', '📿', 'Pulseira delicada no braço.', { tags: tags('casual') }),
  item('smartwatch', 'Smartwatch', 'premium', '⌚', 'Tecnologia no pulso.', { tags: tags('futurista', 'esporte') }),
  novo('bangles', 'Pulseiras', 'free', '💫', 'Várias pulseirinhas que tilintam.', { tags: tags('festa') }),
  novo('beads', 'Miçangas', 'free', '📿', 'Miçangas coloridas feitas à mão.', { tags: tags('praia') }),
  novo('scrunchie', 'Xuxinha', 'free', '🎀', 'Xuxinha no pulso, sempre à mão.', { tags: tags('casual') }),
  novo('fitness', 'Pulseira fitness', 'free', '🏃', 'Conta cada passo do seu dia.', { tags: tags('esporte') }),
  novo('luxury', 'Relógio de luxo', 'premium', '💎', 'Relógio dourado de colecionador.', { tags: tags('elegante') }),
  novo('cuff', 'Bracelete dourado', 'premium', '🌟', 'Bracelete dourado e marcante.', { tags: tags('festa', 'elegante') }),
];

// ---------------- orgulho ----------------

const RAINBOW = ['#E40303', '#FF8C00', '#FFED00', '#008026', '#004DFF', '#750787'];
const st = (...hex: string[]): { hex: string }[] => hex.map((h) => ({ hex: h }));

/** Bandeiras com as listras oficiais (de cima pra baixo). */
export const PRIDE_FLAGS: AvatarFlagDef[] = [
  { id: 'rainbow', label: 'Arco-íris', stripes: st(...RAINBOW) },
  { id: 'progress', label: 'Progress Pride', stripes: st(...RAINBOW), overlay: 'progress' },
  {
    id: 'trans',
    label: 'Trans',
    stripes: st('#5BCEFA', '#F5A9B8', '#FFFFFF', '#F5A9B8', '#5BCEFA'),
  },
  {
    id: 'bi',
    label: 'Bissexual',
    stripes: [
      { hex: '#D60270', w: 2 },
      { hex: '#9B4F96', w: 1 },
      { hex: '#0038A8', w: 2 },
    ],
  },
  { id: 'pan', label: 'Pansexual', stripes: st('#FF218C', '#FFD800', '#21B1FF') },
  {
    id: 'lesbian',
    label: 'Lésbica',
    stripes: st('#D52D00', '#EF7627', '#FF9A56', '#FFFFFF', '#D162A4', '#B55690', '#A30262'),
  },
  {
    id: 'gay',
    label: 'Gay',
    stripes: st('#078D70', '#26CEAA', '#98E8C1', '#FFFFFF', '#7BADE2', '#5049CC', '#3D1A78'),
  },
  {
    id: 'nonbinary',
    label: 'Não binária',
    stripes: st('#FCF434', '#FFFFFF', '#9C59D1', '#2C2C2C'),
  },
  { id: 'ace', label: 'Assexual', stripes: st('#000000', '#A3A3A3', '#FFFFFF', '#800080') },
  {
    id: 'demi',
    label: 'Demissexual',
    stripes: [
      { hex: '#FFFFFF', w: 3 },
      { hex: '#6E0070', w: 1 },
      { hex: '#D2D2D2', w: 3 },
    ],
    overlay: 'demi',
  },
  {
    id: 'aro',
    label: 'Arromântica',
    stripes: st('#3DA542', '#A7D379', '#FFFFFF', '#A9A9A9', '#000000'),
  },
  { id: 'intersex', label: 'Intersexo', stripes: st('#FFD800'), overlay: 'intersex' },
  {
    id: 'genderfluid',
    label: 'Gênero fluido',
    stripes: st('#FF76A4', '#FFFFFF', '#C011D7', '#000000', '#2F3CBE'),
  },
  {
    id: 'agender',
    label: 'Agênero',
    stripes: st('#000000', '#BCC4C7', '#FFFFFF', '#B7F684', '#FFFFFF', '#BCC4C7', '#000000'),
  },
  { id: 'genderqueer', label: 'Genderqueer', stripes: st('#B57EDC', '#FFFFFF', '#4A8123') },
  {
    id: 'ally',
    label: 'Aliada',
    stripes: st('#000000', '#FFFFFF', '#000000', '#FFFFFF', '#000000', '#FFFFFF'),
    overlay: 'ally',
  },
];

const FLAG_HINTS: Record<string, [emoji: string, desc: string]> = {
  rainbow: ['🏳️‍🌈', 'A bandeira arco-íris de toda a comunidade.'],
  progress: ['🏳️‍🌈', 'Arco-íris com o chevron que abraça pessoas trans e pessoas negras.'],
  trans: ['🏳️‍⚧️', 'Azul, rosa e branco das pessoas trans.'],
  bi: ['💜', 'Rosa, roxo e azul da bissexualidade.'],
  pan: ['💛', 'Rosa, amarelo e azul da pansexualidade.'],
  lesbian: ['🧡', 'Tons de laranja e rosa da bandeira lésbica.'],
  gay: ['💚', 'Tons de verde e azul da bandeira gay.'],
  nonbinary: ['💛', 'Amarelo, branco, roxo e preto das pessoas não binárias.'],
  ace: ['🖤', 'Preto, cinza, branco e roxo da assexualidade.'],
  demi: ['🤍', 'Branco, roxo e cinza com o chevron preto da demissexualidade.'],
  aro: ['💚', 'Verdes, branco, cinza e preto da arromanticidade.'],
  intersex: ['💛', 'Amarelo com o anel roxo das pessoas intersexo.'],
  genderfluid: ['💗', 'Rosa, branco, roxo, preto e azul da fluidez de gênero.'],
  agender: ['🤍', 'Preto, cinza, branco e verde das pessoas agênero.'],
  genderqueer: ['💜', 'Lavanda, branco e verde das pessoas genderqueer.'],
  ally: ['🤝', 'Preto e branco com o arco-íris de quem apoia.'],
};

export const PRIDE_FLAG_ITEMS: AvatarItemDef[] = PRIDE_FLAGS.map((f) => {
  const [emoji, desc] = FLAG_HINTS[f.id] ?? ['🏳️', 'Bandeira de orgulho.'];
  return novo(f.id, f.label, 'free', emoji, desc, { tags: tags('orgulho') });
});

export const PRIDE_ITEMS: AvatarItemDef[] = [
  novo(NONE, 'Nenhum', 'free', '🙂', 'Sem item de orgulho.'),
  novo('pin', 'Pin da bandeira', 'free', '📍', 'Um pin no peito com as cores da sua bandeira.', { tags: tags('orgulho') }),
  novo('heart_pin', 'Coração da bandeira', 'free', '💖', 'Coraçãozinho com as cores que te representam.', { tags: tags('orgulho') }),
  novo('band', 'Pulseira da bandeira', 'free', '🌈', 'Pulseira no pulso direito com as cores da bandeira.', { tags: tags('orgulho') }),
  novo('face_paint', 'Pintura no rosto', 'free', '🎨', 'Listrinhas da bandeira pintadas na bochecha.', { tags: tags('orgulho') }),
  novo('sash', 'Faixa', 'free', '🎗️', 'Faixa atravessada no peito, pronta pra parada.', { tags: tags('orgulho') }),
  novo('cape', 'Capa da bandeira', 'free', '🦸', 'A bandeira inteira nas costas, voando.', { tags: tags('orgulho') }),
  novo('flag', 'Bandeirinha', 'free', '🏳️‍🌈', 'Bandeirinha na mão esquerda.', { tags: tags('orgulho') }),
];

export const PRONOUN_ITEMS: AvatarItemDef[] = [
  novo(NONE, 'Não mostrar', 'free', '🙂', 'Sem plaquinha de pronomes.'),
  novo('ela', 'ela/dela', 'free', '🏷️', 'Aparece como ela/dela na plaquinha.'),
  novo('ele', 'ele/dele', 'free', '🏷️', 'Aparece como ele/dele na plaquinha.'),
  novo('elu', 'elu/delu', 'free', '🏷️', 'Aparece como elu/delu na plaquinha.'),
  novo('ela_elu', 'ela/elu', 'free', '🏷️', 'Aparece como ela/elu na plaquinha.'),
  novo('ele_elu', 'ele/elu', 'free', '🏷️', 'Aparece como ele/elu na plaquinha.'),
  novo('ela_ele', 'ela/ele', 'free', '🏷️', 'Aparece como ela/ele na plaquinha.'),
  novo('any', 'qualquer pronome', 'free', '🏷️', 'Mostra que qualquer pronome tá valendo.'),
];

// ---------------- efeitos ----------------

const ANIM = { animated: true } as const;

export const AURA_ITEMS: AvatarItemDef[] = [
  item(NONE, 'Sem efeito', 'free', '🙂', 'Sem efeito em volta.'),
  item('lime', 'Aura lima', 'premium', '💚', 'O brilho verde-lima da Metch.'),
  item('magenta', 'Aura magenta', 'premium', '💗', 'Brilho magenta vibrante.'),
  item('gold', 'Aura dourada', 'premium', '💛', 'Brilho dourado de estrela.'),
  item('fest', 'Aura Metch Fest', 'event', '🎉', 'Exclusiva do Metch Fest.', { tags: tags('festa') }),
  novo('sparkle', 'Brilhinho', 'free', '✨', 'Faíscas suaves em volta de você.', ANIM),
  novo('pride', 'Aura do orgulho', 'free', '🏳️‍🌈', 'Um halo com as cores da sua bandeira.', { ...ANIM, tags: tags('orgulho') }),
  novo('galaxy', 'Aura galáctica', 'premium', '🌌', 'Um pedacinho do universo girando em volta.', { ...ANIM, rarity: EPIC }),
  novo('flames', 'Chamas', 'premium', '🔥', 'Fogo no rolê, literalmente.', ANIM),
  novo('electric', 'Energia elétrica', 'premium', '⚡', 'Raios de energia pura.', ANIM),
  novo('crystals', 'Cristais flutuantes', 'premium', '💎', 'Cristais orbitando com brilho.', { ...ANIM, rarity: EPIC }),
  novo('mist', 'Névoa mágica', 'premium', '🌫️', 'Névoa misteriosa aos seus pés.', ANIM),
  novo('stardust', 'Poeira de estrelas', 'premium', '⭐', 'Poeira cintilante caindo devagar.', ANIM),
  novo('petals', 'Pétalas', 'premium', '🌸', 'Pétalas dançando no vento.', ANIM),
  novo('hologram', 'Holograma', 'premium', '🔷', 'Brilho holográfico com linhas de scan.', { ...ANIM, rarity: EPIC, tags: tags('futurista') }),
  novo('golden', 'Aura dourada real', 'premium', '👑', 'Raios dourados de realeza.', { ...ANIM, rarity: EPIC, tags: tags('elegante') }),
  novo('rainbow', 'Arco-íris', 'premium', '🌈', 'Um arco-íris girando em volta.', ANIM),
  novo('hearts', 'Corações', 'premium', '💕', 'Coraçõezinhos subindo sem parar.', { ...ANIM, tags: tags('festa') }),
  novo('bubbles', 'Bolhas de sabão', 'premium', '🫧', 'Bolhas flutuando e estourando.', ANIM),
  novo('snow', 'Neve', 'premium', '❄️', 'Flocos de neve caindo de levinho.', ANIM),
  novo('fireflies', 'Vaga-lumes', 'premium', '🌟', 'Vaga-lumes piscando no escuro.', ANIM),
  novo('music', 'Notas musicais', 'premium', '🎶', 'Notas musicais dançando no ar.', { ...ANIM, tags: tags('festa') }),
  novo('supernova', 'Supernova', 'plus', '💥', 'Explosão estelar de energia.', ANIM),
];

export const AURA_LEVEL_ITEMS: AvatarItemDef[] = [
  novo('soft', 'Suave', 'free', '🌙', 'Discreta e elegante.'),
  novo('medium', 'Média', 'free', '✨', 'Na medida certa.'),
  novo('max', 'Intensa', 'free', '💥', 'Brilho no talo!'),
];

export const BACKDROP_ITEMS: AvatarItemDef[] = [
  novo(NONE, 'Sem fundo', 'free', '⬛', 'Fundo limpo.'),
  novo('sunset', 'Pôr do sol', 'free', '🌅', 'Céu alaranjado de fim de tarde.'),
  novo('beach', 'Praia', 'free', '🏖️', 'Areia, mar e sol.', { tags: tags('praia') }),
  novo('hearts', 'Corações', 'free', '💕', 'Coraçõezinhos por todo lado.'),
  novo('garden', 'Jardim', 'free', '🌿', 'Verde, flores e paz.', { tags: tags('atemporal') }),
  novo('studio', 'Estúdio', 'free', '📸', 'Luz de estúdio pra foto perfeita.', { tags: tags('elegante') }),
  novo('pride', 'Bandeira', 'free', '🏳️‍🌈', 'As listras da sua bandeira ao fundo.', { tags: tags('orgulho') }),
  novo('night_city', 'Cidade à noite', 'premium', '🌃', 'Luzes da cidade que não dorme.', { tags: tags('urbano') }),
  novo('neon_grid', 'Grade neon', 'premium', '🟪', 'Grade retrô-futurista em neon.', { tags: tags('futurista') }),
  novo('galaxy', 'Galáxia', 'premium', '🌌', 'Estrelas e nebulosas.'),
  novo('aurora', 'Aurora boreal', 'premium', '🌠', 'Cortinas de luz dançando no céu.', { rarity: EPIC }),
  novo('confetti', 'Confete', 'premium', '🎊', 'Chuva de confete colorido.', { tags: tags('festa') }),
  novo('gold_luxe', 'Dourado luxo', 'premium', '✨', 'Fundo dourado digno de capa.', { tags: tags('elegante') }),
  novo('carnival', 'Carnaval', 'premium', '🎭', 'Serpentina, brilho e samba.', { tags: tags('festa') }),
  novo('stage', 'Palco', 'plus', '🎤', 'Holofotes e um palco só seu.', { tags: tags('festa') }),
];

// ---------------- animações ----------------

export const EMOTE_ITEMS: AvatarItemDef[] = [
  novo(NONE, 'Nenhuma', 'free', '🙂', 'Sem animação.'),
  novo('wave', 'Acenar', 'free', '👋', 'Um tchauzinho simpático.', ANIM),
  novo('greet', 'Cumprimentar', 'free', '🤝', 'Um cumprimento caloroso.', ANIM),
  novo('clap', 'Aplaudir', 'free', '👏', 'Palmas pra quem merece.', ANIM),
  novo('kiss', 'Mandar beijo', 'premium', '😘', 'Um beijo soprado com carinho.', ANIM),
  novo('heart', 'Coração com as mãos', 'premium', '🫶', 'Coração feito com as mãos.', ANIM),
  novo('victory', 'Pose de vitória', 'premium', '✌️', 'Braços pro alto: vitória!', ANIM),
  novo('bow', 'Reverência', 'premium', '🙇', 'Uma reverência elegante.', ANIM),
  novo('shy', 'Timidez', 'premium', '☺️', 'Aquela timidez fofa.', ANIM),
  novo('laugh', 'Gargalhada', 'premium', '😂', 'Rir até a barriga doer.', ANIM),
  novo('jump', 'Pulo de alegria', 'premium', '🤸', 'Pulinho de felicidade.', ANIM),
  novo('spin', 'Giro', 'premium', '💫', 'Um giro com estilo.', ANIM),
  novo('flex', 'Muque', 'premium', '💪', 'Mostrando o muque.', ANIM),
  novo('dance_samba', 'Samba no pé', 'premium', '💃', 'Gingado brasileiro de respeito.', { ...ANIM, rarity: EPIC }),
  novo('dance_passinho', 'Passinho', 'premium', '🕺', 'O passinho do baile.', { ...ANIM, rarity: EPIC }),
  novo('dance_hiphop', 'Hip-hop', 'premium', '🎧', 'Groove de hip-hop.', ANIM),
  novo('dance_disco', 'Disco', 'premium', '🪩', 'Febre de sábado à noite.', ANIM),
  novo('dance_robot', 'Robô', 'premium', '🤖', 'Movimentos robóticos precisos.', ANIM),
  novo('dance_kpop', 'K-pop', 'premium', '🎤', 'Coreografia de idol.', { ...ANIM, rarity: EPIC }),
  novo('dance_vogue', 'Vogue', 'premium', '💅', 'Poses de vogue direto dos ballrooms.', { ...ANIM, rarity: EPIC }),
  novo('dance_shuffle', 'Shuffle', 'premium', '👟', 'Pés rápidos no shuffle.', ANIM),
  novo('guitar', 'Tocar violão', 'premium', '🎸', 'Um som no violão.', ANIM),
  novo('mic', 'Soltar a voz', 'premium', '🎤', 'Soltando a voz no microfone.', ANIM),
  novo('pandeiro', 'Pandeiro', 'premium', '🥁', 'Batucada no pandeiro.', ANIM),
  novo('pose_hero', 'Pose de herói', 'premium', '🦸', 'Mãos na cintura, olhar no horizonte.', ANIM),
  novo('pose_model', 'Pose de capa de revista', 'premium', '📸', 'Clique! Pose digna de capa.', ANIM),
  novo('magic', 'Truque de mágica', 'premium', '🪄', 'Abracadabra com faíscas.', { ...ANIM, rarity: EPIC }),
  novo('pet_love', 'Carinho no pet', 'premium', '🐾', 'Um carinho no seu bichinho.', ANIM),
  novo('starfall', 'Chuva de estrelas', 'plus', '🌠', 'Estrelas caindo à sua volta.', ANIM),
  novo('fireworks', 'Fogos de artifício', 'plus', '🎆', 'Fogos pra celebrar em grande estilo.', ANIM),
];

// ---------------- pets ----------------

const P = (...p: AvatarPetPose[]): AvatarPetPose[] => p;

export const PET_ITEMS: AvatarItemDef[] = [
  novo(NONE, 'Sem pet', 'free', '🙂', 'Só você, por enquanto.'),
  novo('dog_caramel', 'Vira-lata caramelo', 'free', '🐕', 'O caramelo, patrimônio nacional.', { petPoses: P('side', 'arms') }),
  novo('dog_black', 'Cachorro pretinho', 'free', '🐶', 'Pretinho fiel e brincalhão.', { petPoses: P('side', 'arms') }),
  novo('pug', 'Pug', 'free', '🐶', 'Carinha amassada e muito amor.', { petPoses: P('arms', 'side') }),
  novo('dachshund', 'Salsicha', 'free', '🌭', 'Pernas curtinhas e coração enorme.', { petPoses: P('side', 'arms') }),
  novo('cat_orange', 'Gato laranja', 'free', '🐈', 'Laranjinha preguiçoso e carinhoso.', { petPoses: P('arms', 'side', 'shoulder') }),
  novo('cat_black', 'Gato preto', 'free', '🐈‍⬛', 'Gato preto que só traz sorte.', { petPoses: P('arms', 'side', 'shoulder') }),
  novo('cat_tuxedo', 'Gato frajola', 'free', '🐱', 'Frajola sempre de terno.', { petPoses: P('arms', 'side', 'shoulder') }),
  novo('bunny', 'Coelho', 'free', '🐰', 'Orelhudo e fofinho.', { petPoses: P('arms', 'side') }),
  novo('hamster', 'Hamster', 'free', '🐹', 'Bochechas cheias de sementinhas.', { petPoses: P('shoulder', 'arms') }),
  novo('turtle', 'Jabuti', 'free', '🐢', 'Devagar e sempre.', { petPoses: P('side', 'arms') }),
  novo('poodle', 'Poodle', 'premium', '🐩', 'Topete de salão.', { petPoses: P('side', 'arms') }),
  novo('husky', 'Husky', 'premium', '🐺', 'Olhos azuis e uivos dramáticos.', { petPoses: P('side') }),
  novo('cat_siamese', 'Siamês', 'premium', '🐈', 'Siamês elegante de olhos azuis.', { petPoses: P('arms', 'side', 'shoulder') }),
  novo('arara', 'Arara-azul', 'premium', '🦜', 'Arara-azul, joia do Brasil.', { petPoses: P('shoulder', 'float') }),
  novo('parrot', 'Papagaio', 'premium', '🦜', 'Papagaio tagarela.', { petPoses: P('shoulder', 'float') }),
  novo('capybara', 'Capivara', 'premium', '🦫', 'A capivara, mestre da calma.', { rarity: EPIC, petPoses: P('side') }),
  novo('sloth', 'Bicho-preguiça', 'premium', '🦥', 'Abraço lento e eterno.', { petPoses: P('arms') }),
  novo('axolotl', 'Axolote', 'premium', '🦎', 'Axolote sorridente de outro mundo.', { petPoses: P('arms', 'float') }),
  novo('dragon', 'Mini dragão', 'premium', '🐉', 'Mini dragão que solta faisquinhas.', {
    rarity: EPIC,
    tags: tags('fantasia'),
    petPoses: P('float', 'shoulder'),
  }),
  novo('unicorn', 'Unicórnio', 'premium', '🦄', 'Unicórnio de crina arco-íris.', {
    rarity: EPIC,
    tags: tags('fantasia'),
    petPoses: P('side', 'arms'),
  }),
  novo('fox_spirit', 'Raposa espiritual', 'premium', '🦊', 'Raposa mística de cauda brilhante.', {
    rarity: EPIC,
    tags: tags('fantasia'),
    petPoses: P('side', 'float'),
  }),
  novo('robot_dog', 'Robô-cão', 'premium', '🤖', 'Robô-cão leal e conectado.', { tags: tags('futurista'), petPoses: P('side') }),
  novo('ghost', 'Fantasminha', 'premium', '👻', 'Fantasminha camarada, nada assustador.', {
    tags: tags('fantasia'),
    petPoses: P('float', 'shoulder'),
  }),
  novo('phoenix', 'Fênix', 'plus', '🔥', 'Fênix de fogo que renasce em brilho.', { tags: tags('fantasia'), petPoses: P('float', 'shoulder') }),
];

export const PET_POSE_ITEMS: AvatarItemDef[] = [
  novo('side', 'Ao lado', 'free', '🐾', 'Do seu lado, no chão.'),
  novo('arms', 'No colo', 'free', '🤗', 'Aconchegado nos seus braços.'),
  novo('shoulder', 'No ombro', 'free', '🦜', 'Empoleirado no seu ombro.'),
  novo('float', 'Flutuando', 'free', '☁️', 'Flutuando pertinho de você.'),
];

// ---------------- veículos ----------------

export const VEHICLE_ITEMS: AvatarItemDef[] = [
  novo(NONE, 'Sem veículo', 'free', '🚶', 'A pé mesmo.'),
  novo('bike', 'Bicicleta', 'free', '🚲', 'Pedalando pela cidade.', { mount: 'straddle', tags: tags('esporte') }),
  novo('kick', 'Patinete elétrico', 'free', '🛴', 'Deslizando no patinete elétrico.', { mount: 'stand', tags: tags('urbano') }),
  novo('skate', 'Skate', 'free', '🛹', 'Manobras no skate.', { mount: 'stand', tags: tags('urbano') }),
  novo('wheelchair', 'Cadeira de rodas', 'free', '🦽', 'Sua cadeira, seu estilo.', { mount: 'seat' }),
  novo('wheelchair_sport', 'Cadeira esportiva', 'free', '🦽', 'Rodas inclinadas pra jogar e correr.', { mount: 'seat', tags: tags('esporte') }),
  novo('moto', 'Moto', 'premium', '🏍️', 'O ronco do motor na avenida.', { mount: 'straddle', tags: tags('urbano') }),
  novo('lambreta', 'Lambreta', 'premium', '🛵', 'Charme retrô sobre duas rodas.', { mount: 'straddle', tags: tags('atemporal') }),
  novo('car', 'Conversível', 'premium', '🚗', 'Capota aberta e vento no cabelo.', { mount: 'cover' }),
  novo('classic', 'Carro retrô', 'premium', '🚙', 'Clássico das antigas, impecável.', { mount: 'cover', tags: tags('atemporal') }),
  novo('jeep', 'Jipe', 'premium', '🚙', 'Pronto pra trilha e pra praia.', { mount: 'cover', tags: tags('praia') }),
  novo('hoverboard', 'Hoverboard', 'premium', '🛹', 'Prancha que flutua.', { mount: 'stand', tags: tags('futurista') }),
  novo('carpet', 'Tapete voador', 'premium', '🧞', 'Voando sobre a cidade num tapete mágico.', {
    mount: 'hover',
    rarity: EPIC,
    tags: tags('fantasia'),
  }),
  novo('cloud', 'Nuvem fofinha', 'premium', '☁️', 'Passeando nas nuvens.', { mount: 'hover', tags: tags('fantasia') }),
  novo('sport', 'Esportivo neon', 'plus', '🏎️', 'Velocidade com rastro de neon.', { mount: 'cover', tags: tags('futurista') }),
  novo('ufo', 'Disco voador', 'plus', '🛸', 'Chegando de outra galáxia.', { mount: 'hover', tags: tags('futurista') }),
];

// ---------------- na mão ----------------

export const HELD_ITEMS: AvatarItemDef[] = [
  novo(NONE, 'Nada', 'free', '✋', 'Mãos livres.'),
  novo('rose', 'Rosa vermelha', 'free', '🌹', 'Uma rosa pra alguém especial.'),
  novo('bouquet', 'Buquê', 'free', '💐', 'Buquê colorido de flores.', { tags: tags('festa') }),
  novo('sunflower', 'Girassol', 'free', '🌻', 'Girassol que sempre olha pro sol.'),
  novo('coffee', 'Cafezinho', 'free', '☕', 'O cafezinho sagrado.', { tags: tags('atemporal') }),
  novo('coconut', 'Água de coco', 'free', '🥥', 'Geladinha, direto do coco.', { tags: tags('praia') }),
  novo('milkshake', 'Milk-shake', 'free', '🥤', 'Milk-shake com canudinho.'),
  novo('boba', 'Bubble tea', 'free', '🧋', 'Chá com bolinhas de tapioca.'),
  novo('ice_cream', 'Sorvete', 'free', '🍦', 'Casquinha antes que derreta.', { tags: tags('praia') }),
  novo('popcorn', 'Pipoca', 'free', '🍿', 'Pipoca pro cineminha.'),
  novo('gift', 'Presente', 'free', '🎁', 'Um presente com laço.', { tags: tags('festa') }),
  novo('book', 'Livro', 'free', '📖', 'Sempre com uma boa leitura.', { tags: tags('atemporal') }),
  novo('camera', 'Câmera', 'free', '📷', 'Pronta pra registrar o momento.'),
  novo('mic', 'Microfone', 'free', '🎤', 'Microfone na mão, karaokê garantido.', { tags: tags('festa') }),
  novo('tambourine', 'Pandeiro', 'free', '🥁', 'Pandeiro pra puxar o samba.', { tags: tags('festa') }),
  novo('fan', 'Leque', 'free', '🪭', 'Leque pra refrescar com estilo.', { tags: tags('festa', 'elegante') }),
  novo('heart_sign', 'Plaquinha de coração', 'free', '💟', 'Plaquinha de coração pra espalhar carinho.'),
  novo('balloon', 'Balão de coração', 'premium', '🎈', 'Balão de coração flutuando.', { tags: tags('festa') }),
  novo('guitar', 'Violão', 'premium', '🎸', 'Violão pra uma serenata.'),
  novo('trophy', 'Troféu', 'premium', '🏆', 'O troféu de campeão.', { tags: tags('esporte') }),
  novo('sparkler', 'Estrelinha', 'premium', '🎇', 'Estrelinha faiscando.', { tags: tags('festa') }),
  novo('potion', 'Poção brilhante', 'premium', '🧪', 'Poção misteriosa que brilha.', { tags: tags('fantasia') }),
  novo('wand', 'Varinha mágica', 'premium', '🪄', 'Varinha com faíscas.', { tags: tags('fantasia') }),
  novo('crystal_ball', 'Bola de cristal', 'premium', '🔮', 'Vê o futuro… e talvez um match.', { rarity: EPIC, tags: tags('fantasia') }),
  novo('lantern', 'Lanterna mágica', 'premium', '🏮', 'Luz quentinha que guia o caminho.', { tags: tags('fantasia') }),
  novo('saber', 'Sabre neon', 'premium', '⚔️', 'Lâmina de luz neon.', { rarity: EPIC, tags: tags('futurista') }),
  novo('orb', 'Orbe galáctico', 'plus', '🌌', 'Uma galáxia na palma da mão.', { tags: tags('fantasia', 'futurista') }),
];

// ---------------- cores ----------------

/**
 * Tons de pele em ordem de claro → escuro (L* decrescente; o teste confere). s1..s8 são os originais (ids e hex
 * preservados); s9..s14 cobrem subtons frios e neutros/oliva que faltavam, do muito claro ao retinto.
 */
export const SKIN_COLORS: AvatarColorDef[] = [
  {
    id: 's9',
    label: 'Pele 9',
    hex: '#FBE4DC',
    tier: 'free',
    desc: 'Muito clara, subtom frio',
    isNew: true,
  },
  { id: 's1', label: 'Pele 1', hex: '#F8D9C4', tier: 'free', desc: 'Muito clara, subtom quente' },
  { id: 's2', label: 'Pele 2', hex: '#F2C6A6', tier: 'free', desc: 'Clara, subtom quente' },
  {
    id: 's10',
    label: 'Pele 10',
    hex: '#E2C29C',
    tier: 'free',
    desc: 'Clara, subtom oliva',
    isNew: true,
  },
  { id: 's3', label: 'Pele 3', hex: '#E8B590', tier: 'free', desc: 'Clara média, subtom quente' },
  { id: 's4', label: 'Pele 4', hex: '#D39B72', tier: 'free', desc: 'Média, subtom quente' },
  {
    id: 's11',
    label: 'Pele 11',
    hex: '#C69A70',
    tier: 'free',
    desc: 'Média, subtom oliva',
    isNew: true,
  },
  { id: 's5', label: 'Pele 5', hex: '#B87A52', tier: 'free', desc: 'Média escura, subtom quente' },
  {
    id: 's12',
    label: 'Pele 12',
    hex: '#A66A57',
    tier: 'free',
    desc: 'Média escura, subtom frio',
    isNew: true,
  },
  { id: 's6', label: 'Pele 6', hex: '#95583A', tier: 'free', desc: 'Escura, subtom quente' },
  {
    id: 's13',
    label: 'Pele 13',
    hex: '#7E4C3C',
    tier: 'free',
    desc: 'Escura, subtom neutro',
    isNew: true,
  },
  { id: 's7', label: 'Pele 7', hex: '#6E3E28', tier: 'free', desc: 'Muito escura, subtom quente' },
  { id: 's8', label: 'Pele 8', hex: '#4A2A1C', tier: 'free', desc: 'Retinta, subtom quente' },
  {
    id: 's14',
    label: 'Pele 14',
    hex: '#36211D',
    tier: 'free',
    desc: 'Retinta, subtom frio',
    isNew: true,
  },
  {
    id: 'f_lunar',
    label: 'Lunar',
    hex: '#C9D4F2',
    tier: 'premium',
    desc: 'Pele de fantasia prateada como a lua',
    isNew: true,
  },
  {
    id: 'f_cosmic',
    label: 'Cósmico',
    hex: '#5B4BB7',
    tier: 'premium',
    desc: 'Pele de fantasia violeta de galáxia',
    isNew: true,
  },
  {
    id: 'f_jade',
    label: 'Jade',
    hex: '#5FB89A',
    tier: 'premium',
    desc: 'Pele de fantasia verde jade',
    isNew: true,
  },
];

export const EYE_COLORS: AvatarColorDef[] = [
  { id: 'e_dark', label: 'Castanho escuro', hex: '#3B2416', tier: 'free', isNew: true },
  { id: 'e_brown', label: 'Castanho', hex: '#6B4226', tier: 'free', isNew: true },
  { id: 'e_hazel', label: 'Mel', hex: '#A8742F', tier: 'free', isNew: true },
  { id: 'e_amber', label: 'Âmbar', hex: '#C68A2E', tier: 'free', isNew: true },
  { id: 'e_green', label: 'Verde', hex: '#4E8A4A', tier: 'free', isNew: true },
  { id: 'e_blue', label: 'Azul', hex: '#4A7FC1', tier: 'free', isNew: true },
  { id: 'e_gray', label: 'Cinza', hex: '#8A96A3', tier: 'free', isNew: true },
  { id: 'e_black', label: 'Preto', hex: '#1E1A1A', tier: 'free', isNew: true },
  {
    id: 'e_violet',
    label: 'Violeta',
    hex: '#8B5CF6',
    tier: 'premium',
    desc: 'Cor de fantasia',
    isNew: true,
  },
  {
    id: 'e_gold',
    label: 'Dourado',
    hex: '#E0B000',
    tier: 'premium',
    desc: 'Cor de fantasia',
    isNew: true,
  },
  {
    id: 'e_ice',
    label: 'Gelo',
    hex: '#A8E6FF',
    tier: 'premium',
    desc: 'Cor de fantasia',
    isNew: true,
  },
  {
    id: 'e_ruby',
    label: 'Rubi',
    hex: '#D63864',
    tier: 'premium',
    desc: 'Cor de fantasia',
    isNew: true,
  },
];

/** Os 10 primeiros são os naturais originais (o gerador determinístico sorteia só entre eles). */
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
  { id: 'h_silver', label: 'Prateado', hex: '#C9CDD6', tier: 'free', isNew: true },
  { id: 'h_salt', label: 'Sal e pimenta', hex: '#7D7B78', tier: 'free', isNew: true },
  { id: 'h_steel', label: 'Grafite', hex: '#4D525C', tier: 'free', isNew: true },
  { id: 'h_pink', label: 'Rosa', hex: '#FF6FB1', tier: 'premium' },
  { id: 'h_blue', label: 'Azul', hex: '#4C8DFF', tier: 'premium' },
  { id: 'h_purple', label: 'Roxo', hex: '#9B5CFF', tier: 'premium' },
  { id: 'h_green', label: 'Verde', hex: '#4CD97B', tier: 'premium' },
  { id: 'h_lime', label: 'Lima neon', hex: '#7FFF00', tier: 'premium' },
  { id: 'h_teal', label: 'Turquesa', hex: '#1FB5A8', tier: 'premium', isNew: true },
  { id: 'h_lavender', label: 'Lavanda', hex: '#B79CF2', tier: 'premium', isNew: true },
  { id: 'h_rosegold', label: 'Rosé gold', hex: '#E7A39C', tier: 'premium', isNew: true },
  { id: 'h_fire', label: 'Vermelho fogo', hex: '#E5381C', tier: 'premium', isNew: true },
  { id: 'h_ice', label: 'Azul gelo', hex: '#A9DDF5', tier: 'premium', isNew: true },
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
  { id: 'c_lime', label: 'Lima Metch', hex: '#7FFF00', tier: 'premium' },
  { id: 'c_magenta', label: 'Magenta Metch', hex: '#FF1493', tier: 'premium' },
  { id: 'c_gold', label: 'Dourado', hex: '#FFD700', tier: 'premium' },
];

/** 'a_auto' = usar a cor própria do efeito (o hex é só reserva). */
export const AURA_AUTO = 'a_auto';

export const AURA_COLORS: AvatarColorDef[] = [
  {
    id: AURA_AUTO,
    label: 'Original',
    hex: '#FFFFFF',
    tier: 'free',
    desc: 'Cor original do efeito',
    isNew: true,
  },
  { id: 'a_lime', label: 'Lima', hex: '#7FFF00', tier: 'free', isNew: true },
  { id: 'a_magenta', label: 'Magenta', hex: '#FF1493', tier: 'free', isNew: true },
  { id: 'a_gold', label: 'Dourado', hex: '#FFD700', tier: 'free', isNew: true },
  { id: 'a_cyan', label: 'Ciano', hex: '#00E5FF', tier: 'free', isNew: true },
  { id: 'a_violet', label: 'Violeta', hex: '#9B5CFF', tier: 'free', isNew: true },
  { id: 'a_fire', label: 'Fogo', hex: '#FF6A00', tier: 'free', isNew: true },
  { id: 'a_rose', label: 'Rosa', hex: '#FF7AB6', tier: 'free', isNew: true },
  { id: 'a_emerald', label: 'Esmeralda', hex: '#00D68F', tier: 'free', isNew: true },
  { id: 'a_ice', label: 'Gelo', hex: '#9FE8FF', tier: 'free', isNew: true },
  { id: 'a_silver', label: 'Prata', hex: '#E6E8F0', tier: 'free', isNew: true },
  { id: 'a_crimson', label: 'Carmim', hex: '#E01E3C', tier: 'free', isNew: true },
];

// ---------------- slots ----------------

export const AVATAR_ITEM_SLOTS: AvatarSlotDef<AvatarItemDef>[] = [
  { slot: 'body', label: 'Corpo', optional: false, items: BODY_ITEMS, category: 'look' },
  { slot: 'faceShape', label: 'Rosto', optional: false, items: FACE_SHAPE_ITEMS, category: 'look' },
  { slot: 'eyes', label: 'Olhos', optional: false, items: EYES_ITEMS, category: 'look' },
  { slot: 'brows', label: 'Sobrancelhas', optional: false, items: BROWS_ITEMS, category: 'look' },
  { slot: 'nose', label: 'Nariz', optional: false, items: NOSE_ITEMS, category: 'look' },
  { slot: 'face', label: 'Expressão', optional: false, items: FACE_ITEMS, category: 'look' },
  {
    slot: 'lines',
    label: 'Marcas do tempo',
    optional: true,
    items: LINES_ITEMS,
    category: 'look',
    hint: 'Livre pra qualquer idade: use se combinar com você.',
  },
  {
    slot: 'faceDetail',
    label: 'Detalhes',
    optional: true,
    items: FACE_DETAIL_ITEMS,
    category: 'look',
  },
  { slot: 'hair', label: 'Cabelo', optional: false, items: HAIR_ITEMS, category: 'hair' },
  {
    slot: 'facialHair',
    label: 'Barba',
    optional: true,
    items: FACIAL_HAIR_ITEMS,
    category: 'hair',
  },
  { slot: 'top', label: 'Parte de cima', optional: false, items: TOP_ITEMS, category: 'clothes' },
  {
    slot: 'outer',
    label: 'Sobreposição',
    optional: true,
    items: OUTER_ITEMS,
    category: 'clothes',
    hint: 'Uma peça por cima: blazer, jaqueta, capa…',
  },
  {
    slot: 'bottom',
    label: 'Parte de baixo',
    optional: false,
    items: BOTTOM_ITEMS,
    category: 'clothes',
  },
  { slot: 'shoes', label: 'Calçado', optional: false, items: SHOES_ITEMS, category: 'clothes' },
  { slot: 'hat', label: 'Cabeça', optional: true, items: HAT_ITEMS, category: 'accessories' },
  {
    slot: 'glasses',
    label: 'Óculos',
    optional: true,
    items: GLASSES_ITEMS,
    category: 'accessories',
  },
  {
    slot: 'accessory',
    label: 'Brincos e enfeites',
    optional: true,
    items: ACCESSORY_ITEMS,
    category: 'accessories',
  },
  { slot: 'neck', label: 'Pescoço', optional: true, items: NECK_ITEMS, category: 'accessories' },
  {
    slot: 'bag',
    label: 'Bolsa e costas',
    optional: true,
    items: BAG_ITEMS,
    category: 'accessories',
  },
  { slot: 'wrist', label: 'Pulso', optional: true, items: WRIST_ITEMS, category: 'accessories' },
  {
    slot: 'prideFlag',
    label: 'Bandeira',
    optional: false,
    items: PRIDE_FLAG_ITEMS,
    category: 'pride',
    hint: 'Os itens de orgulho usam as cores da bandeira que você escolher.',
  },
  {
    slot: 'pride',
    label: 'Itens',
    optional: true,
    items: PRIDE_ITEMS,
    category: 'pride',
    hint: 'Tudo aqui é opcional e só aparece se você quiser.',
  },
  {
    slot: 'pronouns',
    label: 'Pronomes',
    optional: true,
    items: PRONOUN_ITEMS,
    category: 'pride',
    hint: 'Aparecem numa plaquinha nas telas grandes, nunca no mapa.',
  },
  { slot: 'aura', label: 'Aura', optional: true, items: AURA_ITEMS, category: 'effects' },
  {
    slot: 'auraLevel',
    label: 'Intensidade',
    optional: false,
    items: AURA_LEVEL_ITEMS,
    category: 'effects',
  },
  { slot: 'backdrop', label: 'Fundo', optional: true, items: BACKDROP_ITEMS, category: 'effects' },
  {
    slot: 'emote',
    label: 'Animação',
    optional: true,
    items: EMOTE_ITEMS,
    category: 'emotes',
    hint: 'Sua animação assinatura. Toque pra ver ela em ação.',
  },
  { slot: 'pet', label: 'Pet', optional: true, items: PET_ITEMS, category: 'pets' },
  {
    slot: 'petPose',
    label: 'Posição',
    optional: false,
    items: PET_POSE_ITEMS,
    category: 'pets',
    hint: 'Cada bichinho tem os cantinhos favoritos dele.',
  },
  { slot: 'vehicle', label: 'Veículo', optional: true, items: VEHICLE_ITEMS, category: 'rides' },
  {
    slot: 'held',
    label: 'Na mão',
    optional: true,
    items: HELD_ITEMS,
    category: 'held',
    hint: 'Vai na mão direita. Some quando a mão está ocupada (volante, guidão, pet no colo).',
  },
];

export const AVATAR_COLOR_SLOTS: AvatarSlotDef<AvatarColorDef>[] = [
  { slot: 'skin', label: 'Tom de pele', optional: false, items: SKIN_COLORS, category: 'look' },
  {
    slot: 'eyeColor',
    label: 'Cor dos olhos',
    optional: false,
    items: EYE_COLORS,
    category: 'look',
  },
  {
    slot: 'hairColor',
    label: 'Cor do cabelo',
    optional: false,
    items: HAIR_COLORS,
    category: 'hair',
  },
  {
    slot: 'topColor',
    label: 'Cor da parte de cima',
    optional: false,
    items: CLOTH_COLORS,
    category: 'clothes',
  },
  {
    slot: 'outerColor',
    label: 'Cor da sobreposição',
    optional: false,
    items: CLOTH_COLORS,
    category: 'clothes',
  },
  {
    slot: 'bottomColor',
    label: 'Cor da parte de baixo',
    optional: false,
    items: CLOTH_COLORS,
    category: 'clothes',
  },
  {
    slot: 'shoesColor',
    label: 'Cor do calçado',
    optional: false,
    items: CLOTH_COLORS,
    category: 'clothes',
  },
  {
    slot: 'hatColor',
    label: 'Cor do chapéu',
    optional: false,
    items: CLOTH_COLORS,
    category: 'accessories',
  },
  {
    slot: 'auraColor',
    label: 'Cor da aura',
    optional: false,
    items: AURA_COLORS,
    category: 'effects',
  },
  {
    slot: 'vehicleColor',
    label: 'Cor do veículo',
    optional: false,
    items: CLOTH_COLORS,
    category: 'rides',
  },
];

// ---------------- categorias ----------------

export const AVATAR_CATEGORIES: AvatarCategoryDef[] = [
  {
    key: 'look',
    label: 'Visual',
    icon: 'happy-outline',
    slots: ['body', 'faceShape', 'eyes', 'brows', 'nose', 'face', 'lines', 'faceDetail'],
    extraColors: ['skin', 'eyeColor'],
  },
  {
    key: 'hair',
    label: 'Cabelo',
    icon: 'cut-outline',
    slots: ['hair', 'facialHair'],
    colorOf: { hair: 'hairColor', facialHair: 'hairColor' },
  },
  {
    key: 'clothes',
    label: 'Roupas',
    icon: 'shirt-outline',
    slots: ['top', 'outer', 'bottom', 'shoes'],
    colorOf: { top: 'topColor', outer: 'outerColor', bottom: 'bottomColor', shoes: 'shoesColor' },
  },
  {
    key: 'accessories',
    label: 'Acessórios',
    icon: 'glasses-outline',
    slots: ['hat', 'glasses', 'accessory', 'neck', 'bag', 'wrist'],
    colorOf: { hat: 'hatColor' },
  },
  {
    key: 'pride',
    label: 'Orgulho',
    icon: 'flag-outline',
    slots: ['prideFlag', 'pride', 'pronouns'],
  },
  {
    key: 'effects',
    label: 'Efeitos',
    icon: 'sparkles-outline',
    slots: ['aura', 'backdrop'],
    colorOf: { aura: 'auraColor' },
    chipsOf: { aura: 'auraLevel' },
  },
  { key: 'emotes', label: 'Animações', icon: 'musical-notes-outline', slots: ['emote'] },
  { key: 'pets', label: 'Pets', icon: 'paw-outline', slots: ['pet'], chipsOf: { pet: 'petPose' } },
  {
    key: 'rides',
    label: 'Veículos',
    icon: 'car-sport-outline',
    slots: ['vehicle'],
    colorOf: { vehicle: 'vehicleColor' },
  },
  { key: 'held', label: 'Na mão', icon: 'rose-outline', slots: ['held'] },
];

// ---------------- looks prontos ----------------

/**
 * Slots que um look pode mexer. Corpo, pele, traços do rosto, expressão, cabelo, cor do cabelo, barba, marcas do tempo,
 * detalhes do rosto, pronomes e bandeira são da pessoa — look nenhum toca neles.
 */
export const AVATAR_LOOK_SLOTS: readonly AvatarSlot[] = [
  'top',
  'topColor',
  'outer',
  'outerColor',
  'bottom',
  'bottomColor',
  'shoes',
  'shoesColor',
  'hat',
  'hatColor',
  'glasses',
  'accessory',
  'neck',
  'bag',
  'wrist',
  'pride',
  'aura',
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

/**
 * Itens que fazem parte de quem a pessoa é (acessibilidade, fé): um look nunca troca nem remove.
 * Ex.: aplicar "Festa" em quem usa hijab mantém o hijab (e a cor dele); cadeira de rodas continua.
 */
export const AVATAR_PROTECTED_ITEMS: Partial<Record<AvatarItemSlot, readonly string[]>> = {
  hat: ['hijab', 'turban'],
  accessory: ['hearing_aid'],
  vehicle: ['wheelchair', 'wheelchair_sport'],
};

export const AVATAR_LOOKS: AvatarLookDef[] = [
  {
    id: 'casual',
    label: 'Casual de domingo',
    desc: 'Listrada, jaqueta jeans e um cafezinho pra começar bem.',
    tag: 'casual',
    set: {
      top: 'striped',
      topColor: 'c_navy',
      outer: 'denim',
      outerColor: 'c_denim',
      bottom: 'jeans',
      bottomColor: 'c_lightdenim',
      shoes: 'sneakers',
      shoesColor: 'c_white',
      hat: NONE,
      neck: NONE,
      bag: 'tote',
      wrist: 'watch',
      held: 'coffee',
      aura: NONE,
      backdrop: 'garden',
    },
  },
  {
    id: 'encontro',
    label: 'Primeiro encontro',
    desc: 'Linho leve, mocassim e uma rosa pra causar boa impressão.',
    tag: 'casual',
    set: {
      top: 'linen',
      topColor: 'c_white',
      outer: NONE,
      outerColor: 'c_navy',
      bottom: 'pants',
      bottomColor: 'c_navy',
      shoes: 'loafers',
      shoesColor: 'c_brown',
      hat: NONE,
      neck: 'necklace',
      bag: 'crossbody',
      wrist: 'bracelet',
      held: 'rose',
      aura: NONE,
      backdrop: 'sunset',
    },
  },
  {
    id: 'elegante',
    label: 'Noite elegante',
    desc: 'Blazer, alfaiataria e gravata: pronto pra qualquer convite.',
    tag: 'elegante',
    set: {
      top: 'shirt',
      topColor: 'c_white',
      outer: 'blazer',
      outerColor: 'c_black',
      bottom: 'tailored',
      bottomColor: 'c_black',
      shoes: 'oxford',
      shoesColor: 'c_black',
      hat: NONE,
      neck: 'tie',
      bag: NONE,
      wrist: 'watch',
      held: NONE,
      aura: NONE,
      backdrop: 'studio',
    },
  },
  {
    id: 'atemporal',
    label: 'Elegância atemporal',
    desc: 'Gola alta, cardigã e um bom livro: clássico que nunca envelhece.',
    tag: 'atemporal',
    set: {
      top: 'turtleneck',
      topColor: 'c_beige',
      outer: 'cardigan',
      outerColor: 'c_brown',
      bottom: 'tailored',
      bottomColor: 'c_gray',
      shoes: 'loafers',
      shoesColor: 'c_brown',
      hat: NONE,
      neck: 'silk',
      bag: NONE,
      wrist: 'watch',
      held: 'book',
      aura: NONE,
      backdrop: 'garden',
    },
  },
  {
    id: 'urbano',
    label: 'Rolê urbano',
    desc: 'Oversized, bomber e skate pra rodar a cidade.',
    tag: 'urbano',
    set: {
      top: 'oversized',
      topColor: 'c_black',
      outer: 'bomber',
      outerColor: 'c_olive',
      bottom: 'joggers',
      bottomColor: 'c_gray',
      shoes: 'hightops',
      shoesColor: 'c_white',
      hat: 'cap_back',
      hatColor: 'c_black',
      neck: NONE,
      bag: 'fanny',
      wrist: NONE,
      held: NONE,
      aura: NONE,
      backdrop: 'sunset',
      vehicle: 'skate',
      vehicleColor: 'c_red',
    },
  },
  {
    id: 'praia',
    label: 'Dia de praia',
    desc: 'Camisa florida, chinelo e água de coco geladinha.',
    tag: 'praia',
    set: {
      top: 'hawaiian',
      topColor: 'c_teal',
      outer: NONE,
      outerColor: 'c_navy',
      bottom: 'bermuda',
      bottomColor: 'c_beige',
      shoes: 'slides',
      shoesColor: 'c_white',
      hat: 'panama',
      hatColor: 'c_beige',
      glasses: 'sun',
      neck: 'lei',
      bag: NONE,
      wrist: 'beads',
      held: 'coconut',
      aura: NONE,
      backdrop: 'beach',
    },
  },
  {
    id: 'esporte',
    label: 'Modo esporte',
    desc: 'Regata, faixa na testa e bike pra queimar energia.',
    tag: 'esporte',
    set: {
      top: 'basket',
      topColor: 'c_red',
      outer: NONE,
      outerColor: 'c_navy',
      bottom: 'shorts',
      bottomColor: 'c_black',
      shoes: 'sneakers',
      shoesColor: 'c_white',
      hat: 'headband',
      hatColor: 'c_white',
      neck: NONE,
      bag: NONE,
      wrist: 'fitness',
      held: NONE,
      aura: NONE,
      backdrop: NONE,
      vehicle: 'bike',
      vehicleColor: 'c_blue',
    },
  },
  {
    id: 'orgulho',
    label: 'Parada do orgulho',
    desc: 'Camiseta e bandeirinha nas cores que você escolheu, aura e fundo combinando.',
    tag: 'orgulho',
    set: {
      top: 'pride_tee',
      topColor: 'c_white',
      outer: NONE,
      outerColor: 'c_navy',
      bottom: 'shorts',
      bottomColor: 'c_denim',
      shoes: 'sneakers',
      shoesColor: 'c_white',
      hat: NONE,
      neck: NONE,
      bag: NONE,
      wrist: 'bangles',
      pride: 'flag',
      held: 'heart_sign',
      aura: 'pride',
      auraColor: AURA_AUTO,
      backdrop: 'pride',
    },
  },
  {
    id: 'festa',
    label: 'Noite de festa',
    desc: 'Paetê, plataforma e estrelinha na mão: a pista é sua.',
    tag: 'festa',
    set: {
      top: 'sequin',
      topColor: 'c_magenta',
      outer: NONE,
      outerColor: 'c_navy',
      bottom: 'wide',
      bottomColor: 'c_black',
      shoes: 'platform',
      shoesColor: 'c_black',
      hat: NONE,
      accessory: 'hoops',
      neck: 'choker',
      bag: 'clutch',
      wrist: 'bangles',
      held: 'sparkler',
      aura: 'music',
      auraColor: 'a_magenta',
      backdrop: 'confetti',
      emote: 'dance_disco',
    },
  },
  {
    id: 'fantasia',
    label: 'Conto de fadas',
    desc: 'Túnica estrelada, varinha e tapete voador rumo à aventura.',
    tag: 'fantasia',
    set: {
      top: 'wizard',
      topColor: 'c_purple',
      outer: NONE,
      outerColor: 'c_navy',
      bottom: 'pants',
      bottomColor: 'c_navy',
      shoes: 'boots',
      shoesColor: 'c_brown',
      hat: 'witch',
      hatColor: 'c_purple',
      neck: 'amulet',
      bag: NONE,
      wrist: NONE,
      held: 'wand',
      aura: 'stardust',
      auraColor: AURA_AUTO,
      backdrop: 'galaxy',
      vehicle: 'carpet',
      vehicleColor: 'c_red',
    },
  },
  {
    id: 'futurista',
    label: 'Neon do futuro',
    desc: 'Top cyber, ombreiras mecha e hoverboard direto de 2099.',
    tag: 'futurista',
    set: {
      top: 'cyber',
      topColor: 'c_black',
      outer: 'mecha',
      outerColor: 'c_gray',
      bottom: 'metallic',
      bottomColor: 'c_gray',
      shoes: 'runners',
      shoesColor: 'c_lime',
      hat: NONE,
      glasses: 'cyber',
      neck: NONE,
      bag: 'jetpack',
      wrist: 'smartwatch',
      held: 'saber',
      aura: 'hologram',
      auraColor: 'a_cyan',
      backdrop: 'neon_grid',
      vehicle: 'hoverboard',
      vehicleColor: 'c_black',
    },
  },
];

// ---------------- índices e helpers ----------------

const itemIndex = new Map<string, Map<string, AvatarItemDef>>();
for (const s of AVATAR_ITEM_SLOTS) itemIndex.set(s.slot, new Map(s.items.map((i) => [i.id, i])));
const colorIndex = new Map<string, Map<string, AvatarColorDef>>();
for (const s of AVATAR_COLOR_SLOTS) colorIndex.set(s.slot, new Map(s.items.map((i) => [i.id, i])));
const slotIndex = new Map<string, AvatarSlotDef<AvatarItemDef> | AvatarSlotDef<AvatarColorDef>>();
for (const s of AVATAR_ITEM_SLOTS) slotIndex.set(s.slot, s);
for (const s of AVATAR_COLOR_SLOTS) slotIndex.set(s.slot, s);
const flagIndex = new Map(PRIDE_FLAGS.map((f) => [f.id, f]));
const lookIndex = new Map(AVATAR_LOOKS.map((l) => [l.id, l]));

export function avatarItem(slot: AvatarItemSlot, id: string): AvatarItemDef | undefined {
  return itemIndex.get(slot)?.get(id);
}

export function avatarColor(slot: AvatarColorSlot, id: string): AvatarColorDef | undefined {
  return colorIndex.get(slot)?.get(id);
}

/** hex da cor de um slot (reserva: primeira cor do slot) */
export function avatarColorHex(slot: AvatarColorSlot, id: string): string {
  const def = avatarColor(slot, id);
  if (def) return def.hex;
  const first = AVATAR_COLOR_SLOTS.find((s) => s.slot === slot)?.items[0];
  return first ? first.hex : '#888888';
}

/** tinta da aura pro renderer: null = cor original do efeito ('a_auto' ou id desconhecido) */
export function avatarAuraTint(auraColorId: string): string | null {
  if (auraColorId === AURA_AUTO) return null;
  return avatarColor('auraColor', auraColorId)?.hex ?? null;
}

/** o tier necessário pra usar um item/cor ('free' quando o id não existe — o normalize já troca pelo padrão) */
export function avatarTierOf(slot: AvatarSlot, id: string): AvatarTier {
  return itemIndex.get(slot)?.get(id)?.tier ?? colorIndex.get(slot)?.get(id)?.tier ?? 'free';
}

/** raridade visual de um item/cor (explícita ou a padrão do tier) */
export function avatarRarityOf(slot: AvatarSlot, id: string): AvatarRarity {
  const it = itemIndex.get(slot)?.get(id);
  if (it) return it.rarity ?? RARITY_BY_TIER[it.tier];
  const c = colorIndex.get(slot)?.get(id);
  return c ? RARITY_BY_TIER[c.tier] : 'common';
}

export function avatarSlotDef(slot: AvatarItemSlot): AvatarSlotDef<AvatarItemDef>;
export function avatarSlotDef(slot: AvatarColorSlot): AvatarSlotDef<AvatarColorDef>;
export function avatarSlotDef(slot: AvatarSlot): AvatarSlotDef<AvatarItemDef> | AvatarSlotDef<AvatarColorDef>;
export function avatarSlotDef(slot: AvatarSlot): AvatarSlotDef<AvatarItemDef> | AvatarSlotDef<AvatarColorDef> {
  const def = slotIndex.get(slot);
  if (!def) throw new Error(`slot de avatar desconhecido: ${slot}`);
  return def;
}

/** categoria do editor onde o slot (de item ou cor) aparece */
export function avatarCategoryOf(slot: AvatarSlot): AvatarCategoryKey {
  return slotIndex.get(slot)?.category ?? 'look';
}

export function avatarCategoryDef(key: AvatarCategoryKey): AvatarCategoryDef | undefined {
  return AVATAR_CATEGORIES.find((c) => c.key === key);
}

/** bandeira de orgulho (reserva: arco-íris) */
export function prideFlagDef(id: string | null | undefined): AvatarFlagDef {
  return (id ? flagIndex.get(id) : undefined) ?? flagIndex.get('rainbow')!;
}

/** posições aceitas pelo pet (a primeira é a padrão); [] pra 'none' ou id desconhecido */
export function petPosesOf(petId: string | null | undefined): AvatarPetPose[] {
  if (!petId) return [];
  return avatarItem('pet', petId)?.petPoses ?? [];
}

/** como o avatar vai montado no veículo; null sem veículo (ou id desconhecido) */
export function vehicleMountOf(id: string | null | undefined): AvatarMountKind | null {
  if (!id) return null;
  return avatarItem('vehicle', id)?.mount ?? null;
}

/** item que se mexe sozinho (aura animada, animação) — a UI mostra o selo "animado" e respeita movimento reduzido */
export function isAnimatedItem(slot: AvatarSlot, id: string): boolean {
  return itemIndex.get(slot)?.get(id)?.animated === true;
}

/** texto da plaquinha de pronomes; null quando não mostra */
export function avatarPronounsLabel(id: string | null | undefined): string | null {
  if (!id || id === NONE) return null;
  return avatarItem('pronouns', id)?.label ?? null;
}

export function avatarLook(id: string): AvatarLookDef | undefined {
  return lookIndex.get(id);
}

const TIER_RANK: Record<AvatarTier, number> = { free: 0, premium: 1, plus: 2, event: 3 };

/** maior tier entre os itens do look (o selo do card do look) */
export function avatarLookTier(id: string): AvatarTier {
  const look = lookIndex.get(id);
  let best: AvatarTier = 'free';
  if (!look) return best;
  for (const [slot, value] of Object.entries(look.set) as [AvatarSlot, string][]) {
    const t = avatarTierOf(slot, value);
    if (TIER_RANK[t] > TIER_RANK[best]) best = t;
  }
  return best;
}
