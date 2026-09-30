// Fila do Bull do push social (só constantes e tipos: o service agenda, o processor executa — sem ciclo de import).

/** fila do push social (Redis do REDIS_URL, prefixo padrão 'bull') */
export const SOCIAL_PUSH_QUEUE = 'social-push';

/** envio das curtidas juntadas no fim da espera de 15 min */
export const LIKES_FLUSH_JOB = 'likes-flush';

export interface LikesFlushJob {
  /** quem recebe o aviso */
  to: string;
  /** fim da espera (ms) que barrou as curtidas — é o valor gravado na chave da espera */
  dueAt: number;
}

/** folga depois do fim da espera: o job não pode rodar com a espera velha ainda de pé */
export const LIKES_FLUSH_MARGIN_MS = 1_000;

/** um job por destinatário E por janela: curtidas barradas pela mesma espera caem no mesmo job (o Bull ignora o repetido) */
export const likesFlushJobId = (to: string, dueAt: number): string => `likes:${to}:${dueAt}`;
