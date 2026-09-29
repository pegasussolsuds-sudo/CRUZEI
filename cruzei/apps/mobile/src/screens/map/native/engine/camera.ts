import type { CameraAnimationOptions, CameraEasing, CameraOptions, CameraRef, CameraStop, ViewPadding } from '@maplibre/maplibre-react-native';

import type { LngLat, VisibleBounds } from './geo';

export type { CameraRef };

export interface CamState {
  center: LngLat;
  zoom: number;
  bearing: number;
  pitch: number;
  bounds: VisibleBounds | null;
}

export interface Padding {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export type MoveMode = 'easeTo' | 'flyTo' | 'linearTo' | 'none';

export interface MoveStop {
  center?: LngLat;
  zoom?: number;
  pitch?: number;
  bearing?: number;
  duration: number;
  mode: MoveMode;
}

/** o MapLibre Native Android recusa pitch acima de 60° (MAXIMUM_TILT): todo enquadramento do motor para aqui */
export const MAX_PITCH = 60;

/** posição inicial igual à do antigo new mapboxgl.Map (Uberlândia) */
export const INITIAL_CAMERA: CamState = { center: [-48.2772, -18.9186], zoom: 15.5, bearing: -12, pitch: 58, bounds: null };

const EASING: Record<MoveMode, CameraEasing> = { easeTo: 'ease', flyTo: 'fly', linearTo: 'linear', none: undefined };

/** o nativo lê o padding com getInt (dp) */
function padOf(p: Padding): ViewPadding {
  return { top: Math.round(p.top), bottom: Math.round(p.bottom), left: Math.round(p.left), right: Math.round(p.right) };
}

/**
 * Controle da câmera nativa com as mesmas regras do WebView:
 * - conta as animações "nossas" (programmatic) pra saber se um movimento veio de gesto;
 * - o padding das sheets fica pendente enquanto uma animação nossa ou um gesto roda (aplicar padding interromperia o
 *   voo) e entra no fim dela — ou já dentro do próximo movimento nosso com centro, que anima os dois juntos;
 * - o setStop do MLRN resolve ao despachar, não no fim da animação: o fim é o tempo da animação + folga.
 */
export class CameraCtl {
  state: CamState = { ...INITIAL_CAMERA };
  /** padding aplicado no nativo (todo setStop com centro leva ele: o MLRN zera o padding de um stop com centro sem padding) */
  padding: Padding = { top: 0, bottom: 0, left: 0, right: 0 };
  programmatic = 0;
  gestureActive = false;
  /** houve gesto do usuário desde o último 'idle' */
  gestureSinceIdle = false;
  lastGestureAt = 0;
  /** houve animação nossa desde o último 'moveend' (o movimento não foi do usuário) */
  private animatedSinceIdle = false;

  private pendingPad: Padding | null = null;
  private padTimer: ReturnType<typeof setTimeout> | null = null;
  /** animação nossa em curso: o nativo cancela a anterior a cada setStop, então só existe uma */
  private pending: { timer: ReturnType<typeof setTimeout>; onEnd?: (completed: boolean) => void } | null = null;

  constructor(private readonly getCamera: () => CameraRef | null) {}

  /** setStop sem deixar escapar erro: lança síncrono com a câmera ainda não montada e rejeita se o mapa sumiu */
  private send(stop: CameraStop): void {
    const cam = this.getCamera();
    if (!cam) return;
    try {
      cam.setStop(stop).catch(() => {});
    } catch {
      /* câmera ainda não montada: o fim estimado mantém o contador certo */
    }
  }

