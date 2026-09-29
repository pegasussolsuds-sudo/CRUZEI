// Thumbnails das fotos da bolha de identidade no mapa nativo — porta do CZ_PHOTO (identity-bubble.ts) sem a
// parte de desenho (a bolha em si é desenhada em images/draw.ts a partir do thumb daqui).
//   - cache por URL, fila por prioridade (mais perto do centro primeiro), no máximo 4 downloads simultâneos,
//     timeout, falha memorizada com novas tentativas espaçadas;
//   - recorte quadrado central (puxado pra cima, onde costuma estar o rosto) num bitmap 2x de 96x96.
// Tudo em Skia RASTER (Skia.Surface.Make, CPU): nada de GPU na thread JS — o Moto g54 cai no driver GL.
//
// Contrato:
//   request(url, pri, cb?)  -> Promise<boolean> (e cb(ok)) quando resolver; imediato se já em cache
//   thumb(url)              -> SkImage 96x96 ou null (renova o LRU: chame logo antes de desenhar)
//   status(url)             -> 'none' | 'queued' | 'loading' | 'ok' | 'bad' (bad tenta de novo até 3x; decode é definitivo)
//   retryAt(url)            -> 0 (pode pedir) | timestamp da próxima tentativa | Infinity (desistiu)
//   reprioritize(fn)        -> fn(url) devolve a prioridade nova de cada URL na fila
//   onFailed(fn)            -> fn(url, falha) a cada falha (log)

import {
  FilterMode,
  MipmapMode,
  Skia,
  type SkData,
  type SkImage,
  type SkSurface,
} from '@shopify/react-native-skia';

import { IMG_SCALE } from '../contracts';

export type PhotoStatus = 'none' | 'queued' | 'loading' | 'ok' | 'bad';
export type PhotoFailReason = 'http' | 'network' | 'timeout' | 'decode';

export interface PhotoFailure {
  reason: PhotoFailReason;
  /** status HTTP quando reason = 'http' */
  status?: number;
  /** falhas acumuladas desta URL */
  tries: number;
  /** true = desistiu nesta sessão (decode inválido ou MAX_TRIES) */
  definitive: boolean;
}

/** lado do thumb em px CSS; o bitmap é 2x — a bolha nunca passa disso na tela */
export const PHOTO_THUMB = 48;
export const PHOTO_THUMB_PX = Math.round(PHOTO_THUMB * IMG_SCALE);

const MAX_INFLIGHT = 4; // downloads simultâneos (conexão lenta não trava o resto)
const MAX_CACHE = 400; // entradas vivas na sessão (LRU pelas menos usadas)
const TIMEOUT_MS = 15000;
const MAX_TRIES = 3; // falhas de rede/HTTP tentam de novo (45 s, 90 s); depois desiste na sessão
const RETRY_MS = 45000;
const LOW_PRIORITY = 1e9;

interface Entry {
  st: PhotoStatus;
  img: SkImage | null;
  waiters: ((ok: boolean) => void)[];
  pri: number;
  /** último uso (LRU) */
  at: number;
  tries: number;
  retryAt: number;
}

function warn(msg: string, e?: unknown): void {
  if (!__DEV__) return;
  const detail = e === undefined ? '' : ': ' + (e instanceof Error ? e.message : String(e));
  // eslint-disable-next-line no-console
  console.warn('[mapphoto] ' + msg + detail);
}

function disposeSafe(o: { dispose(): void } | null): void {
  if (!o) return;
  try {
    o.dispose();
  } catch {
    // já liberado
  }
}

/**
 * Decodifica e recorta (object-fit: cover) num bitmap 96x96. O rosto costuma ficar no terço de cima, então o
 * recorte é puxado pra cima. Mipmap linear: a foto costuma ser ~10x maior que o thumb e só bilinear serrilha.
 * Devolve null se a imagem não decodificar.
 */
