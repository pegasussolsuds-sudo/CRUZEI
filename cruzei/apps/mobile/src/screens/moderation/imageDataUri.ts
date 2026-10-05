// Bytes de imagem → data:<mime>;base64,... pra <Image>. Serve à foto retida por denúncia na ficha da moderação: no
// Android a <Image> (Fresco) grava no cache de DISCO tudo o que baixa por http(s) — ignora Cache-Control: no-store e
// usa só a URI como chave, sem o header. Um data: URI vai pelo produtor local do Fresco (decodifica e fica só no cache
// de memória), então o arquivo nunca para no disco do celular de quem modera.
// Base64 próprio: Buffer não existe no Hermes e nada de dependência nova. Funções puras (testadas no node).

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const CODES = Uint8Array.from(ALPHABET, (c) => c.charCodeAt(0));
const PAD = 61; // '='
/** String.fromCharCode em fatias: apply com milhões de argumentos estoura a pilha */
const CHUNK = 4096;

/** acima disso nem converte (a string base64 inteira mora na memória do JS) */
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

/** base64 padrão (RFC 4648, com '=' no fim), igual ao Buffer.toString('base64') */
export function bytesToBase64(bytes: Uint8Array): string {
  const len = bytes.length;
  const out = new Uint8Array(Math.ceil(len / 3) * 4);
  let o = 0;
  let i = 0;
  for (; i + 2 < len; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out[o++] = CODES[n >> 18];
    out[o++] = CODES[(n >> 12) & 63];
    out[o++] = CODES[(n >> 6) & 63];
    out[o++] = CODES[n & 63];
  }
  const rest = len - i;
  if (rest) {
    const n = (bytes[i] << 16) | (rest === 2 ? bytes[i + 1] << 8 : 0);
    out[o++] = CODES[n >> 18];
    out[o++] = CODES[(n >> 12) & 63];
    out[o++] = rest === 2 ? CODES[(n >> 6) & 63] : PAD;
    out[o++] = PAD;
  }
  const parts: string[] = [];
  for (let k = 0; k < out.length; k += CHUNK) {
    parts.push(String.fromCharCode.apply(null, out.subarray(k, k + CHUNK) as unknown as number[]));
  }
  return parts.join('');
}

/**
 * Tipo do Content-Type só se for imagem (image/jpeg, image/png...), sem parâmetros e em minúsculas; o resto vira null.
 * SVG fica de fora: é documento, não bitmap (a <Image> nem decodifica).
 */
export function imageMime(contentType: unknown): string | null {
  const raw = Array.isArray(contentType) ? contentType[0] : contentType;
  if (typeof raw !== 'string') return null;
  const mime = raw.split(';')[0].trim().toLowerCase();
  if (!/^image\/[a-z0-9][a-z0-9.+-]*$/.test(mime) || mime === 'image/svg+xml') return null;
  return mime;
}

/** corpo da resposta como bytes: ArrayBuffer (o axios no RN) ou view (Uint8Array, Buffer); o resto é null */
export function asBytes(data: unknown): Uint8Array | null {
  if (ArrayBuffer.isView(data))
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  // toString em vez de instanceof: ArrayBuffer de outro realm (jest) também vale
  if (Object.prototype.toString.call(data) === '[object ArrayBuffer]')
    return new Uint8Array(data as ArrayBuffer);
  return null;
}

/** data:<mime>;base64,... só pra imagem de verdade (Content-Type image/*), não vazia e dentro do teto; senão null */
export function imageDataUri(data: unknown, contentType: unknown): string | null {
  const mime = imageMime(contentType);
  const bytes = asBytes(data);
  if (!mime || !bytes || bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return null;
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}
