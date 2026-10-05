import {
  ACCOUNT_DELETION_GRACE_DAYS_DEFAULT,
  DATA_EXPORT_DAILY_LIMIT_DEFAULT,
} from '@cruzei/shared-types';

// Prazos de conta e privacidade lidos do ambiente (valor inválido cai no padrão seguro). Função pura: os serviços leem
// na hora (testes mudam o env sem reiniciar) e nada disso passa pelo configuration.ts.

export interface PrivacyConfig {
  /** ACCOUNT_DELETION_GRACE_DAYS: prazo pra voltar atrás (0 = limpa na próxima rodada; só dev/teste) */
  graceDays: number;
  /** ACCOUNT_EVIDENCE_RETENTION_DAYS: conversas/atendimentos citados em denúncia, contados do fim da denúncia */
  evidenceDays: number;
  /** PAYMENT_RECORDS_RETENTION_YEARS: assinaturas e Boosts de conta limpa (fiscal/CDC) */
  paymentYears: number;
  /** DATA_EXPORT_DAILY_LIMIT: cópias dos dados por pessoa por dia */
  exportDaily: number;
  /** LOCATION_FORGET_DAILY_LIMIT: "apagar histórico de localização" por pessoa por dia */
  forgetDaily: number;
}

/** meses que o phone_hash do pedido concluído fica (casa ordem judicial com os access_logs, que ficam 6 meses) */
export const PHONE_HASH_RETENTION_MONTHS = 6;
/** registros de acesso (Marco Civil, art. 15): o mesmo corte do AccessLogService.purgeOld */
export const ACCESS_LOG_RETENTION_MONTHS = 6;
/** denúncia em análise adia a limpeza por este tanto e tenta de novo */
export const HOLD_RETRY_MS = 86_400_000;

function intEnv(raw: string | undefined, def: number, min: number, max: number): number {
  if (raw === undefined || raw.trim() === '') return def;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : def;
}

export function privacyConfig(env: NodeJS.ProcessEnv = process.env): PrivacyConfig {
  return {
    graceDays: intEnv(env.ACCOUNT_DELETION_GRACE_DAYS, ACCOUNT_DELETION_GRACE_DAYS_DEFAULT, 0, 365),
    evidenceDays: intEnv(env.ACCOUNT_EVIDENCE_RETENTION_DAYS, 180, 1, 3650),
    paymentYears: intEnv(env.PAYMENT_RECORDS_RETENTION_YEARS, 5, 1, 20),
    exportDaily: intEnv(env.DATA_EXPORT_DAILY_LIMIT, DATA_EXPORT_DAILY_LIMIT_DEFAULT, 1, 100),
    // baixo de propósito: cada vez zera as âncoras do anti-teleporte
    forgetDaily: intEnv(env.LOCATION_FORGET_DAILY_LIMIT, 3, 1, 100),
  };
}

/** query booleana ('true' / '1' liga; ausente ou qualquer outra coisa = desligado) */
export function parseFlag(v: unknown): boolean {
  return v === true || v === 'true' || v === '1';
}
