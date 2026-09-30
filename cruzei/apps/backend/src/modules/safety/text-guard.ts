import { checkText, textBlockedError } from '@cruzei/shared-utils';
import { BadRequestException } from '@nestjs/common';

// Filtro de abuso nas MENSAGENS (regras e listas em @cruzei/shared-utils/moderation). Nome, bio e @ usam
// checkProfileText direto no cadastro (AuthService.register) e no editar perfil (UsersService.update).

/**
 * Mensagem de chat: ódio, ameaça e sexual com menor → 400 text_blocked (nada é gravado). Golpe → passa e devolve o
 * trecho que bateu, pra quem chama abrir a denúncia automática DEPOIS do envio (autoReportScam). Palavrão entre
 * adultos passa.
 */
export function screenMessage(text: string): { scam: string | null } {
  const v = checkText(text, 'message');
  if (v.action === 'block') throw new BadRequestException(textBlockedError('message', v));
  return { scam: v.action === 'flag' ? v.match : null };
}
