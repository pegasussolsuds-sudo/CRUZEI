// Objetos na mão (dono: pets): presente, livro, câmera, microfone, pandeiro, leque, plaquinha de coração, balão de
// coração, violão e troféu. Espaço do objeto: origem na pegada, −y rumo ao cotovelo (pra cima com o braço solto).
// Materiais próprios: papel e cetim, couro com folha de ouro, couro sintético e metal escovado, malha de metal, madeira
// com cordas, pele de pandeiro com platinelas, seda plissada, metalizado de balão e ouro polido.

import type { HeldDef } from './held';
import { ballGrad, cylX, metalX, mix, screenDir, sparkles, tones, type Pen, type SP } from './pets-kit';

const GOLD = '#E8B93A';

function gift(q: Pen): string {
  const L = q.lite;
  // alça de fita saindo do punho até o laço; a caixa pende embaixo da mão
  const loop = q.taper([[-0.5, -1.4], [-0.2, 2.6], [0.4, 6.0]], [0.42, 0.4, 0.36], { n: 8 }) + q.taper([[0.5, -1.4], [0.9, 2.6], [0.8, 6.0]], [0.42, 0.4, 0.36], { n: 8 });
  const rb = tones('#FF1493');
  q.fill(loop, rb.base, { gf: q.lg(-0.6, 0, 1, 0, [[0, rb.light], [1, rb.shade]]) });
  const B = tones('#2462C9');
  const y0 = 7.0;
  const front = q.path([[-2.8, y0 + 0.6], [2.2, y0 + 0.6], [2.2, y0 + 6.4], [-2.8, y0 + 6.4]]);
  const side = q.path([[2.2, y0 + 0.6], [3.5, y0 - 0.4], [3.5, y0 + 5.4], [2.2, y0 + 6.4]]);
  const top = q.path([[-2.8, y0 + 0.6], [2.2, y0 + 0.6], [3.5, y0 - 0.4], [-1.5, y0 - 0.4]]);
  q.fill(side, B.shade, { gf: q.lg(2.2, 0, 3.5, 0, [[0, B.shade], [1, B.deep]]) });
  q.fill(front, B.base, { gf: q.lg(-2.8, y0, 2.2, y0 + 6.4, [[0, B.light], [1, B.base]]) });
  q.fill(top, B.lighter, { gf: q.lg(-1.5, y0 - 0.4, 2.2, y0 + 0.6, [[0, B.lighter], [1, B.light]]) });
  if (!L) {
    // bolinhas da estampa
    let d = '';
    for (const [x, y] of [
      [-2.0, y0 + 1.8],
      [1.4, y0 + 2.0],
      [-1.6, y0 + 4.6],
      [1.2, y0 + 5.4],
      [-0.4, y0 + 3.2],
    ] as const)
      d += q.ell(x, y, 0.32, 0.32);
    q.fill(d, '#FFFFFF', { o: 0.5, cp: front });
    q.line(q.path([[-1.6, y0 - 0.2], [-2.6, y0 + 0.5]], false), '#FFFFFF', 0.12, { o: 0.4 });
  }
  // fita: faixa vertical na frente, faixa na lateral e no tampo
  q.fill(q.path([[-0.75, y0 + 0.6], [0.15, y0 + 0.6], [0.15, y0 + 6.4], [-0.75, y0 + 6.4]]), rb.base, { gf: q.lg(-0.75, 0, 0.15, 0, [[0, rb.lighter], [1, rb.shade]]) });
  q.fill(q.path([[2.2, y0 + 3.0], [3.5, y0 + 2.0], [3.5, y0 + 2.9], [2.2, y0 + 3.9]]), rb.shade);
  q.fill(q.path([[-0.75, y0 + 0.6], [0.15, y0 + 0.6], [1.45, y0 - 0.4], [0.55, y0 - 0.4]]), rb.light);
  // laço
  const bow = q.path([[0.2, y0], [-1.8, y0 - 1.6, 0.6], [-2.0, y0 + 0.2, 0.6]]) + q.path([[0.2, y0], [2.2, y0 - 1.8, 0.6], [2.4, y0 + 0.1, 0.6]]);
  q.fill(bow, rb.base, { gf: q.lg(-2, y0 - 1.8, 2.4, y0, [[0, rb.lighter], [0.5, rb.base], [1, rb.shade]]) });
  q.fill(q.ell(0.2, y0 - 0.1, 0.55, 0.5), rb.light);
  return loop;
}

