import type { AdminAuditEntry, AdminAuditList, UserRole } from '@cruzei/shared-types';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';

import { cursorTs, decodeCursor, encodeCursor, pageSize } from './cursor';

export type AuditTargetKind = NonNullable<AdminAuditEntry['target']>['kind'];

export interface AuditTarget {
  kind: AuditTargetKind;
  id: string;
}

/**
 * Trilha do painel: as ações novas vão pro audit_log (append-only) com action 'admin.*' e metadata
 * { target: {kind, id}, detail, ... }. A leitura junta com moderation_actions (banir, suspender, fotos...).
 */
@Injectable()
export class AuditService {
  private readonly log = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** grava a ação; falha de gravação não desfaz a ação (fica no log do servidor) */
  async record(
    actorId: string,
    action: `admin.${string}`,
    target: AuditTarget | null,
    detail: string | null,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: actorId,
          action: action.slice(0, 100),
          metadata: {
            ...extra,
            target,
            detail: detail?.slice(0, 500) ?? null,
          } as Prisma.InputJsonValue,
        },
      });
    } catch (e) {
      this.log.error(`auditoria não gravada (${action}): ${(e as Error).message}`);
    }
  }

  async list(q: {
    actorId?: string;
    targetId?: string;
    action?: string;
    cursor?: string;
    limit?: unknown;
  }): Promise<AdminAuditList> {
    const limit = pageSize(q.limit, 50, 200);
    const cur = decodeCursor(q.cursor, 2);
    const where: Prisma.Sql[] = [];
    if (q.actorId) where.push(Prisma.sql`x.actor_id = ${q.actorId}::uuid`);
    if (q.targetId) where.push(Prisma.sql`x.target_id = ${q.targetId}`);
    if (q.action)
      where.push(Prisma.sql`x.action LIKE ${q.action.replace(/[%_\\]/g, '\\$&') + '%'}`);
    if (cur)
      where.push(
        Prisma.sql`(x.at, x.id) < ((${cursorTs(cur[0])}::timestamp AT TIME ZONE 'UTC'), ${cur[1]})`,
      );
    const cond = where.length ? Prisma.sql`WHERE ${Prisma.join(where, ' AND ')}` : Prisma.empty;
    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        at: Date;
        cursor_at: string;
        actor_id: string | null;
        action: string;
        target_kind: string | null;
        target_id: string | null;
        detail: string | null;
      }[]
    >`
      SELECT x.*, to_char(x.at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS cursor_at FROM (
        SELECT 'm' || m.id::text AS id, m.created_at AT TIME ZONE 'UTC' AS at, m.moderator_id AS actor_id,
               'moderation.' || m.action AS action, 'user' AS target_kind, m.target_user_id::text AS target_id, m.note AS detail
          FROM moderation_actions m
        UNION ALL
        SELECT 'a' || a.id::text, a.created_at AT TIME ZONE 'UTC', a.user_id, a.action,
               a.metadata->'target'->>'kind', a.metadata->'target'->>'id', a.metadata->>'detail'
          FROM audit_log a WHERE a.action LIKE 'admin.%'
      ) x
      ${cond}
      ORDER BY x.at DESC, x.id DESC
      LIMIT ${limit + 1}`;
    const page = rows.slice(0, limit);
    const labels = await this.labels(page);
    const actorIds = [...new Set(page.map((r) => r.actor_id).filter((v): v is string => !!v))];
    const actors = new Map(
      (
        await this.prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, name: true, role: true },
        })
      ).map((u) => [u.id, u]),
    );
    const items: AdminAuditEntry[] = page.map((r) => {
      const a = r.actor_id ? actors.get(r.actor_id) : undefined;
      const kind = r.target_kind as AuditTargetKind | null;
      return {
        id: r.id,
        at: r.at.toISOString(),
        actor: a ? { id: a.id, name: a.name, role: a.role as UserRole } : null,
        action: r.action,
        target:
          kind && r.target_id
            ? { kind, id: r.target_id, label: labels.get(`${kind}:${r.target_id}`) ?? null }
            : null,
        detail: r.detail,
      };
    });
    const last = page[page.length - 1];
    return {
      items,
      nextCursor: rows.length > limit && last ? encodeCursor([last.cursor_at, last.id]) : null,
    };
  }

  /** nome legível de cada alvo (pessoa, evento, campanha, lugar, candidato, atendimento), numa consulta por tipo */
  private async labels(
    rows: { target_kind: string | null; target_id: string | null }[],
  ): Promise<Map<string, string>> {
    const by = new Map<string, Set<string>>();
    for (const r of rows) {
      if (!r.target_kind || !r.target_id) continue;
      const s = by.get(r.target_kind) ?? new Set<string>();
      s.add(r.target_id);
      by.set(r.target_kind, s);
    }
    const out = new Map<string, string>();
    const uuids = (k: string) => [...(by.get(k) ?? [])].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
    const ints = (k: string) =>
      [...(by.get(k) ?? [])].filter((id) => /^\d{1,18}$/.test(id)).map((id) => BigInt(id));
    const put = (kind: string, list: { id: string | bigint; label: string }[]) =>
      list.forEach((x) => out.set(`${kind}:${String(x.id)}`, x.label));
    const users = uuids('user');
    if (users.length)
      put(
        'user',
        (
          await this.prisma.user.findMany({
            where: { id: { in: users } },
            select: { id: true, name: true },
          })
        ).map((u) => ({ id: u.id, label: u.name })),
      );
    const events = uuids('event');
    if (events.length)
      put(
        'event',
        (
          await this.prisma.event.findMany({
            where: { id: { in: events } },
            select: { id: true, title: true },
          })
        ).map((e) => ({ id: e.id, label: e.title })),
      );
    const campaigns = uuids('campaign');
    if (campaigns.length)
      put(
        'campaign',
        (
          await this.prisma.pushCampaign.findMany({
            where: { id: { in: campaigns } },
            select: { id: true, title: true },
          })
        ).map((c) => ({ id: c.id, label: c.title })),
      );
    const pois = ints('poi');
    if (pois.length)
      put(
        'poi',
        (
          await this.prisma.pOI.findMany({
            where: { id: { in: pois } },
            select: { id: true, name: true },
          })
        ).map((p) => ({ id: p.id, label: p.name })),
      );
    const cands = ints('candidate');
    if (cands.length) {
      const rows2 = await this.prisma.$queryRaw<
        { id: bigint; name: string }[]
      >`SELECT id, name FROM place_candidates WHERE id = ANY(${cands}::bigint[])`;
      put(
        'candidate',
        rows2.map((c) => ({ id: c.id, label: c.name })),
      );
    }
    const threads = uuids('support');
    if (threads.length) {
      const rows3 = await this.prisma.$queryRaw<{ id: string; name: string }[]>`
        SELECT t.id::text AS id, u.name FROM support_threads t JOIN users u ON u.id = t.user_id WHERE t.id = ANY(${threads}::uuid[])`;
      put(
        'support',
        rows3.map((t) => ({ id: t.id, label: `Atendimento de ${t.name}` })),
      );
    }
    return out;
  }
}
