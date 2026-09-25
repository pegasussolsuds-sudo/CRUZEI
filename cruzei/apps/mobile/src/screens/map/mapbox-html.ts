// Mapa 3D vivo do Cruzei — Mapbox GL JS v3.7 dentro de react-native-webview (Android).
//
// Contrato com o RN (ver ./bridge.ts): RN -> window.cruzei.* via injectJavaScript; WebView -> postMessage(JSON).
// Regras (painel de design): camadas GL (nunca Marker DOM por pessoa), avatares via canvas -> ImageData,
// tema Day/Dusk/Night por setPaintProperty + fog + lights (NUNCA setStyle), imagens animadas compartilhadas
// (StyleImageInterface) pra sonar/anel/auras, ['zoom'] só no topo de interpolate/step, fontes só DIN Pro /
// Arial Unicode MS, nada de mapboxgl.supported() (não existe no v3), erros de tile nunca são fatais.
//
// ATENÇÃO: este arquivo é uma template string TS — o JS embutido usa concatenação com "+" e NÃO contém a
// sequência cifrão+chave de interpolação de template.

import { buildBeforeContentLoadedScript, type InitTier, type MapTheme } from './bridge';
import { AVATAR_ANIM_JS } from './avatar-anim';
import { IDENTITY_BUBBLE_JS } from './identity-bubble';

export interface MapHtmlInit {
  theme: MapTheme;
  tier: InitTier;
}

export const MAPBOX_BASE_STYLE = 'mapbox://styles/mapbox/streets-v12';

