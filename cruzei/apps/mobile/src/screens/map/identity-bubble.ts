// Bolha de identidade no mapa (brief FOTO AVATAR): foto real circular flutuando acima do avatar.
// JS puro injetado no mapbox-html.ts (mesmo esquema do avatar-anim.ts) — dois papéis:
//   1. CZ_PHOTO.request(url, pri, cb): carrega thumbnails com cache por URL, fila por prioridade (mais perto do centro
//      primeiro), no máximo 4 downloads simultâneos, timeout, falha memorizada (nunca tenta a mesma URL de novo na
//      sessão) e recorte quadrado central num canvas 2x pronto pra desenhar. Imagem sem CORS = 'bad' + aviso ao RN.
//   2. CZ_PHOTO.drawBubble(ctx, thumb, cx, cy, opts): círculo perfeito com borda por estado (online / em alta / match /
//      selecionado), sombra suave, rabicho ligando ao personagem, ponto de presença e selos (novo ✦, match ♥).
//
// Contrato (usado pelo mapbox-html.ts):
//   CZ_PHOTO.request(url, pri, cb)     -> cb(ok) quando resolver (imediato se já em cache)
//   CZ_PHOTO.thumb(url)                -> canvas 2x (THUMB*2) ou null
//   CZ_PHOTO.status(url)               -> 'none' | 'queued' | 'loading' | 'ok' | 'bad' (bad tenta de novo até 3x; CORS bloqueado é definitivo)
//   CZ_PHOTO.retryAt(url)              -> 0 (pode pedir) | timestamp da próxima tentativa | Infinity (desistiu)
//   CZ_PHOTO.reprioritize(fn)          -> fn(url) devolve a prioridade nova de cada URL na fila
//   CZ_PHOTO.onBlocked(fn)             -> fn(url) quando a foto veio sem CORS (canvas tainted)
//   CZ_PHOTO.drawBubble(ctx, cv, cx, cy, o) ; CZ_PHOTO.THUMB