function makeThumb(buf: ArrayBuffer): SkImage | null {
  let data: SkData | null = null;
  let src: SkImage | null = null;
  let surface: SkSurface | null = null;
  try {
    if (!buf || buf.byteLength === 0) return null;
    data = Skia.Data.fromBytes(new Uint8Array(buf));
    src = Skia.Image.MakeImageFromEncoded(data);
    if (!src) return null;
    const w = src.width();
    const h = src.height();
    if (!(w > 0 && h > 0)) return null;
    const s = Math.min(w, h);
    const sx = (w - s) / 2;
    const sy = (h - s) * 0.3;
    surface = Skia.Surface.Make(PHOTO_THUMB_PX, PHOTO_THUMB_PX);
    if (!surface) return null;
    const canvas = surface.getCanvas();
    canvas.clear(Skia.Color('transparent'));
    canvas.drawImageRectOptions(
      src,
      Skia.XYWHRect(sx, sy, s, s),
      Skia.XYWHRect(0, 0, PHOTO_THUMB_PX, PHOTO_THUMB_PX),
      FilterMode.Linear,
      MipmapMode.Linear,
    );
    surface.flush();
    // snapshot de surface raster já é imagem de CPU. NÃO chamar makeNonTextureImage: no Android ele cria um
    // contexto OpenGL (thread_local) na thread JS só pra isso — justamente o driver que derruba o Moto g54.
    return surface.makeImageSnapshot();
  } catch (e) {
    warn('decode', e);
    return null;
  } finally {
    // a original (decodificada em tamanho cheio) sai já; o snapshot mantém os próprios pixels
    disposeSafe(src);
    disposeSafe(data);
    disposeSafe(surface);
  }
}

export class PhotoLoader {
  readonly THUMB = PHOTO_THUMB;
  private readonly cache = new Map<string, Entry>();
  /** URLs em 'queued' */
  private queue: string[] = [];
  private inflight = 0;
  private pumpScheduled = false;
  private failedHandler: ((url: string, failure: PhotoFailure) => void) | null = null;

  status(url: string): PhotoStatus {
    const e = this.cache.get(url);
    return e ? e.st : 'none';
  }

  /** thumb pronto ou null; renova o LRU (quem está na tela não é despejado). Não guarde entre ticks. */
  thumb(url: string): SkImage | null {
    const e = this.cache.get(url);
    if (e && e.st === 'ok' && e.img) {
      e.at = Date.now();
      return e.img;
    }
    return null;
  }

  /** 0 = pode pedir agora; timestamp = espera; Infinity = desistiu nesta sessão */
  retryAt(url: string): number {
    const e = this.cache.get(url);
    if (!e || e.st !== 'bad') return 0;
    return e.tries >= MAX_TRIES ? Infinity : e.retryAt;
  }