function book(q: Pen): string {
  const L = q.lite;
  const C = tones('#7A1F2E');
  const x0 = -1.6;
  const x1 = 3.6;
  const y0 = -3.0;
  const y1 = 4.4;
  // miolo (páginas) aparecendo à direita e embaixo
  const pages = q.path([[x0 + 0.4, y0 + 0.3], [x1 + 0.45, y0 + 0.35], [x1 + 0.45, y1 + 0.35], [x0 + 0.4, y1 + 0.35]]);
  q.fill(pages, '#F4EAD2', { gf: q.lg(x1, 0, x1 + 0.45, 0, [[0, '#FFF8E6'], [1, '#D9C8A2']]) });
  if (!L) {
    let d = '';
    for (let i = 1; i < 4; i++) d += q.path([[x1 + 0.1 * i, y0 + 0.5], [x1 + 0.1 * i, y1 + 0.2]], false);
    q.line(d, '#BCA886', 0.06, { o: 0.7 });
  }
  // capa de couro com lombada
  const cover = q.path([[x0, y0, 0.2], [x1, y0, 0.2], [x1, y1, 0.2], [x0, y1, 0.2]]);
  q.fill(cover, C.base, { gf: q.lg(x0, y0, x1, y1, [[0, C.light], [0.5, C.base], [1, C.shade]]) });
  const spine = q.path([[x0 - 0.5, y0 + 0.1], [x0 + 0.9, y0], [x0 + 0.9, y1], [x0 - 0.5, y1 - 0.1]]);
  q.fill(spine, C.shade, { gf: cylX(q, x0 - 0.5, x0 + 0.9, 0, C) });
  // folha de ouro: título, filetes e ornamento
  const G = tones(GOLD);
  q.fill(q.path([[x0 + 1.6, y0 + 1.2], [x1 - 0.6, y0 + 1.2], [x1 - 0.6, y0 + 1.6], [x0 + 1.6, y0 + 1.6]]) + q.path([[x0 + 2.0, y0 + 2.1], [x1 - 1.0, y0 + 2.1], [x1 - 1.0, y0 + 2.4], [x0 + 2.0, y0 + 2.4]]), G.base, { gf: metalX(q, x0 + 1.6, x1 - 0.6, 0, GOLD) });
  const cx = (x0 + 1.0 + x1) / 2;
  const cy = y0 + 4.6;
  q.fill(q.path([[cx, cy - 1.1, 0], [cx + 0.3, cy - 0.3], [cx + 1.1, cy, 0], [cx + 0.3, cy + 0.3], [cx, cy + 1.1, 0], [cx - 0.3, cy + 0.3], [cx - 1.1, cy, 0], [cx - 0.3, cy - 0.3]]), G.base, { gf: metalX(q, cx - 1, cx + 1, cy, GOLD) });
  if (!L) {
    q.line(q.path([[x0 + 1.2, y0 + 0.5], [x1 - 0.35, y0 + 0.5], [x1 - 0.35, y1 - 0.5], [x0 + 1.2, y1 - 0.5]]) , G.base, 0.12, { o: 0.75 });
    q.line(q.path([[x0 + 0.3, y0 + 1.0], [x0 + 0.3, y1 - 1.0]], false), G.light, 0.1, { o: 0.6, da: [0.3, 0.25] });
    // marcador de fita saindo embaixo
    q.fill(q.taper([[x0 + 3.0, y1], [x0 + 3.1, y1 + 1.2], [x0 + 2.9, y1 + 1.9]], [0.36, 0.34, 0.3]), GOLD);
    q.fill(q.ell(x0 + 1.6, y0 + 1.2, 1.2, 0.5, -30), '#FFFFFF', { o: 0.18, b: 0.4, cp: cover });
  }
  return q.path([[x0 - 0.5, y0], [x1, y0], [x1, y1], [x0 - 0.5, y1]]);
}

