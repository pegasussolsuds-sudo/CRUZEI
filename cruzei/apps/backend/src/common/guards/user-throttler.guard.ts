import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Optional,
  SetMetadata,
  type ExecutionContext,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerGuard } from '@nestjs/throttler';

/** corpo do 429 (mesmo formato dos outros erros da API) */
export interface ThrottleBody {
  error: string;
  message: string;
}

export const THROTTLE_MESSAGE_KEY = 'metch:throttle-message';

/** 429 próprio da rota (junto do @Throttle): troca o "Muitas tentativas" genérico */
export const ThrottleMessage = (body: ThrottleBody) => SetMetadata(THROTTLE_MESSAGE_KEY, body);

/** chave do rate limit por IP (o primeiro de req.ips quando o Express confia no proxy) */
export function ipTracker(req: Record<string, unknown>): string {
  const ips = (req.ips as string[] | undefined) ?? [];
  return 'ip:' + (ips.length ? ips[0] : ((req.ip as string | undefined) ?? 'unknown'));
}

/** /auth/* (login, SMS, cadastro, claim, refresh): nenhuma conta foi provada ali, então é sempre por IP */
export function isAuthRoute(req: Record<string, unknown>): boolean {
  const url = String(req.originalUrl ?? req.url ?? '');
  // com ou sem o prefixo global (v1)
  return /^\/(?:[^/?]+\/)?auth(?:[/?]|$)/i.test(url);
}

/** token do header Authorization: Bearer (ou null) */
export function bearerOf(req: Record<string, unknown>): string | null {
  const headers = (req.headers ?? {}) as Record<string, string | string[] | undefined>;
  const raw = headers.authorization;
  const auth = Array.isArray(raw) ? raw[0] : raw;
  const m = auth ? /^Bearer\s+(\S+)/i.exec(auth) : null;
  return m ? m[1] : null;
}

/**
 * Chave do rate limit: 'u:<userId>' só com um access token de assinatura válida e não vencido; qualquer outra coisa
 * (sem token, token inventado/vencido, refresh, e toda rota /auth/*) cai no IP. Nunca usa um Bearer sem verificar:
 * senão cada token inventado virava uma cota nova e a força bruta não tinha limite.
 * `verify` devolve o payload do JWT ou lança.
 */
export function resolveTracker(
  req: Record<string, unknown>,
  verify: (token: string) => { sub?: unknown; typ?: unknown },
): string {
  if (isAuthRoute(req)) return ipTracker(req);
  const token = bearerOf(req);
  if (!token) return ipTracker(req);
  try {
    const p = verify(token);
    // refresh (mesmo segredo) não autentica nada: não ganha cota de usuário
    if (typeof p.sub === 'string' && p.sub && p.typ !== 'refresh') return 'u:' + p.sub;
  } catch {
    /* assinatura errada ou vencido: IP */
  }
  return ipTracker(req);
}

/**
 * Rate limit por USUÁRIO (brief PRIVACIDADE §6): o guard global roda antes do JwtAuthGuard, então `req.user` ainda
 * não existe — o guard confere o Bearer aqui (assinatura + validade) e usa o id da conta (trocar de token não zera a
 * cota). Sem token válido, cai no IP. Assim um atacante não zera a cota dos outros atrás do mesmo NAT, e cada conta
 * tem o seu limite de consultas.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  @Optional() @Inject(ConfigService) private readonly cfg?: ConfigService;
  private jwt: JwtService | null = null;
  /** o getTracker roda uma vez por throttler: confere o token uma vez só por pedido */
  private readonly memo = new WeakMap<object, string>();

  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const hit = this.memo.get(req);
    if (hit) return hit;
    this.jwt ??= new JwtService({ secret: this.cfg?.get<string>('jwt.secret') });
    const jwt = this.jwt;
    const t = resolveTracker(req, (token) => jwt.verify(token));
    this.memo.set(req, t);
    return t;
  }

  // 429 em pt-BR e no mesmo formato do cooldown do SMS (o padrão é "ThrottlerException: Too Many Requests"); a rota
  // pode trocar o corpo com @ThrottleMessage (ex.: emergência lembra do 190)
  protected async throwThrottlingException(context?: ExecutionContext): Promise<void> {
    const custom = context
      ? this.reflector.getAllAndOverride<ThrottleBody | undefined>(THROTTLE_MESSAGE_KEY, [
          context.getHandler(),
          context.getClass(),
        ])
      : undefined;
    throw new HttpException(
      custom ?? {
        error: 'too_many_requests',
        message: 'Muitas tentativas. Espera um minuto e tenta de novo.',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
