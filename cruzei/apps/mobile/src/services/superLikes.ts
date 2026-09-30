// Super curtida: limite por dia (grátis 1, Premium e Premium+ 7; vira à meia-noite de Brasília). Quem garante é o
// servidor (403 super_like_limit); aqui ficam as regras puras do contador e dos textos do aviso.
import type { LikeResult, SuperLikeLimitError, SuperLikeQuota } from '@cruzei/shared-types';

/** o erro é o 403 super_like_limit? devolve o corpo (limite, quando volta, se dá pra assinar) */
export function superLikeLimitOf(err: unknown): SuperLikeLimitError | null {
  const res = (err as { response?: { status?: number; data?: unknown } } | null)?.response;
  const data = res?.data as Partial<SuperLikeLimitError> | undefined;
  if (res?.status !== 403 || data?.error !== 'super_like_limit') return null;
  return {
    error: 'super_like_limit',
    message: data.message ?? 'Acabaram as super curtidas de hoje.',
    limit: typeof data.limit === 'number' ? data.limit : 1,
    resetsAt: typeof data.resetsAt === 'string' ? data.resetsAt : '',
    canUpgrade: data.canUpgrade === true,
  };
}

/** quantas restam agora (null = ainda não sabe); passou da meia-noite = cota cheia até o servidor confirmar */
export function quotaRemaining(q: SuperLikeQuota | null | undefined, now: number = Date.now()): number | null {
  if (!q) return null;
  const resets = Date.parse(q.resetsAt);
  if (Number.isFinite(resets) && resets <= now) return q.limit;
  return Math.max(0, q.remaining);
}

/**
 * Contador depois de uma super curtida que deu certo. Sem superLikesRemainingToday (repetida pra quem eu já curti, ou
 * servidor antigo) não dá pra saber: devolve null e quem chama pede a cota de novo.
 */
export function quotaAfterSuperLike(
  q: SuperLikeQuota | null | undefined,
  res: Pick<LikeResult, 'superLikesRemainingToday'> | null | undefined,
): SuperLikeQuota | null {
  const remaining = res?.superLikesRemainingToday;
  if (!q || typeof remaining !== 'number') return null;
  return { ...q, remaining, used: Math.max(0, q.limit - remaining) };
}

/** o servidor disse que acabou: zera o contador com o que veio no 403 */
export function quotaFromLimit(q: SuperLikeQuota | null | undefined, e: SuperLikeLimitError): SuperLikeQuota | null {
  if (!q) return null;
  return { ...q, limit: e.limit, used: e.limit, remaining: 0, resetsAt: e.resetsAt || q.resetsAt };
}

/** "daqui a 5 h" / "daqui a 20 min" até a cota voltar ('' se não souber) */
export function resetInText(resetsAt: string | null | undefined, now: number = Date.now()): string {
  const at = resetsAt ? Date.parse(resetsAt) : NaN;
  if (!Number.isFinite(at)) return '';
  const min = Math.max(1, Math.ceil((at - now) / 60_000));
  if (min < 60) return `daqui a ${min} min`;
  return `daqui a ${Math.round(min / 60)} h`;
}

/** textos do aviso quando acaba: no grátis é convite pro Premium */
export function superLikeLimitCopy(
  info: { canUpgrade: boolean; limit?: number; resetsAt?: string | null },
  now: number = Date.now(),
): { title: string; body: string } {
  const when = resetInText(info.resetsAt, now);
  const back = when ? `Volta à meia-noite (${when}).` : 'Volta à meia-noite.';
  if (info.canUpgrade) {
    return {
      title: 'Tua super curtida de hoje já foi ⭐',
      body: `No grátis é 1 por dia. ${back}\n\nNo Premium são 7 por dia — e quem recebe vê você primeiro no deck.`,
    };
  }
  return {
    title: 'Acabaram as super curtidas de hoje',
    body: `Tuas ${info.limit ?? 7} super curtidas do dia já foram. ${back} Enquanto isso, a curtida normal tá liberada 💚`,
  };
}
