// Mapa Mapbox GL JS dentro de WebView — estilo custom Cruzei (Pokémon GO: pitch 3D, prédios, neon).
// RN → WebView: window.cruzei.* via injectJavaScript
// WebView → RN: window.ReactNativeWebView.postMessage(JSON)
//
// Token público (pk.) é esperado aqui — ele é feito pra rodar no cliente.
// Restrinja o token por URL/app no painel do Mapbox antes do lançamento.

export const MAPBOX_STYLE_NIGHT = 'mapbox://styles/mapbox/dark-v11';
export const MAPBOX_STYLE_DAY = 'mapbox://styles/mapbox/streets-v12';

export function buildMapboxHtml(token: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<link href="https://api.mapbox.com/mapbox-gl-js/v3.7.0/mapbox-gl.css" rel="stylesheet" />
<script src="https://api.mapbox.com/mapbox-gl-js/v3.7.0/mapbox-gl.js"></script>
<style>
  html, body, #map { margin:0; padding:0; height:100%; width:100%; background:#0A0A1A; overflow:hidden; }
  .mapboxgl-ctrl-logo { opacity:.6; }
  .mapboxgl-ctrl-attrib { font-size:9px; opacity:.7; }
  .cz-me { width:20px; height:20px; border-radius:50%; background:#7FFF00; border:3px solid #fff; box-shadow:0 0 0 8px rgba(127,255,0,.22), 0 2px 10px rgba(0,0,0,.6); }
  .cz-me::after { content:''; position:absolute; inset:-14px; border-radius:50%; border:2px solid rgba(127,255,0,.5); animation: ring 2.2s ease-out infinite; }
  @keyframes ring { 0% { transform:scale(.5); opacity:1; } 100% { transform:scale(2.2); opacity:0; } }
  .cz-user { width:40px; height:40px; border-radius:50%; border:3px solid #fff; background:#FF1493 center/cover no-repeat; box-shadow:0 4px 12px rgba(0,0,0,.5); display:flex; align-items:center; justify-content:center; color:#fff; font:700 14px system-ui; cursor:pointer; }
  .cz-user.anon { background:#3A3A4A; border:3px dashed #A3A3A3; color:#D4D4D4; }
  .cz-user.sel { box-shadow:0 0 0 4px #7FFF00, 0 4px 12px rgba(0,0,0,.5); }
  .cz-poi-wrap { position:relative; width:32px; height:32px; }
  .cz-poi { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); min-width:32px; height:32px; padding:0 9px; border-radius:16px; background:#FFD700; border:2px solid #fff; color:#0A0A1A; font:800 12px system-ui; display:flex; align-items:center; justify-content:center; box-shadow:0 2px 8px rgba(0,0,0,.45); white-space:nowrap; cursor:pointer; }
  .cz-poi.hot { background:#FF1493; color:#fff; animation: pulse 1.6s ease-out infinite; }
  @keyframes pulse { 0% { box-shadow:0 0 0 0 rgba(255,20,147,.65);} 100% { box-shadow:0 0 0 20px rgba(255,20,147,0);} }
  .cz-poi-label { position:absolute; top:34px; left:50%; transform:translateX(-50%); color:#fff; font:600 11px system-ui; text-shadow:0 1px 3px #000; white-space:nowrap; pointer-events:none; }
</style>
</head>
<body>
<div id="map"></div>
<script>
(function () {
  var RN = window.ReactNativeWebView;
  function send(type, payload) { if (RN) RN.postMessage(JSON.stringify(Object.assign({ type: type }, payload || {}))); }
  window.onerror = function (msg) { send('error', { message: String(msg) }); };

  if (!window.mapboxgl) { send('error', { message: 'mapbox-gl não carregou (sem internet?)' }); return; }
  if (!mapboxgl.supported()) { send('error', { message: 'WebGL indisponível neste dispositivo' }); return; }

  mapboxgl.accessToken = ${JSON.stringify(token)};
  var NIGHT = ${JSON.stringify(MAPBOX_STYLE_NIGHT)};
  var DAY = ${JSON.stringify(MAPBOX_STYLE_DAY)};
  var currentStyle = DAY;

  var map = new mapboxgl.Map({
    container: 'map',
    style: DAY,
    center: [-48.2772, -18.9186],
    zoom: 15.5,
    pitch: 55,
    bearing: -12,
    attributionControl: true,
    antialias: true,
  });
  map.touchZoomRotate.enable();
  map.dragRotate.enable();

  // Prédios 3D — o "look de jogo"
  function add3D() {
    if (map.getLayer('cz-3d')) return;
    var layers = map.getStyle().layers;
    var labelId = null;
    for (var i = 0; i < layers.length; i++) { if (layers[i].type === 'symbol' && layers[i].layout && layers[i].layout['text-field']) { labelId = layers[i].id; break; } }
    var dark = currentStyle === NIGHT;
    try {
      map.addLayer({
        id: 'cz-3d', source: 'composite', 'source-layer': 'building', filter: ['==', 'extrude', 'true'], type: 'fill-extrusion', minzoom: 14,
        paint: {
          'fill-extrusion-color': dark ? '#1E1E3A' : '#E6E4DE',
          'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 14, 0, 15.5, ['get', 'height']],
          'fill-extrusion-base': ['interpolate', ['linear'], ['zoom'], 14, 0, 15.5, ['get', 'min_height']],
          'fill-extrusion-opacity': 0.85
        }
      }, labelId);
    } catch (e) { /* estilo sem composite/building */ }
  }
  map.on('style.load', add3D);

  var me = null, userMarkers = {}, poiMarkers = [], selectedId = null, located = false;

  function initials(name) { return (name || '?').trim().split(/\\s+/).map(function (p) { return p[0]; }).slice(0, 2).join('').toUpperCase(); }

  window.cruzei = {
    setTheme: function (dark) {
      var next = dark ? NIGHT : DAY;
      if (next === currentStyle) return;
      currentStyle = next; map.setStyle(next);
    },
    setCenter: function (lat, lng, zoom) { map.flyTo({ center: [lng, lat], zoom: zoom || map.getZoom(), essential: true, duration: 900 }); },
    setMe: function (lat, lng) {
      located = true;
      if (!me) {
        var el = document.createElement('div'); el.className = 'cz-me'; el.style.position = 'relative';
        me = new mapboxgl.Marker({ element: el, anchor: 'center' }).setLngLat([lng, lat]).addTo(map);
      } else me.setLngLat([lng, lat]);
    },
    setData: function (data) {
      Object.keys(userMarkers).forEach(function (k) { userMarkers[k].remove(); }); userMarkers = {};
      (data.users || []).forEach(function (u) {
        var el = document.createElement('div');
        el.className = 'cz-user' + (u.isAnonymous ? ' anon' : '') + (u.id === selectedId ? ' sel' : '');
        if (u.mainPhotoUrl) el.style.backgroundImage = 'url(' + u.mainPhotoUrl + ')';
        else el.textContent = u.isAnonymous ? '?' : initials(u.name);
        el.addEventListener('click', function (ev) { ev.stopPropagation(); send('userTap', { id: u.id }); });
        userMarkers[u.id] = new mapboxgl.Marker({ element: el, anchor: 'center' }).setLngLat([u.longitude, u.latitude]).addTo(map);
      });
      poiMarkers.forEach(function (m) { m.remove(); }); poiMarkers = [];
      (data.pois || []).forEach(function (p) {
        var wrap = document.createElement('div'); wrap.className = 'cz-poi-wrap';
        var el = document.createElement('div'); el.className = 'cz-poi' + ((p.userCount || 0) >= 3 ? ' hot' : ''); el.textContent = String(p.userCount || 0);
        var label = document.createElement('div'); label.className = 'cz-poi-label'; label.textContent = p.name;
        wrap.appendChild(el); wrap.appendChild(label);
        wrap.addEventListener('click', function (ev) { ev.stopPropagation(); send('poiTap', { id: p.id }); });
        poiMarkers.push(new mapboxgl.Marker({ element: wrap, anchor: 'center' }).setLngLat([p.longitude, p.latitude]).addTo(map));
      });
    },
    select: function (id) {
      selectedId = id;
      Object.keys(userMarkers).forEach(function (k) {
        var el = userMarkers[k].getElement();
        if (k === id) el.classList.add('sel'); else el.classList.remove('sel');
      });
      if (id && userMarkers[id]) map.easeTo({ center: userMarkers[id].getLngLat(), duration: 600 });
    }
  };

  // só reporta o centro depois da 1ª posição própria — evita buscar 'perto' do centro padrão
  map.on('moveend', function () { if (!located) return; var c = map.getCenter(); send('moveend', { lat: c.lat, lng: c.lng, zoom: map.getZoom() }); });
  map.on('click', function () { send('mapTap'); });
  map.on('load', function () { send('ready'); });
  map.on('error', function (e) { send('error', { message: (e && e.error && e.error.message) || 'erro no mapa' }); });
})();
</script>
</body>
</html>`;
}
