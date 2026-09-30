// Contexto da denúncia (de onde saiu, qual conversa/mensagem/foto). Funções PURAS: usadas na gravação
// (ReportsService) e na leitura da moderação (ModerationService), sem um service importar o outro.
import {
  REPORT_CONTEXT_OCCURRENCES_MAX,
  REPORT_SOURCES,
  SYSTEM_REPORT_SOURCES,
  type AnyReportSource,
  type ReportContext,
  type ReportOccurrence,
  type ReportSource,
} from '@cruzei/shared-types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOURCES = new Set<string>(REPORT_SOURCES);
/** gravadas pelo servidor (botão de emergência, filtro de abuso): valem só na LEITURA (fila/ficha da moderação) */
const STORED_SOURCES = new Set<string>([...REPORT_SOURCES, ...SYSTEM_REPORT_SOURCES]);

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

/** lista de conversas da denúncia automática (só gravada): uuids válidos, sem repetir conversa, até o máximo */
export function contextOccurrences(c: unknown): ReportOccurrence[] {
  if (!c || typeof c !== 'object') return [];
  const raw = (c as { occurrences?: unknown }).occurrences;
  if (!Array.isArray(raw)) return [];
  const out: ReportOccurrence[] = [];
  const seen = new Set<string>();
  for (const o of raw) {
    if (out.length >= REPORT_CONTEXT_OCCURRENCES_MAX) break;
    if (!o || typeof o !== 'object') continue;
    const conversationId = uuidOf((o as { conversationId?: unknown }).conversationId);
    if (!conversationId || seen.has(conversationId)) continue;
    seen.add(conversationId);
    const messageId = uuidOf((o as { messageId?: unknown }).messageId);
    out.push(messageId ? { conversationId, messageId } : { conversationId });
  }
  return out;
}

/** todas as conversas citadas (a do contexto + as da lista do filtro automático), sem repetir; minúsculas */
export function contextConversationIds(c: unknown): string[] {
  const first = contextConversationId(c);
  const ids = [...(first ? [first] : []), ...contextOccurrences(c).map((o) => o.conversationId)];
  return [...new Set(ids)];
}

/**
 * só campos conhecidos e uuids válidos; o formato antigo (matchId, origem 'matches') vira o de hoje.
 * `stored: true` = lendo o que está gravado (aceita também as origens de sistema 'emergency'/'auto_filter'); sem ele
 * é entrada do app, que nunca escolhe origem de sistema.
 */
export function sanitizeContext(
  c: ReportContextInput | null | undefined,
  opts: { stored?: boolean } = {},
): ReportContext | null {
  if (!c || typeof c !== 'object') return null;
  const raw = typeof c.source === 'string' ? c.source : '';
  const source = LEGACY_SOURCE_MAP.get(raw) ?? raw;
  if (!(opts.stored ? STORED_SOURCES : SOURCES).has(source)) return null;
  const out: ReportContext = { source: source as AnyReportSource };
  const conversationId = contextConversationId(c);
  if (conversationId) out.conversationId = conversationId;
  if (typeof c.messageId === 'string' && UUID.test(c.messageId)) out.messageId = c.messageId;
  if (typeof c.photoId === 'string' && UUID.test(c.photoId)) out.photoId = c.photoId;
  // lista do filtro automático: só o servidor grava (o app nunca manda)
  const occurrences = opts.stored ? contextOccurrences(c) : [];
  if (occurrences.length) out.occurrences = occurrences;
  return out;
}
