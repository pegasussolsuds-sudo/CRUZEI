import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const isHttp = exception instanceof HttpException;
    // erros do body-parser (corpo grande demais → 413, JSON quebrado → 400) chegam como Error com status 4xx
    const parserStatus = !isHttp ? Number((exception as { status?: number; statusCode?: number })?.status ?? (exception as { statusCode?: number })?.statusCode) : NaN;
    const clientError = parserStatus >= 400 && parserStatus < 500;
    const status = isHttp ? exception.getStatus() : clientError ? parserStatus : HttpStatus.INTERNAL_SERVER_ERROR;
    const body = isHttp
      ? exception.getResponse()
      : clientError
        ? { error: parserStatus === 413 ? 'payload_too_large' : 'bad_request', message: parserStatus === 413 ? 'Conteúdo grande demais' : 'Requisição inválida' }
        : { message: 'Erro interno' };

    if (status >= 500) {
      this.logger.error(
        `${req.method} ${req.url} → ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
      // só erro do servidor vai pro Sentry (4xx é fluxo normal); sem DSN é no-op. Limpeza em src/instrument.ts
      Sentry.captureException(exception);
    }

    res.status(status).json(
      typeof body === 'string'
        ? { error: body, message: body, status }
        : { ...(body as object), status },
    );
  }
}
