// Textos do push social (mensagem nova, curtida, match). PURO: sem Prisma e sem Nest (testado em
// social-push.texts.spec.ts). Quem decide SE manda e o que pode aparecer (nome, prévia) é o SocialPushService.

export interface PushText {
  title: string;
  body: string;
}

/** prévia da mensagem no aviso (o resto fica no app) */
export const PREVIEW_MAX = 120;
/** nome no título do aviso */
const NAME_MAX = 40;

/** texto de uma linha só, sem espaços repetidos, cortado com reticências */
export function oneLine(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

const nameOf = (name: string | null | undefined): string =>
  oneLine(name?.trim() || 'Alguém', NAME_MAX);

/** o que a mensagem mostra no aviso: texto (cortado) ou o tipo da mídia; mensagem de sistema não vira prévia */
export function messagePreviewOf(messageType: string, body: string | null): string | null {
  switch (messageType) {
    case 'text': {
      const t = oneLine(body ?? '', PREVIEW_MAX);
      return t || null;
    }
    case 'photo_temp':
      return '📷 Foto temporária';
    case 'audio':
      return '🎤 Áudio';
    case 'gif':
      return 'GIF';
    case 'location':
      return '📍 Localização';
    default:
      return null;
  }
}

export interface MessagePushTextInput {
  peerName: string | null;
  /** pasta de quem RECEBE: 'requests' = solicitação de mensagem */
  folder: 'inbox' | 'requests';
  /** prévia já montada (messagePreviewOf) */
  preview: string | null;
  /** preferência messagePreview de quem recebe */
  showPreview: boolean;
  /** não lidas da conversa pra quem recebe (depois desta) */
  unread: number;
}

/**
 * Mensagem nova.
 * - Principal: título = nome; corpo = prévia (ligada) ou "Mandou uma mensagem" / "N mensagens novas".
 * - Solicitação: título "Nova solicitação de mensagem"; corpo "Nome quer conversar com você" ou "Nome: prévia".
 */
export function messagePushText(i: MessagePushTextInput): PushText {
  const name = nameOf(i.peerName);
  const preview = i.showPreview ? i.preview : null;
  if (i.folder === 'requests') {
    return {
      title: 'Nova solicitação de mensagem',
      body: preview ? `${name}: ${preview}` : `${name} quer conversar com você`,
    };
  }
  if (preview) return { title: name, body: preview };
  return {
    title: name,
    body: i.unread > 1 ? `${i.unread} mensagens novas` : 'Mandou uma mensagem',
  };
}

export interface LikePushTextInput {
  /** nome de quem curtiu — só quando quem recebe pode saber (Premium+ vigente, curtidor visível e fora de análise) */
  likerName: string | null;
  /** curtidas somadas neste aviso (a espera de 15 min junta as do período) */
  count: number;
  isSuper: boolean;
}

/** curtida recebida: sem nome pra quem não pode ver quem curtiu; agregada quando junta mais de uma */
export function likePushText(i: LikePushTextInput): PushText {
  const n = Math.max(1, Math.trunc(i.count) || 1);
  if (i.likerName == null) {
    const body = 'Abre o Metch pra ver.';
    if (i.isSuper) return { title: 'Alguém te mandou uma super curtida ⭐', body };
    if (n > 1) return { title: `Você tem ${n} curtidas novas 💚`, body };
    return { title: 'Alguém curtiu você 💚', body };
  }
  const name = nameOf(i.likerName);
  const body = 'Curte de volta e dá Metch.';
  if (i.isSuper) return { title: `${name} te mandou uma super curtida ⭐`, body };
  if (n > 1) {
    const more = n - 1;
    return {
      title: `${name} e mais ${more} ${more === 1 ? 'pessoa' : 'pessoas'} curtiram você 💚`,
      body,
    };
  }
  return { title: `${name} curtiu você 💚`, body };
}

/** match fechado (pra quem curtiu primeiro) */
export function matchPushText(peerName: string | null): PushText {
  return { title: 'METCH! 🔥', body: `Você e ${nameOf(peerName)} se curtiram. Manda um oi!` };
}
