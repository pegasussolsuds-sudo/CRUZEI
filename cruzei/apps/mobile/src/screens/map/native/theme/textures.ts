// Texturas do mapa base geradas em código: fachadas com janelas acesas (fill-extrusion-pattern dos prédios no
// entardecer/noite) e o brilho da água (fill-pattern). TS puro, sem Skia nem disco: pixels RGBA -> PNG (deflate
// "stored", sem compressão) -> data URI, que o <Images> do MapLibre carrega pelo Fresco. O mesmo código gera as
// texturas do preview no navegador (scratchpad), então o que se vê lá é o que o app desenha.
//
// Tudo a 2x: cada imagem tem o dobro de pixels do tamanho lógico e vai pro estilo com scale 2 (pixelRatio 2).

import type { MapTheme } from '../../bridge';

/** densidade dos bitmaps das texturas (o pattern é medido em px lógicos) */
export const TEX_SCALE = 2;

export interface Rgba {
  w: number;
  h: number;
  data: Uint8Array;
}

type Rgb = readonly [number, number, number];

function hex(c: string): Rgb {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** hash inteiro determinístico (cada janela acende sempre igual, em qualquer aparelho) */
function hash(a: number, b: number, seed: number): number {
  let h = Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function canvas(w: number, h: number): Rgba {
  return { w, h, data: new Uint8Array(w * h * 4) };
}

/** pinta um retângulo (px do bitmap) misturando por cima com alfa a */
function rect(img: Rgba, x0: number, y0: number, x1: number, y1: number, c: Rgb, a = 1): void {
  for (let y = Math.max(0, y0); y < Math.min(img.h, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(img.w, x1); x++) {
      const i = (y * img.w + x) * 4;
      const d = img.data;
      const ia = d[i + 3] / 255;
      const oa = a + ia * (1 - a);
      if (oa <= 0) continue;
      for (let k = 0; k < 3; k++) d[i + k] = Math.round((c[k] * a + d[i + k] * ia * (1 - a)) / oa);
      d[i + 3] = Math.round(oa * 255);
    }
  }
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export type FacadeKind = 'low' | 'tower';
export type LitTheme = Exclude<MapTheme, 'day'>;

interface FacadeLook {
  wall: string;
  /** linha da laje (entre andares) e pilar */
  slab: string;
  /** vidro apagado: topo (reflexo do céu) e base */
  glassTop: string;
  glassBottom: string;
  /** fração de janelas acesas */
  lit: number;
  /** cores das janelas acesas com o peso de cada uma */
  lights: ReadonlyArray<readonly [string, number]>;
}

// prettier-ignore
const FACADES: Record<LitTheme, Record<FacadeKind, FacadeLook>> = {
  dusk: {
    low:   { wall: '#664472', slab: '#553A62', glassTop: '#A87AAE', glassBottom: '#523A66', lit: 0.2,
             lights: [['#FFD08A', 0.6], ['#FFE9C2', 0.3], ['#FF8FC4', 0.1]] },
    tower: { wall: '#5A4C7E', slab: '#4A3E6C', glassTop: '#C08CBA', glassBottom: '#4E4478', lit: 0.26,
             lights: [['#FFE3B0', 0.5], ['#FFF6E0', 0.35], ['#9FD4FF', 0.15]] },
  },
  night: {
    low:   { wall: '#2A2140', slab: '#1E182F', glassTop: '#2E2A4A', glassBottom: '#1A1630', lit: 0.34,
             lights: [['#FFC46A', 0.55], ['#FFE6B0', 0.25], ['#FF4FA8', 0.12], ['#9FD4FF', 0.08]] },
    tower: { wall: '#22253F', slab: '#181A30', glassTop: '#2A3050', glassBottom: '#161A30', lit: 0.5,
             lights: [['#FFE3A8', 0.4], ['#F4F8FF', 0.3], ['#8FCBFF', 0.18], ['#FF4FA8', 0.12]] },
  },
};

/** lado da textura de fachada em px lógicos (4 x 4 janelas de 8 px) */
export const FACADE_SIZE = 32;
const CELL = 8 * TEX_SCALE;

function pickLight(look: FacadeLook, r: number): Rgb {
  let acc = 0;
  for (const [c, w] of look.lights) {
    acc += w;
    if (r < acc) return hex(c);
  }
  return hex(look.lights[0][0]);
}

/**
 * fachada: parede, laje entre andares, vidro com reflexo e ~30-50% das janelas acesas (com um halo de 1 px na
 * parede). No teto do prédio a mesma textura vira "luzes da cobertura" — limitação do fill-extrusion-pattern.
 */
export function facadeTexture(kind: FacadeKind, theme: LitTheme): Rgba {
  const look = FACADES[theme][kind];
  const px = FACADE_SIZE * TEX_SCALE;
  const img = canvas(px, px);
  const wall = hex(look.wall);
  const slab = hex(look.slab);
  const gTop = hex(look.glassTop);
  const gBot = hex(look.glassBottom);
  rect(img, 0, 0, px, px, wall);
  const seed = (kind === 'low' ? 11 : 23) + (theme === 'night' ? 100 : 0);
  // janela dentro da célula de 16 px: casa = janela menor; torre = pano de vidro mais largo
  const [wx0, wy0, wx1, wy1] = kind === 'low' ? [4, 4, 12, 11] : [2, 3, 14, 12];
  for (let cy = 0; cy < px / CELL; cy++) {
    for (let cx = 0; cx < px / CELL; cx++) {
      const ox = cx * CELL;
      const oy = cy * CELL;
      rect(img, ox, oy + CELL - 2, ox + CELL, oy + CELL, slab);
      if (kind === 'tower') rect(img, ox + CELL - 1, oy, ox + CELL, oy + CELL, slab, 0.7);
      const on = hash(cx, cy, seed) < look.lit;
      if (on) {
        const c = pickLight(look, hash(cy, cx, seed + 7));
        rect(img, ox + wx0 - 1, oy + wy0 - 1, ox + wx1 + 1, oy + wy1 + 1, c, 0.28);
        for (let y = wy0; y < wy1; y++) {
          // luz mais forte no meio da janela (cortina/abajur), borda um pouco mais escura
          const t = Math.abs((y - wy0) / (wy1 - wy0 - 1) - 0.45);
          rect(img, ox + wx0, oy + y, ox + wx1, oy + y + 1, mix(c, [255, 255, 255], Math.max(0, 0.25 - t * 0.5)));
        }
        rect(img, ox + wx0, oy + wy1 - 1, ox + wx1, oy + wy1, mix(c, wall, 0.35));
      } else {
        for (let y = wy0; y < wy1; y++) rect(img, ox + wx0, oy + y, ox + wx1, oy + y + 1, mix(gTop, gBot, (y - wy0) / (wy1 - wy0 - 1)));
      }
      if (kind === 'tower') rect(img, ox + 8, oy + wy0, ox + 9, oy + wy1, slab, 0.8);
    }
  }
  return img;
}

/** lado da textura da água em px lógicos */
export const RIPPLE_SIZE = 32;

/** brilho da água: tracinhos brancos curtos e translúcidos (a opacidade da camada decide a força por tema) */
export function rippleTexture(): Rgba {
  const px = RIPPLE_SIZE * TEX_SCALE;
  const img = canvas(px, px);
  const n = 7;
  for (let i = 0; i < n; i++) {
    const x = Math.floor(hash(i, 1, 5) * px);
    const y = Math.floor(hash(i, 2, 5) * (px - 2));
    const len = 6 + Math.floor(hash(i, 3, 5) * 14);
    const a = 0.35 + hash(i, 4, 5) * 0.5;
    for (let k = 0; k < len; k++) {
      // tracinho com pontas suaves, "dando a volta" na borda pra emendar sem costura
      const t = k / (len - 1);
      const fa = a * Math.sin(Math.PI * t);
      const xx = (x + k) % px;
      rect(img, xx, y, xx + 1, y + 1, [255, 255, 255], fa);
      rect(img, xx, y + 1, xx + 1, y + 2, [255, 255, 255], fa * 0.35);
    }
  }
  return img;
}

// ---------------------------------------------------------------------------------------------------------------
// PNG mínimo (RGBA 8 bits, sem filtro, deflate "stored") + base64
// ---------------------------------------------------------------------------------------------------------------

let crcTable: Uint32Array | null = null;
function crc32(buf: Uint8Array, start: number, end: number): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = crcTable[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(buf: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < buf.length; i++) {
    a = (a + buf[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

export function encodePng(img: Rgba): Uint8Array {
  const { w, h, data } = img;
  const stride = w * 4 + 1;
  const raw = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) raw.set(data.subarray(y * w * 4, (y + 1) * w * 4), y * stride + 1);
  const blocks = Math.max(1, Math.ceil(raw.length / 65535));
  const zlen = 2 + raw.length + blocks * 5 + 4;
  const idat = new Uint8Array(zlen);
  idat[0] = 0x78;
  idat[1] = 0x01;
  let p = 2;
  for (let b = 0; b < blocks; b++) {
    const s = b * 65535;
    const len = Math.min(65535, raw.length - s);
    idat[p++] = b === blocks - 1 ? 1 : 0;
    idat[p++] = len & 255;
    idat[p++] = len >>> 8;
    idat[p++] = ~len & 255;
    idat[p++] = (~len >>> 8) & 255;
    idat.set(raw.subarray(s, s + len), p);
    p += len;
  }
  const ad = adler32(raw);
  idat[p++] = ad >>> 24;
  idat[p++] = (ad >>> 16) & 255;
  idat[p++] = (ad >>> 8) & 255;
  idat[p++] = ad & 255;

  const ihdr = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 8, 6, 0, 0, 0]);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  const chunks: [string, Uint8Array][] = [
    ['IHDR', ihdr],
    ['IDAT', idat],
    ['IEND', new Uint8Array(0)],
  ];
  const total = 8 + chunks.reduce((n, [, d]) => n + 12 + d.length, 0);
  const out = new Uint8Array(total);
  out.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  let o = 8;
  const odv = new DataView(out.buffer);
  for (const [type, d] of chunks) {
    odv.setUint32(o, d.length);
    for (let i = 0; i < 4; i++) out[o + 4 + i] = type.charCodeAt(i);
    out.set(d, o + 8);
    odv.setUint32(o + 8 + d.length, crc32(out, o + 4, o + 8 + d.length));
    o += 12 + d.length;
  }
  return out;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function base64(bytes: Uint8Array): string {
  let s = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    s += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    s += B64[n >> 18] + B64[(n >> 12) & 63] + '==';
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    s += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + '=';
  }
  return s;
}

/** nomes das imagens no estilo (prefixo cz-tex- pra não colidir com o sprite nem com as imagens do motor) */
export const TEX = {
  facade: (kind: FacadeKind, theme: LitTheme) => `cz-tex-facade-${kind}-${theme}`,
  ripple: 'cz-tex-ripple',
} as const;

/** todas as texturas do tema: nome -> bitmap RGBA (2x) */
export function allTextures(): Record<string, Rgba> {
  const out: Record<string, Rgba> = {};
  for (const theme of ['dusk', 'night'] as const) {
    for (const kind of ['low', 'tower'] as const) out[TEX.facade(kind, theme)] = facadeTexture(kind, theme);
  }
  out[TEX.ripple] = rippleTexture();
  return out;
}

let uriCache: Record<string, string> | null = null;
/** nome -> data URI PNG, gerado uma vez por processo (~20 ms, poucos KB cada) */
export function textureDataUris(): Record<string, string> {
  if (!uriCache) {
    const out: Record<string, string> = {};
    const tex = allTextures();
    for (const name of Object.keys(tex)) out[name] = 'data:image/png;base64,' + base64(encodePng(tex[name]));
    uriCache = out;
  }
  return uriCache;
}