export function buildMapboxHtml(token: string, init: MapHtmlInit = { theme: 'day', tier: 'auto' }): string {
  const tokenJson = JSON.stringify(token);
  const initJson = JSON.stringify(init);
  const dprClamp = buildBeforeContentLoadedScript(init.tier);

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<script>${dprClamp}</script>
<link href="https://api.mapbox.com/mapbox-gl-js/v3.7.0/mapbox-gl.css" rel="stylesheet" />
<script src="https://api.mapbox.com/mapbox-gl-js/v3.7.0/mapbox-gl.js"></script>
<style>
  html, body { margin:0; padding:0; height:100%; width:100%; background:#0A0A1A; overflow:hidden; -webkit-user-select:none; user-select:none; }
  #map { position:absolute; inset:0; }
  #fx { position:absolute; inset:0; pointer-events:none; }
  .mapboxgl-ctrl-logo { opacity:.55; }
  .mapboxgl-ctrl-attrib { font-size:9px; opacity:.65; }
  .mapboxgl-ctrl-bottom-left { bottom:2px; }
</style>
</head>
<body>
<div id="map"></div>
<canvas id="fx"></canvas>
<script>
${AVATAR_ANIM_JS}
${IDENTITY_BUBBLE_JS}
(function () {
  'use strict';
  // ======================================================================
  // 0. Ponte, fila de comandos e guards
  // ======================================================================
  var RN = window.ReactNativeWebView;
  var TOKEN = ${tokenJson};
  var INIT = ${initJson};
  function send(type, payload) {
    try { if (RN) RN.postMessage(JSON.stringify(Object.assign({ type: type }, payload || {}))); } catch (e) {}
  }
  function warn() { try { console.warn.apply(console, arguments); } catch (e) {} }

  var ready = false;
  var queue = [];
  var API = {};
  // window.cruzei existe desde já: antes do 'ready' os comandos ficam na fila e são reaplicados em ordem.
  window.cruzei = {};
  ['setTheme', 'setTier', 'setActive', 'setMe', 'setCenter', 'reveal', 'setData', 'select', 'focusPoi', 'setPadding', 'burst', 'defineAvatars', 'matchMoment', 'emote'].forEach(function (name) {
    window.cruzei[name] = function () {
      var args = Array.prototype.slice.call(arguments);
      if (!ready) { queue.push({ name: name, args: args }); return; }
      try { API[name].apply(null, args); }
      catch (e) { send('error', { message: name + ': ' + (e && e.message ? e.message : String(e)), fatal: false }); }
    };
  });

  var loaded = false;
  window.onerror = function (msg) { send('error', { message: String(msg), fatal: !loaded }); };

  if (!window.mapboxgl) { send('error', { message: 'mapbox-gl não carregou (sem internet?)', fatal: true }); return; }
  var probe = document.createElement('canvas');
  var webgl2 = !!(probe.getContext('webgl2'));
  var webgl1 = webgl2 || !!(probe.getContext('webgl') || probe.getContext('experimental-webgl'));
  if (!webgl1) { send('error', { message: 'WebGL indisponível neste dispositivo', fatal: true }); return; }

  // ======================================================================
  // 1. Paletas (docs 06/17) e estado
  // ======================================================================
  var PALETTES = {
    day:   { bg:'#E8F5E8', water:'#40E0D0', park:'#7FFF00', parkAlpha:0.55, landuse:'#E1EBDD', road:'#FFFFFF', roadCase:'#D6DCD6', primary:'#FFD700', secondary:'#FFF1B8', highway:'#FF6B6B',
             bBase:'#D4D4AA', bTop:'#FAFAFA', text:'#0A0A1A', halo:'#FAFAFA', glow:0.0, fog:['#E8F5E8','#CFE9FF','#DDE8FF'], star:0,
             ambient:['#FFFFFF',0.9], dir:['#FFF8E0',0.55] },
    dusk:  { bg:'#3A2A44', water:'#1E5B6B', park:'#3E7A2A', parkAlpha:0.7, landuse:'#3E3050', road:'#7A6A8A', roadCase:'#2E2438', primary:'#FF7AB8', secondary:'#9A5A88', highway:'#B8FF6B',
             bBase:'#4A3A5E', bTop:'#8A7AA0', text:'#FAFAFA', halo:'#1A1A2A', glow:0.18, fog:['#3A2A44','#FF6B9A','#1A1A2E'], star:0.2,
             ambient:['#FFD1E8',0.6], dir:['#FF9AC8',0.45] },
    night: { bg:'#0A0A1A', water:'#0A3D4D', park:'#1A4D1A', parkAlpha:0.85, landuse:'#101024', road:'#2A2A3A', roadCase:'#12121E', primary:'#FF1493', secondary:'#5A2452', highway:'#7FFF00',
             bBase:'#1A1A2A', bTop:'#3A3A5A', text:'#FAFAFA', halo:'#0A0A1A', glow:0.35, fog:['#0A0A1A','#1A1A3A','#05050F'], star:0.55,
             ambient:['#8AA0FF',0.35], dir:['#FF1493',0.35] }
  };
  var state = {
    theme: (INIT.theme === 'night' || INIT.theme === 'dusk') ? INIT.theme : 'day',
    tier: (INIT.tier === 'low' || INIT.tier === 'mid' || INIT.tier === 'high') ? INIT.tier : 'high',
    active: true,
    located: false,
    me: null,
    users: {},        // id -> user
    pois: {},         // id -> poi
    hotIds: {},       // poiId -> true (hotspots vistos)
    hadData: false,
    hotMin: 5,
    selected: null,
    lastGesture: 0,
    programmatic: 0,  // > 0 enquanto uma animação de câmera nossa roda
    revealed: false,
    firstDataAt: 0,
    momentUserId: null // pessoa em destaque no momento do match (spot)
  };
  var FONTS = ['DIN Pro Medium', 'Arial Unicode MS Regular'];
  // camadas que contam como 'toque numa pessoa' (figura, bolha, ponto, destaque) — usada nos delegados e no click genérico
  var TAP_LAYERS = ['cz-users', 'cz-users-photo', 'cz-users-boost', 'cz-users-boost-photo', 'cz-movers', 'cz-movers-photo', 'cz-spot', 'cz-spot-photo', 'cz-users-dot', 'cz-users-boost-dot', 'cz-movers-dot'];
  var DPR = Math.min(window.devicePixelRatio || 1, 2);

  // ======================================================================
  // 2. Mapa
  // ======================================================================
  mapboxgl.accessToken = TOKEN;
  var map = new mapboxgl.Map({
    container: 'map',
    fadeDuration: 0, // sem cross-fade de símbolos: figuras andando (setData por tick) não deixam rastro
    style: 'mapbox://styles/mapbox/streets-v12',
    center: [-48.2772, -18.9186],
    zoom: 15.5,
    pitch: 58,
    bearing: -12,
    maxPitch: 70,
    minZoom: 10,
    attributionControl: true,
    antialias: false,
    fadeDuration: 250,
    pitchWithRotate: true,
    touchPitch: true
  });
  map.touchZoomRotate.enable();
  map.dragRotate.enable();

  // Gesto real do usuário: 'moveend' com originalEvent. Também pausa a idle-cam por 30s.
  ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart'].forEach(function (ev) {
    map.on(ev, function (e) { if (e && e.originalEvent) { state.lastGesture = Date.now(); idleCam.stop(); } });
  });
  map.on('moveend', function (e) {
    if (state.programmatic === 0) flushPadding();
    if (!state.located) return;
    var c = map.getCenter();
    var userMoved = !!(e && e.originalEvent);
    send('moveend', { lat: c.lat, lng: c.lng, zoom: map.getZoom(), userMoved: userMoved });
  });
  map.on('click', function (e) {
    // tap em pessoa/POI é tratado nos handlers de camada; aqui só o tap no mapa vazio
    var hit = map.queryRenderedFeatures(e.point, { layers: TAP_LAYERS.concat(['cz-poi', 'cz-cluster']) });
    if (!hit || hit.length === 0) send('mapTap');
  });
  map.on('error', function (e) {
    var err = e && e.error;
    var status = err && (err.status || (err.message && /40[13]/.test(err.message) ? 401 : 0));
    if (!loaded || status === 401 || status === 403) {
      send('error', { message: (err && err.message) || 'erro ao carregar o mapa', fatal: true });
    } else {
      warn('[mapbox]', err && err.message);
    }
  });
  var canvasEl = map.getCanvas();
  var ctxLostTimer = null;
  canvasEl.addEventListener('webglcontextlost', function () {
    ctxLostTimer = setTimeout(function () { send('error', { message: 'contexto WebGL perdido', fatal: true }); }, 3000);
  });
  canvasEl.addEventListener('webglcontextrestored', function () { if (ctxLostTimer) clearTimeout(ctxLostTimer); ctxLostTimer = null; });

  // ======================================================================
  // 3. Tema: walker de recolor + prédios 3D + neon + fog + luzes (sem setStyle)
  // ======================================================================
  var themed = false;
  var firstRoadLayerId = null;
  var firstLabelLayerId = null;

  function classifyLayer(l) {
    var id = l.id || '';
    var sl = l['source-layer'] || '';
    if (l.type === 'background') return 'bg';
    if (l.type === 'fill' && sl === 'water') return 'water';
    if (l.type === 'fill' && /park|grass|pitch|garden|wood|scrub|cemetery|national/.test(id)) return 'park';
    if (l.type === 'fill' && (sl === 'landuse' || sl === 'landcover' || sl === 'landuse_overlay')) return 'landuse';
    if (l.type === 'fill' && sl === 'building') return 'building';
    if (l.type === 'line' && sl === 'road') {
      if (/case/.test(id)) return 'roadCase';
      if (/motorway|trunk/.test(id)) return 'highway';
      if (/primary/.test(id)) return 'primary';
      if (/secondary|tertiary/.test(id)) return 'secondary';
      return 'road';
    }
    if (l.type === 'symbol') return 'symbol';
    return null;
  }

  function setPaint(id, prop, value) { try { map.setPaintProperty(id, prop, value); } catch (e) {} }

  function applyTheme(name, animate) {
    var P = PALETTES[name] || PALETTES.day;
    state.theme = name;
    var layers = (map.getStyle() && map.getStyle().layers) || [];
    for (var i = 0; i < layers.length; i++) {
      var l = layers[i];
      var kind = classifyLayer(l);
      if (!kind) continue;
      if (!themed) {
        // registra transições uma vez (800ms)
        var props = { bg: ['background-color'], water: ['fill-color'], park: ['fill-color', 'fill-opacity'], landuse: ['fill-color'],
                      roadCase: ['line-color'], highway: ['line-color'], primary: ['line-color'], secondary: ['line-color'], road: ['line-color'], symbol: ['text-color', 'text-halo-color'] }[kind] || [];
        for (var p = 0; p < props.length; p++) setPaint(l.id, props[p] + '-transition', { duration: animate ? 800 : 0, delay: 0 });
      }
      if (kind === 'bg') setPaint(l.id, 'background-color', P.bg);
      else if (kind === 'water') setPaint(l.id, 'fill-color', P.water);
      else if (kind === 'park') { setPaint(l.id, 'fill-color', P.park); setPaint(l.id, 'fill-opacity', P.parkAlpha); }
      else if (kind === 'landuse') {
        // só verde nas classes de vegetação; aeroporto/hospital/escola ficam neutros
        setPaint(l.id, 'fill-color', ['match', ['get', 'class'], ['park', 'grass', 'pitch', 'garden', 'wood', 'scrub', 'cemetery', 'recreation_ground'], P.park, P.landuse]);
      }
      else if (kind === 'building') { setPaint(l.id, 'fill-opacity', 0); }
      else if (kind === 'roadCase') setPaint(l.id, 'line-color', P.roadCase);
      else if (kind === 'highway') setPaint(l.id, 'line-color', P.highway);
      else if (kind === 'primary') setPaint(l.id, 'line-color', P.primary);
      else if (kind === 'secondary') setPaint(l.id, 'line-color', P.secondary);
      else if (kind === 'road') setPaint(l.id, 'line-color', P.road);
      else if (kind === 'symbol') { setPaint(l.id, 'text-color', P.text); setPaint(l.id, 'text-halo-color', P.halo); }
    }
    themed = true;
    // prédios
    setPaint('cz-3d', 'fill-extrusion-color', ['interpolate', ['linear'], ['get', 'height'], 0, P.bBase, 60, P.bTop]);
    // neon das ruas (só à noite/dusk)
    setPaint('cz-glow-primary', 'line-color', P.primary); setPaint('cz-glow-primary', 'line-opacity', P.glow);
    setPaint('cz-glow-highway', 'line-color', P.highway); setPaint('cz-glow-highway', 'line-opacity', P.glow);
    // labels Cruzei
    ['cz-users-label', 'cz-users-boost-label', 'cz-poi-label'].forEach(function (id) { setPaint(id, 'text-halo-color', P.halo); });
    setPaint('cz-users-label', 'text-color', P.text); setPaint('cz-users-boost-label', 'text-color', P.text);
    setPaint('cz-poi-label', 'text-color', ['case', ['==', ['get', 'hot'], true], '#FF1493', P.text]);
    setPaint('cz-cluster-count', 'text-color', P.text);
    // fog / céu
    try {
      map.setFog({ 'color': P.fog[0], 'high-color': P.fog[1], 'space-color': P.fog[2], 'horizon-blend': name === 'day' ? 0.08 : 0.16, 'star-intensity': P.star, 'range': [0.8, 8] });
    } catch (e) {}
    // luzes 3D (v3): ambiente + direcional; à noite a direcional é magenta e tinge fachadas
    try {
      map.setLights([
        { id: 'ambient', type: 'ambient', properties: { color: P.ambient[0], intensity: P.ambient[1] } },
        { id: 'sun', type: 'directional', properties: { color: P.dir[0], intensity: P.dir[1], direction: [210, 40], 'cast-shadows': false } }
      ]);
    } catch (e) {}
    applyTierEffects();
  }

  // Efeitos caros dependem do tier: flood light rosa no chão (só high + noite), partículas (só high)
  function applyTierEffects() {
    var night = state.theme !== 'day';
    var high = state.tier === 'high';
    setPaint('cz-3d', 'fill-extrusion-flood-light-color', '#FF1493');
    setPaint('cz-3d', 'fill-extrusion-flood-light-intensity', (high && night) ? 0.3 : 0);
    setPaint('cz-3d', 'fill-extrusion-flood-light-ground-radius', (high && night) ? 7 : 0);
    setPaint('cz-3d', 'fill-extrusion-ambient-occlusion-intensity', high ? 0.25 : 0);
    particles.setEnabled(high);
    animImages.setFps(high ? 30 : (state.tier === 'mid' ? 20 : 12));
    if (!high) idleCam.stop();
  }

  function addBaseLayers() {
    var layers = map.getStyle().layers;
    for (var i = 0; i < layers.length; i++) {
      var l = layers[i];
      if (!firstRoadLayerId && l.type === 'line' && l['source-layer'] === 'road') firstRoadLayerId = l.id;
      if (!firstLabelLayerId && l.type === 'symbol' && l.layout && l.layout['text-field']) firstLabelLayerId = l.id;
    }
    // neon por baixo das ruas
    var glowBase = { type: 'line', source: 'composite', 'source-layer': 'road', minzoom: 13,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-blur': 6, 'line-opacity': 0, 'line-emissive-strength': 1,
               'line-width': ['interpolate', ['linear'], ['zoom'], 13, 3, 16, 9, 18, 16] } };
    try {
      map.addLayer(Object.assign({}, glowBase, { id: 'cz-glow-primary', filter: ['in', ['get', 'class'], ['literal', ['primary']]] }), firstRoadLayerId || undefined);
      map.addLayer(Object.assign({}, glowBase, { id: 'cz-glow-highway', filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk']]] }), firstRoadLayerId || undefined);
    } catch (e) { warn('glow layers', e && e.message); }
    // prédios 3D com gradiente vertical; nascem com altura 0 e crescem (vertical-scale)
    try {
      map.addLayer({
        id: 'cz-3d', type: 'fill-extrusion', source: 'composite', 'source-layer': 'building', minzoom: 14,
        filter: ['==', ['get', 'extrude'], 'true'],
        paint: {
          'fill-extrusion-color': '#D4D4AA',
          'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 14, 0, 15.2, ['get', 'height']],
          'fill-extrusion-base': ['interpolate', ['linear'], ['zoom'], 14, 0, 15.2, ['get', 'min_height']],
          'fill-extrusion-opacity': 0.85,
          'fill-extrusion-vertical-gradient': true,
          'fill-extrusion-vertical-scale': 0,
          'fill-extrusion-emissive-strength': 0.05
        }
      }, firstLabelLayerId || undefined);
    } catch (e) { warn('3d layer', e && e.message); }
  }

  function growBuildings() {
    // 'prédios crescendo' no primeiro load: tween único de 900ms (não é por frame permanente)
    var t0 = performance.now();
    (function step() {
      var k = Math.min(1, (performance.now() - t0) / 900);
      var eased = 1 - Math.pow(1 - k, 3);
      setPaint('cz-3d', 'fill-extrusion-vertical-scale', eased);
      if (k < 1) requestAnimationFrame(step);
    })();
  }

  // ======================================================================
  // 4. Imagens: avatares, POIs, imagens animadas compartilhadas
  // ======================================================================
  var IMG = { fig: { w: 72, h: 112 }, figBoost: { w: 96, h: 150 }, bubble: { w: 56, h: 62 }, poi: 44, sonar: 120, ring: 72, aura: 110 };
  var FIG_TOP = 14, FIG_PAD = 18; // margem em cima (pulos/braços levantados) e embaixo (poça de luz da aura)
  function figScale(dim) { return (dim.h - FIG_TOP - FIG_PAD) / 140; }
  function figOffset(dim) { return dim.h - (FIG_TOP + 134 * figScale(dim)); }
  // bolha de identidade: círculo de 42 px dentro de um canvas 56x62 (margem pra sombra/brilho + rabicho até y=53)
  var BUB = { d: 42, cx: 28, cy: 27, tip: 53 };
  var PHOTO_MIN_ZOOM = 14; // abaixo disso só o avatar simplificado (LOD §8)
  var FAR_ZOOM = 13;       // abaixo disso a figura vira um ponto pequeno (LOD §8: longe = "tem alguém ali")
  // y do topo da cabeça relativo ao pé (negativo, em px da imagem da figura); 4 unidades de folga pra chapéu/cabelo
  function headTop(dim) { return figOffset(dim) - dim.h + FIG_TOP + 4 * figScale(dim); }
  // icon-offset da bolha (âncora bottom): a ponta do rabicho fica 2 px acima da cabeça
  function bubbleOffset(dim) { return headTop(dim) - 2 + (IMG.bubble.h - BUB.tip); }
  var CAT_EMOJI = { bar:'🍺', restaurant:'🍽️', cafe:'☕', park:'🌳', shopping:'🏬', gym:'🏋️', show:'🎸', event:'⚡', beach:'🏖️', museum:'🏛️', other:'📍' };
  var imgCache = {};        // imageId -> signature (POIs e imagens estáticas compartilhadas)
  var avatarDefs = {};      // avatarKey -> { l: camadas vetoriais, p: pivôs do rig } (vem do RN via defineAvatars)
  var keyWaiters = {};      // avatarKey -> { userId: true } (quem ainda está com silhueta esperando a definição)
  var AURA_RGB = { lime: '127,255,0', magenta: '255,20,147', gold: '255,215,0', fest: '255,111,177' };

  function makeCanvasWH(w, h) { var c = document.createElement('canvas'); c.width = w * 2; c.height = h * 2; var ctx = c.getContext('2d', { willReadFrequently: true }); ctx.scale(2, 2); return { c: c, ctx: ctx, w: w, h: h }; }
  function makeCanvas(size) { return makeCanvasWH(size, size); }
  function imageDataOf(cv) { return cv.ctx.getImageData(0, 0, cv.c.width, cv.c.height); }
  function putImage(id, cv) {
    var data = imageDataOf(cv);
    try {
      if (map.hasImage(id)) map.updateImage(id, data);
      else map.addImage(id, data, { pixelRatio: 2 });
    } catch (e) { warn('image', id, e && e.message); }
  }
  function isRecent(iso, minutes) { if (!iso) return true; var t = Date.parse(iso); return !isNaN(t) && (Date.now() - t) < minutes * 60000; }
  function distM(a, b) { var dy = (b[1] - a[1]) * 111320, dx = (b[0] - a[0]) * 111320 * Math.cos(a[1] * Math.PI / 180); return Math.sqrt(dx * dx + dy * dy); }

  // Desenha as camadas vetoriais paradas (pose neutra) — Path2D aceita o mesmo 'd' do react-native-svg
  function drawLayers(ctx, layers, x, y, scale, mirror) {
    ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
    if (mirror) { ctx.translate(100, 0); ctx.scale(-1, 1); }
    for (var i = 0; i < layers.length; i++) {
      var l = layers[i]; var p;
      try { p = new Path2D(l.d); } catch (e) { continue; }
      ctx.globalAlpha = (l.o == null) ? 1 : l.o;
      if (l.f) { ctx.fillStyle = l.f; ctx.fill(p, l.r || 'nonzero'); }
      if (l.s) { ctx.lineWidth = l.w || 1; ctx.lineCap = l.c || 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = l.s; ctx.stroke(p); }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }
  // Silhueta neutra enquanto a definição do avatar não chegou (nunca fica sem boneco)
  function drawSilhouette(ctx, x, y, scale) {
    ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
    ctx.beginPath(); ctx.ellipse(50, 135, 26, 5, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fill();
    ctx.fillStyle = '#8A8A96';
    ctx.beginPath(); ctx.arc(50, 33, 21, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(31, 60, 38, 36); ctx.fillRect(34, 94, 13, 34); ctx.fillRect(53, 94, 13, 34);
    ctx.fillRect(20, 62, 10, 36); ctx.fillRect(70, 62, 10, 36);
    ctx.restore();
  }
  function figureAura(u) {
    if (u.isBoosted) return AURA_RGB.gold;
    if (u.aura && AURA_RGB[u.aura]) return AURA_RGB[u.aura];
    if (u.premiumTier === 'premium_plus') return AURA_RGB.magenta;
    return null;
  }
  // Figura em pé: poça de luz (aura) no chão, avatar vetorial (parado ou com pose), anel de presença, selo verificado
  function drawFigure(cv, u, def, pose, mirror) {
    var ctx = cv.ctx, w = cv.w, h = cv.h;
    ctx.clearRect(0, 0, w, h);
    var scale = figScale({ w: w, h: h });
    var x = (w - 100 * scale) / 2, y = FIG_TOP;
    var footY = y + 134 * scale, cx = w / 2;
    var aura = figureAura(u);
    if (aura) {
      var g = ctx.createRadialGradient(cx, footY - 2, 3, cx, footY - 2, w * 0.5);
      g.addColorStop(0, 'rgba(' + aura + ',0.65)'); g.addColorStop(1, 'rgba(' + aura + ',0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(cx, footY - 2, w * 0.5, w * 0.24, 0, 0, Math.PI * 2); ctx.fill();
    }
    if (def && def.l) {
      if (pose) CZ_ANIM.drawPosed(ctx, def.l, def.p, pose, x, y, scale, mirror);
      else drawLayers(ctx, def.l, x, y, scale, mirror);
    } else drawSilhouette(ctx, x, y, scale);
    var ring = isRecent(u.recordedAt, 15) ? '#7FFF00' : '#FFD700';
    ctx.strokeStyle = ring; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(cx, footY - 3, w * 0.36, w * 0.13, 0, 0, Math.PI * 2); ctx.stroke();
    if (u.premiumTier === 'premium' || u.premiumTier === 'premium_plus') { ctx.strokeStyle = '#FF1493'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(cx, footY - 3, w * 0.43, w * 0.16, 0, 0, Math.PI * 2); ctx.stroke(); }
    if (u.isVerified) {
      var bx = x + 76 * scale, by = y + 18 * scale, br = 5 * scale + 2;
      ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); ctx.arc(bx, by, br + 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#008B8B'; ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 1.8; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(bx - br * 0.45, by); ctx.lineTo(bx - br * 0.1, by + br * 0.38); ctx.lineTo(bx + br * 0.5, by - br * 0.4); ctx.stroke();
    }
    if (u.isAnonymous) {
      // modo invisível: só EU me vejo, e meio apagado — lembrete visual do estado
      ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = 'rgba(10,10,26,0.5)'; ctx.fillRect(0, 0, w, h); ctx.globalCompositeOperation = 'source-over';
    }
  }

  function avatarSignature(u) { return [u.avatarKey || '', isRecent(u.recordedAt, 15) ? 1 : 0, u.isBoosted ? 1 : 0, u.premiumTier || 'free', u.isVerified ? 1 : 0, u.aura || '', u.isAnonymous ? 1 : 0].join('|'); }

  // ======================================================================
  // 4b. Figuras vivas: uma imagem (StyleImageInterface) por pessoa. Parada custa zero (render() sai cedo);
  //     as mais perto do centro (LOD) ganham pose por tick; emotes/caminhada ligam a animação sob demanda.
  // ======================================================================
  var figs = {}; // id -> fig
  function figOf(id) {
    var f = figs[id];
    if (!f) {
      f = figs[id] = { id: id, st: 'idle', since: 0, one: null, move: null, pos: null, mirror: false, animated: false, wasLive: false, force: 0,
        v: { ph: CZ_ANIM.hash01(id, 'ph'), sp: 0.85 + 0.3 * CZ_ANIM.hash01(id, 'sp'), en: 0.9 + 0.2 * CZ_ANIM.hash01(id, 'en') },
        sz: 0.96 + 0.08 * CZ_ANIM.hash01(id, 'sz'), obj: null, dim: null, sig: '', imgId: '', user: null, lastPose: null, blendFrom: null, blendAt: 0, ph: null, leaving: 0, moment: false };
    }
    return f;
  }
  function figState(f) { if (f.one) return f.one.name; if (f.move) return f.move.run ? 'run' : 'walk'; return 'idle'; }
  function figIsLive(f, now) { return !!(f.animated || f.one || f.move || f.force > now); }
  function figPose(f, now) {
    var st = figState(f);
    if (st !== f.st || !f.lastPose) {
      f.blendFrom = f.lastPose; f.blendAt = now; f.st = st;
      f.since = f.one ? f.one.start : (f.move ? f.move.start : now);
    }
    var p = CZ_ANIM.pose(st, (now - f.since) / 1000, f.v);
    if (f.blendFrom) { var k = (now - f.blendAt) / 220; if (k >= 1) f.blendFrom = null; else p = CZ_ANIM.blend(f.blendFrom, p, k); }
    f.lastPose = p;
    return p;
  }
  function makeFigImage(f, dim) {
    var cv = makeCanvasWH(dim.w, dim.h);
    return {
      width: dim.w * 2, height: dim.h * 2, data: new Uint8ClampedArray(dim.w * 2 * dim.h * 2 * 4), dirty: true,
      onAdd: function () {}, onRemove: function () {},
      render: function () {
        if (!this.dirty) return false;
        this.dirty = false;
        var u = f.user; if (!u) return false;
        var now = performance.now();
        var def = u.avatarKey ? avatarDefs[u.avatarKey] : null;
        drawFigure(cv, u, def, figIsLive(f, now) ? figPose(f, now) : null, f.mirror);
        this.data = imageDataOf(cv).data;
        return true;
      }
    };
  }
  // Garante a imagem da figura (silhueta imediata; avatar real quando a definição da chave existir). Retorna o imageId.
  function ensureAvatar(u, imageId) {
    var id = imageId || ('av-' + u.id);
    var f = figOf(u.id); f.user = u; f.imgId = id;
    syncBubble(f);
    var dim = u.isBoosted ? IMG.figBoost : IMG.fig;
    var sig = avatarSignature(u);
    if (u.avatarKey && !avatarDefs[u.avatarKey]) { (keyWaiters[u.avatarKey] = keyWaiters[u.avatarKey] || {})[u.id] = true; }
    if (!f.obj || f.dim !== dim) {
      if (f.obj) { try { map.removeImage(id); } catch (e) {} }
      f.obj = makeFigImage(f, dim); f.dim = dim; f.sig = sig;
      try { map.addImage(id, f.obj, { pixelRatio: 2 }); } catch (e) { warn('fig image', id, e && e.message); }
    } else if (f.sig !== sig) { f.sig = sig; f.obj.dirty = true; }
    return id;
  }
  function removeFig(id) {
    var f = figs[id]; if (!f) return;
    try { if (f.imgId) map.removeImage(f.imgId); } catch (e) {}
    dropBubble(f);
    delete figs[id];
  }
  // ======================================================================
  // 4c. Bolha de identidade: foto real (thumb) flutuando acima do avatar. Uma imagem por pessoa, criada só quando ela
  //     entra na viewport com zoom >= PHOTO_MIN_ZOOM (lazy); transparente até o thumb chegar (fade 300 ms); vazia se a
  //     foto falhar (o avatar segue sozinho — nunca quebra o mapa). Estilo por estado: online, em alta, match, novo,
  //     selecionado, momento do match.
  // ======================================================================
  function bubbleStyle(u, f) {
    var o = { d: BUB.d, ring: 'rgba(250,250,250,0.92)', ringW: 2, glow: null, dot: isRecent(u.recordedAt, 15) ? '#7FFF00' : null, badge: null, tail: true };
    if (u.isBoosted) { o.ring = '#FFD700'; o.glow = 'rgba(255,215,0,0.5)'; }
    if (u.matchId) { o.ring = '#FF1493'; o.badge = 'match'; }
    else if (u.isNew) o.badge = 'new';
    if (f.moment) { o.ring = '#FF1493'; o.glow = 'rgba(255,20,147,0.85)'; o.ringW = 2.5; o.badge = 'match'; }
    if (state.selected && state.selected === u.id) { o.ring = '#7FFF00'; o.glow = 'rgba(127,255,0,0.75)'; o.ringW = 2.5; }
    return o;
  }
  function bubbleSig(u, f) { var o = bubbleStyle(u, f); return [u.photo || '', o.ring, o.glow || '', o.dot || '', o.badge || '', o.ringW].join('|'); }
  function makeBubbleImage(f) {
    var dim = IMG.bubble, cv = makeCanvasWH(dim.w, dim.h);
    return {
      width: dim.w * 2, height: dim.h * 2, data: new Uint8ClampedArray(dim.w * 2 * dim.h * 2 * 4), dirty: true,
      onAdd: function () {}, onRemove: function () {},
      render: function () {
        if (!this.dirty) return false;
        this.dirty = false;
        var u = f.user, ph = f.ph; if (!u || !ph) return false;
        cv.ctx.clearRect(0, 0, dim.w, dim.h);
        var th = CZ_PHOTO.thumb(ph.url);
        if (th) {
          var o = bubbleStyle(u, f);
          o.alpha = ph.since ? Math.min(1, (performance.now() - ph.since) / 300) : 1;
          CZ_PHOTO.drawBubble(cv.ctx, th, BUB.cx, BUB.cy, o);
        }
        this.data = imageDataOf(cv).data;
        return true;
      }
    };
  }
  // cria a bolha (se a pessoa tem foto e não está anônima) e pede o thumb com a prioridade dada (menor = antes).
  // Devolve true quando a feature precisa ser reenviada (bolha nova → propriedade 'ph').
  function ensureBubble(f, pri) {
    var u = f.user; if (!u) return false;
    var url = u.isAnonymous ? null : (u.photo || null);
    if (!url) { if (f.ph) { dropBubble(f); return true; } return false; }
    if (f.ph && f.ph.url !== url) dropBubble(f);
    var ra = CZ_PHOTO.retryAt(url);
    if (!f.ph && ra > Date.now()) { f.phWait = ra; return false; } // falhou há pouco: sem bolha até a próxima tentativa
    var created = false;
    if (!f.ph) {
      f.ph = { url: url, imgId: 'ph-' + f.id, obj: makeBubbleImage(f), since: 0, fadeUntil: 0, sig: '' };
      try { map.addImage(f.ph.imgId, f.ph.obj, { pixelRatio: 2 }); } catch (e) { warn('bubble image', f.id, e && e.message); }
      created = true;
    }
    var ph = f.ph;
    if (CZ_PHOTO.status(url) === 'ok') { if (!ph.since) ph.since = 1; }
    else {
      CZ_PHOTO.request(url, pri, function (ok) {
        if (f.ph !== ph) return; // trocou de foto no meio
        if (!ok) { f.phWait = CZ_PHOTO.retryAt(url); dropBubble(f); pushUsers(); return; } // falhou: sem bolha (nem alvo de toque vazio)
        ph.since = performance.now(); ph.fadeUntil = ph.since + 340; ph.obj.dirty = true; map.triggerRepaint();
      });
    }
    var sig = bubbleSig(u, f);
    if (sig !== ph.sig) { ph.sig = sig; ph.obj.dirty = true; }
    return created;
  }
  // refetch trouxe a pessoa de novo: foto trocou/sumiu → descarta (o LOD recria); estado mudou → redesenha
  function syncBubble(f) {
    if (!f.ph) return;
    var u = f.user, url = u.isAnonymous ? null : (u.photo || null);
    if (!url || url !== f.ph.url) { dropBubble(f); return; }
    var sig = bubbleSig(u, f);
    if (sig !== f.ph.sig) { f.ph.sig = sig; f.ph.obj.dirty = true; }
  }
  function refreshBubble(id) { var f = figs[id]; if (f && f.user) syncBubble(f); }
  function dropBubble(f) { if (!f.ph) return; try { map.removeImage(f.ph.imgId); } catch (e) {} f.ph = null; }

  // RN manda { avatarKey: { l, p } } só pras chaves que o WebView ainda não conhece (cache por visual, não por pessoa)
  function defineAvatars(defs) {
    if (!defs) return;
    var touched = false;
    for (var key in defs) {
      var d = defs[key];
      if (!d || !d.l || !d.l.length) continue;
      avatarDefs[key] = d;
      var waiting = keyWaiters[key]; delete keyWaiters[key];
      if (waiting) { for (var uid in waiting) { var wf = figs[uid]; if (wf && wf.obj) { wf.obj.dirty = true; touched = true; } } }
    }
    if (touched) map.triggerRepaint();
  }
  // emote: reação curta (wave | like | celebrate | match | arrive); força a figura a animar mesmo fora do LOD
  function emote(id, kind) {
    var f = figs[id]; if (!f || !CZ_ANIM.DUR[kind]) return;
    var now = performance.now();
    f.one = { name: kind, start: now };
    f.force = now + CZ_ANIM.DUR[kind] * 1000 + 300;
    if (f.obj) f.obj.dirty = true;
    map.triggerRepaint();
  }
  // caminhada: da posição atual até to, em tempo proporcional à distância (1,5 m/s; 1,2–9 s). Longe demais = teleporte.
  function startMove(f, to, now) {
    if (!f.pos) { f.pos = to; return; }
    var d = distM(f.pos, to);
    if (d < 3) { f.pos = to; return; }
    if (d > 600) { f.mirror = to[0] < f.pos[0]; f.pos = to; f.move = null; return; }
    f.mirror = to[0] < f.pos[0];
    f.move = { from: f.pos.slice(), to: to, start: now, dur: Math.min(9000, Math.max(1200, (d / 1.5) * 1000)), run: d > 120 };
  }
  function ensurePoiImage(p, hot) {
    var isEvent = p.category === 'event';
    var id = hot ? 'poi-hot' : (isEvent ? 'poi-event' : ('poi-' + (p.category || 'other') + (p.isPartner ? '-partner' : '')));
    if (imgCache[id]) return id;
    imgCache[id] = '1';
    var size = IMG.poi, cv = makeCanvas(size), ctx = cv.ctx, c = size / 2;
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 5; ctx.shadowOffsetY = 2;
    ctx.fillStyle = (hot || isEvent) ? '#FF1493' : '#FFD700'; ctx.beginPath(); ctx.arc(c, c, c - 5, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    ctx.strokeStyle = (p.isPartner && !hot) ? '#FF1493' : '#FFFFFF'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(c, c, c - 5, 0, Math.PI * 2); ctx.stroke();
    if (hot) { ctx.fillStyle = '#FFFFFF'; ctx.font = '700 16px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('🔥', c, c + 1); }
    else if (isEvent) { ctx.fillStyle = '#FFFFFF'; ctx.font = '700 17px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('⚡', c, c + 1); }
    else { ctx.font = '19px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(CAT_EMOJI[p.category] || CAT_EMOJI.other, c, c + 1); }
    putImage(id, cv);
    return id;
  }

  // ---- imagens animadas compartilhadas (StyleImageInterface): 1 canvas por imagem, 1 triggerRepaint por tick ----
  var animImages = (function () {
    var list = [], fps = 30, lastTick = 0, running = false, rafId = null, phase = 0;
    function makeAnim(id, size, draw) {
      var cv = makeCanvas(size);
      var obj = {
        width: size * 2, height: size * 2, data: new Uint8ClampedArray(size * 2 * size * 2 * 4), dirty: true,
        onAdd: function () {}, onRemove: function () {},
        render: function () {
          if (!this.dirty) return false;
          this.dirty = false;
          cv.ctx.clearRect(0, 0, size, size);
          draw(cv.ctx, size, phase);
          this.data = imageDataOf(cv).data;
          return true;
        }
      };
      try { map.addImage(id, obj, { pixelRatio: 2 }); } catch (e) { warn('anim image', id, e && e.message); }
      list.push(obj);
      return obj;
    }
    function tick(now) {
      rafId = null;
      if (!running) return;
      if (fps > 0 && now - lastTick >= 1000 / fps) {
        lastTick = now;
        phase = (now / 1000) % 1000;
        for (var i = 0; i < list.length; i++) list[i].dirty = true;
        try { figTick(now); } catch (e) { warn('figTick', e && e.message); }
        map.triggerRepaint();
      }
      rafId = requestAnimationFrame(tick);
    }
    return {
      make: makeAnim,
      setFps: function (f) { fps = f; if (f === 0) { for (var i = 0; i < list.length; i++) list[i].dirty = true; map.triggerRepaint(); } },
      start: function () { if (running) return; running = true; if (!rafId) rafId = requestAnimationFrame(tick); },
      stop: function () { running = false; if (rafId) { cancelAnimationFrame(rafId); rafId = null; } }
    };
  })();

  // sonar do hotspot: N anéis defasados (5-9 → 1, 10-19 → 2, 20+ → 3), período menor com mais gente
  function sonarDrawer(rings, period) {
    return function (ctx, size, phase) {
      var c = size / 2, maxR = c - 2;
      for (var i = 0; i < rings; i++) {
        var t = ((phase / period) + i / rings) % 1;
        var r = 10 + (maxR - 10) * t;
        ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,20,147,' + (0.85 * (1 - t)).toFixed(3) + ')'; ctx.lineWidth = 4; ctx.stroke();
      }
      var g = ctx.createRadialGradient(c, c, 0, c, c, maxR * 0.7); g.addColorStop(0, 'rgba(255,20,147,0.28)'); g.addColorStop(1, 'rgba(255,20,147,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c, c, maxR * 0.7, 0, Math.PI * 2); ctx.fill();
    };
  }
  function meRingDrawer(ctx, size, phase) {
    var c = size / 2, t = phase % 2.2 / 2.2, r = 14 + (c - 6 - 14) * t;
    ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(127,255,0,' + (0.7 * (1 - t)).toFixed(3) + ')'; ctx.lineWidth = 2.5; ctx.stroke();
    var g = ctx.createRadialGradient(c, c, 0, c, c, 22); g.addColorStop(0, 'rgba(127,255,0,0.35)'); g.addColorStop(1, 'rgba(127,255,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c, c, 22, 0, Math.PI * 2); ctx.fill();
  }
  function selRingDrawer(ctx, size, phase) {
    var c = size / 2, pulse = 0.5 + 0.5 * Math.sin(phase * 4);
    ctx.beginPath(); ctx.arc(c, c, c - 6 - 3 * pulse, 0, Math.PI * 2); ctx.strokeStyle = '#7FFF00'; ctx.lineWidth = 3; ctx.stroke();
  }
  function auraDrawer(color) {
    return function (ctx, size, phase) {
      var c = size / 2, pulse = 0.85 + 0.15 * Math.sin(phase * 3);
      var g = ctx.createRadialGradient(c, c, c * 0.35, c, c, c * pulse); g.addColorStop(0, color + '0.45)'); g.addColorStop(1, color + '0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c, c, c, 0, Math.PI * 2); ctx.fill();
    };
  }

  // ======================================================================
  // 5. Sources e camadas Cruzei
  // ======================================================================
  // feature-state só funciona em paint: a entrada escalonada usa icon-opacity ('a'); icon-size (layout) é fixo por zoom
  var S_ALPHA = ['coalesce', ['feature-state', 'a'], 1];
  // lugar em alta / evento aparece maior ('zoom' só pode ser raiz do interpolate; o fator entra nas saídas)
  var POI_SCALE = ['case', ['==', ['get', 'hot'], true], 1.3, ['==', ['get', 'event'], true], 1.15, 1];
  function addCruzeiLayers() {
    map.addSource('users', { type: 'geojson', data: empty(), cluster: true, maxzoom: 22, clusterMaxZoom: 21, clusterRadius: 70, promoteId: 'id' });
    map.addSource('users-boost', { type: 'geojson', data: empty(), promoteId: 'id' });
    map.addSource('pois', { type: 'geojson', data: empty(), promoteId: 'id' });
    map.addSource('me', { type: 'geojson', data: empty() });
    map.addSource('sel', { type: 'geojson', data: empty() });
    map.addSource('fx', { type: 'geojson', data: empty(), promoteId: 'id' });
    map.addSource('spot', { type: 'geojson', data: empty(), promoteId: 'id' }); // pessoa em destaque (selecionada / momento do match): sai do cluster e fica por cima, maior
    map.addSource('movers', { type: 'geojson', data: empty(), promoteId: 'id' }); // quem está andando (posição interpolada por tick; fora do cluster)

    animImages.make('sonar-1', IMG.sonar, sonarDrawer(1, 2.4));
    animImages.make('sonar-2', IMG.sonar, sonarDrawer(2, 1.9));
    animImages.make('sonar-3', IMG.sonar, sonarDrawer(3, 1.4));
    animImages.make('me-ring', IMG.ring, meRingDrawer);
    animImages.make('sel-ring', IMG.aura, selRingDrawer);
    animImages.make('aura-boost', IMG.aura, auraDrawer('rgba(255,215,0,'));
    animImages.make('aura-plus', IMG.aura, auraDrawer('rgba(255,20,147,'));

    // auras (boost/premium+) por baixo dos avatares
    map.addLayer({ id: 'cz-aura', type: 'symbol', source: 'users', filter: ['all', ['!', ['has', 'point_count']], ['has', 'aura']],
      layout: { 'icon-image': ['get', 'aura'], 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-pitch-alignment': 'map',
                'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.5, 16, 0.9, 18, 1.2] },
      paint: { 'icon-opacity': S_ALPHA, 'icon-emissive-strength': 1 } });
    map.addLayer({ id: 'cz-aura-boost', type: 'symbol', source: 'users-boost',
      layout: { 'icon-image': 'aura-boost', 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-pitch-alignment': 'map',
                'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.8, 16, 1.4, 18, 1.8] },
      paint: { 'icon-opacity': S_ALPHA, 'icon-emissive-strength': 1 } });
    // sonar dos hotspots: acima das auras, abaixo dos avatares — anéis grandes pra ler de longe
    map.addLayer({ id: 'cz-hot-sonar', type: 'symbol', source: 'pois', filter: ['any', ['==', ['get', 'hot'], true], ['==', ['get', 'event'], true]],
      layout: { 'icon-image': ['get', 'sonar'], 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-pitch-alignment': 'viewport',
                'icon-size': ['interpolate', ['linear'], ['zoom'], 13, 1.0, 16, 1.8, 18, 2.4] },
      paint: { 'icon-emissive-strength': 1 } });
    // POIs
    map.addLayer({ id: 'cz-poi', type: 'symbol', source: 'pois',
      layout: { 'icon-image': ['get', 'img'], 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-anchor': 'center',
                'icon-size': ['interpolate', ['linear'], ['zoom'], 12, ['*', 0.55, POI_SCALE], 15, ['*', 0.8, POI_SCALE], 18, ['*', 1.0, POI_SCALE]] },
      paint: { 'icon-emissive-strength': 1 } });
    map.addLayer({ id: 'cz-poi-label', type: 'symbol', source: 'pois', minzoom: 14.5,
      layout: { 'text-field': ['step', ['zoom'], '', 15, ['get', 'label']], 'text-font': FONTS, 'text-size': 11, 'text-anchor': 'top', 'text-offset': [0, 1.6],
                'text-max-width': 9, 'text-optional': true, 'text-line-height': 1.15 },
      paint: { 'text-color': '#0A0A1A', 'text-halo-color': '#FAFAFA', 'text-halo-width': 1.3, 'text-emissive-strength': 1 } });
    // clusters
    map.addLayer({ id: 'cz-cluster', type: 'circle', source: 'users', filter: ['has', 'point_count'],
      paint: { 'circle-color': '#12122A', 'circle-radius': ['step', ['get', 'point_count'], 19, 10, 23, 30, 28], 'circle-stroke-color': '#7FFF00', 'circle-stroke-width': 2.5, 'circle-emissive-strength': 1, 'circle-pitch-alignment': 'viewport' } });
    map.addLayer({ id: 'cz-cluster-count', type: 'symbol', source: 'users', filter: ['has', 'point_count'],
      layout: { 'icon-image': 'people-icon', 'icon-size': 0.5, 'icon-offset': [-22, 0], 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-pitch-alignment': 'viewport',
                'text-field': ['get', 'point_count_abbreviated'], 'text-font': FONTS, 'text-size': 13, 'text-offset': [0.55, 0], 'text-allow-overlap': true, 'text-ignore-placement': true, 'text-pitch-alignment': 'viewport' },
      paint: { 'text-color': '#FFFFFF', 'text-emissive-strength': 1, 'icon-emissive-strength': 1 } });
    // pessoas
    // 'off' (pés no ponto) e 'sz' (variação de escala por pessoa) vêm nas propriedades da feature
    var SIZE_N = [0.42, 0.72, 0.95], SIZE_B = [0.5, 0.85, 1.1];
    function sizeExpr(b) { return ['interpolate', ['linear'], ['zoom'], 12, ['*', b[0], ['get', 'sz']], 15, ['*', b[1], ['get', 'sz']], 18, ['*', b[2], ['get', 'sz']]]; }
    var userLayout = function (boost) {
      return { 'icon-image': ['get', 'img'], 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-anchor': 'bottom',
               'icon-pitch-alignment': 'viewport', 'icon-rotation-alignment': 'viewport', 'icon-offset': ['get', 'off'], 'icon-size': sizeExpr(boost ? SIZE_B : SIZE_N) };
    };
    // bolha de identidade: mesma escala da figura (o offset 'poff' é em px da figura → composição consistente em todo zoom)
    var photoLayout = function (boost) {
      return { 'icon-image': ['get', 'ph'], 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-anchor': 'bottom',
               'icon-pitch-alignment': 'viewport', 'icon-rotation-alignment': 'viewport', 'icon-offset': ['get', 'poff'], 'icon-size': sizeExpr(boost ? SIZE_B : SIZE_N) };
    };
    // longe (zoom < FAR_ZOOM): só um ponto por pessoa — a figura inteira não lê nesse zoom e vira ruído
    var dotPaint = { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 13, 4], 'circle-color': '#7FFF00', 'circle-stroke-color': '#0A0A1A', 'circle-stroke-width': 1.2, 'circle-opacity': S_ALPHA, 'circle-emissive-strength': 1, 'circle-pitch-alignment': 'map' };
    map.addLayer({ id: 'cz-users-dot', type: 'circle', source: 'users', maxzoom: FAR_ZOOM, filter: ['!', ['has', 'point_count']], paint: dotPaint });
    map.addLayer({ id: 'cz-users-boost-dot', type: 'circle', source: 'users-boost', maxzoom: FAR_ZOOM, paint: Object.assign({}, dotPaint, { 'circle-color': '#FFD700' }) });
    map.addLayer({ id: 'cz-movers-dot', type: 'circle', source: 'movers', maxzoom: FAR_ZOOM, paint: dotPaint });
    map.addLayer({ id: 'cz-users', type: 'symbol', source: 'users', minzoom: FAR_ZOOM, filter: ['!', ['has', 'point_count']], layout: userLayout(false), paint: { 'icon-opacity': S_ALPHA, 'icon-emissive-strength': 1 } });
    map.addLayer({ id: 'cz-users-photo', type: 'symbol', source: 'users', minzoom: PHOTO_MIN_ZOOM, filter: ['all', ['!', ['has', 'point_count']], ['has', 'ph']], layout: photoLayout(false), paint: { 'icon-opacity': S_ALPHA, 'icon-emissive-strength': 1 } });
    map.addLayer({ id: 'cz-users-boost', type: 'symbol', source: 'users-boost', minzoom: FAR_ZOOM, layout: userLayout(true), paint: { 'icon-opacity': S_ALPHA, 'icon-emissive-strength': 1 } });
    map.addLayer({ id: 'cz-users-boost-photo', type: 'symbol', source: 'users-boost', minzoom: PHOTO_MIN_ZOOM, filter: ['has', 'ph'], layout: photoLayout(true), paint: { 'icon-opacity': S_ALPHA, 'icon-emissive-strength': 1 } });
    // nome curto ("Leonardo S.") embaixo dos pés: texto GL (nítido em qualquer zoom), só a partir de zoom 15.5 (LOD §8)
    var labelLayout = { 'text-field': ['get', 'label'], 'text-font': FONTS, 'text-size': 11, 'text-anchor': 'top', 'text-offset': [0, 0.35], 'text-optional': true, 'text-max-width': 8, 'text-letter-spacing': 0.02 };
    map.addLayer({ id: 'cz-users-label', type: 'symbol', source: 'users', minzoom: 15.5, filter: ['!', ['has', 'point_count']], layout: labelLayout, paint: { 'text-color': '#0A0A1A', 'text-halo-color': '#FAFAFA', 'text-halo-width': 1.2, 'text-opacity': S_ALPHA, 'text-emissive-strength': 1 } });
    map.addLayer({ id: 'cz-users-boost-label', type: 'symbol', source: 'users-boost', minzoom: 15, layout: labelLayout, paint: { 'text-color': '#0A0A1A', 'text-halo-color': '#FAFAFA', 'text-halo-width': 1.2, 'text-opacity': S_ALPHA, 'text-emissive-strength': 1 } });
    // quem está andando (o boost já entra no 'sz'); a bolha anda junto (mesma feature)
    map.addLayer({ id: 'cz-movers', type: 'symbol', source: 'movers', minzoom: FAR_ZOOM, layout: userLayout(false), paint: { 'icon-opacity': S_ALPHA, 'icon-emissive-strength': 1 } });
    map.addLayer({ id: 'cz-movers-photo', type: 'symbol', source: 'movers', minzoom: PHOTO_MIN_ZOOM, filter: ['has', 'ph'], layout: photoLayout(false), paint: { 'icon-opacity': S_ALPHA, 'icon-emissive-strength': 1 } });
    map.addLayer({ id: 'cz-movers-label', type: 'symbol', source: 'movers', minzoom: 15, layout: labelLayout, paint: { 'text-color': '#0A0A1A', 'text-halo-color': '#FAFAFA', 'text-halo-width': 1.2, 'text-opacity': S_ALPHA, 'text-emissive-strength': 1 } });
    // seleção
    map.addLayer({ id: 'cz-sel', type: 'symbol', source: 'sel',
      layout: { 'icon-image': 'sel-ring', 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-pitch-alignment': 'map', 'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.45, 15, 0.7, 18, 0.9] },
      paint: { 'icon-emissive-strength': 1 } });
    // eu
    map.addLayer({ id: 'cz-me-ring', type: 'symbol', source: 'me',
      layout: { 'icon-image': 'me-ring', 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-pitch-alignment': 'map', 'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.7, 16, 1.1, 18, 1.4] },
      paint: { 'icon-emissive-strength': 1 } });
    map.addLayer({ id: 'cz-me-heading', type: 'symbol', source: 'me', filter: ['has', 'heading'],
      layout: { 'icon-image': 'me-cone', 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-rotate': ['get', 'heading'], 'icon-rotation-alignment': 'map', 'icon-pitch-alignment': 'map', 'icon-size': 1 },
      paint: { 'icon-opacity': 0.9, 'icon-emissive-strength': 1 } });
    map.addLayer({ id: 'cz-me', type: 'symbol', source: 'me',
      layout: { 'icon-image': 'me-avatar', 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-anchor': 'bottom', 'icon-pitch-alignment': 'viewport', 'icon-rotation-alignment': 'viewport', 'icon-offset': ['get', 'off'], 'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.5, 15, 0.78, 18, 1.0] },
      paint: { 'icon-emissive-strength': 1 } });
    map.addLayer({ id: 'cz-me-photo', type: 'symbol', source: 'me', minzoom: PHOTO_MIN_ZOOM, filter: ['has', 'ph'],
      layout: { 'icon-image': ['get', 'ph'], 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-anchor': 'bottom', 'icon-pitch-alignment': 'viewport', 'icon-rotation-alignment': 'viewport', 'icon-offset': ['get', 'poff'], 'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.5, 15, 0.78, 18, 1.0] },
      paint: { 'icon-emissive-strength': 1 } });
    // destaque (selecionada / momento do match): figura + bolha por cima de tudo, ~20% maiores, com crossfade (feature-state 'a')
    var SPOT_SIZE = ['interpolate', ['linear'], ['zoom'], 12, 0.55, 15, 0.9, 18, 1.15];
    var SPOT_PHOTO_SIZE = ['interpolate', ['linear'], ['zoom'], 12, 0.65, 15, 1.06, 18, 1.36]; // 1.18x: a foto do selecionado cresce mais que o boneco
    map.addLayer({ id: 'cz-spot-aura', type: 'symbol', source: 'spot', filter: ['has', 'aura'],
      layout: { 'icon-image': ['get', 'aura'], 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-pitch-alignment': 'map',
                'icon-size': ['interpolate', ['linear'], ['zoom'], 12, ['case', ['==', ['get', 'aura'], 'aura-boost'], 0.8, 0.5], 16, ['case', ['==', ['get', 'aura'], 'aura-boost'], 1.4, 0.9], 18, ['case', ['==', ['get', 'aura'], 'aura-boost'], 1.8, 1.2]] },
      paint: { 'icon-opacity': S_ALPHA, 'icon-emissive-strength': 1 } });
    map.addLayer({ id: 'cz-spot', type: 'symbol', source: 'spot',
      layout: { 'icon-image': ['get', 'img'], 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-anchor': 'bottom', 'icon-pitch-alignment': 'viewport', 'icon-rotation-alignment': 'viewport', 'icon-offset': ['get', 'off'],
                'icon-size': SPOT_SIZE,
                'text-field': ['get', 'label'], 'text-font': FONTS, 'text-size': 12, 'text-anchor': 'top', 'text-offset': [0, 0.35], 'text-optional': true, 'text-letter-spacing': 0.02 },
      paint: { 'icon-opacity': S_ALPHA, 'icon-emissive-strength': 1, 'text-color': '#0A0A1A', 'text-halo-color': '#7FFF00', 'text-halo-width': 1.4, 'text-opacity': S_ALPHA, 'text-emissive-strength': 1 } });
    map.addLayer({ id: 'cz-spot-photo', type: 'symbol', source: 'spot', minzoom: 13, filter: ['has', 'ph'],
      layout: { 'icon-image': ['get', 'ph'], 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-anchor': 'bottom', 'icon-pitch-alignment': 'viewport', 'icon-rotation-alignment': 'viewport', 'icon-offset': ['get', 'poff'], 'icon-size': SPOT_PHOTO_SIZE },
      paint: { 'icon-opacity': S_ALPHA, 'icon-emissive-strength': 1 } });
    // efeitos one-shot (curtir / super / match)
    map.addLayer({ id: 'cz-fx-outer', type: 'circle', source: 'fx',
      paint: { 'circle-radius': ['interpolate', ['linear'], ['coalesce', ['feature-state', 'p'], 0], 0, 6, 1, 70], 'circle-color': ['get', 'color2'],
               'circle-opacity': ['interpolate', ['linear'], ['coalesce', ['feature-state', 'p'], 0], 0, 0.7, 1, 0], 'circle-emissive-strength': 1, 'circle-pitch-alignment': 'map' } });
    map.addLayer({ id: 'cz-fx-inner', type: 'circle', source: 'fx',
      paint: { 'circle-radius': ['interpolate', ['linear'], ['coalesce', ['feature-state', 'p'], 0], 0, 2, 0.5, 34, 1, 40], 'circle-color': ['get', 'color'],
               'circle-opacity': ['interpolate', ['linear'], ['coalesce', ['feature-state', 'p'], 0], 0, 0.9, 0.6, 0.35, 1, 0], 'circle-emissive-strength': 1, 'circle-pitch-alignment': 'map' } });

    // ícone 'pessoas' do cluster (duas cabeças, lima)
    (function () { var size = 32, cv = makeCanvas(size), ctx = cv.ctx; ctx.fillStyle = '#7FFF00';
      ctx.beginPath(); ctx.arc(11, 11, 5, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(22, 12, 4.2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(11, 25, 9, 7, 0, Math.PI, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.ellipse(22, 25.5, 7, 6, 0, Math.PI, Math.PI * 2); ctx.fill();
      putImage('people-icon', cv); })();
    // cone de direção (imagem estática)
    (function () { var size = 72, cv = makeCanvas(size), ctx = cv.ctx, c = size / 2; var g = ctx.createLinearGradient(c, c, c, 2); g.addColorStop(0, 'rgba(127,255,0,0.55)'); g.addColorStop(1, 'rgba(127,255,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(c, c); ctx.lineTo(c - 22, 2); ctx.lineTo(c + 22, 2); ctx.closePath(); ctx.fill(); putImage('me-cone', cv); })();

    // interações
    var tapLayers = TAP_LAYERS;
    tapLayers.forEach(function (id) { map.on('click', id, function (e) { var f = e.features && e.features[0]; if (f && f.properties && f.properties.id) { e.preventDefault(); var uid = String(f.properties.id); emote(uid, 'arrive'); send('userTap', { id: uid }); } }); });
    map.on('click', 'cz-poi', function (e) { var f = e.features && e.features[0]; if (f && f.properties) { e.preventDefault(); send('poiTap', { id: Number(f.properties.id) }); } });
    map.on('click', 'cz-cluster', function (e) {
      var f = e.features && e.features[0]; if (!f) return; e.preventDefault();
      var src = map.getSource('users');
      src.getClusterExpansionZoom(f.properties.cluster_id, function (err, zoom) {
        if (err) return;
        if (zoom > 21 || map.getZoom() >= 20.5) {
          // todo mundo no mesmo lugar (ex.: dentro do bar): abre o painel com quem está ali
          src.getClusterLeaves(f.properties.cluster_id, 100, 0, function (err2, leaves) {
            if (err2 || !leaves) return;
            send('clusterTap', { ids: leaves.map(function (l) { return String(l.properties.id); }), lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] });
          });
          return;
        }
        state.programmatic++; map.easeTo({ center: f.geometry.coordinates, zoom: Math.min(zoom + 0.3, 21.5), duration: 650 });
        map.once('moveend', function () { endProgrammatic(); });
      });
    });
  }
  function empty() { return { type: 'FeatureCollection', features: [] }; }

  // ======================================================================
  // 6. Dados: diff por id, entrada escalonada, hotspotBorn
  // ======================================================================
  var tweens = [];  // {source, id, key, from, to, start, dur, onDone}
  function tween(source, id, key, from, to, dur, delay) {
    tweens.push({ source: source, id: id, key: key, from: from, to: to, start: performance.now() + (delay || 0), dur: dur });
    stepTweens.kick();
  }
  var stepTweens = (function () {
    var rafId = null;
    function step(now) {
      rafId = null;
      var keep = [];
      for (var i = 0; i < tweens.length; i++) {
        var t = tweens[i];
        var k = (now - t.start) / t.dur;
        if (k < 0) { keep.push(t); continue; }
        var e = k >= 1 ? 1 : (t.key === 's' ? (1 + 1.6 * Math.pow(k - 1, 3) + 1.6 * Math.pow(k - 1, 2)) : (1 - Math.pow(1 - k, 3))); // overshoot leve no scale
        var v = t.from + (t.to - t.from) * e;
        var st = {}; st[t.key] = v;
        try { map.setFeatureState({ source: t.source, id: t.id }, st); } catch (err) {}
        if (k < 1) keep.push(t);
        else if (t.onDone) t.onDone();
      }
      tweens = keep;
      if (tweens.length) rafId = requestAnimationFrame(step);
    }
    return { kick: function () { if (!rafId) rafId = requestAnimationFrame(step); } };
  })();

  function featureFor(u, fg, coords, szMul) {
    var aura = u.isBoosted ? null : (u.premiumTier === 'premium_plus' ? 'aura-plus' : null);
    var dim = fg.dim || IMG.fig;
    var props = { id: u.id, img: fg.imgId, label: (u.isAnonymous ? '' : (u.label || u.name || '')), anon: !!u.isAnonymous, off: [0, figOffset(dim)], sz: fg.sz * (szMul || 1) };
    if (aura) props.aura = aura;
    if (fg.ph) { props.ph = fg.ph.imgId; props.poff = [0, bubbleOffset(dim)]; }
    return { type: 'Feature', id: u.id, properties: props, geometry: { type: 'Point', coordinates: coords } };
  }
  var leaving = {}; // id -> user (saiu da lista; fica 300 ms sumindo antes de ser removido)
  // monta as 3 fontes de pessoas: paradas (cluster), com boost e andando (posição interpolada)
  function pushUsers() {
    var normal = [], boosted = [], movers = [];
    for (var id in state.users) {
      var u = state.users[id], fg = figOf(id);
      if (fg.move) movers.push(featureFor(u, fg, fg.pos, u.isBoosted ? 1.17 : 1));
      else (u.isBoosted ? boosted : normal).push(featureFor(u, fg, fg.pos || [u.longitude, u.latitude]));
    }
    for (var lid in leaving) { var lf = figs[lid]; if (lf && lf.pos) (leaving[lid].isBoosted ? boosted : normal).push(featureFor(leaving[lid], lf, lf.pos)); }
    map.getSource('users').setData({ type: 'FeatureCollection', features: normal });
    map.getSource('users-boost').setData({ type: 'FeatureCollection', features: boosted });
    map.getSource('movers').setData({ type: 'FeatureCollection', features: movers });
  }
  function pushMovers() {
    var movers = [];
    for (var id in state.users) { var fg = figs[id]; if (fg && fg.move) movers.push(featureFor(state.users[id], fg, fg.pos, state.users[id].isBoosted ? 1.17 : 1)); }
    map.getSource('movers').setData({ type: 'FeatureCollection', features: movers });
  }
  function pushMe() {
    var fg = figs['me']; if (!fg || !fg.pos || !state.me) return;
    var dim = fg.dim || IMG.fig;
    var props = { off: [0, figOffset(dim)] };
    if (typeof state.me.heading === 'number') props.heading = state.me.heading;
    if (fg.ph) { props.ph = fg.ph.imgId; props.poff = [0, bubbleOffset(dim)]; }
    map.getSource('me').setData({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: fg.pos } }] });
  }
  // tick das figuras: fim de emotes, caminhada (interpolação suave + chegada), quem anima e quem ganha bolha (LOD a cada 700 ms)
  var figTick = (function () {
    var lastLod = 0;
    function finishMove(fg) { fg.pos = fg.move.to; fg.move = null; fg.one = { name: 'arrive', start: performance.now() }; }
    function updateLod(skipPush) {
      var max = state.tier === 'high' ? 14 : (state.tier === 'mid' ? 8 : 4);
      var zoom = map.getZoom();
      if (zoom < 14.5 || !state.active) max = 0;
      // fotos: só com zoom >= PHOTO_MIN_ZOOM; quem está na tela ou até 30% fora dela pede o thumb (lazy + pré-carga
      // pro arrasto); mais perto do centro baixa primeiro
      var wantPhotos = zoom >= PHOTO_MIN_ZOOM && state.active;
      var el = map.getContainer(), W = el.clientWidth || 1, H = el.clientHeight || 1;
      var c = { x: W / 2, y: H / 2 }, cand = [], changed = false;
      for (var id in figs) {
        var fg = figs[id]; if (!fg.pos) continue;
        var p = map.project(fg.pos);
        var inView = p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= H;
        var nearView = p.x >= -W * 0.3 && p.x <= W * 1.3 && p.y >= -H * 0.3 && p.y <= H * 1.3;
        if (!inView) fg.animated = false;
        if (!nearView) continue;
        var d = (p.x - c.x) * (p.x - c.x) + (p.y - c.y) * (p.y - c.y);
        if (inView) cand.push({ f: fg, d: d });
        if (wantPhotos && id !== 'me' && !fg.leaving && fg.user && fg.user.photo && !fg.ph && !(fg.phWait > Date.now())) { if (ensureBubble(fg, d)) changed = true; }
      }
      cand.sort(function (p, q) { return p.d - q.d; });
      for (var i = 0; i < cand.length; i++) cand[i].f.animated = i < max;
      CZ_PHOTO.reprioritize(function (url) { for (var k = 0; k < cand.length; k++) { var cf = cand[k].f; if (cf.ph && cf.ph.url === url) return cand[k].d; } return 1e8; });
      if (changed && !skipPush) pushUsers();
      return changed;
    }
    var tick = function (now) {
      var moversDirty = false, usersDirty = false, meDirty = false, spotDirty = false;
      for (var id in figs) {
        var fg = figs[id];
        if (fg.one && now - fg.one.start > CZ_ANIM.DUR[fg.one.name] * 1000) { fg.one = null; if (fg.obj) fg.obj.dirty = true; }
        if (fg.move) {
          var k = (now - fg.move.start) / fg.move.dur;
          if (k >= 1) { finishMove(fg); if (id === 'me') meDirty = true; else usersDirty = true; }
          else {
            var e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
            fg.pos = [fg.move.from[0] + (fg.move.to[0] - fg.move.from[0]) * e, fg.move.from[1] + (fg.move.to[1] - fg.move.from[1]) * e];
            if (id === 'me') meDirty = true; else moversDirty = true;
          }
          if (id === state.selected || id === state.momentUserId) spotDirty = true;
        }
        var live = figIsLive(fg, now);
        if (live) { if (fg.obj) fg.obj.dirty = true; fg.wasLive = true; }
        else if (fg.wasLive) { fg.wasLive = false; if (fg.obj) fg.obj.dirty = true; } // volta pra pose neutra
        if (fg.ph && fg.ph.fadeUntil && now < fg.ph.fadeUntil) fg.ph.obj.dirty = true; // fade-in da foto
      }
      if (usersDirty) pushUsers(); else if (moversDirty) pushMovers();
      if (meDirty) pushMe();
      if (spotDirty) pushSpot();
      if (now - lastLod > 700) { lastLod = now; updateLod(); }
    };
    tick.lod = updateLod;
    return tick;
  })();

  function setData(payload) {
    payload = payload || {};
    var users = (payload.users || []).slice(0, 300);
    var pois = payload.pois || [];
    if (typeof payload.hotMin === 'number') state.hotMin = payload.hotMin;
    var now = performance.now();
    var isFirst = !state.hadData;
    var prev = state.users; var next = {};
    var newIds = [];
    for (var i = 0; i < users.length; i++) {
      var u = users[i];
      if (!u || !u.id || typeof u.latitude !== 'number' || typeof u.longitude !== 'number') continue;
      next[u.id] = u;
      ensureAvatar(u);
      var fg = figOf(u.id);
      var to = [u.longitude, u.latitude];
      // voltou enquanto ainda sumia: cancela a saída
      var wasLeaving = !!leaving[u.id];
      if (wasLeaving) {
        delete leaving[u.id];
        // cancela o fade de saída em curso e garante opacidade cheia (senão 'a' ficava preso em 0)
        tweens = tweens.filter(function (t) { return !(t.key === 'a' && t.id === u.id && t.to === 0); });
        ['users', 'users-boost'].forEach(function (src) { try { map.setFeatureState({ source: src, id: u.id }, { a: 1 }); } catch (e) {} });
      }
      fg.leaving = 0; // também cobre quem volta entre o fim do fade e a remoção da imagem
      // posição mudou: a pessoa ANDA até lá (não teleporta); na 1ª carga todo mundo já nasce no lugar
      if ((prev[u.id] || wasLeaving) && !isFirst) startMove(fg, to, now); else { fg.pos = to; fg.move = null; }
      if (!prev[u.id] && !wasLeaving) newIds.push({ id: u.id, boosted: !!u.isBoosted });
    }
    // quem saiu some com fade (300 ms) e só depois leva a imagem junto; na 1ª carga não há ninguém pra sair
    for (var oid in prev) {
      if (next[oid]) continue;
      var lf = figs[oid];
      if (!lf || !lf.pos || isFirst) { removeFig(oid); continue; }
      lf.move = null; lf.one = null; lf.leaving = now; leaving[oid] = prev[oid];
      if (state.selected === oid) state.selected = null;
      (function (id, token, src) {
        tweens.push({ source: src, id: id, key: 'a', from: 1, to: 0, start: now, dur: 300, onDone: function () {
          var f2 = figs[id]; if (!f2 || f2.leaving !== token) return; // voltou no meio do fade
          delete leaving[id]; pushUsers();
          setTimeout(function () { var f3 = figs[id]; if (f3 && f3.leaving === token && !state.users[id] && !leaving[id]) removeFig(id); }, 400);
        } });
      })(oid, now, prev[oid].isBoosted ? 'users-boost' : 'users');
    }
    stepTweens.kick();
    // definições de avatar só de quem está no mapa (+ eu): sessão longa não acumula visuais de quem já foi embora
    var usedKeys = {}; for (var uk in next) if (next[uk].avatarKey) usedKeys[next[uk].avatarKey] = true; if (state.me && state.me.avatarKey) usedKeys[state.me.avatarKey] = true;
    for (var lk in leaving) if (leaving[lk].avatarKey) usedKeys[leaving[lk].avatarKey] = true; // quem está sumindo continua desenhado por 300 ms
    for (var dk in avatarDefs) if (!usedKeys[dk]) delete avatarDefs[dk];
    for (var wk in keyWaiters) if (!usedKeys[wk]) delete keyWaiters[wk];
    state.users = next;
    try { figTick.lod(true); } catch (e) { warn('lod', e && e.message); } // bolhas novas entram já neste pushUsers
    pushUsers();
    pushSpot();
    // entrada escalonada: novos começam invisíveis/pequenos e "pousam"
    for (var n = 0; n < newIds.length; n++) {
      var src = newIds[n].boosted ? 'users-boost' : 'users';
      try { map.setFeatureState({ source: src, id: newIds[n].id }, { a: 0 }); } catch (e) {}
      var delay = Math.min(600, n * 35);
      tween(src, newIds[n].id, 'a', 0, 1, 260, delay);
      if (!isFirst && n < 12) (function (id, d) { setTimeout(function () { if (state.users[id]) emote(id, 'arrive'); }, d + 120); })(newIds[n].id, delay);
    }
    // POIs + hotspots
    var feats = [], newHot = [];
    var nextHot = {};
    for (var p = 0; p < pois.length; p++) {
      var poi = pois[p];
      if (!poi || typeof poi.latitude !== 'number') continue;
      var count = poi.userCount || 0;
      var hot = count >= state.hotMin;
      var sonar = count >= 20 ? 'sonar-3' : (count >= 10 ? 'sonar-2' : 'sonar-1');
      feats.push({ type: 'Feature', id: poi.id, properties: {
        id: poi.id, hot: hot, event: poi.category === 'event', sonar: (poi.category === 'event' && !hot) ? 'sonar-1' : sonar, img: ensurePoiImage(poi, hot), partner: !!poi.isPartner,
        label: hot ? (poi.name + '\\n' + count + (count === 1 ? ' pessoa' : ' pessoas')) : (poi.category === 'event' ? ('⚡ ' + poi.name) : poi.name)
      }, geometry: { type: 'Point', coordinates: [poi.longitude, poi.latitude] } });
      if (hot) { nextHot[poi.id] = true; if (!isFirst && !state.hotIds[poi.id]) newHot.push({ poiId: poi.id, name: poi.name, userCount: count }); }
    }
    state.hotIds = nextHot;
    state.pois = {}; for (var q = 0; q < pois.length; q++) if (pois[q]) state.pois[pois[q].id] = pois[q];
    map.getSource('pois').setData({ type: 'FeatureCollection', features: feats });
    for (var h = 0; h < newHot.length; h++) { send('hotspotBorn', newHot[h]); burst({ lat: state.pois[newHot[h].poiId].latitude, lng: state.pois[newHot[h].poiId].longitude, kind: 'match' }); }
    state.hadData = true;
    if (isFirst) state.firstDataAt = now;
    particles.retarget();
    map.triggerRepaint();
  }

  // ======================================================================
  // 7. Eu, seleção, câmera, efeitos, partículas, idle-cam
  // ======================================================================
  function setMe(me) {
    if (!me || typeof me.lat !== 'number' || typeof me.lng !== 'number') return;
    state.me = me;
    var u = { id: 'me', name: me.name || 'você', isAnonymous: !!me.isAnonymous, isBoosted: !!me.isBoosted, premiumTier: me.tier || 'free', isVerified: false,
              recordedAt: new Date().toISOString(), avatarKey: me.avatarKey || '', aura: me.aura || '', photo: me.photoUrl || null, isNew: false, matchId: null };
    var fg = figOf('me');
    var to = [me.lng, me.lat];
    if (fg.pos) startMove(fg, to, performance.now()); else fg.pos = to; // eu também ando no mapa
    ensureAvatar(u, 'me-avatar');
    ensureBubble(fg, 0); // minha foto sempre (sem gate de zoom)
    pushMe();
    if (!state.located) { state.located = true; if (!state.revealed) { /* RN chama reveal(); se não chamar em 1.5s, centraliza */ setTimeout(function () { if (!state.revealed) API.setCenter(me.lat, me.lng, 16); }, 1500); } }
    particles.retarget();
  }

  // ---- pessoa em destaque (selecionada ou no momento do match): sai do cluster e fica por cima, ~20% maior ----
  function spotSourceOf(id) { var fg = figs[id], u = state.users[id]; return fg && fg.move ? 'movers' : (u && u.isBoosted ? 'users-boost' : 'users'); }
  function pushSpot() {
    var id = state.momentUserId || state.selected;
    var u = id ? state.users[id] : null, fg = u ? figs[id] : null;
    if (!u || !fg || !fg.pos) { try { map.getSource('spot').setData(empty()); } catch (e) {} return; }
    var feat = featureFor(u, fg, fg.pos, u.isBoosted ? 1.17 : 1);
    if (u.isBoosted) feat.properties.aura = 'aura-boost';
    map.getSource('spot').setData({ type: 'FeatureCollection', features: [feat] });
  }
  // destaque suave: a figura normal apaga enquanto a versão maior (spot) acende — parece que ela "cresce".
  // A pessoa pode trocar de fonte (users ⇄ movers) no meio: as outras fontes já recebem o estado final na hora.
  var ALL_USER_SRC = ['users', 'users-boost', 'movers'];
  function setAlphaElsewhere(id, src, a) { ALL_USER_SRC.forEach(function (o) { if (o !== src) { try { map.setFeatureState({ source: o, id: id }, { a: a }); } catch (e) {} } }); }
  function spotIn(id) {
    var fg = figs[id]; if (!fg) return;
    if (fg.user && fg.user.photo && !fg.ph && !(fg.phWait > Date.now())) ensureBubble(fg, 0); // foto do selecionado tem prioridade máxima
    pushUsers(); pushSpot();
    try { map.setFeatureState({ source: 'spot', id: id }, { a: 0 }); } catch (e) {}
    tween('spot', id, 'a', 0, 1, 220);
    var src = spotSourceOf(id);
    tween(src, id, 'a', 1, 0, 220);
    setAlphaElsewhere(id, src, 0);
  }
  function spotOut(id) {
    var fg = figs[id]; if (!fg || !state.users[id]) { pushSpot(); return; }
    var src = spotSourceOf(id);
    tween(src, id, 'a', 0, 1, 200);
    setAlphaElsewhere(id, src, 1);
    tweens.push({ source: 'spot', id: id, key: 'a', from: 1, to: 0, start: performance.now(), dur: 200, onDone: function () { pushSpot(); } });
    stepTweens.kick();
  }

  // ---- momento de match no mapa: os dois avatares (com fotos) enquadrados, arco de luz entre eles, pulsos e explosão no meio ----
  var momentTimer = null;
  function clearMoment() {
    if (momentTimer) { clearTimeout(momentTimer); momentTimer = null; }
    try { var s = map.getSource('moment'); if (s) s.setData(empty()); } catch (e) {}
    var mid = state.momentUserId; state.momentUserId = null;
    var fm = figs['me']; if (fm) { fm.moment = false; refreshBubble('me'); }
    if (mid) { var fu = figs[mid]; if (fu) { fu.moment = false; refreshBubble(mid); } if (state.selected !== mid) spotOut(mid); else pushSpot(); }
    else pushSpot();
    // alguém foi selecionado durante o momento: o destaque dela entra agora
    if (state.selected && state.selected !== mid && state.users[state.selected]) spotIn(state.selected);
    if (!state.selected) { try { map.getSource('sel').setData(empty()); } catch (e) {} }
  }
  function matchMoment(m) {
    if (!m || !state.me) { send('matchMomentDone', { userId: m ? m.userId : null, shown: false }); return; }
    var u = state.users[m.userId];
    if (!u) { send('matchMomentDone', { userId: m.userId, shown: false }); return; }
    clearMoment();
    state.momentUserId = m.userId;
    var fm = figs['me'], fu = figs[m.userId];
    if (fm) { fm.moment = true; refreshBubble('me'); }
    if (fu) { fu.moment = true; refreshBubble(m.userId); }
    var a = [state.me.lng, state.me.lat], b = [u.longitude, u.latitude];
    if (fm) fm.mirror = b[0] < a[0]; if (fu) fu.mirror = a[0] < b[0]; // um de frente pro outro
    emote('me', 'match'); emote(m.userId, 'match');
    if (state.selected !== m.userId) spotIn(m.userId); else pushSpot();
    if (!map.getSource('moment')) {
      map.addSource('moment', { type: 'geojson', data: empty() });
      map.addLayer({ id: 'cz-moment-glow', type: 'line', source: 'moment', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#FF1493', 'line-width': 16, 'line-blur': 12, 'line-opacity': 0.6, 'line-emissive-strength': 1 } }, 'cz-aura');
      map.addLayer({ id: 'cz-moment-line', type: 'line', source: 'moment', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#7FFF00', 'line-width': 3, 'line-opacity': 0.95, 'line-emissive-strength': 1 } }, 'cz-aura');
    }
    var mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    var span = Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), 0.0004);
    var pts = [];
    for (var i = 0; i <= 28; i++) {
      var t = i / 28, it = 1 - t;
      pts.push([it * it * a[0] + 2 * it * t * mid[0] + t * t * b[0], it * it * a[1] + 2 * it * t * (mid[1] + span * 0.45) + t * t * b[1]]);
    }
    map.getSource('moment').setData({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts } }] });
    state.programmatic++;
    var bounds = new mapboxgl.LngLatBounds(a, a); bounds.extend(b);
    var cam = null;
    try { cam = map.cameraForBounds(bounds, { padding: { top: 140, bottom: 40, left: 60, right: 60 }, maxZoom: 18 }); } catch (e) { cam = null; }
    if (cam) map.easeTo({ center: cam.center, zoom: cam.zoom, pitch: 55, bearing: map.getBearing(), duration: 900, essential: true });
    else map.easeTo({ center: mid, zoom: Math.min(map.getZoom(), 17), pitch: 55, duration: 900, essential: true });
    map.once('moveend', function () { endProgrammatic(); });
    var seq = [0, 380, 760, 1140, 1520];
    for (var s = 0; s < seq.length; s++) (function (k) {
      setTimeout(function () {
        burst({ lat: a[1], lng: a[0], kind: 'match' });
        burst({ lat: b[1], lng: b[0], kind: 'match' });
        if (k === 2) burst({ lat: mid[1], lng: mid[0], kind: 'super' });
      }, seq[k]);
    })(s);
    map.getSource('sel').setData({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: b } }] });
    momentTimer = setTimeout(function () { clearMoment(); send('matchMomentDone', { userId: m.userId, shown: true }); }, 3400);
  }

  // toque na pessoa: anel no chão, figura + foto crescem (spot), nome ganha destaque, câmera centraliza
  function select(id) {
    var prevSel = state.selected;
    state.selected = id || null;
    var inMoment = !!momentTimer;
    if (prevSel && prevSel !== state.selected) { refreshBubble(prevSel); if (prevSel !== state.momentUserId && !inMoment) spotOut(prevSel); }
    if (!id && inMoment) return; // o momento do match está usando o anel; clearMoment limpa no fim
    var u = id ? state.users[id] : null;
    map.getSource('sel').setData(u ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [u.longitude, u.latitude] } }] } : empty());
    if (!u) { if (!state.momentUserId) pushSpot(); return; }
    refreshBubble(id);
    // durante o momento do match o spot é da pessoa do match: a seleção entra quando o momento acabar (clearMoment)
    if (inMoment && id !== state.momentUserId) return;
    if (id !== state.momentUserId) spotIn(id); else pushSpot();
    state.programmatic++; map.easeTo({ center: [u.longitude, u.latitude], duration: 600, offset: [0, -60] }); map.once('moveend', function () { endProgrammatic(); });
  }

  function reveal(lat, lng) {
    state.revealed = true;
    idleCam.stop();
    map.jumpTo({ center: [lng, lat], zoom: 13.5, pitch: 0, bearing: 0 });
    state.programmatic++;
    map.flyTo({ center: [lng, lat], zoom: 16, pitch: 58, bearing: -12, duration: 1800, curve: 1.2, essential: true });
    map.once('moveend', function () { endProgrammatic(); idleCam.schedule(); });
  }

  function setCenter(lat, lng, zoom, opts) {
    opts = opts || {};
    state.programmatic++;
    map.easeTo({ center: [lng, lat], zoom: (typeof zoom === 'number') ? zoom : map.getZoom(),
      pitch: (typeof opts.pitch === 'number') ? opts.pitch : map.getPitch(), bearing: (typeof opts.bearing === 'number') ? opts.bearing : map.getBearing(),
      duration: (typeof opts.duration === 'number') ? opts.duration : 900, essential: true });
    map.once('moveend', function () { endProgrammatic(); });
  }

  function focusPoi(id) {
    var p = state.pois[id]; if (!p) return;
    state.programmatic++;
    map.easeTo({ center: [p.longitude, p.latitude], zoom: 17, pitch: 65, bearing: map.getBearing() + 25, duration: 900, essential: true, offset: [0, -40] });
    map.once('moveend', function () { endProgrammatic(); });
  }

  // setPadding do Mapbox faz jumpTo (cancela flyTo/easeTo em curso) → enquanto uma animação nossa roda, o padding
  // fica pendente e é aplicado no moveend seguinte. Throttle de 16ms fora de animação.
  var padTimer = null, pendingPad = null;
  // Evented do Mapbox dispara os listeners fixos antes dos once(): o flush precisa acontecer AQUI, no fim de cada animação nossa
  function endProgrammatic() { state.programmatic = Math.max(0, state.programmatic - 1); if (state.programmatic === 0) flushPadding(); }
  function flushPadding() {
    if (!pendingPad || state.programmatic > 0) return;
    var p = pendingPad; pendingPad = null;
    try { map.setPadding(p); } catch (e) {}
  }
  function setPadding(pad) {
    pendingPad = Object.assign({ top: 0, bottom: 0, left: 0, right: 0 }, map.getPadding ? map.getPadding() : {}, pad || {});
    if (padTimer) return;
    padTimer = setTimeout(function () { padTimer = null; flushPadding(); }, 16);
  }

  var fxSeq = 0;
  function burst(b) {
    if (!b || typeof b.lat !== 'number') return;
    var kind = b.kind || 'like';
    var color = kind === 'super' ? '#FFD700' : (kind === 'match' ? '#FF1493' : '#7FFF00');
    var color2 = kind === 'match' ? '#7FFF00' : color;
    var id = 'fx-' + (++fxSeq);
    var src = map.getSource('fx');
    var data = src._data && src._data.features ? src._data : empty();
    data.features.push({ type: 'Feature', id: id, properties: { id: id, color: color, color2: color2 }, geometry: { type: 'Point', coordinates: [b.lng, b.lat] } });
    src.setData(data);
    try { map.setFeatureState({ source: 'fx', id: id }, { p: 0 }); } catch (e) {}
    var dur = kind === 'super' ? 800 : (kind === 'match' ? 1000 : 400);
    tweens.push({ source: 'fx', id: id, key: 'p', from: 0, to: 1, start: performance.now(), dur: dur, onDone: function () {
      var d = src._data && src._data.features ? src._data : empty();
      d.features = d.features.filter(function (f) { return f.id !== id; });
      src.setData(d);
    } });
    stepTweens.kick();
  }

  // partículas ambientes (canvas 2D, ≤ 24 pontos, só tier high): vagalumes de dia, faíscas rosa/dourado à noite
  var particles = (function () {
    var cv = document.getElementById('fx'), ctx = cv.getContext('2d');
    var enabled = false, running = false, rafId = null, pts = [], anchors = [], last = 0;
    function resize() { cv.width = Math.floor(window.innerWidth * DPR); cv.height = Math.floor(window.innerHeight * DPR); cv.style.width = window.innerWidth + 'px'; cv.style.height = window.innerHeight + 'px'; }
    window.addEventListener('resize', resize); resize();
    function retarget() {
      anchors = [];
      if (state.me) anchors.push([state.me.lng, state.me.lat]);
      for (var id in state.hotIds) { var p = state.pois[id]; if (p) anchors.push([p.longitude, p.latitude]); }
      while (pts.length < 24) pts.push({ a: Math.random() * Math.PI * 2, r: 12 + Math.random() * 40, sp: 0.3 + Math.random() * 0.8, ph: Math.random() * 10, k: Math.floor(Math.random() * 100) });
    }
    function frame(now) {
      rafId = null;
      if (!running) return;
      if (now - last > 33) {
        last = now;
        ctx.clearRect(0, 0, cv.width, cv.height);
        if (anchors.length && map.getZoom() >= 14) {
          ctx.save(); ctx.scale(DPR, DPR); ctx.globalCompositeOperation = 'lighter';
          var night = state.theme !== 'day';
          for (var i = 0; i < pts.length; i++) {
            var p = pts[i]; var an = anchors[p.k % anchors.length]; var s = map.project(an);
            var t = now / 1000 * p.sp + p.ph;
            var x = s.x + Math.cos(t + p.a) * p.r, y = s.y + Math.sin(t * 1.3 + p.a) * p.r * 0.6 - (t * 6 % 40);
            var alpha = 0.35 + 0.35 * Math.sin(t * 2);
            ctx.fillStyle = night ? (i % 2 ? 'rgba(255,20,147,' + alpha + ')' : 'rgba(255,215,0,' + alpha + ')') : 'rgba(127,255,0,' + alpha + ')';
            ctx.beginPath(); ctx.arc(x, y, 1.6 + (i % 3) * 0.6, 0, Math.PI * 2); ctx.fill();
          }
          ctx.restore();
        }
      }
      rafId = requestAnimationFrame(frame);
    }
    return {
      setEnabled: function (v) { enabled = v; if (!v) { running = false; if (rafId) cancelAnimationFrame(rafId); rafId = null; ctx.clearRect(0, 0, cv.width, cv.height); } else if (state.active && !running) { running = true; rafId = requestAnimationFrame(frame); } },
      retarget: retarget,
      pause: function () { running = false; if (rafId) cancelAnimationFrame(rafId); rafId = null; ctx.clearRect(0, 0, cv.width, cv.height); },
      resume: function () { if (enabled && !running) { running = true; rafId = requestAnimationFrame(frame); } }
    };
  })();

  // idle-cam: rotação curta (25° em 20s) só em tier high, ativo, sem gesto há 30s
  var idleCam = (function () {
    var timer = null, spinning = false;
    function schedule() { stop(); if (state.tier !== 'high' || !state.active) return; timer = setTimeout(spin, 30000); }
    function spin() {
      timer = null;
      if (state.tier !== 'high' || !state.active || Date.now() - state.lastGesture < 30000) { schedule(); return; }
      spinning = true; state.programmatic++;
      map.easeTo({ bearing: map.getBearing() + 25, duration: 20000, easing: function (t) { return t; }, essential: false });
      map.once('moveend', function () { endProgrammatic(); spinning = false; schedule(); });
    }
    function stop() { if (timer) { clearTimeout(timer); timer = null; } if (spinning) { spinning = false; map.stop(); } }
    return { schedule: schedule, stop: stop };
  })();

  // ======================================================================
  // 8. Perf: medição inicial (90 frames num easeTo de 1s) + perf a cada 5s
  // ======================================================================
  var perf = (function () {
    var stamps = [], timer = null, running = false;
    function onRender() { stamps.push(performance.now()); if (stamps.length > 900) stamps.shift(); }
    // fps = mediana do intervalo entre frames renderizados (só conta quando o mapa estava repintando)
    function estimate() {
      var iv = [];
      for (var i = 1; i < stamps.length; i++) { var d = stamps[i] - stamps[i - 1]; if (d > 0 && d < 250) iv.push(d); }
      stamps = stamps.length ? [stamps[stamps.length - 1]] : [];
      if (iv.length < 10) return null;
      iv.sort(function (a, b) { return a - b; });
      return Math.round(1000 / iv[Math.floor(iv.length / 2)]);
    }
    function start() { if (running) return; running = true; stamps = []; map.on('render', onRender);
      timer = setInterval(function () { var fps = estimate(); if (fps != null) send('perf', { fps: fps }); }, 5000); }
    function stop() { running = false; map.off('render', onRender); if (timer) clearInterval(timer); timer = null; }
    function measure(cb) {
      var n = 0, start = performance.now(), done = false;
      function count() { n++; }
      function finish(fps) { if (done) return; done = true; map.off('render', count); cb(fps); }
      map.on('render', count);
      state.programmatic++;
      map.easeTo({ bearing: map.getBearing() + 8, duration: 1000, essential: true });
      map.once('moveend', function () { endProgrammatic(); finish(n / ((performance.now() - start) / 1000)); });
      // WebView em background (rAF parado): assume tier médio e segue
      setTimeout(function () { finish(40); }, 2500);
    }
    return { start: start, stop: stop, measure: measure };
  })();

  // ======================================================================
  // 9. API pública (window.cruzei) + boot
  // ======================================================================
  API.setTheme = function (theme, animate) { if (theme !== 'day' && theme !== 'dusk' && theme !== 'night') theme = 'day'; applyTheme(theme, animate !== false); };
  API.setTier = function (tier) { if (tier === 'low' || tier === 'mid' || tier === 'high') { state.tier = tier; applyTierEffects(); } };
  API.setActive = function (active) {
    state.active = !!active;
    if (state.active) { animImages.start(); particles.resume(); perf.start(); idleCam.schedule(); }
    else { animImages.stop(); particles.pause(); perf.stop(); idleCam.stop(); }
  };
  API.setMe = setMe;
  API.setCenter = setCenter;
  API.reveal = reveal;
  API.setData = setData;
  API.select = select;
  API.focusPoi = focusPoi;
  API.setPadding = setPadding;
  API.burst = burst;
  API.defineAvatars = defineAvatars;
  API.emote = emote;
  API.matchMoment = matchMoment;

  map.on('style.load', function () { send('styleLoaded'); });
  CZ_PHOTO.onBlocked(function (url) { send('photoBlocked', { url: url }); });

  map.once('load', function () {
    loaded = true;
    try { addBaseLayers(); addCruzeiLayers(); } catch (e) { send('error', { message: 'falha ao montar camadas: ' + (e && e.message), fatal: true }); return; }
    applyTheme(state.theme, false);
    growBuildings();
    animImages.start();
    var finish = function (tier) {
      if (INIT.tier === 'low' || INIT.tier === 'mid' || INIT.tier === 'high') tier = INIT.tier;
      state.tier = tier; applyTierEffects();
      ready = true;
      send('ready', { tier: tier, webgl2: webgl2, dpr: DPR, fps: state.measuredFps || 0 });
      // reaplica a fila na ordem em que chegou
      var q = queue; queue = [];
      for (var i = 0; i < q.length; i++) { try { API[q[i].name].apply(null, q[i].args); } catch (e) { send('error', { message: q[i].name + ': ' + (e && e.message), fatal: false }); } }
      perf.start();
      idleCam.schedule();
    };
    // mede só com o mapa ocioso (tiles/prédios carregados): medir durante o load dava 'low' em aparelho de 60 fps
    var measured = false;
    var doMeasure = function () { if (measured) return; measured = true; perf.measure(function (fps) { state.measuredFps = Math.round(fps); finish(fps >= 42 ? 'high' : (fps >= 26 ? 'mid' : 'low')); }); };
    map.once('idle', doMeasure);
    setTimeout(doMeasure, 6000);
  });
})();
</script>
</body>
</html>`;
}