function camera(q: Pen): string {
  const L = q.lite;
  // alça: da mão até a orelha da câmera (pende embaixo da mão)
  const strap = q.taper([[0, -1.6], [-0.4, 2.0], [-1.8, 5.2]], [0.5, 0.48, 0.45], { n: 8 });
  q.fill(strap, '#2A2A30', { gf: q.lg(-1, 0, 0.6, 0, [[0, '#4A4A54'], [1, '#1A1A20']]) });
  const cx = 0.6;
  const cy = 8.2;
  // corpo: chapa de cima prateada, couro sintético embaixo
  const body = q.path([[cx - 3.4, cy - 1.8, 0.3], [cx + 3.4, cy - 1.8, 0.3], [cx + 3.4, cy + 2.2, 0.3], [cx - 3.4, cy + 2.2, 0.3]]);
  q.fill(body, '#1E1E24', { gf: q.lg(0, cy - 1.8, 0, cy + 2.2, [[0, '#3A3A44'], [1, '#141418']]) });
  const plate = q.path([[cx - 3.4, cy - 1.8, 0.3], [cx + 3.4, cy - 1.8, 0.3], [cx + 3.4, cy - 0.7], [cx - 3.4, cy - 0.7]]);
  q.fill(plate, '#C8CCD4', { gf: metalX(q, cx - 3.4, cx + 3.4, cy, '#C8CCD4') });
  if (!L) {
    let d = '';
    for (let x = cx - 3.0; x < cx + 3.2; x += 0.6) for (let y = cy - 0.3; y < cy + 2.1; y += 0.6) d += q.ell(x, y, 0.08, 0.08);
    q.fill(d, '#55555E', { o: 0.6, cp: body });
  }
  // visor, botão do disparo, orelhas
  q.fill(q.path([[cx - 2.9, cy - 3.0, 0.3], [cx - 1.3, cy - 3.0, 0.3], [cx - 1.3, cy - 1.8], [cx - 2.9, cy - 1.8]]), '#C8CCD4', { gf: metalX(q, cx - 2.9, cx - 1.3, 0, '#C8CCD4') });
  q.fill(q.path([[cx - 2.6, cy - 2.7], [cx - 1.6, cy - 2.7], [cx - 1.6, cy - 2.1], [cx - 2.6, cy - 2.1]]), '#6AA6D8', { gf: q.lg(0, cy - 2.7, 0, cy - 2.1, [[0, '#BFE6FF'], [1, '#3A6AA0']]) });
  q.fill(q.ell(cx + 2.4, cy - 2.05, 0.55, 0.3), '#E0344A');
  q.fill(q.ell(cx - 3.5, cy - 1.2, 0.3, 0.4) + q.ell(cx + 3.5, cy - 1.2, 0.3, 0.4), '#9A9EA8');
  // lente: anel metálico, anel preto, vidro com reflexos
  const lx = cx + 0.5;
  const ly = cy + 0.6;
  q.fill(q.ell(lx, ly, 2.0, 2.0), '#B8BCC6', { gf: q.rg(lx - 0.6, ly - 0.7, 2.4, [[0, '#F2F4F8'], [0.6, '#A8ACB6'], [1, '#5A5E68']]) });
  q.fill(q.ell(lx, ly, 1.5, 1.5), '#16161C');
  const glassD = q.ell(lx, ly, 1.05, 1.05);
  q.fill(glassD, '#2A2A5A', { gf: q.rg(lx + 0.3, ly + 0.3, 1.3, [[0, '#6A3AA8'], [0.5, '#2A3A7A'], [1, '#0A0A1A']]) });
  q.fill(q.ell(lx - 0.35, ly - 0.4, 0.4, 0.28, -30), '#FFFFFF', { o: 0.85 });
  if (!L) q.fill(q.ell(lx + 0.45, ly + 0.45, 0.16, 0.12), '#FFFFFF', { o: 0.6 });
  return strap;
}

