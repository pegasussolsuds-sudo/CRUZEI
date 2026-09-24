// Contrato da ponte RN <-> WebView do mapa 3D.
// RN -> WebView: window.cruzei.* via injectJavaScript (todas idempotentes; o HTML enfileira antes do 'ready').
// WebView -> RN: window.ReactNativeWebView.postMessage(JSON.stringify(msg)).
// O HTML (mapbox-html.ts) implementa exatamente estas assinaturas — não mude um lado sem o outro.

import type { NearbyUser, POI } from '@cruzei/shared-types';

export type MapTheme = 'day' | 'dusk' | 'night';
export type PerfTier = 'low' | 'mid' | 'high';
export type InitTier = 'auto' | PerfTier;
export type BurstKind = 'like' | 'super' | 'match';
export type MePremiumTier = 'free' | 'premium' | 'premium_plus';

export interface MeState {
  lat: number;
  lng: number;
  heading: number | null;
  tier: MePremiumTier;
  isBoosted: boolean;
  isAnonymous: boolean;
  photoUrl: string | null;
  name: string;
}

export interface MapDataPayload {
  users: NearbyUser[];
  pois: POI[];
  /** mínimo de userCount pra um POI virar hotspot (default 5 no HTML) */
  hotMin?: number;
}

export interface CameraOpts {
  pitch?: number;
  bearing?: number;
  duration?: number;
}

export interface MapPadding {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
}

export interface BurstPayload {
  lat: number;
  lng: number;
  kind: BurstKind;
}

// ---------- WebView -> RN ----------

export type WebMsg =
  | { type: 'ready'; tier: PerfTier; webgl2: boolean; dpr: number }
  | { type: 'styleLoaded' }
  | { type: 'error'; message: string; fatal: boolean }
  | { type: 'moveend'; lat: number; lng: number; zoom: number; userMoved: boolean }
  | { type: 'userTap'; id: string }
  | { type: 'poiTap'; id: number }
  | { type: 'mapTap' }
  | { type: 'hotspotBorn'; poiId: number; name: string; userCount: number }
  | { type: 'perf'; fps: number }
  | { type: 'photoBlocked'; url: string };

const WEB_MSG_TYPES: ReadonlySet<string> = new Set<WebMsg['type']>([
  'ready',
  'styleLoaded',
  'error',
  'moveend',
  'userTap',
  'poiTap',
  'mapTap',
  'hotspotBorn',
  'perf',
  'photoBlocked',
]);

const PERF_TIERS: ReadonlySet<string> = new Set<PerfTier>(['low', 'mid', 'high']);

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isTier(v: unknown): v is PerfTier {
  return typeof v === 'string' && PERF_TIERS.has(v);
}

/**
 * Faz o parse defensivo do postMessage; devolve null pra payloads que não são do contrato.
 * Valida os campos que o MapScreen usa em lógica (tier, lat/lng, fps, ids) — um `ready` sem tier válido
 * ou um `moveend` com NaN NUNCA chegam tipados como se fossem válidos.
 */
export function parseWebMsg(raw: string): WebMsg | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const m = parsed as Record<string, unknown>;
  const rawType = m.type;
  if (typeof rawType !== 'string' || !WEB_MSG_TYPES.has(rawType)) return null;
  const type = rawType as WebMsg['type'];

  switch (type) {
    case 'ready':
      if (!isTier(m.tier)) return null;
      return { type, tier: m.tier, webgl2: m.webgl2 === true, dpr: isNum(m.dpr) ? m.dpr : 1 };
    case 'styleLoaded':
    case 'mapTap':
      return { type };
    case 'error':
      // sem `fatal` explícito, trata como fatal: melhor mostrar retry do que uma tela preta muda
      return { type, message: typeof m.message === 'string' ? m.message : 'erro no mapa', fatal: typeof m.fatal === 'boolean' ? m.fatal : true };
    case 'moveend':
      if (!isNum(m.lat) || !isNum(m.lng)) return null;
      return { type, lat: m.lat, lng: m.lng, zoom: isNum(m.zoom) ? m.zoom : 0, userMoved: m.userMoved === true };
    case 'userTap':
      return typeof m.id === 'string' && m.id.length > 0 ? { type, id: m.id } : null;
    case 'poiTap':
      return isNum(m.id) ? { type, id: m.id } : null;
    case 'hotspotBorn':
      if (!isNum(m.poiId) || !isNum(m.userCount)) return null;
      return { type, poiId: m.poiId, name: typeof m.name === 'string' ? m.name : '', userCount: m.userCount };
    case 'perf':
      return isNum(m.fps) ? { type, fps: m.fps } : null;
    case 'photoBlocked':
      return typeof m.url === 'string' ? { type, url: m.url } : null;
    default:
      return null;
  }
}

// ---------- RN -> WebView ----------

/** Nome da função em window.cruzei — também usado como chave de "último estado" pra reaplicar após reload. */
export type CommandName =
  | 'setTheme'
  | 'setTier'
  | 'setActive'
  | 'setMe'
  | 'setCenter'
  | 'reveal'
  | 'setData'
  | 'select'
  | 'focusPoi'
  | 'setPadding'
  | 'burst';

function call(fn: CommandName, ...args: unknown[]): string {
  // descarta opcionais finais não informados (zoom/opts) em vez de mandar null pro HTML
  let end = args.length;
  while (end > 0 && args[end - 1] === undefined) end -= 1;
  const serialized = args
    .slice(0, end)
    .map((a) => JSON.stringify(a === undefined ? null : a))
    .join(', ');
  return `window.cruzei.${fn}(${serialized}); true;`;
}

/** Builders tipados: devolvem a string JS a injetar com webRef.injectJavaScript(...). */
export const cmd = {
  setTheme: (theme: MapTheme, animate = true): string => call('setTheme', theme, animate),
  setTier: (tier: PerfTier): string => call('setTier', tier),
  setActive: (active: boolean): string => call('setActive', active),
  setMe: (me: MeState): string => call('setMe', me),
  setCenter: (lat: number, lng: number, zoom?: number, opts?: CameraOpts): string => call('setCenter', lat, lng, zoom, opts),
  reveal: (lat: number, lng: number): string => call('reveal', lat, lng),
  setData: (payload: MapDataPayload): string => call('setData', payload),
  select: (id: string | null): string => call('select', id),
  focusPoi: (id: number): string => call('focusPoi', id),
  setPadding: (padding: MapPadding): string => call('setPadding', padding),
  burst: (payload: BurstPayload): string => call('burst', payload),
} as const;

/**
 * Script de injectedJavaScriptBeforeContentLoaded: clampa o devicePixelRatio ANTES do mapbox-gl criar o canvas
 * (≤ 2 por padrão; ≤ 1.5 no tier low). Androids médios têm DPR 2.6–3.0 — é o maior ganho isolado de GPU.
 * O HTML lê window.devicePixelRatio já clampado.
 */
export function buildBeforeContentLoadedScript(tier: InitTier): string {
  const max = tier === 'low' ? 1.5 : 2;
  return (
    '(function(){' +
    'var max=' +
    String(max) +
    ';var real=window.devicePixelRatio||1;' +
    'try{Object.defineProperty(window,"devicePixelRatio",{configurable:true,get:function(){return Math.min(real,max);}});}catch(e){}' +
    '})(); true;'
  );
}
