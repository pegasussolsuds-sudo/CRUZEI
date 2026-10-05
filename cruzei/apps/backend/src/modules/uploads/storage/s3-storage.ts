// Driver S3/R2 sem SDK: fetch nativo (Node 20) + SigV4 próprio. Path-style por padrão (o R2 exige); com
// forcePathStyle=false usa virtual-host (<bucket>.<host>) da AWS. Retry em erro de rede, 5xx e 429; 403 e outros 4xx
// não repetem. Mensagem de erro leva método, status, <Code> e a chave — nunca headers nem segredo.
import { assertKey } from './assert-key';
import type { ObjectStorage } from './object-storage';
import { EMPTY_SHA256, sha256Hex, signV4, uriEncode } from './sigv4';

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  cacheControl: string;
}

export interface S3Deps {
  fetch?: typeof fetch;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /** por tentativa (padrão 15 s) */
  timeoutMs?: number;
  /** tentativas no total (padrão 3) */
  attempts?: number;
}

/** teto de leitura (as fotos saem com até ~1 MB) */
const MAX_GET_BYTES = 20 * 1024 * 1024;

export class StorageRequestError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code: string | null,
  ) {
    super(message);
    this.name = 'StorageRequestError';
  }
}

const retryable = (status: number) => status >= 500 || status === 429;

export class S3ObjectStorage implements ObjectStorage {
  readonly driver = 's3' as const;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timeoutMs: number;
  private readonly attempts: number;

  constructor(
    private readonly cfg: S3Config,
    deps: S3Deps = {},
  ) {
    this.fetchImpl = deps.fetch ?? fetch;
    this.now = deps.now ?? (() => new Date());
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.timeoutMs = deps.timeoutMs ?? 15_000;
    this.attempts = Math.max(1, deps.attempts ?? 3);
  }

  /** URL do objeto (caminho codificado uma vez, igual ao que é assinado) */
  urlFor(key: string): URL {
    assertKey(key);
    const endpoint = new URL(this.cfg.endpoint);
    const basePath = endpoint.pathname.replace(/\/+$/, '');
    const encodedKey = uriEncode(key, true);
    if (this.cfg.forcePathStyle) {
      return new URL(
        `${endpoint.protocol}//${endpoint.host}${basePath}/${uriEncode(this.cfg.bucket)}/${encodedKey}`,
      );
    }
    return new URL(
      `${endpoint.protocol}//${this.cfg.bucket}.${endpoint.host}${basePath}/${encodedKey}`,
    );
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const res = await this.send('PUT', key, body, {
      'content-type': contentType,
      'cache-control': this.cfg.cacheControl,
    });
    await this.expect(res, 'PUT', key, [200]);
  }

  async get(key: string): Promise<Buffer | null> {
    const res = await this.send('GET', key);
    if (res.status === 404) {
      await res.arrayBuffer().catch(() => undefined);
      return null;
    }
    await this.expect(res, 'GET', key, [200], true);
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > MAX_GET_BYTES)
      throw new StorageRequestError(`S3 GET ${key}: objeto grande demais`, res.status, null);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_GET_BYTES)
      throw new StorageRequestError(`S3 GET ${key}: objeto grande demais`, res.status, null);
    return buf;
  }

  async exists(key: string): Promise<boolean> {
    const res = await this.send('HEAD', key);
    if (res.status === 404) return false;
    await this.expect(res, 'HEAD', key, [200]);
    return true;
  }

  async delete(key: string): Promise<void> {
    const res = await this.send('DELETE', key);
    await this.expect(res, 'DELETE', key, [200, 204, 404]);
  }

  /** confere o status; em erro lê o <Code> do XML (sem vazar nada da requisição) */
  private async expect(
    res: Response,
    method: string,
    key: string,
    ok: number[],
    keepBody = false,
  ): Promise<void> {
    if (ok.includes(res.status)) {
      if (!keepBody) await res.arrayBuffer().catch(() => undefined);
      return;
    }
    const text = await res.text().catch(() => '');
    const code = /<Code>([^<]{1,64})<\/Code>/.exec(text)?.[1] ?? null;
    throw new StorageRequestError(
      `S3 ${method} ${key} → ${res.status}${code ? ` ${code}` : ''}`,
      res.status,
      code,
    );
  }

  private async send(
    method: 'PUT' | 'GET' | 'HEAD' | 'DELETE',
    key: string,
    body?: Buffer,
    extra: Record<string, string> = {},
  ): Promise<Response> {
    const url = this.urlFor(key);
    const payloadHash = body ? sha256Hex(body) : EMPTY_SHA256;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < this.attempts; attempt++) {
      if (attempt > 0) await this.sleep(200 * 2 ** (attempt - 1));
      // assina a cada tentativa (x-amz-date novo)
      const headers = signV4(
        { method, url, headers: extra, payloadHash },
        {
          accessKeyId: this.cfg.accessKeyId,
          secretAccessKey: this.cfg.secretAccessKey,
          region: this.cfg.region,
          service: 's3',
        },
        this.now(),
      );
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method,
          headers,
          body: body ? new Uint8Array(body.buffer, body.byteOffset, body.byteLength) : undefined,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (err) {
        // rede / timeout: tenta de novo sem guardar a mensagem crua (pode trazer a URL, nunca o segredo)
        lastErr = err;
        continue;
      }
      if (retryable(res.status) && attempt < this.attempts - 1) {
        await res.arrayBuffer().catch(() => undefined);
        lastErr = new StorageRequestError(`S3 ${method} ${key} → ${res.status}`, res.status, null);
        continue;
      }
      return res;
    }
    if (lastErr instanceof StorageRequestError) throw lastErr;
    const name = (lastErr as Error | null)?.name ?? 'erro';
    throw new StorageRequestError(`S3 ${method} ${key}: falha de rede (${name})`, null, null);
  }
}