function mic(q: Pen): string {
  const L = q.lite;
  const H = tones('#26262E');
  const handle = q.taper([[0, 4.9], [0, 1.0], [0, -2.5]], [0.62, 0.8, 0.98], { n: 8, round: true });
  q.fill(handle, H.base, { gf: cylX(q, -1, 1, 0, H, true) });
  if (!L) q.line(q.path([[0, 4.2], [0, 3.6]], false), '#55E07A', 0.3, { o: 0.9 });
  // anel e cabeça de malha metálica
  q.fill(q.path([[-1.1, -2.4, 0.4], [1.1, -2.4, 0.4], [1.15, -3.0, 0.4], [-1.15, -3.0, 0.4]]), '#D8B04A', { gf: metalX(q, -1.15, 1.15, 0, '#D8B04A') });
  const head = q.path([[-1.25, -2.9], [-1.85, -3.8], [-1.95, -5.0], [-1.3, -6.2], [0, -6.6, 0.6], [1.3, -6.2], [1.95, -5.0], [1.85, -3.8], [1.25, -2.9]]);
  // luz sempre de cima-esquerda da tela (o microfone fica de cabeça pra baixo no repouso)
  const [lx, ly] = screenDir(q, -0.62, -0.78);
  q.fill(head, '#B9BEC8', { gf: q.rg(lx * 1.1, -4.75 + ly * 1.1, 2.6, [[0, '#F4F6FA'], [0.5, '#B0B5C0'], [1, '#5A5E6A']]) });
  if (!L) {
    let d = '';
    for (let i = -4; i <= 4; i++) d += q.path([[i * 0.5 - 1.6, -2.8], [i * 0.5 + 1.6, -6.8]], false) + q.path([[i * 0.5 + 1.6, -2.8], [i * 0.5 - 1.6, -6.8]], false);
    q.line(d, '#4A4E58', 0.08, { o: 0.55, cp: head });
    q.fill(q.ell(lx * 1.15, -4.75 + ly * 1.15, 0.7, 0.45, -25), '#FFFFFF', { o: 0.6, b: 0.25, cp: head });
  }
  q.line(q.path([[-1.95, -4.6], [0, -4.3], [1.95, -4.6]], false), '#8A8E98', 0.3, { o: 0.9 });
  return handle;
}

function tambourine(q: Pen): string {
  const L = q.lite;
  // o pandeiro é desenhado alinhado com a tela (luz sempre de cima-esquerda), com centro além dos dedos
  const c = q.sub(0, -4.4, 1, -150);
  const W = tones('#B9783A');
  const r = 4.3;
  const frame = c.ell(0, 0, r, r * 0.94);
  c.fill(frame, W.base, { gf: c.rg(-1.4, -1.6, r * 1.3, [[0, W.lighter], [0.5, W.base], [1, W.deep]]) });
  const head = c.ell(0.15, 0.1, r - 0.75, (r - 0.75) * 0.94);
  c.fill(head, '#F2E2C2', { gf: c.rg(-1.0, -1.2, r * 1.1, [[0, '#FFF6E4'], [0.6, '#EED9B2'], [1, '#C8A878']]) });
  if (!L) {
    c.fill(c.ell(1.0, 1.2, 2.0, 1.6), '#8A5A2A', { o: 0.15, b: 0.8, cp: head });
    c.line(c.ell(0.15, 0.1, r - 0.75, (r - 0.75) * 0.94), '#6A4420', 0.18, { o: 0.6 });
  }
  // platinelas: pares de discos de metal nas fendas do aro
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    const x = Math.cos(a) * (r - 0.38);
    const y = Math.sin(a) * (r - 0.38) * 0.94;
    const slot = c.ell(x, y, 0.95, 0.5, (a * 180) / Math.PI + 90);
    c.fill(slot, '#3A2410');
    c.fill(c.ell(x - 0.15, y - 0.05, 0.62, 0.6) + c.ell(x + 0.2, y + 0.08, 0.6, 0.58), '#D8DCE4', { gf: c.rg(x - 0.3, y - 0.3, 0.9, [[0, '#FFFFFF'], [0.5, '#C8CCD6'], [1, '#7A7E88']]) });
  }
  return q.ell(0, -0.6, 1.4, 1.6);
}

