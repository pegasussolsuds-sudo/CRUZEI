// Contexto da denúncia (de onde saiu, qual conversa/mensagem/foto). Funções PURAS: usadas na gravação
// (ReportsService) e na leitura da moderação (ModerationService), sem um service importar o outro.
import { REPORT_SOURCES, type ReportContext, type ReportSource } from '@cruzei/shared-types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOURCES = new Set<string>(REPORT_SOURCES);

/** origens de antes da inbox (aba "Matches") → a de hoje */
export const LEGACY_REPORT_SOURCES = ['matches'] as const;
export type LegacyReportSource = (typeof LEGACY_REPORT_SOURCES)[number];
const LEGACY_SOURCE_MAP = new Map<string, ReportSource>([['matches', 'inbox']]);

/**
 * Contexto como chega do app (o de hoje ou o de um build antigo) ou como está gravado em denúncias de antes da
 * inbox: origem 'matches' e matchId no lugar de conversationId.
 */
export type ReportContextInput = Omit<ReportContext, 'source'> & {
  source: ReportSource | LegacyReportSource;
  /** antigo: a migração da inbox criou cada conversa com o MESMO id do match (conversation.id = match.id) */
  matchId?: string;
};

const uuidOf = (v: unknown): string | null =>
  typeof v === 'string' && UUID.test(v) ? v.toLowerCase() : null;

/** conversa citada na denúncia: conversationId ou, em denúncia antiga, o matchId (mesmo id); minúsculas */
export function contextConversationId(c: unknown): string | null {
  if (!c || typeof c !== 'object') return null;
  const r = c as { conversationId?: unknown; matchId?: unknown };
  return uuidOf(r.conversationId) ?? uuidOf(r.matchId);
}

/** só campos conhecidos e uuids válidos; o formato antigo (matchId, origem 'matches') vira o de hoje */
export function sanitizeContext(c: ReportContextInput | null | undefined): ReportContext | null {
  if (!c || typeof c !== 'object') return null;
  const raw = typeof c.source === 'string' ? c.source : '';
  const source = LEGACY_SOURCE_MAP.get(raw) ?? raw;
  if (!SOURCES.has(source)) return null;
  const out: ReportContext = { source: source as ReportSource };
  const conversationId = contextConversationId(c);
  if (conversationId) out.conversationId = conversationId;
  if (typeof c.messageId === 'string' && UUID.test(c.messageId)) out.messageId = c.messageId;
  if (typeof c.photoId === 'string' && UUID.test(c.photoId)) out.photoId = c.photoId;
  return out;
}
