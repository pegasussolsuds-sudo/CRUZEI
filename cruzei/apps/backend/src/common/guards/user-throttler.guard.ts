import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { createHash } from 'node:crypto';

/**
 * Rate limit por USUÁRIO (brief PRIVACIDADE §6): o guard global roda antes do JwtAuthGuard, então `req.user` ainda
 * não existe — a chave é o hash do bearer token (1 token = 1 sessão = 1 pessoa). Sem token, cai no IP.
 * Assim um atacante não zera a cota dos outros atrás do mesmo NAT, e cada conta tem o seu limite de consultas.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const headers = (req.headers ?? {}) as Record<string, string | string[] | undefined>;
    const raw = headers.authorization;
    const auth = Array.isArray(raw) ? raw[0] : raw;
    if (auth && /^Bearer\s+\S+/i.test(auth)) {
      return 'u:' + createHash('sha256').update(auth.slice(7).trim()).digest('hex').slice(0, 32);
    }
    const ips = (req.ips as string[] | undefined) ?? [];
    return 'ip:' + (ips.length ? ips[0] : ((req.ip as string | undefined) ?? 'unknown'));
  }
}
