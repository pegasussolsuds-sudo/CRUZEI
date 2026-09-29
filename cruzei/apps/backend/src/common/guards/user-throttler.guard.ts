import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { createHash } from 'node:crypto';

/** chave do rate limit por IP (o primeiro de req.ips quando o Express confia no proxy) */
export function ipTracker(req: Record<string, unknown>): string {
  const ips = (req.ips as string[] | undefined) ?? [];
  return 'ip:' + (ips.length ? ips[0] : ((req.ip as string | undefined) ?? 'unknown'));
}

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
    return ipTracker(req);
  }

  // 429 em pt-BR e no mesmo formato do cooldown do SMS (o padrão é "ThrottlerException: Too Many Requests")
  protected async throwThrottlingException(): Promise<void> {
    throw new HttpException(
      { error: 'too_many_requests', message: 'Muitas tentativas. Espera um minuto e tenta de novo.' },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
