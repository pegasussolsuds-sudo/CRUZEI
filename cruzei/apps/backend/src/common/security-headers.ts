import type { NextFunction, Request, Response } from 'express';

// Cabeçalhos de segurança sem dependência nova (o que o helmet faria, só o que serve pra uma API JSON).
// Controller que precisa de outra política sobrescreve no próprio handler (ex.: /legal/:slug com <style> inline).

/** API só devolve JSON: nada de script, frame, formulário ou base */
export const API_CSP =
  "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
/** 180 dias; sem includeSubDomains/preload (não trava outros subdomínios do domínio) */
export const HSTS_VALUE = 'max-age=15552000';

export type SecurityHeadersOptions = {
  /** HSTS só em produção (em dev/test a API é http) */
  hsts: boolean;
  /** prefixo da API (v1): só ali entra Cache-Control: no-store */
  apiPrefix: string;
};

export function securityHeaders(opts: SecurityHeadersOptions) {
  const prefix = `/${opts.apiPrefix.replace(/^\/+|\/+$/g, '').toLowerCase()}`;
  return (req: Request, res: Response, next: NextFunction): void => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', API_CSP);
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    if (opts.hsts) res.setHeader('Strict-Transport-Security', HSTS_VALUE);
    // resposta da API tem dado pessoal: nada em cache de proxy/navegador. Só no prefixo — o express.static de
    // /uploads não sobrescreve Cache-Control existente e perderia o cache de 7 dias; tiles e legal põem o próprio
    // o router do express não diferencia maiúsculas: /V1/me também é a API
    const path = (req.path ?? req.url ?? '').toLowerCase();
    if (path === prefix || path.startsWith(`${prefix}/`))
      res.setHeader('Cache-Control', 'no-store');
    next();
  };
}
