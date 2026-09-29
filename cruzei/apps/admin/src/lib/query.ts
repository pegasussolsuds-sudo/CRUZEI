// Query string sem campos vazios (o backend valida com forbidNonWhitelisted: nada de "?q=&status=")
export type QueryValue = string | number | boolean | null | undefined;
export type QueryParams = Record<string, QueryValue>;

export function buildQuery(params: QueryParams | undefined): string {
  if (!params) return '';
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const s = typeof v === 'string' ? v.trim() : String(v);
    if (s === '') continue;
    sp.set(k, s);
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : '';
}

/**
 * Mensagem pronta do próprio Nest, em inglês: lista do class-validator ("limit must be a number", "property x should
 * not exist"), pipes ("Validation failed (uuid is expected)"), rota inexistente ("Cannot GET /v1/…") e os textos
 * padrão das exceções sem mensagem. O painel mostra a mensagem padrão em português no lugar.
 */
const FRAMEWORK_MESSAGE = /^(Validation failed\b|Cannot (GET|POST|PATCH|PUT|DELETE) \/|ThrottlerException\b|(Bad Request|Unauthorized|Forbidden|Forbidden resource|Not Found|Conflict|Internal server error|Too Many Requests)$)/i;

/** texto de erro da API: as mensagens do Metch já vêm em pt-BR; as do framework (em inglês) viram null */
export function messageFromBody(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const msg = (body as { message?: unknown }).message;
  // lista = class-validator (o backend não tem mensagem própria em DTO): sempre o texto padrão em inglês
  if (Array.isArray(msg)) return null;
  if (typeof msg === 'string' && msg.trim() && !FRAMEWORK_MESSAGE.test(msg.trim())) return msg;
  return null;
}

/**
 * O que fazer com a resposta do /auth/refresh: só 401/403 (token recusado, conta bloqueada) encerram a sessão.
 * Sem rede, 5xx, 429… a sessão fica: o painel avisa "sem conexão" e tenta de novo depois.
 */
export type RefreshOutcome = 'ok' | 'denied' | 'unavailable';

export function refreshOutcome(status: number | 'network'): RefreshOutcome {
  if (status === 'network') return 'unavailable';
  if (status >= 200 && status < 300) return 'ok';
  if (status === 401 || status === 403) return 'denied';
  return 'unavailable';
}
