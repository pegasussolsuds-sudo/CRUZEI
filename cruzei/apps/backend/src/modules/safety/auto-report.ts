import {
  REPORT_CONTEXT_OCCURRENCES_MAX,
  type ReportContext,
  type ReportOccurrence,
} from '@cruzei/shared-types';
import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type { PrismaService } from '../../database/prisma.service';

// Denúncia automática do filtro de abuso: golpe numa mensagem (Pix, pagamento, link encurtado…). A mensagem PASSA
// (não é bloqueada); a moderação recebe uma denúncia 'scam' sem denunciante (reporter_id NULL), context.source
// 'auto_filter', apontando a conversa e a mensagem. Dedupe no banco: no máximo UMA pendente por pessoa+motivo
// (índice único parcial reports_auto_filter_pending_uq); repetir soma o trecho novo à descrição e a conversa nova à
// lista context.occurrences (uma entrada por conversa, até REPORT_CONTEXT_OCCURRENCES_MAX) — a ficha abre cada uma.

const log = new Logger('AbuseFilter');

/** mesma prioridade da denúncia de golpe feita por gente (REPORT_PRIORITY.scam) */
export const AUTO_FILTER_PRIORITY = 1;
const DESCRIPTION_MAX = 2000;
const SEP = '\n—\n';

export interface AutoReportInput {
  /** quem mandou a mensagem */
  reportedId: string;
  conversationId: string | null;
  messageId: string | null;
  /** trecho normalizado que o filtro achou (sem localização, sem dado da outra pessoa) */
  match: string;
}

/** trecho entre aspas, curto (é ele que o dedupe procura na descrição) */
function quoted(match: string): string {
  return `"${match.length > 120 ? `${match.slice(0, 117)}…` : match}"`;
}

export function autoReportDescription(match: string): string {
  return `Filtro automático: possível golpe numa mensagem (${quoted(match)})`;
}

/** a conversa (e a mensagem) desta ocorrência; sem conversa não entra na lista */
export function autoReportOccurrence(p: AutoReportInput): ReportOccurrence | null {
  if (!p.conversationId) return null;
  return p.messageId
    ? { conversationId: p.conversationId, messageId: p.messageId }
    : { conversationId: p.conversationId };
}

/** contexto da 1ª ocorrência (conversationId/messageId no topo continuam valendo pra quem lê o formato antigo) */
export function autoReportContext(p: AutoReportInput): ReportContext {
  const occ = autoReportOccurrence(p);
  return {
    source: 'auto_filter',
    ...(p.conversationId ? { conversationId: p.conversationId } : {}),
    ...(p.messageId ? { messageId: p.messageId } : {}),
    ...(occ ? { occurrences: [occ] } : {}),
  };
}

// lista já gravada; pendente de antes da lista (só conversationId/messageId) vira a 1ª entrada
const PREV_OCCURRENCES = Prisma.sql`COALESCE(reports.context -> 'occurrences',
  CASE WHEN (reports.context ->> 'conversationId') IS NOT NULL
    THEN jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'conversationId', reports.context -> 'conversationId', 'messageId', reports.context -> 'messageId')))
    ELSE '[]'::jsonb END)`;

/** INSERT da denúncia ou soma à pendente (trecho novo na descrição, conversa nova na lista) — exportado pro teste */
export function autoReportSql(p: AutoReportInput): Prisma.Sql {
  const context = autoReportContext(p);
  const occ = autoReportOccurrence(p);
  const occJson = occ ? JSON.stringify(occ) : null;
  const description = autoReportDescription(p.match);
  // repetição: soma só o trecho novo; o mesmo trecho de novo não muda nada
  const q = quoted(p.match);
  const more = `de novo: ${q}`;
  return Prisma.sql`
    INSERT INTO reports (id, reporter_id, reported_id, reason, description, priority, context, created_at)
    VALUES (gen_random_uuid(), NULL, ${p.reportedId}::uuid, 'scam', ${description}, ${AUTO_FILTER_PRIORITY}::smallint,
            ${JSON.stringify(context)}::jsonb, (now() AT TIME ZONE 'UTC'))
    ON CONFLICT (reported_id, reason)
      WHERE status = 'pending' AND reporter_id IS NULL AND (context ->> 'source') = 'auto_filter'
    DO UPDATE SET
      description = CASE
        WHEN position(${q} IN COALESCE(reports.description, '')) > 0 THEN reports.description
        ELSE left(COALESCE(reports.description || ${SEP}, '') || ${more}, ${DESCRIPTION_MAX}::int)
      END,
      -- conversa nova entra na lista (uma entrada por conversa, até o máximo); a mesma conversa não repete
      context = CASE
        WHEN ${occJson}::jsonb IS NULL
          OR ${PREV_OCCURRENCES} @> jsonb_build_array(jsonb_build_object('conversationId', ${p.conversationId}::text))
          OR jsonb_array_length(${PREV_OCCURRENCES}) >= ${REPORT_CONTEXT_OCCURRENCES_MAX}::int
        THEN reports.context
        ELSE jsonb_set(reports.context, '{occurrences}', ${PREV_OCCURRENCES} || jsonb_build_array(${occJson}::jsonb))
      END
    RETURNING id::text AS id, (xmax = 0) AS created`;
}

/** grava (ou soma à pendente) a denúncia automática; nunca lança: falha vira log (o envio já aconteceu) */
export async function autoReportScam(
  db: PrismaService | Prisma.TransactionClient,
  p: AutoReportInput,
): Promise<{ id: string; created: boolean } | null> {
  try {
    const rows = await db.$queryRaw<{ id: string; created: boolean }[]>(autoReportSql(p));
    const r = rows[0];
    if (r?.created) log.log(`denúncia automática (golpe) contra ${p.reportedId}: ${r.id}`);
    return r ?? null;
  } catch (e) {
    log.warn(`denúncia automática falhou (${p.reportedId}): ${(e as Error).message}`);
    return null;
  }
}
