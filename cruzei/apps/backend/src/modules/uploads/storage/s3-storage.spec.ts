import { PRIVATE_CACHE_CONTROL } from './object-storage';
import { S3ObjectStorage, StorageRequestError, type S3Config } from './s3-storage';
import {
  canonicalQuery,
  canonicalRequest,
  credentialScope,
  EMPTY_SHA256,
  hmac,
  sha256Hex,
  signingKey,
  stringToSign,
} from './sigv4';

// Driver S3/R2 sem SDK, com fetch falso: URL (path-style e virtual-host), assinatura conferida de forma independente,
// retry só no que vale repetir e mensagens de erro sem segredo nem header.

const SECRET = 'segredo-do-bucket-NAO-PODE-VAZAR';
const CFG: S3Config = {
  endpoint: 'https://conta123.r2.cloudflarestorage.com',
  region: 'auto',
  bucket: 'metch-fotos',
  accessKeyId: 'AKIDTESTE',
  secretAccessKey: SECRET,
  forcePathStyle: true,
  cacheControl: 'public, max-age=86400, immutable',
};
const KEY = 'p/3f2b8c1e-9a4d-4e2f-8b7a-1c2d3e4f5a6b.jpg';

type Call = { url: string; method: string; headers: Record<string, string>; body?: Uint8Array };

/** fetch falso: responde na ordem da fila (Response ou Error); grava cada chamada */
function fakeFetch(...replies: (Response | Error)[]) {
  const calls: Call[] = [];
  const fn = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: String(init?.method),
      headers: { ...(init?.headers as Record<string, string>) },
      body: init?.body as Uint8Array | undefined,
    });
    const next = replies.shift();
    if (!next) throw new Error('fetch chamado mais vezes que o esperado');
    if (next instanceof Error) throw next;
    return next;
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

const xmlError = (status: number, code: string) =>
  new Response(`<?xml version="1.0"?><Error><Code>${code}</Code><Message>x</Message></Error>`, {
    status,
  });

function storage(
  f: typeof fetch,
  extra: Partial<S3Config> = {},
  now = () => new Date('2026-10-05T12:00:00Z'),
) {
  return new S3ObjectStorage(
    { ...CFG, ...extra },
    { fetch: f, now, sleep: async () => undefined, attempts: 3 },
  );
}

/** confere a assinatura de uma chamada recalculando do zero (sem passar pelo signV4) */
function expectValidSignature(c: Call, cfg: S3Config = CFG) {
  const url = new URL(c.url);
  const auth = c.headers.authorization;
  const m =
    /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request, SignedHeaders=([^,]+), Signature=([0-9a-f]{64})$/.exec(
      auth,
    );
  expect(m).not.toBeNull();
  const [, akid, date, region, signed, signature] = m!;
  expect(akid).toBe(cfg.accessKeyId);
  expect(region).toBe(cfg.region);
  const headers: Record<string, string> = { host: url.host };
  for (const name of signed.split(';')) if (name !== 'host') headers[name] = c.headers[name];
  const canon = canonicalRequest(
    c.method,
    url.pathname,
    canonicalQuery(url),
    headers,
    c.headers['x-amz-content-sha256'],
  );
  expect(canon.signedHeaders).toBe(signed);
  const sts = stringToSign(
    c.headers['x-amz-date'],
    credentialScope(date, region, 's3'),
    canon.text,
  );
  expect(hmac(signingKey(cfg.secretAccessKey, date, region, 's3'), sts).toString('hex')).toBe(
    signature,
  );
}

describe('S3ObjectStorage — URL', () => {
  it('path-style (R2): endpoint/bucket/chave, chave codificada uma vez só', () => {
    const s = storage(fakeFetch().fetch);
    expect(s.urlFor(KEY).toString()).toBe(
      `https://conta123.r2.cloudflarestorage.com/metch-fotos/${KEY}`,
    );
  });

  it('virtual-host (AWS) e endpoint com caminho', () => {
    const v = storage(fakeFetch().fetch, {
      endpoint: 'https://s3.us-east-1.amazonaws.com',
      forcePathStyle: false,
    });
    expect(v.urlFor(KEY).toString()).toBe(`https://metch-fotos.s3.us-east-1.amazonaws.com/${KEY}`);
    const p = storage(fakeFetch().fetch, { endpoint: 'http://minio.local:9000/base/' });
    expect(p.urlFor('fakes/a.jpg').toString()).toBe(
      'http://minio.local:9000/base/metch-fotos/fakes/a.jpg',
    );
  });

  it('chave inválida nunca chega ao fetch', async () => {
    const f = fakeFetch();
    const s = storage(f.fetch);
    for (const bad of ['../x.jpg', 'p//x.jpg', '/abs.jpg', 'X.JPG']) {
      await expect(s.put(bad, Buffer.from('a'), 'image/jpeg')).rejects.toThrow(
        /chave de storage inválida/,
      );
    }
    expect(f.calls).toHaveLength(0);
  });
});