export const IDENTITY_BUBBLE_JS = String.raw`
var CZ_PHOTO = (function () {
  'use strict';
  var TAU = Math.PI * 2;
  var THUMB = 48;             // lado do thumb em px CSS (canvas 2x = 96) — a bolha nunca passa disso na tela
  var MAX_INFLIGHT = 4;       // downloads simultâneos (conexão lenta não trava o resto)
  var MAX_CACHE = 400;        // thumbs vivos na sessão (LRU pelos menos usados)
  var TIMEOUT_MS = 15000;
  var MAX_TRIES = 3;          // falhas de rede/404 tentam de novo (45 s, 90 s); depois desiste na sessão
  var RETRY_MS = 45000;
  var cache = {};             // url -> { st, cv, waiters, pri, at }
  var queue = [];             // urls em 'queued'
  var inflight = 0;
  var blockedHandler = null;

  function status(url) { var c = cache[url]; return c ? c.st : 'none'; }
  function thumb(url) { var c = cache[url]; if (c && c.st === 'ok') { c.at = Date.now(); return c.cv; } return null; } // renova o LRU: quem está na tela não é despejado
  // 0 = pode pedir agora; timestamp = espera; Infinity = desistiu nesta sessão
  function retryAt(url) { var c = cache[url]; if (!c || c.st !== 'bad') return 0; return c.tries >= MAX_TRIES ? Infinity : c.retryAt; }

  function request(url, pri, cb) {
    if (!url || typeof url !== 'string') { if (cb) cb(false); return; }
    var c = cache[url];
    if (c) {
      c.at = Date.now();
      if (c.st === 'ok') { if (cb) cb(true); return; }
      // falhou antes: tenta de novo depois de um tempo (rede lenta/túnel), até 3 vezes; CORS bloqueado é definitivo
      if (c.st === 'bad') {
        if (c.tries >= MAX_TRIES || Date.now() < c.retryAt) { if (cb) cb(false); return; }
        c.st = 'queued'; c.pri = (typeof pri === 'number') ? pri : 1e9; c.waiters = cb ? [cb] : []; queue.push(url); pump(); return;
      }
      if (typeof pri === 'number' && pri < c.pri) c.pri = pri;
      if (cb) c.waiters.push(cb);
      return;
    }
    cache[url] = { st: 'queued', cv: null, waiters: cb ? [cb] : [], pri: (typeof pri === 'number') ? pri : 1e9, at: Date.now(), tries: 0, retryAt: 0 };
    queue.push(url);
    pump();
  }
  function reprioritize(fn) {
    for (var i = 0; i < queue.length; i++) { var c = cache[queue[i]]; if (c) { var p = fn(queue[i]); if (typeof p === 'number') c.pri = p; } }
  }
  function pump() {
    while (inflight < MAX_INFLIGHT && queue.length) {
      queue.sort(function (a, b) { return (cache[a] ? cache[a].pri : 1e9) - (cache[b] ? cache[b].pri : 1e9); });
      var url = queue.shift(); var c = cache[url];
      if (!c || c.st !== 'queued') continue;
      load(url, c);
    }
  }
  function load(url, c) {
    c.st = 'loading'; inflight++;
    var img = new Image(), done = false, timer = null;
    function finish(ok, blocked) {
      if (done) return; done = true; inflight--;
      if (timer) clearTimeout(timer);
      img.onload = null; img.onerror = null;
      if (ok) { try { c.cv = crop(img); } catch (e) { ok = false; blocked = true; } }
      c.st = ok ? 'ok' : 'bad'; if (!ok) { c.cv = null; c.tries = blocked ? MAX_TRIES : (c.tries || 0) + 1; c.retryAt = Date.now() + RETRY_MS * c.tries; }
      if (!ok && blocked && blockedHandler) { try { blockedHandler(url); } catch (e) {} }
      var w = c.waiters; c.waiters = [];
      for (var i = 0; i < w.length; i++) { try { w[i](ok); } catch (e) {} }
      evict(); pump();
    }
    timer = setTimeout(function () { try { img.src = ''; } catch (e) {} finish(false, false); }, TIMEOUT_MS);
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = function () { finish(true, false); };
    img.onerror = function () { finish(false, false); };
    img.src = url;
  }
  // recorte quadrado (object-fit: cover) num canvas 2x; o rosto costuma ficar no terço de cima → recorte puxado pra cima
  function crop(img) {
    var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    if (!w || !h) throw new Error('empty');
    var s = Math.min(w, h), sx = (w - s) / 2, sy = (h - s) * 0.3;
    var cv = document.createElement('canvas'); cv.width = THUMB * 2; cv.height = THUMB * 2;
    var ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = true; try { ctx.imageSmoothingQuality = 'high'; } catch (e) {}
    ctx.drawImage(img, sx, sy, s, s, 0, 0, THUMB * 2, THUMB * 2);
    ctx.getImageData(0, 0, 1, 1); // SecurityError se a imagem veio sem CORS (canvas tainted) → cai no avatar
    return cv;
  }
  function evict() {
    var keys = Object.keys(cache); if (keys.length <= MAX_CACHE) return;
    keys.sort(function (a, b) { return cache[a].at - cache[b].at; });
    var extra = keys.length - MAX_CACHE;
    for (var i = 0; i < keys.length && extra > 0; i++) { var c = cache[keys[i]]; if (c.st === 'ok' || c.st === 'bad') { delete cache[keys[i]]; extra--; } }
  }

  // ---- desenho ----
  // o = { d: diâmetro (px CSS), ring: cor da borda, ringW: espessura, glow: cor|null, dot: cor|null, badge: 'new'|'match'|null, tail: bool, alpha: 0..1 }
  function drawBubble(ctx, cv, cx, cy, o) {
    var r = o.d / 2, rw = o.ringW || 2;
    ctx.save();
    ctx.globalAlpha = (o.alpha == null) ? 1 : Math.max(0, Math.min(1, o.alpha));
    // sombra suave por baixo (legibilidade sobre o mapa, dia ou noite)
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 2;
    ctx.fillStyle = '#12122A'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill(); ctx.restore();
    // brilho discreto (selecionado / match / em alta)
    if (o.glow) { ctx.save(); ctx.shadowColor = o.glow; ctx.shadowBlur = 9; ctx.strokeStyle = o.glow; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, cy, r + 0.5, 0, TAU); ctx.stroke(); ctx.restore(); }
    // rabicho: a bolha "pertence" ao personagem embaixo
    if (o.tail !== false) { ctx.fillStyle = o.ring; ctx.beginPath(); ctx.moveTo(cx - 4.5, cy + r - 2.5); ctx.lineTo(cx + 4.5, cy + r - 2.5); ctx.lineTo(cx, cy + r + 5); ctx.closePath(); ctx.fill(); }
    // foto (ou placeholder neutro) recortada no círculo
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r - rw * 0.5, 0, TAU); ctx.clip();
    if (cv) ctx.drawImage(cv, cx - r, cy - r, o.d, o.d);
    else { ctx.fillStyle = '#1E1E3A'; ctx.fillRect(cx - r, cy - r, o.d, o.d); ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.beginPath(); ctx.arc(cx, cy - r * 0.15, r * 0.34, 0, TAU); ctx.fill(); ctx.beginPath(); ctx.ellipse(cx, cy + r * 0.75, r * 0.6, r * 0.42, 0, Math.PI, TAU); ctx.fill(); }
    ctx.restore();
    // borda
    ctx.strokeStyle = o.ring; ctx.lineWidth = rw; ctx.beginPath(); ctx.arc(cx, cy, r - rw * 0.5, 0, TAU); ctx.stroke();
    // ponto de presença (online) — canto inferior direito, com "furo" pra destacar
    if (o.dot) { var dx = cx + r * 0.68, dy = cy + r * 0.68; ctx.fillStyle = '#12122A'; ctx.beginPath(); ctx.arc(dx, dy, 5, 0, TAU); ctx.fill(); ctx.fillStyle = o.dot; ctx.beginPath(); ctx.arc(dx, dy, 3.4, 0, TAU); ctx.fill(); }
    // selo (novo por aqui ✦ / match ♥) — canto superior esquerdo
    if (o.badge) {
      var bx = cx - r * 0.72, by = cy - r * 0.72, isMatch = o.badge === 'match';
      ctx.fillStyle = '#12122A'; ctx.beginPath(); ctx.arc(bx, by, 7, 0, TAU); ctx.fill();
      ctx.fillStyle = isMatch ? '#FF1493' : '#FFD700'; ctx.beginPath(); ctx.arc(bx, by, 5.6, 0, TAU); ctx.fill();
      ctx.fillStyle = '#0A0A1A';
      if (isMatch) { heart(ctx, bx, by + 0.4, 3.2); }
      else { star(ctx, bx, by, 3.6); }
    }
    ctx.restore();
  }
  function heart(ctx, x, y, s) {
    ctx.beginPath(); ctx.moveTo(x, y + s);
    ctx.bezierCurveTo(x - s * 1.6, y - s * 0.2, x - s * 0.7, y - s * 1.3, x, y - s * 0.4);
    ctx.bezierCurveTo(x + s * 0.7, y - s * 1.3, x + s * 1.6, y - s * 0.2, x, y + s);
    ctx.closePath(); ctx.fill();
  }
  function star(ctx, x, y, s) {
    ctx.beginPath();
    for (var i = 0; i < 8; i++) { var rr = (i % 2 === 0) ? s : s * 0.42, a = -Math.PI / 2 + i * Math.PI / 4; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    ctx.closePath(); ctx.fill();
  }

  return { request: request, thumb: thumb, status: status, retryAt: retryAt, reprioritize: reprioritize, drawBubble: drawBubble,
           onBlocked: function (fn) { blockedHandler = fn; }, THUMB: THUMB };
})();
`;
