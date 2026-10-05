// Assinatura AWS Signature V4 (S3/R2) só com node:crypto — sem SDK. Referência: "Signature Calculations for the
// Authorization Header: Transferring Payload in a Single Chunk" (S3). Funções internas exportadas pros testes.
import { createHash, createHmac } from 'node:crypto';

export const SIGV4_ALGORITHM = 'AWS4-HMAC-SHA256';
/** sha256 do corpo vazio (GET/HEAD/DELETE) */
export const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

export interface SigV4Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service?: string;
}

export interface SigV4Request {
  method: string;
  url: URL;
  /** headers extras a assinar (content-type, cache-control, range…); host sai da URL */
  headers?: Record<string, string>;
  /** sha256 hex do corpo (ou UNSIGNED-PAYLOAD) */
  payloadHash: string;
}

export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

/** RFC 3986 do jeito do S3: só A-Za-z0-9-_.~ ficam; '/' preservado no caminho; nunca codifica duas vezes */
export function uriEncode(input: string, keepSlash = false): string {
  let out = '';
  for (const byte of Buffer.from(input, 'utf8')) {
    const c = String.fromCharCode(byte);
    if (/[A-Za-z0-9\-_.~]/.test(c) || (keepSlash && c === '/')) out += c;
    else out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

/** YYYYMMDDTHHMMSSZ */
export function amzDate(now: Date): string {
  return now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

/** valor de header canônico: trim + espaços colapsados */
function canonicalValue(v: string): string {
  return v.trim().replace(/\s+/g, ' ');
}

/** query ordenada por chave (e valor), cada parte codificada; '?lifecycle' vira 'lifecycle=' */
export function canonicalQuery(url: URL): string {
  const pairs: [string, string][] = [];
  url.searchParams.forEach((v, k) => pairs.push([uriEncode(k), uriEncode(v)]));
  pairs.sort(([ak, av], [bk, bv]) => (ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0));
  return pairs.map(([k, v]) => `${k}=${v}`).join('&');
}

/** headers em minúsculas, ordenados; devolve o bloco canônico e a lista assinada */
export function canonicalHeaders(headers: Record<string, string>): {
  block: string;
  signed: string;
} {
  const map = new Map<string, string>();
  for (const [k, v] of Object.entries(headers))
    map.set(k.toLowerCase().trim(), canonicalValue(String(v)));
  const names = [...map.keys()].sort();
  return {
    block: names.map((n) => `${n}:${map.get(n)}\n`).join(''),
    signed: names.join(';'),
  };
}

/**
 * Requisição canônica. `path` já vem codificado (URL.pathname de uma URL montada com uriEncode): o S3 não codifica
 * de novo.
 */
export function canonicalRequest(
  method: string,
  path: string,
  query: string,
  headers: Record<string, string>,
  payloadHash: string,
): { text: string; signedHeaders: string } {
  const { block, signed } = canonicalHeaders(headers);
  return {
    text: [method.toUpperCase(), path || '/', query, block, signed, payloadHash].join('\n'),
    signedHeaders: signed,
  };
}

export function credentialScope(date: string, region: string, service: string): string {
  return `${date}/${region}/${service}/aws4_request`;
}

export function stringToSign(amz: string, scope: string, canonical: string): string {
  return [SIGV4_ALGORITHM, amz, scope, sha256Hex(canonical)].join('\n');
}

/** HMAC('AWS4'+secret, data) → região → serviço → 'aws4_request' */
export function signingKey(secret: string, date: string, region: string, service: string): Buffer {
  const kDate = hmac(`AWS4${secret}`, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

/**
 * Assina e devolve os headers a mandar: os extras + x-amz-date, x-amz-content-sha256 e Authorization.
 * O host NÃO volta nos headers (o fetch manda url.host, que é exatamente o que foi assinado).
 */
export function signV4(
  req: SigV4Request,
  cred: SigV4Credentials,
  now: Date = new Date(),
): Record<string, string> {
  const service = cred.service ?? 's3';
  const amz = amzDate(now);
  const date = amz.slice(0, 8);
  const toSign: Record<string, string> = {
    ...(req.headers ?? {}),
    host: req.url.host,
    'x-amz-content-sha256': req.payloadHash,
    'x-amz-date': amz,
  };
  const canon = canonicalRequest(
    req.method,
    req.url.pathname,
    canonicalQuery(req.url),
    toSign,
    req.payloadHash,
  );
  const scope = credentialScope(date, cred.region, service);
  const signature = hmac(
    signingKey(cred.secretAccessKey, date, cred.region, service),
    stringToSign(amz, scope, canon.text),
  ).toString('hex');
  const { host: _host, ...out } = toSign;
  return {
    ...out,
    authorization: `${SIGV4_ALGORITHM} Credential=${cred.accessKeyId}/${scope}, SignedHeaders=${canon.signedHeaders}, Signature=${signature}`,
  };
}
