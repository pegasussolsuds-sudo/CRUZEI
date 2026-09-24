// Motor de animação dos avatares no WebView do mapa (JS puro, injetado dentro do mapbox-html.ts).
// Roda em cima das camadas vetoriais do avatar (layers.ts) marcadas com grupo (`g`) e dos pivôs do rig:
// cada estado vira uma POSE (rotação/deslocamento por grupo) calculada por tempo — sem assets, sem GLB.
//
// Estados: idle | walk | run | wave | like | celebrate | match | arrive
// Transições: blend linear de 220 ms entre a pose anterior e a nova (sem cortes).
// Variação por pessoa: fase, velocidade da respiração e escala vêm de um hash do id (ninguém é clone).
//
// Contrato (usado pelo mapbox-html.ts):
//   CZ_ANIM.hash01(str, salt)                      -> 0..1 determinístico
//   CZ_ANIM.pose(state, t, v, oneShot)             -> pose {body,head,armL,armR,legL,legR,shadow}
//   CZ_ANIM.blend(a, b, k)                         -> pose interpolada
//   CZ_ANIM.drawPosed(ctx, layers, rig, pose, x, y, scale, mirror)
//   CZ_ANIM.DUR[state]                             -> duração (s) dos estados one-shot

export const AVATAR_ANIM_JS = String.raw`
var CZ_ANIM = (function () {
  'use strict';
  var TAU = Math.PI * 2;
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function easeOut(k) { return 1 - Math.pow(1 - clamp(k, 0, 1), 3); }
  function easeInOut(k) { k = clamp(k, 0, 1); return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; }
  function hash01(str, salt) {
    var h = 2166136261 >>> 0; str = String(str) + '|' + (salt || '');
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return (h >>> 8) / 16777216;
  }
  // duração (s) dos estados que acabam sozinhos; 0 = loop
  var DUR = { idle: 0, walk: 0, run: 0, wave: 1.7, like: 0.9, celebrate: 1.6, match: 3.4, arrive: 0.6 };

  // pose neutra
  function zero() {
    return { body: { r: 0, dy: 0, sx: 1, sy: 1 }, head: { r: 0, dy: 0 }, armL: { r: 0 }, armR: { r: 0 }, legL: { r: 0 }, legR: { r: 0 }, shadow: { s: 1 } };
  }
  // v = { ph: fase 0..1, sp: 0.85..1.15 (velocidade da respiração), en: 0.9..1.1 (energia) }
  function idle(t, v) {
    var p = zero();
    var w = t * (TAU / 2.6) * v.sp + v.ph * TAU;
    var b = Math.sin(w);
    p.body.sy = 1 + 0.012 * b; p.body.dy = -0.5 * b;
    p.head.r = 1.6 * Math.sin(w * 0.5 + 0.6) * v.en; p.head.dy = -0.4 * b;
    p.armL.r = 2.2 * b * v.en; p.armR.r = -2.2 * b * v.en;
    // troca de apoio (sutil) a cada ~7 s
    var sw = Math.sin(t * (TAU / 7.3) + v.ph * 9);
    p.body.r = 1.4 * sw * sw * sw; p.legL.r = -1.2 * sw; p.legR.r = 1.2 * sw;
    p.shadow.s = 1 + 0.02 * b;
    return p;
  }
  function gait(t, v, freq, amp, lean) {
    var p = zero();
    var w = t * TAU * freq + v.ph * TAU;
    var s = Math.sin(w), c = Math.cos(w);
    p.legL.r = amp * s; p.legR.r = -amp * s;
    p.armL.r = -amp * 0.8 * s; p.armR.r = amp * 0.8 * s;
    var bob = Math.abs(c);
    p.body.dy = -2.2 * bob * (amp / 28); p.body.r = lean; p.body.sy = 1 + 0.01 * bob;
    p.head.r = -lean * 0.5 - 2 * s * (amp / 28); p.head.dy = -0.6 * bob;
    p.shadow.s = 1 - 0.06 * bob;
    return p;
  }
  function walk(t, v) { return gait(t, v, 1.9 * v.sp, 28, 3); }
  function run(t, v) { return gait(t, v, 2.9 * v.sp, 40, 9); }
  // one-shots: k = progresso 0..1 (tempo / DUR)
  function wave(k, v) {
    var p = idle(k * DUR.wave, v);
    var up = easeOut(k / 0.18) * (1 - easeInOut((k - 0.82) / 0.18)); // sobe rápido, desce no fim
    p.armR.r = -150 * up + 14 * Math.sin(k * DUR.wave * 11) * up;
    p.head.r += 5 * up; p.body.r += -2 * up;
    return p;
  }
  function like(k, v) {
    var p = idle(k * DUR.like, v);
    var hop = Math.sin(Math.PI * clamp(k / 0.7, 0, 1));
    p.body.dy += -7 * hop; p.body.sx = 1 + 0.05 * hop; p.body.sy = 1 - 0.04 * hop + 0.06 * Math.max(0, 1 - Math.abs(k - 0.72) / 0.12);
    p.armL.r += -35 * hop; p.armR.r += 35 * hop; p.head.dy += -1.5 * hop; p.shadow.s = 1 - 0.18 * hop;
    return p;
  }
  function celebrate(k, v) {
    var p = idle(k * DUR.celebrate, v);
    var jump = Math.abs(Math.sin(Math.PI * k * 2)) * (1 - easeInOut((k - 0.85) / 0.15));
    var arms = easeOut(k / 0.15) * (1 - easeInOut((k - 0.85) / 0.15));
    p.body.dy += -10 * jump; p.body.sy = 1 + 0.03 * jump; p.body.sx = 1 - 0.02 * jump;
    p.armL.r = 160 * arms + 8 * Math.sin(k * 30); p.armR.r = -160 * arms - 8 * Math.sin(k * 30);
    p.legL.r = -10 * jump; p.legR.r = 10 * jump; p.head.r = 4 * Math.sin(k * 20) * arms; p.shadow.s = 1 - 0.25 * jump;
    return p;
  }
  function match(k, v) {
    var p = idle(k * DUR.match, v);
    var inA = easeOut(k / 0.12), outA = 1 - easeInOut((k - 0.88) / 0.12), a = inA * outA;
    var sway = Math.sin(k * DUR.match * 5.5);
    p.armL.r = 150 * a + 10 * sway * a; p.armR.r = -150 * a - 10 * sway * a;
    p.body.dy += -3 * Math.abs(Math.sin(k * DUR.match * 4)) * a; p.body.r += 3 * sway * a;
    p.head.r += -6 * sway * a; p.shadow.s = 1 - 0.06 * a;
    return p;
  }
  function arrive(k, v) {
    var p = idle(k * DUR.arrive, v);
    var sq = Math.sin(Math.PI * clamp(k / 0.6, 0, 1));
    p.body.sy *= 1 - 0.08 * sq; p.body.sx *= 1 + 0.06 * sq; p.body.dy += 1.5 * sq; p.head.dy += 1 * sq;
    return p;
  }
  var ONE = { wave: wave, like: like, celebrate: celebrate, match: match, arrive: arrive };

  // pose de um estado no tempo t (s desde o início do estado)
  function pose(state, t, v) {
    if (state === 'walk') return walk(t, v);
    if (state === 'run') return run(t, v);
    var one = ONE[state];
    if (one) return one(clamp(t / DUR[state], 0, 1), v);
    return idle(t, v);
  }
  function lerp(a, b, k) { return a + (b - a) * k; }
  function blend(a, b, k) {
    if (k <= 0) return a; if (k >= 1) return b;
    return {
      body: { r: lerp(a.body.r, b.body.r, k), dy: lerp(a.body.dy, b.body.dy, k), sx: lerp(a.body.sx, b.body.sx, k), sy: lerp(a.body.sy, b.body.sy, k) },
      head: { r: lerp(a.head.r, b.head.r, k), dy: lerp(a.head.dy, b.head.dy, k) },
      armL: { r: lerp(a.armL.r, b.armL.r, k) }, armR: { r: lerp(a.armR.r, b.armR.r, k) },
      legL: { r: lerp(a.legL.r, b.legL.r, k) }, legR: { r: lerp(a.legR.r, b.legR.r, k) },
      shadow: { s: lerp(a.shadow.s, b.shadow.s, k) }
    };
  }

  // Desenha as camadas com a pose: cada grupo tem sua transformação (hierarquia: pernas na raiz;
  // corpo na raiz; cabeça e braços são filhos do corpo). Ordem das camadas preservada (z-order do desenho).
  var D2R = Math.PI / 180;
  function drawPosed(ctx, layers, rig, pose, x, y, scale, mirror) {
    ctx.save();
    ctx.translate(x, y); ctx.scale(scale, scale);
    if (mirror) { ctx.translate(100, 0); ctx.scale(-1, 1); }
    var base = ctx.getTransform();
    var T = {};
    // pernas: giram no quadril
    T.legL = legT(base, rig.legL, pose.legL.r);
    T.legR = legT(base, rig.legR, pose.legR.r);
    // sombra: escala no chão
    var sh = new DOMMatrix(base); sh.translateSelf(50, 135); sh.scaleSelf(pose.shadow.s, 1); sh.translateSelf(-50, -135); T.shadow = sh;
    // corpo: desloca, escala e gira a partir do quadril
    var bd = new DOMMatrix(base); bd.translateSelf(rig.body[0], rig.body[1] + pose.body.dy); bd.rotateSelf(pose.body.r); bd.scaleSelf(pose.body.sx, pose.body.sy); bd.translateSelf(-rig.body[0], -rig.body[1]); T.body = bd;
    // cabeça e braços: filhos do corpo
    var hd = new DOMMatrix(bd); hd.translateSelf(rig.head[0], rig.head[1] + pose.head.dy); hd.rotateSelf(pose.head.r); hd.translateSelf(-rig.head[0], -rig.head[1]); T.head = hd;
    var al = new DOMMatrix(bd); al.translateSelf(rig.armL[0], rig.armL[1]); al.rotateSelf(pose.armL.r); al.translateSelf(-rig.armL[0], -rig.armL[1]); T.armL = al;
    var ar = new DOMMatrix(bd); ar.translateSelf(rig.armR[0], rig.armR[1]); ar.rotateSelf(pose.armR.r); ar.translateSelf(-rig.armR[0], -rig.armR[1]); T.armR = ar;
    var lastG = null;
    for (var i = 0; i < layers.length; i++) {
      var l = layers[i]; var g = l.g || 'body';
      if (g !== lastG) { ctx.setTransform(T[g] || base); lastG = g; }
      var p; try { p = new Path2D(l.d); } catch (e) { continue; }
      ctx.globalAlpha = (l.o == null) ? 1 : l.o;
      if (l.f) { ctx.fillStyle = l.f; ctx.fill(p, l.r || 'nonzero'); }
      if (l.s) { ctx.lineWidth = l.w || 1; ctx.lineCap = l.c || 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = l.s; ctx.stroke(p); }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }
  function legT(base, pivot, deg) { var m = new DOMMatrix(base); m.translateSelf(pivot[0], pivot[1]); m.rotateSelf(deg); m.translateSelf(-pivot[0], -pivot[1]); return m; }

  return { hash01: hash01, pose: pose, blend: blend, drawPosed: drawPosed, DUR: DUR, zero: zero };
})();
`;
