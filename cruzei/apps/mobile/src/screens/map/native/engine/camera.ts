import type { ElementRef } from 'react';
import type { Camera, CameraStop } from '@rnmapbox/maps';

/** o rnmapbox não exporta CameraRef na raiz: sai do tipo do componente */
export type CameraRef = ElementRef<typeof Camera>;
import type { LngLat, VisibleBounds } from './geo';

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

/** posição inicial igual à do antigo new mapboxgl.Map (Uberlândia) */
export const INITIAL_CAMERA: CamState = { center: [-48.2772, -18.9186], zoom: 15.5, bearing: -12, pitch: 58, bounds: null };

/**
 * Controle da câmera nativa com as mesmas regras do WebView:
 * - conta as animações "nossas" (programmatic) pra saber se um movimento veio de gesto;
 * - o padding das sheets fica pendente enquanto uma animação nossa roda (aplicar padding interromperia o voo) e entra
 *   no fim dela;
 * - o rnmapbox não avisa quando a animação acaba: o fim é o tempo da animação + folga.
 */
export class CameraCtl {
  state: CamState = { ...INITIAL_CAMERA };
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
  /** animação nossa em curso: o nativo cancela a anterior a cada setCamera, então só existe uma */
  private pending: { timer: ReturnType<typeof setTimeout>; onEnd?: (completed: boolean) => void } | null = null;

  constructor(private readonly getCamera: () => CameraRef | null) {}

  private cameraPadding(p: Padding) {
    return { paddingTop: p.top, paddingBottom: p.bottom, paddingLeft: p.left, paddingRight: p.right };
  }

  /**
   * Anima a câmera. onEnd(true) quando a animação teria terminado; onEnd(false) na hora em que outra animação nossa,
   * um gesto ou stop() a atropela (o nativo já a cancelou) — o contador nunca fica preso esperando um timer velho.
   */
  move(stop: MoveStop, onEnd?: (completed: boolean) => void): void {
    this.cancelPending();
    this.animatedSinceIdle = true;
    const cam = this.getCamera();
    const native: CameraStop = {
      animationDuration: stop.mode === 'none' ? 0 : stop.duration,
      animationMode: stop.mode === 'none' ? 'moveTo' : stop.mode,
    };
    if (stop.center) native.centerCoordinate = stop.center;
    if (stop.zoom != null) native.zoomLevel = stop.zoom;
    if (stop.pitch != null) native.pitch = stop.pitch;
    if (stop.bearing != null) native.heading = stop.bearing;
    this.programmatic = 1;
    try {
      cam?.setCamera(native);
    } catch {
      /* câmera ainda não montada: o fim abaixo mantém o contador certo */
    }
    const entry = {
      timer: setTimeout(
        () => {
          if (this.pending !== entry) return;
          this.pending = null;
          this.endProgrammatic();
          onEnd?.(true);
        },
        (stop.mode === 'none' ? 0 : stop.duration) + 120,
      ),
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
    const cam = this.getCamera();
    try {
      cam?.setCamera({ centerCoordinate: this.state.center, zoomLevel: this.state.zoom, heading: this.state.bearing, pitch: this.state.pitch, animationDuration: 0, animationMode: 'moveTo' });
    } catch {
      /* noop */
    }
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
    try {
      this.getCamera()?.setCamera({ padding: this.cameraPadding(p), animationDuration: 0, animationMode: 'moveTo' });
    } catch {
      /* noop */
    }
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
