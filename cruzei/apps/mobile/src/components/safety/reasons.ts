import type { ReportReason } from '@cruzei/shared-types';

/** motivos na ordem da lista (texto do ponto de vista de quem denuncia) */
export const REASON_OPTIONS: { reason: ReportReason; label: string; icon: string }[] = [
  { reason: 'harassment', label: 'Assédio ou ofensa', icon: 'chatbubble-ellipses-outline' },
  { reason: 'fake', label: 'Perfil falso ou se passando por outra pessoa', icon: 'person-remove-outline' },
  { reason: 'scam', label: 'Golpe ou pedido de dinheiro', icon: 'cash-outline' },
  { reason: 'inappropriate', label: 'Nudez ou conteúdo sexual', icon: 'eye-off-outline' },
  { reason: 'threat', label: 'Ameaça ou violência', icon: 'warning-outline' },
  { reason: 'underage', label: 'Parece ter menos de 18 anos', icon: 'id-card-outline' },
  { reason: 'child_safety', label: 'Exploração ou abuso infantil', icon: 'shield-outline' },
  { reason: 'spam', label: 'Spam ou propaganda', icon: 'megaphone-outline' },
  { reason: 'other', label: 'Outro motivo', icon: 'ellipsis-horizontal-circle-outline' },
];

/** motivos em que vale lembrar dos canais de emergência */
export const URGENT_REASONS = new Set<ReportReason>(['threat', 'child_safety', 'underage']);

export const EMERGENCY_NUMBERS = [
  { number: '190', label: 'Polícia Militar' },
  { number: '180', label: 'Central de Atendimento à Mulher' },
  { number: '100', label: 'Disque Direitos Humanos (abuso infantil)' },
];