function fan(q: Pen): string {
  const L = q.lite;
  const R = tones('#C8102E');
  const a0 = -152;
  const a1 = -28;
  const n = 12;
  const r0 = 2.2;
  const r1 = 7.6;
  // varetas (madeira escura) por baixo
  let ribs = '';
  for (let i = 0; i <= n; i++) {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    ribs += q.path([[0, 0], [Math.cos(a) * r0 * 1.2, Math.sin(a) * r0 * 1.2]], false);
  }
  q.line(ribs, '#3A2016', 0.32);
  // seda plissada: gomos alternando luz e sombra
  for (let i = 0; i < n; i++) {
    const aa = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    const ab = ((a0 + ((a1 - a0) * (i + 1)) / n) * Math.PI) / 180;
    const d = q.path([[Math.cos(aa) * r0, Math.sin(aa) * r0, 0], [Math.cos(aa) * r1, Math.sin(aa) * r1, 0], [Math.cos((aa + ab) / 2) * (r1 + 0.25), Math.sin((aa + ab) / 2) * (r1 + 0.25)], [Math.cos(ab) * r1, Math.sin(ab) * r1, 0], [Math.cos(ab) * r0, Math.sin(ab) * r0, 0]]);
    const c = i % 2 ? R.base : R.light;
    q.fill(d, c, { gf: q.rg(0, 0, r1, [[0, R.shade], [0.4, c], [1, i % 2 ? R.shade : R.base]]) });
  }
  const silk = q.path([...Array.from({ length: 9 }, (_, i) => {
    const a = ((a0 + ((a1 - a0) * i) / 8) * Math.PI) / 180;
    return [Math.cos(a) * r1, Math.sin(a) * r1] as SP;
  }), ...Array.from({ length: 9 }, (_, i) => {
    const a = ((a1 - ((a1 - a0) * i) / 8) * Math.PI) / 180;
    return [Math.cos(a) * r0, Math.sin(a) * r0] as SP;
  })]);
  if (!L) {
    // florzinhas brancas e borda dourada
    let fl = '';
    for (const [rr, ang, s] of [
      [5.6, -120, 0.5],
      [4.4, -95, 0.4],
      [6.0, -70, 0.55],
      [4.8, -50, 0.4],
      [5.2, -140, 0.38],
    ] as const) {
      const a = (ang * Math.PI) / 180;
      const x = Math.cos(a) * rr;
      const y = Math.sin(a) * rr;
      for (let k = 0; k < 5; k++) {
        const b = (k / 5) * Math.PI * 2;
        fl += q.ell(x + Math.cos(b) * s * 0.6, y + Math.sin(b) * s * 0.6, s * 0.42, s * 0.42);
      }
    }
    q.fill(fl, '#FFF4F0', { o: 0.85, cp: silk });
    const edge: SP[] = [];
    for (let i = 0; i <= 16; i++) {
      const a = ((a0 + ((a1 - a0) * i) / 16) * Math.PI) / 180;
      edge.push([Math.cos(a) * (r1 - 0.25), Math.sin(a) * (r1 - 0.25)]);
    }
    q.line(q.path(edge, false), GOLD, 0.22, { o: 0.9 });
  }
  // varetas de guarda e rebite dourado
  const guard = (ang: number) => {
    const a = (ang * Math.PI) / 180;
    return q.taper([[0, 0], [Math.cos(a) * r1 * 0.98, Math.sin(a) * r1 * 0.98]], [0.5, 0.32]);
  };
  q.fill(guard(a0) + guard(a1), '#4A2A1A', { gf: q.lg(-2, 0, 2, -7, [[0, '#7A4A2A'], [1, '#3A2016']]) });
  q.fill(q.ell(0, 0, 0.45, 0.45), GOLD, { gf: ballGrad(q, 0, 0, 0.45, tones(GOLD)) });
  return q.taper([[0, 1.4], [0, -2.4]], [1.4, 1.0]);
}

