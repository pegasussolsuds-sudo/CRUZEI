import { createHmac } from 'node:crypto';

import {
  canonicalQuery,
  canonicalRequest,
  credentialScope,
  EMPTY_SHA256,
  sha256Hex,
  signingKey,
  signV4,
  stringToSign,
  uriEncode,
} from './sigv4';

// Vetores oficiais da AWS:
// - S3 "Examples: Signature Calculations in AWS Signature Version 4" (header-based auth, 1 chunk)
// - suíte de testes do SigV4 (aws-sig-v4-test-suite: get-vanilla, get-vanilla-query-order-key-case)
// - "Deriving the signing key" da documentação geral do SigV4
// Credenciais e assinaturas são os exemplos públicos da AWS (não são segredo de verdade).

const S3_EXAMPLE = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
  service: 's3',
};
const S3_DATE = new Date('2013-05-24T00:00:00Z');
const S3_HOST = 'https://examplebucket.s3.amazonaws.com';

const SUITE = {
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
  service: 'service',
};

/** Signature=… do header Authorization */
const signatureOf = (headers: Record<string, string>) =>
  /Signature=([0-9a-f]{64})$/.exec(headers.authorization)?.[1];

describe('SigV4 — exemplos do S3 (documentação da AWS)', () => {
  it('GET Object com Range', () => {
    const url = new URL(`${S3_HOST}/test.txt`);
    const h = signV4(
      { method: 'GET', url, headers: { range: 'bytes=0-9' }, payloadHash: EMPTY_SHA256 },
      S3_EXAMPLE,
      S3_DATE,
    );

    const canon = canonicalRequest(
      'GET',
      url.pathname,
      canonicalQuery(url),
      {
        host: url.host,
        range: 'bytes=0-9',
        'x-amz-content-sha256': EMPTY_SHA256,
        'x-amz-date': '20130524T000000Z',
      },
      EMPTY_SHA256,
    );
    expect(canon.text).toBe(
      [
        'GET',
        '/test.txt',
        '',
        'host:examplebucket.s3.amazonaws.com',
        'range:bytes=0-9',
        `x-amz-content-sha256:${EMPTY_SHA256}`,
        'x-amz-date:20130524T000000Z',
        '',
        'host;range;x-amz-content-sha256;x-amz-date',
        EMPTY_SHA256,
      ].join('\n'),
    );
    expect(
      stringToSign('20130524T000000Z', credentialScope('20130524', 'us-east-1', 's3'), canon.text),
    ).toBe(
      [
        'AWS4-HMAC-SHA256',
        '20130524T000000Z',
        '20130524/us-east-1/s3/aws4_request',
        '7344ae5b7ee6c3e7e6b0fe0640412a37625d1fbfff95c48bbb2dc43964946972',
      ].join('\n'),
    );
    expect(h.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
        'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, ' +
        'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
    expect(h['x-amz-date']).toBe('20130524T000000Z');
    expect(h['x-amz-content-sha256']).toBe(EMPTY_SHA256);
    // o host NÃO volta: o fetch manda url.host, que é o que foi assinado
    expect(h).not.toHaveProperty('host');
  });

  it('PUT Object com caractere reservado na chave ($ → %24) e corpo assinado', () => {
    const body = Buffer.from('Welcome to Amazon S3.');
    const payloadHash = sha256Hex(body);
    expect(payloadHash).toBe('44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072');
    const url = new URL(`${S3_HOST}/${uriEncode('test$file.text', true)}`);
    expect(url.pathname).toBe('/test%24file.text');
    const h = signV4(
      {
        method: 'PUT',
        url,
        headers: {
          Date: 'Fri, 24 May 2013 00:00:00 GMT',
          'x-amz-storage-class': 'REDUCED_REDUNDANCY',
        },
        payloadHash,
      },
      S3_EXAMPLE,
      S3_DATE,
    );
    expect(h.authorization).toContain(
      'SignedHeaders=date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class',
    );
    expect(signatureOf(h)).toBe('98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd');
  });

  it('GET Bucket Lifecycle (subrecurso sem valor vira "lifecycle=")', () => {
    const url = new URL(`${S3_HOST}/?lifecycle`);
    expect(canonicalQuery(url)).toBe('lifecycle=');
    const h = signV4({ method: 'GET', url, payloadHash: EMPTY_SHA256 }, S3_EXAMPLE, S3_DATE);
    expect(signatureOf(h)).toBe('fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543');
  });

  it('GET Bucket (List Objects) com query', () => {
    const url = new URL(`${S3_HOST}/?max-keys=2&prefix=J`);
    expect(canonicalQuery(url)).toBe('max-keys=2&prefix=J');
    const h = signV4({ method: 'GET', url, payloadHash: EMPTY_SHA256 }, S3_EXAMPLE, S3_DATE);
    expect(signatureOf(h)).toBe('34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7');
  });
});

describe('SigV4 — suíte de testes da AWS', () => {
  const amz = '20150830T123600Z';
  const scope = credentialScope('20150830', 'us-east-1', 'service');
  const key = signingKey(SUITE.secretAccessKey, '20150830', 'us-east-1', 'service');

  it('get-vanilla', () => {
    const canon = canonicalRequest(
      'GET',
      '/',
      '',
      { Host: 'example.amazonaws.com', 'X-Amz-Date': amz },
      EMPTY_SHA256,
    );
    expect(canon.text).toBe(
      [
        'GET',
        '/',
        '',
        'host:example.amazonaws.com',
        `x-amz-date:${amz}`,
        '',
        'host;x-amz-date',
        EMPTY_SHA256,
      ].join('\n'),
    );
    const sts = stringToSign(amz, scope, canon.text);
    expect(sts.split('\n')[3]).toBe(
      'bb579772317eb040ac9ed261061d46c1f17a8133879d6129b6e1c25292927e63',
    );
    const sig = createHmac('sha256', key).update(sts).digest('hex');
    expect(sig).toBe('5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31');
  });

  it('get-vanilla-query-order-key-case (query ordenada pela chave codificada)', () => {
    const url = new URL('https://example.amazonaws.com/?Param2=value2&Param1=value1');
    expect(canonicalQuery(url)).toBe('Param1=value1&Param2=value2');
    const canon = canonicalRequest(
      'GET',
      url.pathname,
      canonicalQuery(url),
      { host: url.host, 'x-amz-date': amz },
      EMPTY_SHA256,
    );
    const sig = createHmac('sha256', key)
      .update(stringToSign(amz, scope, canon.text))
      .digest('hex');
    expect(sig).toBe('b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500');
  });
});

describe('SigV4 — peças', () => {
  it('chave de assinatura (exemplo "Deriving the signing key")', () => {
    expect(
      signingKey(
        'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
        '20120215',
        'us-east-1',
        'iam',
      ).toString('hex'),
    ).toBe('f4780e2d9f65fa895f9c67b32ce1baf0b0d8a43505a000a1a9e090d414db404d');
  });

  it('uriEncode: só A-Za-z0-9-_.~ ficam; espaço vira %20 (nunca +); UTF-8 por byte; barra só no caminho', () => {
    expect(uriEncode('a b+c*~')).toBe('a%20b%2Bc%2A~');
    expect(uriEncode('ção')).toBe('%C3%A7%C3%A3o');
    expect(uriEncode('p/x.jpg')).toBe('p%2Fx.jpg');
    expect(uriEncode('p/x.jpg', true)).toBe('p/x.jpg');
    // nunca codifica duas vezes o que já veio codificado
    expect(uriEncode('%41')).toBe('%2541');
  });

  it('header canônico: nome minúsculo, valor sem espaço sobrando', () => {
    const c = canonicalRequest(
      'put',
      '/k',
      '',
      { 'Content-Type': '  image/jpeg ', 'X-Amz-Meta-A': 'a   b' },
      'h',
    );
    expect(c.text.split('\n')).toEqual([
      'PUT',
      '/k',
      '',
      'content-type:image/jpeg',
      'x-amz-meta-a:a b',
      '',
      'content-type;x-amz-meta-a',
      'h',
    ]);
  });

  it('não vaza o segredo em nenhum header', () => {
    const h = signV4(
      { method: 'GET', url: new URL(`${S3_HOST}/k.jpg`), payloadHash: EMPTY_SHA256 },
      S3_EXAMPLE,
      S3_DATE,
    );
    expect(JSON.stringify(h)).not.toContain(S3_EXAMPLE.secretAccessKey);
  });
});
