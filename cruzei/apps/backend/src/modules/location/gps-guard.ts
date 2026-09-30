// GPS falso: estado no Redis + aviso pra moderação. A decisão é pura (anti-spoof.ts); aqui só leitura/escrita.
//
// Chaves (todas por pessoa, nada de trilha):
//   loc:anchor:<id>   última posição ACEITA, GROSSEIRA (3 casas ≈ 110 m) + horário + precisão — TTL 12 h; campos w*
//                     = âncora da janela (posição aceita de alguns minutos atrás, também grosseira): velocidade acumulada
//   loc:pending:<id>  posição nova depois de um salto, esperando confirmação (grosseira) — TTL 12 h
//   loc:flag:<id>     'mock' | 'teleport': escondida e sem ver ninguém agora — TTL 15 min (um fix bom apaga)
//   gps:strikes:<id>:<tipo>  episódios nas últimas 24 h
//   gps:flagged:<id>  já foi pra fila da moderação nas últimas 24 h (uma denúncia automática por dia)
//   gps:shadow:<dia>  modo shadow: só contagem por motivo (sem id, sem coordenada)
// A denúncia automática não tem denunciante nem coordenada: só o tipo e quantas vezes (ver autoReportText).
import { Logger } from '@nestjs/common';

import type { PrismaService } from '../../database/prisma.service';
import type { RedisService } from '../../redis/redis.service';

import {
  GPS_GUARD,
  autoReportText,
  nextWindow,
  strikeLimit,
  type AcceptReason,
  type Fix,
  type GuardConfig,
  type GuardDecision,
  type GuardFlag,
  type GuardState,
} from './anti-spoof';
import { coarse, localDateBrazil } from './discovery-privacy';

export const GPS_KEYS = {
  anchor: (id: string) => `loc:anchor:${id}`,
  pending: (id: string) => `loc:pending:${id}`,
  flag: (id: string) => `loc:flag:${id}`,
  strikes: (id: string, kind: GuardFlag) => `gps:strikes:${id}:${kind}`,
  flagged: (id: string) => `gps:flagged:${id}`,
  shadow: (day: string) => `gps:shadow:${day}`,
};

type HoldDecision = Extract<GuardDecision, { action: 'hold' }>;

/** `p` = prefixo dos campos ('' = âncora/pendente; 'w' = âncora da janela, no mesmo hash da âncora) */
export function parseFix(m: Record<string, string> | null | undefined, p = ''): Fix | null {
  const la = m?.[`${p}la`];
  const lo = m?.[`${p}lo`];
  const t = m?.[`${p}t`];
  if (!la || !lo || !t) return null;
  const f = { lat: Number(la), lng: Number(lo), t: Number(t), acc: Number(m?.[`${p}a`] ?? 0) };
  return Number.isFinite(f.lat) && Number.isFinite(f.lng) && Number.isFinite(f.t)
    ? { ...f, acc: Number.isFinite(f.acc) ? f.acc : 0 }
    : null;
}

/** só a grade grosseira vai pro Redis — nunca uma cópia precisa nova da posição */
export function fixFields(f: Fix, p = ''): Record<string, string> {
  return {
    [`${p}la`]: String(coarse(f.lat)),
    [`${p}lo`]: String(coarse(f.lng)),
    [`${p}t`]: String(Math.round(f.t)),
    [`${p}a`]: String(Math.round(Math.max(0, f.acc))),
  };
}

export function parseFlag(v: string | null | undefined): GuardFlag | null {
  return v === 'mock' || v === 'teleport' ? v : null;
}

