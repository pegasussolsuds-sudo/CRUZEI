import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { Request, Response } from 'express';
import { resolveRequestLogMode, resolveSlowRequestMs, type RequestLogMode } from '../../config/runtime';

/**
 * Log por requisição, controlado por LOG_REQUESTS (all | slow | off — ver config/runtime.ts).
 * Com milhares de requisições por segundo, logar todas no console (síncrono na thread principal) pesa mais que
 * muita rota: em carga use "slow" (só as lentas e as com erro 5xx).
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  constructor(
    private readonly mode: RequestLogMode = resolveRequestLogMode(),
    private readonly slowMs: number = resolveSlowRequestMs(),
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (this.mode === 'off' || ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<Request>();
    const start = Date.now();
    const done = (status: number) => {
      const ms = Date.now() - start;
      if (this.mode === 'all' || ms >= this.slowMs || status >= 500) {
        const line = `${req.method} ${req.url} → ${ms}ms`;
        if (status >= 500) this.logger.warn(`${line} (${status})`);
        else this.logger.log(line);
      }
    };
    return next.handle().pipe(
      tap({
        next: () => done(ctx.switchToHttp().getResponse<Response>().statusCode ?? 200),
        error: (err: { status?: number; getStatus?: () => number }) => {
          if (this.mode === 'all') return; // no modo "all" o filtro de exceções já registra os 5xx
          done(typeof err?.getStatus === 'function' ? err.getStatus() : (err?.status ?? 500));
        },
      }),
    );
  }
}