function heartSign(q: Pen): string {
  const L = q.lite;
  const Wd = tones('#D8B07A');
  const stick = q.path([[-0.42, 5.0], [0.42, 5.0], [0.42, -9.4], [-0.42, -9.4]]);
  q.fill(stick, Wd.base, { gf: cylX(q, -0.42, 0.42, 0, Wd) });
  if (!L) q.line(q.path([[-0.1, 4.6], [-0.15, -9.0]], false), Wd.deep, 0.06, { o: 0.4 });
  // placa: coração de papelão pintado com borda branca e coraçãozinho no meio
  const cx = 0;
  const cy = -12.6;
  const heart = (s: number) => q.path([[cx, cy + 3.1 * s, 0], [cx - 3.0 * s, cy + 0.2 * s], [cx - 3.4 * s, cy - 1.8 * s], [cx - 1.8 * s, cy - 3.2 * s], [cx, cy - 1.9 * s, 0], [cx + 1.8 * s, cy - 3.2 * s], [cx + 3.4 * s, cy - 1.8 * s], [cx + 3.0 * s, cy + 0.2 * s]]);
  const H = tones('#FF4F7B');
  const big = heart(1.05);
  if (!L) q.fill(big, '#000000', { o: 0.25, b: 0.6 });
  q.fill(big, H.base, { gf: q.lg(cx - 3, cy - 3, cx + 3, cy + 3, [[0, H.lighter], [0.5, H.base], [1, H.shade]]) });
  q.line(heart(0.86), '#FFFFFF', 0.3, { o: 0.9 });
  q.fill(heart(0.42), '#FFFFFF', { o: 0.95 });
  if (!L) {
    q.fill(q.ell(cx - 1.6, cy - 1.9, 0.9, 0.5, -30), '#FFFFFF', { o: 0.35, b: 0.3, cp: big });
    q.fill(q.ell(0, cy + 1.2, 0.18, 0.18) + q.ell(0, cy - 1.0, 0.18, 0.18), '#B8BCC6');
  }
  return stick;
}

function balloon(q: Pen): string {
  const L = q.lite;
  // fio subindo da mão até o balão (curva suave)
  const string = q.path([[0, 2.4], [0.2, -12], [1.2, -26], [2.0, -38.8]], false);
  q.line(string, '#F2F2F6', 0.16, { o: 0.9 });
  const cx = 2.2;
  const cy = -45.4;
  const s = 1.0;
  const heart = q.path([[cx, cy + 5.4 * s, 0], [cx - 4.6 * s, cy + 0.6 * s], [cx - 5.2 * s, cy - 2.4 * s], [cx - 2.8 * s, cy - 4.8 * s], [cx, cy - 3.0 * s, 0], [cx + 2.8 * s, cy - 4.8 * s], [cx + 5.2 * s, cy - 2.4 * s], [cx + 4.6 * s, cy + 0.6 * s]]);
  const M = tones('#FF2A6A');
  q.fill(heart, M.base, { gf: q.rg(cx - 1.8, cy - 2.0, 7.4, [[0, M.lighter], [0.35, M.base], [0.8, M.shade], [1, M.deep]]) });
  if (!L) {
    // metalizado: reflexo forte, faixa clara na borda, costura
    q.fill(q.taper([[cx - 4.0, cy - 1.4], [cx - 3.2, cy - 3.4], [cx - 1.8, cy - 3.9]], [0.5, 0.9, 0.3], { round: true }), '#FFFFFF', { o: 0.85 });
    q.fill(q.ell(cx + 2.6, cy - 2.6, 1.0, 0.6, 20), '#FFFFFF', { o: 0.5, b: 0.3 });
    q.fill(q.ell(cx + 1.8, cy + 1.6, 2.4, 2.0), '#6A0024', { o: 0.25, b: 1.0, cp: heart });
    q.line(heart, mix(M.lighter, '#FFFFFF', 0.3), 0.2, { o: 0.5 });
  }
  q.fill(q.path([[cx - 0.5, cy + 5.6], [cx + 0.5, cy + 5.6], [cx + 0.2, cy + 6.4], [cx - 0.2, cy + 6.4]]), M.shade);
  return q.taper([[0, 3.0], [0, -4.0]], [0.3, 0.3]);
}

