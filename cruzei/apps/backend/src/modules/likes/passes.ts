// "Passar" salvo (tabela passes): quem eu passei não volta no DECK por DISCOVERY_PASS_DAYS; o mapa continua mostrando
// (o mapa é presença, não o deck). Passar de novo renova o prazo; "Voltar" apaga a linha; a limpeza diária apaga o que
// venceu (PassesCleanupTask). Nada disso vai mais pro audit_log.
import { DISCOVERY_PASS_DAYS_DEFAULT } from '@cruzei/shared-types';

/**
 * DISCOVERY_PASS_DAYS (env): inteiro de 1 a 365; vazio ou fora disso = DISCOVERY_PASS_DAYS_DEFAULT (30).
 * A MESMA regra do deckPassDays do deck (location/discovery-order): a limpeza nunca apaga um passar ainda valendo.
 */
export function discoveryPassDays(env: NodeJS.ProcessEnv = process.env): number {
  const raw = (env.DISCOVERY_PASS_DAYS ?? '').trim();
  const n = Number(raw);
  return raw && Number.isInteger(n) && n >= 1 && n <= 365 ? n : DISCOVERY_PASS_DAYS_DEFAULT;
}

/** prazo do "Passar" em dias (lido uma vez, na subida) */
export const DISCOVERY_PASS_DAYS = discoveryPassDays();

/** "Voltar" desfaz só o MEU passar mais recente, e até esses minutos depois (não vira um "despassar" de qualquer um) */
export const PASS_UNDO_WINDOW_MIN = 10;

/** passes criados antes disso já venceram (voltam pro deck e a limpeza apaga) */
export function passCutoff(now: Date = new Date(), days: number = DISCOVERY_PASS_DAYS): Date {
  return new Date(now.getTime() - days * 86_400_000);
}
