import { REPORT_THROTTLE } from '../reports/reports.controller';

// Limites do botão de emergência (puros, testados em emergency.service.spec.ts / emergency.controller.spec.ts).

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * POST /safety/emergency por conta: 3 por hora ('default') e 10 por dia ('strict' — só vale onde a rota declara). A 1ª
 * vez já pausa, chama a equipe e toca o alarme; repetir não ajuda ninguém e virava jeito de inundar a fila.
 */
export const EMERGENCY_THROTTLE = {
  default: { ttl: HOUR_MS, limit: 3 },
  strict: { ttl: DAY_MS, limit: 10 },
};

/** pessoas DIFERENTES que o botão denuncia por dia (a mesma pessoa de novo reaproveita a denúncia pendente) */
export const EMERGENCY_REPORT_TARGETS_PER_DAY = 3;

/**
 * por que a denúncia de emergência não saiu: 'hour' = orçamento das denúncias do app estourado (REPORT_THROTTLE,
 * contando TODAS as da última hora, do app e do botão); 'targets' = já denunciou EMERGENCY_REPORT_TARGETS_PER_DAY
 * pessoas diferentes pelo botão nas últimas 24 h
 */
export type EmergencyReportSkip = 'hour' | 'targets';

export function emergencyReportSkip(p: {
  reportsLastHour: number;
  otherTargetsToday: number;
}): EmergencyReportSkip | null {
  if (p.reportsLastHour >= REPORT_THROTTLE.default.limit) return 'hour';
  if (p.otherTargetsToday >= EMERGENCY_REPORT_TARGETS_PER_DAY) return 'targets';
  return null;
}

/** janela do orçamento de denúncias (a mesma do REPORT_THROTTLE) e a dos alvos distintos */
export const REPORT_BUDGET_WINDOW_MS = REPORT_THROTTLE.default.ttl;
export const EMERGENCY_TARGETS_WINDOW_MS = DAY_MS;