function guitar(q: Pen): string {
  const L = q.lite;
  const S = tones('#C8935A');
  const Top = tones('#EDC48A');
  const Fb = tones('#3A2418');
  // cabeça (lá em cima, rumo ao cotovelo) com tarraxas
  const headD = q.path([[-0.85, -10.6], [0.85, -10.6], [1.15, -15.4, 0.4], [-1.15, -15.4, 0.4]]);
  q.fill(headD, Fb.base, { gf: cylX(q, -1.15, 1.15, 0, Fb) });
  let pegs = '';
  for (const y of [-11.6, -13.0, -14.4]) pegs += q.ell(-1.55, y, 0.45, 0.32) + q.ell(1.55, y, 0.45, 0.32);
  q.fill(pegs, '#D8DCE4', { gf: q.lg(-2, 0, 2, 0, [[0, '#FFFFFF'], [0.5, '#B8BCC6'], [1, '#7A7E88']]) });
  // corpo (laterais escuras atrás, tampo de abeto na frente)
  const bout = (dx: number): string =>
    q.path([[dx - 3.6, 7.0], [dx - 4.2, 9.6], [dx - 3.0, 13.4], [dx - 5.4, 17.4], [dx - 5.6, 21.2], [dx - 3.6, 24.8], [dx, 25.8, 0.6], [dx + 3.6, 24.8], [dx + 5.6, 21.2], [dx + 5.4, 17.4], [dx + 3.0, 13.4], [dx + 4.2, 9.6], [dx + 3.6, 7.0], [dx, 6.2, 0.6]]);
  q.fill(bout(0.6), S.deep, { gf: q.lg(0, 6, 1, 26, [[0, S.shade], [1, S.deep]]) });
  const top = bout(0);
  q.fill(top, Top.base, { gf: q.rg(-1.6, 12, 14, [[0, Top.lighter], [0.45, Top.base], [1, Top.shade]]) });
  if (!L) {
    q.line(top, '#F8EEDC', 0.22, { o: 0.85 });
    q.fill(q.ell(2.6, 20.6, 3.4, 4.2), '#7A4A1A', { o: 0.18, b: 1.2, cp: top });
    // veios do abeto
    let d = '';
    for (let x = -4.6; x <= 4.6; x += 1.15) d += q.path([[x, 6.6], [x * 1.04, 25.4]], false);
    q.line(d, Top.shade, 0.06, { o: 0.4, cp: top });
    // escudo (tartaruga)
    q.fill(q.path([[1.0, 13.0], [3.2, 13.6], [3.6, 16.6], [1.6, 17.0, 0.6], [0.6, 15.4]]), '#5A2A12', { o: 0.75, gf: q.lg(1, 13, 3.6, 17, [[0, '#7A3A16'], [1, '#2A1408']]) });
  }
  // boca com roseta
  q.fill(q.ell(0, 12.8, 1.65, 1.65), '#1A0E08');
  if (!L) q.line(q.ell(0, 12.8, 2.1, 2.1), '#5A3A1E', 0.3, { o: 0.85, da: [0.35, 0.2] });
  // braço com escala e trastes (passa pela mão)
  const neck = q.path([[-0.68, -10.8], [0.68, -10.8], [0.78, 11.6], [-0.78, 11.6]]);
  q.fill(neck, Fb.base, { gf: cylX(q, -0.8, 0.8, 0, Fb) });
  if (!L) {
    let fr = '';
    for (let i = 0; i < 10; i++) {
      const y = -10.2 + i * 1.9 - i * i * 0.04;
      fr += q.path([[-0.7, y], [0.72, y]], false);
    }
    q.line(fr, '#C8CCD4', 0.09, { o: 0.8, cp: neck });
  }
  // cavalete e cordas
  q.fill(q.path([[-2.0, 20.2, 0.3], [2.0, 20.2, 0.3], [2.0, 21.2, 0.3], [-2.0, 21.2, 0.3]]), '#2A160C');
  if (!L) {
    let st = '';
    for (let i = 0; i < 6; i++) {
      const xb = -0.95 + i * 0.38;
      const xn = -0.5 + i * 0.2;
      st += q.path([[xb, 20.6], [xn, -10.6]], false);
    }
    q.line(st, '#ECE6DA', 0.06, { o: 0.75 });
  }
  return q.path([[-0.8, -7], [0.8, -7], [0.8, 6], [-0.8, 6]]);
}

