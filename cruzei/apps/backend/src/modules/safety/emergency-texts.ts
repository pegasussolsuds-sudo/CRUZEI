import { EMERGENCY_PAUSE_DAYS, EMERGENCY_PHONE } from '@cruzei/shared-types';

import { EMERGENCY_REPORT_TARGETS_PER_DAY, type EmergencyReportSkip } from './emergency-limits';

// Textos do botão de emergência (puros, testados em emergency-texts.spec.ts). A pessoa vê a própria mensagem e a
// resposta do sistema; a equipe vê também a nota interna. O NOME da outra pessoa só vai na nota interna (a rota
// aceita qualquer id: não pode virar jeito de descobrir o nome de alguém). Nunca localização.

/** de onde veio o botão */
export type EmergencyVia = 'chat' | 'profile' | 'help';

/** prioridade da denúncia de emergência na fila da moderação: acima de tudo (child_safety = 3) */
export const EMERGENCY_REPORT_PRIORITY = 4;

export const EMERGENCY_REPORT_DESCRIPTION = 'Botão de emergência acionado no app';

/** mensagem automática em nome da pessoa (a 1ª do atendimento urgente) */
export function emergencyUserText(via: EmergencyVia): string {
  const where =
    via === 'chat'
      ? ' numa conversa do Metch'
      : via === 'profile'
        ? ' no perfil de uma pessoa'
        : ' no app';
  return `🆘 URGENTE: apertei o botão de emergência${where}. Preciso de ajuda.`;
}

/** data curta no fuso de São Paulo ("07/10") */
export function shortDateBR(d: Date): string {
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** resposta do sistema pra pessoa: o que já aconteceu e o 190 */
export function emergencyReplyText(p: {
  pausedUntil: Date;
  blocked: boolean;
  reported: boolean;
}): string {
  const done = [
    `seu perfil ficou pausado até ${shortDateBR(p.pausedUntil)} (você sumiu do mapa; dá pra despausar no seu perfil quando quiser)`,
    p.blocked ? 'a pessoa foi bloqueada' : null,
    p.reported ? 'a moderação recebeu uma denúncia de segurança' : null,
  ].filter(Boolean);
  return (
    'Recebemos seu pedido de emergência 🆘 A Equipe Metch já foi avisada e vai falar com você por aqui com prioridade. ' +
    `Já feito: ${done.join('; ')}. Se você estiver em perigo agora, ligue ${EMERGENCY_PHONE} (Polícia Militar).`
  );
}

/**
 * 429 do botão (EMERGENCY_THROTTLE). O limite conta tentativas, inclusive as que falharam: não dá pra afirmar que a
 * equipe foi avisada — o texto é condicional e o 190 vem primeiro
 */
export function emergencyThrottledText(): string {
  return (
    `Se você estiver em perigo agora, ligue ${EMERGENCY_PHONE} (Polícia Militar). ` +
    'O botão de emergência foi usado várias vezes em pouco tempo: se um dos acionamentos deu certo, a Equipe Metch já ' +
    'foi avisada e fala com você pelo suporte. Na dúvida, abra o suporte e escreva por lá.'
  );
}

/** nota interna pra equipe (a pessoa não vê): contexto pra agir rápido */
export function emergencyStaffNote(p: {
  via: EmergencyVia;
  target: { id: string; name: string } | null;
  /** pessoa citada SEM relação registrada (não bloqueada nem denunciada): só pra equipe conferir */
  unrelated?: { id: string; name: string } | null;
  conversationId: string | null;
  reportId: string | null;
  /** denúncia não criada por limite (orçamento de denúncias / alvos distintos no dia) */
  reportSkipped?: EmergencyReportSkip | null;
  blocked: boolean;
  blockFailed: boolean;
  pausedUntil: Date;
}): string {
  const lines = [
    `🆘 Botão de emergência (automático, via ${p.via === 'chat' ? 'chat' : p.via === 'profile' ? 'cartão da pessoa' : 'Ajuda e segurança'}).`,
    p.target
      ? `Pessoa envolvida: ${p.target.name} (${p.target.id}).`
      : p.unrelated
        ? `Pessoa citada SEM relação registrada no app (conversa, curtida, passe ou aceno): ${p.unrelated.name} (${p.unrelated.id}). Não foi bloqueada nem denunciada automaticamente: conferir.`
        : 'Sem pessoa envolvida.',
    p.conversationId ? `Conversa: ${p.conversationId} (dá pra ler na ficha da moderação).` : null,
    p.reportId
      ? `Denúncia de segurança: ${p.reportId} (fila da moderação, prioridade máxima).`
      : p.target && p.reportSkipped
        ? `Denúncia NÃO criada: ${p.reportSkipped === 'hour' ? 'limite de denúncias da última hora' : `já denunciou ${EMERGENCY_REPORT_TARGETS_PER_DAY} pessoas diferentes pelo botão hoje`} (conferir e registrar se for o caso).`
        : null,
    p.target
      ? `Bloqueio: ${p.blocked ? 'feito' : p.blockFailed ? 'NÃO deu (conferir)' : '—'}.`
      : null,
    `Perfil de quem pediu pausado até ${p.pausedUntil.toISOString()} (${EMERGENCY_PAUSE_DAYS} dias).`,
    'Localização não é enviada.',
  ];
  return lines.filter(Boolean).join('\n');
}