  /**
   * Anima a câmera. onEnd(true) quando a animação teria terminado; onEnd(false) na hora em que outra animação nossa,
   * um gesto ou stop() a atropela (o nativo já a cancelou) — o contador nunca fica preso esperando um timer velho.
   */
  move(stop: MoveStop, onEnd?: (completed: boolean) => void): void {
    // padding pendente entra junto num movimento com centro (anima com ele, sem o salto no fim). Antes do
    // cancelPending: o fim da animação anterior aplicaria o padding sozinho, num salto
    if (stop.center && this.pendingPad) {
      this.padding = this.pendingPad;
      this.pendingPad = null;
    }
    this.cancelPending();
    this.animatedSinceIdle = true;
    const duration = stop.mode === 'none' ? 0 : Math.max(0, Math.round(stop.duration));
    const opts: CameraOptions & CameraAnimationOptions = { duration };
    // sem easing (ou duração 0) o nativo usa moveCamera: o 'none' vira salto
    if (duration > 0 && EASING[stop.mode]) opts.easing = EASING[stop.mode];
    if (stop.zoom != null) opts.zoom = stop.zoom;
    if (stop.pitch != null) opts.pitch = Math.min(MAX_PITCH, Math.max(0, stop.pitch));
    if (stop.bearing != null) opts.bearing = stop.bearing;
    const native: CameraStop = stop.center ? { ...opts, center: stop.center, padding: padOf(this.padding) } : opts;
    this.programmatic = 1;
    this.send(native);
    const entry = {
      timer: setTimeout(() => {
        if (this.pending !== entry) return;
        this.pending = null;
        this.endProgrammatic();
        onEnd?.(true);
      }, duration + 120),
      onEnd,
    };
    this.pending = entry;
  }

  /** encerra (sem completar) a animação nossa em curso */
  cancelPending(): void {
    const prev = this.pending;
    if (!prev) return;
    this.pending = null;
    clearTimeout(prev.timer);
    this.endProgrammatic();
    prev.onEnd?.(false);
  }

  /** para a animação em curso (idle-cam): reposiciona na câmera atual sem animar */
  stop(): void {
    this.cancelPending();
    const s = this.state;
    this.send({ center: s.center, zoom: s.zoom, bearing: s.bearing, pitch: s.pitch, padding: padOf(this.padding), duration: 0 });
  }

  private endProgrammatic(): void {
    this.programmatic = Math.max(0, this.programmatic - 1);
    if (this.programmatic === 0) this.flushPadding();
  }

  setPadding(p: Partial<Padding>): void {
    this.pendingPad = { ...this.padding, ...(this.pendingPad ?? {}), ...p };
    if (this.padTimer) return;
    this.padTimer = setTimeout(() => {
      this.padTimer = null;
      this.flushPadding();
    }, 16);
  }

  flushPadding(): void {
    if (!this.pendingPad || this.programmatic > 0 || this.gestureActive) return;
    const p = this.pendingPad;
    this.pendingPad = null;
    const same = p.top === this.padding.top && p.bottom === this.padding.bottom && p.left === this.padding.left && p.right === this.padding.right;
    if (same) return;
    this.padding = p;
    // no MLRN o padding só vale num stop com centro: o centro atual desliza pro meio da área útil nova
    this.send({ center: this.state.center, padding: padOf(p), duration: 0 });
  }

  onCameraChanged(s: CamState, gestureActive: boolean): void {
    this.state = s;
    // gesto do usuário atropela a animação nossa (o nativo já parou): libera o contador e o padding pendente
    if (gestureActive && !this.gestureActive) this.cancelPending();
    if (gestureActive) {
      this.gestureSinceIdle = true;
      this.lastGestureAt = Date.now();
    }
    if (this.gestureActive && !gestureActive) {
      this.gestureActive = false;
      this.flushPadding();
    } else {
      this.gestureActive = gestureActive;
    }
  }

  /** consome a marca de animação nossa (usado no 'moveend') */
  takeAnimated(): boolean {
    const a = this.animatedSinceIdle;
    this.animatedSinceIdle = false;
    return a;
  }

  /** consome a marca de gesto (usado no 'moveend') */
  takeGesture(): boolean {
    const g = this.gestureSinceIdle;
    this.gestureSinceIdle = false;
    return g;
  }

  dispose(): void {
    // encerra a animação em curso chamando o onEnd(false) (pino aparece, giro desliga) antes de soltar os timers
    this.cancelPending();
    if (this.padTimer) clearTimeout(this.padTimer);
    this.padTimer = null;
    // se o motor for reaproveitado (Fast Refresh/StrictMode), nada pode ficar preso esperando um timer que sumiu
    this.programmatic = 0;
    this.gestureActive = false;
  }
}
