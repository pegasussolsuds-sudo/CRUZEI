// Foto retida por denúncia: o dono apagou com denúncia underage/child_safety pendente ou em análise contra ele. A linha
// fica em photos (a ficha da moderação continua mostrando, com a marca), mas some do perfil do dono e do público:
// status vira 'rejected' (toda consulta pública exige 'approved'), deixa de ser principal e vai pra um order_index
// negativo (fora do UNIQUE dos visíveis). A marca mora em moderation_labels.retainedByReport (sem coluna nova). O
// arquivo vai pra uma cópia privada held/<uuid novo> (a pública sai no GC) e a ficha lê pela rota autenticada
// (retainedPhotoPath). Quando não sobra denúncia dessas aberta, MediaGcService.releaseRetainedPhotos apaga de verdade
// (gatilho → fila → GC; fechada com ação, 180 dias).
// Funções puras: usadas no UsersService, na moderação, na cópia dos dados e no GC.
import type { Prisma } from '@prisma/client';

/** chave em photos.moderation_labels (a MESMA do índice parcial photos_retained_idx e do SQL do GC) */
export const RETAINED_LABEL = 'retainedByReport';

/**
 * O cron que move pra held/ (MediaGcService.moveRetainedToHeld) também grava na marca: moveAttempts, moveRetryAt e
 * moveError (falha passageira, backoff) e moveFinal/moveFinalAt (arquivo sumido: não tenta mais). Original sumido com
 * a miniatura pública ainda lá: a miniatura vai pra held/ e a marca ganha heldFrom: 'thumbnail' (+ moveFinal).
 */
export interface RetainedMark {
  /** quando o dono apagou (ISO) */
  at: string;
  /** situação antes de reter (a ficha mostra) */
  prevStatus: string;
  wasMain: boolean;
}

function asObject(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/** igual ao SQL `(moderation_labels -> 'retainedByReport') IS NOT NULL`: basta a chave existir */
export function isRetainedPhoto(labels: unknown): boolean {
  const o = asObject(labels);
  return !!o && Object.prototype.hasOwnProperty.call(o, RETAINED_LABEL);
}

export function retainedMark(labels: unknown): RetainedMark | null {
  if (!isRetainedPhoto(labels)) return null;
  const m = asObject((labels as Record<string, unknown>)[RETAINED_LABEL]) ?? {};
  return {
    at: typeof m.at === 'string' ? m.at : '',
    prevStatus: typeof m.prevStatus === 'string' ? m.prevStatus : 'approved',
    wasMain: m.wasMain === true,
  };
}

/** labels com a marca, sem perder o resto (o 'urgent' segue valendo pros 180 dias do gatilho quando sair) */
export function withRetainedMark(labels: unknown, mark: RetainedMark): Prisma.InputJsonObject {
  return { ...(asObject(labels) ?? {}), [RETAINED_LABEL]: { ...mark } } as Prisma.InputJsonObject;
}

/** só as fotos que o dono vê (perfil, contagem, ordem, principal, completude, cópia dos dados) */
export function ownerVisible<T extends { moderationLabels?: unknown }>(photos: T[]): T[] {
  return photos.filter((p) => !isRetainedPhoto(p.moderationLabels));
}

/** order_index da foto retida: abaixo de tudo (negativo), sem bater no UNIQUE(user_id, order_index) */
export function retainedOrderIndex(minOrderIndex: number | null | undefined): number {
  return Math.min(minOrderIndex ?? 0, 0) - 1;
}

/**
 * Onde a ficha da moderação lê a retida: rota AUTENTICADA (Bearer de moderador/admin), relativa à origem da API. O
 * arquivo mora em held/ (fora do /uploads e do acesso público do bucket); a URL pública nunca é montada pra ela.
 */
export function retainedPhotoPath(
  photoId: string,
  apiPrefix = process.env.API_PREFIX ?? 'v1',
): string {
  const prefix = apiPrefix.replace(/^\/+|\/+$/g, '');
  return `/${prefix ? `${prefix}/` : ''}admin/photos/${encodeURIComponent(photoId)}/file`;
}

/** foto marcada 'urgent' pela análise (possível menor): o arquivo fica 180 dias depois de sair (= gatilho) */
export function isUrgentPhoto(labels: unknown): boolean {
  const u = asObject(labels)?.urgent;
  return u === true || u === 'true';
}