function trophy(q: Pen): string {
  const L = q.lite;
  const G = tones(GOLD);
  // base de mármore escuro com plaquinha
  const base = q.path([[-2.0, 2.4, 0.2], [2.0, 2.4, 0.2], [2.3, 4.8, 0.2], [-2.3, 4.8, 0.2]]);
  q.fill(base, '#22222A', { gf: q.lg(-2, 2.4, 2, 4.8, [[0, '#4A4A56'], [1, '#141418']]) });
  q.fill(q.path([[-1.1, 3.2], [1.1, 3.2], [1.15, 4.1], [-1.15, 4.1]]), GOLD, { gf: metalX(q, -1.2, 1.2, 0, GOLD) });
  // haste com nó
  const stem = q.path([[-0.5, 2.5], [0.5, 2.5], [0.4, 0.2], [0.9, -0.6, 0.6], [0.4, -1.4], [0.6, -2.2], [-0.6, -2.2], [-0.4, -1.4], [-0.9, -0.6, 0.6], [-0.4, 0.2]]);
  q.fill(stem, G.base, { gf: metalX(q, -0.9, 0.9, 0, GOLD) });
  // alças
  q.line(q.path([[-2.7, -6.8], [-4.4, -6.4], [-4.0, -4.0], [-2.0, -3.4]], false) + q.path([[2.7, -6.8], [4.4, -6.4], [4.0, -4.0], [2.0, -3.4]], false), G.shade, 0.5);
  if (!L) q.line(q.path([[-2.8, -6.9], [-4.2, -6.6], [-3.9, -4.4]], false) + q.path([[2.8, -6.9], [4.2, -6.6], [3.9, -4.4]], false), G.lighter, 0.16, { o: 0.8 });
  // taça
  const cup = q.path([[-3.0, -7.6], [3.0, -7.6], [2.7, -5.0], [1.7, -2.9], [0.6, -2.1], [-0.6, -2.1], [-1.7, -2.9], [-2.7, -5.0]]);
  q.fill(cup, G.base, { gf: metalX(q, -3, 3, 0, GOLD) });
  q.fill(q.ell(0, -7.6, 3.0, 0.55), G.deep, { gf: q.lg(0, -8.1, 0, -7.0, [[0, G.shade], [1, G.deep]]) });
  q.line(q.ell(0, -7.6, 3.0, 0.55), G.lighter, 0.16, { o: 0.9 });
  // estrela em relevo
  const sx = 0;
  const sy = -5.2;
  const star: SP[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 ? 0.45 : 1.1;
    star.push([sx + Math.cos(a) * rr, sy + Math.sin(a) * rr, 0]);
  }
  q.fill(q.path(star), G.lighter, { gf: q.lg(sx - 1, sy - 1, sx + 1, sy + 1, [[0, '#FFF6C8'], [1, G.shade]]) });
  if (!L) sparkles(q, [[-2.2, -8.8, 0.7], [3.4, -3.0, 0.5]], '#FFFFFF', 0.9);
  return q.path([[-1.0, 2.6], [1.0, 2.6], [1.0, -2.2], [-1.0, -2.2]]);
}

export const HELD_THINGS: Record<string, HeldDef> = {
  gift: { draw: gift },
  book: { draw: book, rot: -4 },
  camera: { draw: camera },
  // cabeça além das pontas dos dedos: no repouso o microfone pende de cabeça pra baixo; erguido até a boca, aponta pra ela
  mic: { draw: mic, rot: 160, dy: 2.5, liteK: 1.5 },
  tambourine: { draw: tambourine, rot: 150 },
  fan: { draw: fan, rot: -12, liteK: 1.35 },
  heart_sign: { draw: heartSign, rot: -6 },
  // objetos grandes já leem no mapa (o balão é alto: cresce pouco pra não sair do quadro)
  balloon: { draw: balloon, rot: 12, liteK: 1.05 },
  guitar: { draw: guitar, rot: 4, liteK: 1.15 },
  trophy: { draw: trophy, dy: -1.2 },
};

