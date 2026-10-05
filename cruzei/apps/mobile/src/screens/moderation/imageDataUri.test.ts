import { asBytes, bytesToBase64, imageDataUri, imageMime, MAX_IMAGE_BYTES } from './imageDataUri';

// Conversão da foto retida pra data: URI (a <Image> não recebe a URL autenticada: no Android o Fresco gravaria no
// disco). Base64 próprio, sem Buffer (não existe no Hermes): o Buffer do node só serve de gabarito aqui.

/** Buffer do node (só existe no jest, o app não tem): gabarito do base64 */
type NodeBufferLike = Uint8Array & { toString(enc: 'base64'): string };
const NodeBuffer = (
  globalThis as unknown as { Buffer: { from(b: ArrayLike<number>): NodeBufferLike } }
).Buffer;
const b64 = (b: ArrayLike<number>) => NodeBuffer.from(b).toString('base64');

const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

/** bytes pseudoaleatórios determinísticos (todos os valores 0..255 aparecem) */
function bytes(n: number, seed = 7): Uint8Array {
  const out = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
}

describe('bytesToBase64', () => {
  it('vetores da RFC 4648 (com o "=" de preenchimento)', () => {
    expect(bytesToBase64(ascii(''))).toBe('');
    expect(bytesToBase64(ascii('f'))).toBe('Zg==');
    expect(bytesToBase64(ascii('fo'))).toBe('Zm8=');
    expect(bytesToBase64(ascii('foo'))).toBe('Zm9v');
    expect(bytesToBase64(ascii('foob'))).toBe('Zm9vYg==');
    expect(bytesToBase64(ascii('fooba'))).toBe('Zm9vYmE=');
    expect(bytesToBase64(ascii('foobar'))).toBe('Zm9vYmFy');
  });

  it('igual ao Buffer em todos os tamanhos pequenos e nos bytes altos (+ e /)', () => {
    for (let n = 0; n <= 64; n++) {
      const b = bytes(n, n + 1);
      expect(bytesToBase64(b)).toBe(b64(b));
    }
    const high = Uint8Array.from([0xff, 0xfe, 0xfd, 0xfb, 0xef, 0xbe, 0x00, 0x3e, 0x3f]);
    expect(bytesToBase64(high)).toBe(b64(high));
  });

  it('foto de verdade (vários pedaços do fromCharCode, sobra de 1 e 2 bytes)', () => {
    for (const n of [4096 * 3, 4096 * 3 + 1, 300_001, 1_000_002]) {
      const b = bytes(n);
      expect(bytesToBase64(b)).toBe(b64(b));
    }
  });

  it('roda sem Buffer (Hermes)', () => {
    const b = bytes(5000);
    const expected = b64(b);
    const g = globalThis as { Buffer?: unknown };
    const saved = g.Buffer;
    delete g.Buffer;
    try {
      expect(bytesToBase64(b)).toBe(expected);
    } finally {
      g.Buffer = saved;
    }
  });
});

describe('imageMime', () => {
  it('só image/*, sem parâmetros e em minúsculas', () => {
    expect(imageMime('image/jpeg')).toBe('image/jpeg');
    expect(imageMime('Image/PNG; charset=binary')).toBe('image/png');
    expect(imageMime(' image/webp ')).toBe('image/webp');
    expect(imageMime(['image/heic'])).toBe('image/heic');
  });

  it('o resto (inclusive SVG, que é documento) vira null', () => {
    for (const t of [
      'text/html',
      'application/octet-stream',
      'image/svg+xml',
      'image/',
      'image',
      'imagejpeg',
      '',
    ]) {
      expect(imageMime(t)).toBeNull();
    }
    expect(imageMime(undefined)).toBeNull();
    expect(imageMime(null)).toBeNull();
    expect(imageMime(42)).toBeNull();
  });
});

describe('asBytes', () => {
  it('ArrayBuffer (o axios no RN), Uint8Array e Buffer; respeita o recorte da view', () => {
    const b = bytes(10);
    expect(Array.from(asBytes(b.buffer)!)).toEqual(Array.from(b));
    expect(Array.from(asBytes(b)!)).toEqual(Array.from(b));
    const view = new Uint8Array(b.buffer, 2, 5);
    expect(Array.from(asBytes(view)!)).toEqual(Array.from(b.slice(2, 7)));
    expect(Array.from(asBytes(NodeBuffer.from([1, 2, 3]))!)).toEqual([1, 2, 3]);
  });

  it('texto (responseType ignorado), objeto e nada viram null', () => {
    expect(asBytes('\xff\xd8\xff')).toBeNull();
    expect(asBytes({ length: 3 })).toBeNull();
    expect(asBytes(null)).toBeNull();
    expect(asBytes(undefined)).toBeNull();
  });
});

describe('imageDataUri', () => {
  it('imagem vira data:<mime>;base64,...', () => {
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    expect(imageDataUri(jpeg.buffer, 'image/jpeg')).toBe(`data:image/jpeg;base64,${b64(jpeg)}`);
    expect(imageDataUri(jpeg, 'IMAGE/PNG; q=1')).toMatch(/^data:image\/png;base64,/);
  });

  it('não é image/*, vazia, sem corpo binário ou acima do teto: null (a tela mostra "não carregou")', () => {
    const b = bytes(16);
    expect(imageDataUri(b, 'text/html')).toBeNull();
    expect(imageDataUri(b, 'application/octet-stream')).toBeNull();
    expect(imageDataUri(b, 'image/svg+xml')).toBeNull();
    expect(imageDataUri(b, undefined)).toBeNull();
    expect(imageDataUri(new Uint8Array(0), 'image/jpeg')).toBeNull();
    expect(imageDataUri('não é binário', 'image/jpeg')).toBeNull();
    expect(imageDataUri(new Uint8Array(MAX_IMAGE_BYTES + 1), 'image/jpeg')).toBeNull();
  });
});
