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

/** texto de erro da API: Nest manda message string ou lista (class-validator) */
export function messageFromBody(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const msg = (body as { message?: unknown }).message;
  if (typeof msg === 'string' && msg.trim()) return msg;
  if (Array.isArray(msg)) {
    const parts = msg.filter((m): m is string => typeof m === 'string' && !!m.trim());
    if (parts.length) return parts.join(' · ');
  }
  return null;
}