export class GpsGuard {
  private readonly log = new Logger('GpsGuard');

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly cfg: GuardConfig = GPS_GUARD,
  ) {}

  /** âncora + pendente + aviso numa ida só (vai em paralelo com a leitura do usuário no update) */
  async read(userId: string): Promise<GuardState> {
    const res = await this.redis.client
      .pipeline()
      .hgetall(GPS_KEYS.anchor(userId))
      .hgetall(GPS_KEYS.pending(userId))
      .get(GPS_KEYS.flag(userId))
      .exec();
    const val = (i: number) => (res?.[i]?.[0] ? null : res?.[i]?.[1]);
    const anchor = val(0) as Record<string, string> | null;
    return {
      anchor: parseFix(anchor),
      win: parseFix(anchor, 'w'),
      pending: parseFix(val(1) as Record<string, string> | null),
      flag: parseFlag(val(2) as string | null),
    };
  }

  /** aviso ativo de quem consulta (descoberta): com aviso, não vê ninguém */
  async flag(userId: string): Promise<GuardFlag | null> {
    return parseFlag(await this.redis.client.get(GPS_KEYS.flag(userId)));
  }

  /** posição aceita: vira a âncora (grosseira) e a janela anda se for a hora (nextWindow); pendente e aviso somem */
  accepted(
    userId: string,
    fix: Fix,
    state: GuardState,
    reason: AcceptReason = 'ok',
  ): Promise<unknown> {
    const fields = {
      ...fixFields(fix),
      ...fixFields(nextWindow(state, fix, reason, this.cfg), 'w'),
    };
    const m = this.redis.client
      .multi()
      .hset(GPS_KEYS.anchor(userId), fields)
      .expire(GPS_KEYS.anchor(userId), this.cfg.STATE_TTL_S);
    if (state.pending) m.del(GPS_KEYS.pending(userId));
    if (state.flag) m.del(GPS_KEYS.flag(userId));
    return m.exec();
  }

  /**
   * posição segurada: esconde a presença antiga na hora (só na transição; todos os processos esquecem), marca o aviso,
   * guarda o pendente novo e conta o episódio
   */
  async hold(userId: string, d: HoldDecision, state: GuardState): Promise<void> {
    if (state.flag !== d.reason) await this.redis.markPresenceHidden(userId);
    const m = this.redis.client
      .multi()
      .set(GPS_KEYS.flag(userId), d.reason, 'EX', this.cfg.FLAG_TTL_S);
    if (d.pending)
      m.hset(GPS_KEYS.pending(userId), fixFields(d.pending)).expire(
        GPS_KEYS.pending(userId),
        this.cfg.STATE_TTL_S,
      );
    await m.exec();
    if (d.strike) await this.strike(userId, d.strike);
  }

  /** conta um episódio; no limite de 24 h, manda pra fila da moderação (sem banir nem esconder por conta) */
  async strike(userId: string, kind: GuardFlag): Promise<number> {
    const key = GPS_KEYS.strikes(userId, kind);
    const n = await this.redis.client.incr(key);
    if (n === 1) await this.redis.client.expire(key, this.cfg.STRIKE_WINDOW_S);
    if (n >= strikeLimit(kind, this.cfg)) await this.flagForReview(userId, kind, n);
    return n;
  }

  /** denúncia automática (sem denunciante, sem coordenada) + trilha 'auto_flag_gps' — no máximo uma por pessoa em 24 h */
  async flagForReview(userId: string, kind: GuardFlag, count: number): Promise<boolean> {
    if (
      (await this.redis.client.set(
        GPS_KEYS.flagged(userId),
        kind,
        'EX',
        this.cfg.STRIKE_WINDOW_S,
        'NX',
      )) !== 'OK'
    )
      return false;
    const description = autoReportText(kind, count);
    try {
      const report = await this.prisma.report.create({
        data: {
          reporterId: null,
          reportedId: userId,
          reason: 'fake',
          priority: 1,
          description,
          context: { source: 'map' },
        },
        select: { id: true },
      });
      await this.prisma.moderationAction.create({
        data: {
          moderatorId: null,
          targetUserId: userId,
          action: 'auto_flag_gps',
          reportId: report.id,
          note: description,
        },
      });
      this.log.warn(
        `GPS suspeito (${kind}, ${count} em 24 h): ${userId} foi pra fila da moderação`,
      );
      return true;
    } catch (e) {
      // não conseguiu gravar: libera pra tentar no próximo episódio
      await this.redis.client.del(GPS_KEYS.flagged(userId)).catch(() => undefined);
      this.log.warn(`denúncia automática de GPS falhou: ${(e as Error).message}`);
      return false;
    }
  }

  /** modo shadow: só conta o que faria, por dia e motivo (calibragem do beta) */
  async shadow(reason: string): Promise<void> {
    const key = GPS_KEYS.shadow(localDateBrazil());
    await this.redis.client
      .multi()
      .hincrby(key, reason, 1)
      .expire(key, 8 * 86_400)
      .exec();
  }
}