  /**
   * Pede o thumb (prioridade menor = antes). Resolve true quando pronto (na hora se já em cache — o cb também é
   * chamado de forma síncrona nesse caso) e false se falhou ou está esperando a próxima tentativa. Nunca rejeita.
   */
  request(url: string, pri?: number, cb?: (ok: boolean) => void): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const done = (ok: boolean): void => {
        if (cb) {
          try {
            cb(ok);
          } catch (err) {
            warn('callback', err);
          }
        }
        resolve(ok);
      };
      if (!url || typeof url !== 'string') {
        done(false);
        return;
      }
      const p = typeof pri === 'number' && Number.isFinite(pri) ? pri : LOW_PRIORITY;
      const t = Date.now();
      const e = this.cache.get(url);
      if (e) {
        e.at = t;
        if (e.st === 'ok') {
          done(true);
          return;
        }
        // falhou antes: tenta de novo depois de um tempo (rede lenta/túnel), até 3 vezes; decode inválido é definitivo
        if (e.st === 'bad') {
          if (e.tries >= MAX_TRIES || t < e.retryAt) {
            done(false);
            return;
          }
          e.st = 'queued';
          e.pri = p;
          e.waiters = [done];
          this.queue.push(url);
          this.schedulePump();
          return;
        }
        if (p < e.pri) e.pri = p;
        e.waiters.push(done);
        return;
      }
      this.cache.set(url, {
        st: 'queued',
        img: null,
        waiters: [done],
        pri: p,
        at: t,
        tries: 0,
        retryAt: 0,
      });
      this.queue.push(url);
      this.schedulePump();
    });
  }

  /** fn(url) devolve a prioridade nova de cada URL ainda na fila (não numérico = mantém) */
  reprioritize(fn: (url: string) => number | null | undefined): void {
    for (const url of this.queue) {
      const e = this.cache.get(url);
      if (!e || e.st !== 'queued') continue;
      try {
        const p = fn(url);
        if (typeof p === 'number' && Number.isFinite(p)) e.pri = p;
      } catch (err) {
        warn('reprioritize', err);
      }
    }
  }

  /** handler de falha (log); null remove. Devolve a função que remove. */
  onFailed(fn: ((url: string, failure: PhotoFailure) => void) | null): () => void {
    this.failedHandler = fn;
    return () => {
      if (this.failedHandler === fn) this.failedHandler = null;
    };
  }

  /** solta os thumbs prontos e as falhas memorizadas (ex.: saiu do mapa); fila e downloads em curso seguem */
  clear(): void {
    for (const [url, e] of this.cache) {
      if (e.st !== 'ok' && e.st !== 'bad') continue;
      disposeSafe(e.img);
      e.img = null;
      this.cache.delete(url);
    }
  }

  // ---- fila ----

  // junta a rajada de pedidos do mesmo tick antes de escolher: os 4 primeiros downloads vão pros mais urgentes
  private schedulePump(): void {
    if (this.pumpScheduled) return;
    this.pumpScheduled = true;
    Promise.resolve().then(
      () => this.pump(),
      () => this.pump(),
    );
  }

  private pump(): void {
    this.pumpScheduled = false;
    if (this.inflight >= MAX_INFLIGHT || this.queue.length === 0) return;
    const pri = (url: string): number => {
      const e = this.cache.get(url);
      return e ? e.pri : LOW_PRIORITY;
    };
    this.queue.sort((a, b) => pri(a) - pri(b));
    while (this.inflight < MAX_INFLIGHT && this.queue.length > 0) {
      const url = this.queue.shift();
      if (url === undefined) break;
      const e = this.cache.get(url);
      if (!e || e.st !== 'queued') continue;
      void this.load(url, e);
    }
  }

  private async load(url: string, e: Entry): Promise<void> {
    e.st = 'loading';
    this.inflight++;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let img: SkImage | null = null;
    let reason: PhotoFailReason | null = null;
    let status: number | undefined;
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) {
        reason = 'http';
        status = res.status;
      } else {
        const buf = await res.arrayBuffer();
        img = makeThumb(buf);
        if (!img) reason = 'decode';
      }
    } catch {
      reason = ctrl.signal.aborted ? 'timeout' : 'network';
    } finally {
      clearTimeout(timer);
    }
    this.inflight--;
    this.finish(url, e, img, reason, status);
  }

  private finish(
    url: string,
    e: Entry,
    img: SkImage | null,
    reason: PhotoFailReason | null,
    status: number | undefined,
  ): void {
    let ok = img !== null;
    if (this.cache.get(url) !== e) {
      // a entrada saiu do cache no meio do download: ninguém mais vai pedir este thumb
      disposeSafe(img);
      img = null;
      ok = false;
    }
    if (ok) {
      e.st = 'ok';
      e.img = img;
    } else {
      e.st = 'bad';
      e.img = null;
      // decode inválido não melhora tentando de novo (igual ao CORS bloqueado do WebView)
      e.tries = reason === 'decode' ? MAX_TRIES : e.tries + 1;
      e.retryAt = Date.now() + RETRY_MS * e.tries;
      const handler = this.failedHandler;
      if (handler && reason) {
        try {
          handler(url, { reason, status, tries: e.tries, definitive: e.tries >= MAX_TRIES });
        } catch (err) {
          warn('onFailed', err);
        }
      }
    }
    const waiters = e.waiters;
    e.waiters = [];
    for (const w of waiters) w(ok); // done() já protege o cb do chamador
    this.evict();
    this.pump();
  }

  private evict(): void {
    if (this.cache.size <= MAX_CACHE) return;
    const done: [string, Entry][] = [];
    for (const kv of this.cache) if (kv[1].st === 'ok' || kv[1].st === 'bad') done.push(kv);
    done.sort((a, b) => a[1].at - b[1].at);
    let extra = this.cache.size - MAX_CACHE;
    for (const [url, e] of done) {
      if (extra <= 0) break;
      this.cache.delete(url);
      disposeSafe(e.img);
      e.img = null;
      extra--;
    }
  }
}

/** instância única usada pelo motor do mapa */
export const mapPhotos = new PhotoLoader();