describe('S3ObjectStorage — operações', () => {
  it('PUT: corpo, content-type, cache-control e hash do corpo assinados', async () => {
    const f = fakeFetch(new Response(null, { status: 200 }));
    const body = Buffer.from('jpeg-de-mentira');
    await storage(f.fetch).put(KEY, body, 'image/jpeg');
    const [c] = f.calls;
    expect(c.method).toBe('PUT');
    expect(Buffer.from(c.body!).toString()).toBe('jpeg-de-mentira');
    expect(c.headers['content-type']).toBe('image/jpeg');
    expect(c.headers['cache-control']).toBe(CFG.cacheControl);
    expect(c.headers['x-amz-content-sha256']).toBe(sha256Hex(body));
    expect(c.headers['x-amz-date']).toBe('20261005T120000Z');
    expect(c.headers.authorization).toContain(
      'SignedHeaders=cache-control;content-type;host;x-amz-content-sha256;x-amz-date',
    );
    expectValidSignature(c);
  });

  it('PUT da foto retida (held/): Cache-Control privado no lugar do público, assinado', async () => {
    const f = fakeFetch(new Response(null, { status: 200 }));
    await storage(f.fetch).put(
      'held/3f2b8c1e-9a4d-4e2f-8b7a-1c2d3e4f5a6b.jpg',
      Buffer.from('prova'),
      'image/jpeg',
      { cacheControl: PRIVATE_CACHE_CONTROL },
    );
    const [c] = f.calls;
    expect(c.headers['cache-control']).toBe('private, no-store');
    expectValidSignature(c);
  });

  it('GET: 200 devolve os bytes; 404 devolve null; HEAD 200/404 = exists', async () => {
    const f = fakeFetch(
      new Response(Buffer.from('abc'), { status: 200 }),
      new Response('nada', { status: 404 }),
      new Response(null, { status: 200 }),
      new Response(null, { status: 404 }),
    );
    const s = storage(f.fetch);
    expect((await s.get(KEY))?.toString()).toBe('abc');
    expect(await s.get(KEY)).toBeNull();
    expect(await s.exists(KEY)).toBe(true);
    expect(await s.exists(KEY)).toBe(false);
    expect(f.calls.map((c) => c.method)).toEqual(['GET', 'GET', 'HEAD', 'HEAD']);
    for (const c of f.calls) {
      expect(c.headers['x-amz-content-sha256']).toBe(EMPTY_SHA256);
      expectValidSignature(c);
    }
  });

  it('GET acima do teto de leitura é recusado', async () => {
    const f = fakeFetch(
      new Response('x', { status: 200, headers: { 'content-length': String(50 * 1024 * 1024) } }),
    );
    await expect(storage(f.fetch).get(KEY)).rejects.toThrow(/grande demais/);
  });

  it('DELETE é idempotente: 204 e 404 são sucesso', async () => {
    const f = fakeFetch(new Response(null, { status: 204 }), new Response(null, { status: 404 }));
    const s = storage(f.fetch);
    await s.delete(KEY);
    await s.delete(KEY);
    expect(f.calls.map((c) => c.method)).toEqual(['DELETE', 'DELETE']);
  });
});

describe('S3ObjectStorage — erros e retry', () => {
  it('5xx e 429 repetem (assinando de novo com hora nova) e passam na 3ª', async () => {
    let t = Date.parse('2026-10-05T12:00:00Z');
    const f = fakeFetch(
      new Response('', { status: 503 }),
      new Response('', { status: 429 }),
      new Response(null, { status: 200 }),
    );
    const s = storage(f.fetch, {}, () => new Date((t += 1000)));
    await s.put(KEY, Buffer.from('a'), 'image/jpeg');
    expect(f.calls).toHaveLength(3);
    const dates = f.calls.map((c) => c.headers['x-amz-date']);
    expect(new Set(dates).size).toBe(3);
    f.calls.forEach((c) => expectValidSignature(c));
  });

  it('403 não repete; erro traz método, status, <Code> e chave — nunca segredo nem header', async () => {
    const f = fakeFetch(xmlError(403, 'SignatureDoesNotMatch'));
    const err = (await storage(f.fetch)
      .put(KEY, Buffer.from('a'), 'image/jpeg')
      .catch((e) => e)) as StorageRequestError;
    expect(err).toBeInstanceOf(StorageRequestError);
    expect(err.status).toBe(403);
    expect(err.code).toBe('SignatureDoesNotMatch');
    expect(err.message).toBe(`S3 PUT ${KEY} → 403 SignatureDoesNotMatch`);
    expect(f.calls).toHaveLength(1);
    expect(JSON.stringify({ m: err.message, s: err.stack })).not.toMatch(
      new RegExp(`${SECRET}|AWS4-HMAC|AKIDTESTE`),
    );
  });

  it('5xx em todas as tentativas: lança o último status', async () => {
    const f = fakeFetch(
      new Response('', { status: 500 }),
      new Response('', { status: 502 }),
      xmlError(500, 'InternalError'),
    );
    const err = (await storage(f.fetch)
      .delete(KEY)
      .catch((e) => e)) as StorageRequestError;
    expect(err.status).toBe(500);
    expect(err.code).toBe('InternalError');
    expect(f.calls).toHaveLength(3);
  });

  it('falha de rede/timeout: repete e lança "falha de rede" sem a mensagem crua', async () => {
    const boom = Object.assign(new Error(`connect ECONNREFUSED https://AKIDTESTE:${SECRET}@host`), {
      name: 'TypeError',
    });
    const f = fakeFetch(boom, boom, boom);
    const err = (await storage(f.fetch)
      .get(KEY)
      .catch((e) => e)) as StorageRequestError;
    expect(err).toBeInstanceOf(StorageRequestError);
    expect(err.status).toBeNull();
    expect(err.message).toBe(`S3 GET ${KEY}: falha de rede (TypeError)`);
    expect(err.message).not.toContain(SECRET);
    expect(f.calls).toHaveLength(3);
  });
});
