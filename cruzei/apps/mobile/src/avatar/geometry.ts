// Primitivas de path SVG (strings) usadas pelo avatar — sem dependência de RN nem de DOM.
// Todo path é fechado e desenhável tanto por react-native-svg (Path d=...) quanto por canvas (new Path2D(d)).

const f = (n: number): string => String(Math.round(n * 100) / 100);

export function circle(cx: number, cy: number, r: number): string {
  return `M${f(cx - r)},${f(cy)}a${f(r)},${f(r)} 0 1,0 ${f(2 * r)},0a${f(r)},${f(r)} 0 1,0 ${f(-2 * r)},0Z`;
}

export function ellipse(cx: number, cy: number, rx: number, ry: number): string {
  return `M${f(cx - rx)},${f(cy)}a${f(rx)},${f(ry)} 0 1,0 ${f(2 * rx)},0a${f(rx)},${f(ry)} 0 1,0 ${f(-2 * rx)},0Z`;
}

/** retângulo com cantos [tl, tr, br, bl] */
export function rrect4(x: number, y: number, w: number, h: number, radii: [number, number, number, number]): string {
  const m = Math.min(w, h) / 2;
  const [tl, tr, br, bl] = radii.map((r) => Math.max(0, Math.min(r, m)));
  return (
    `M${f(x + tl)},${f(y)}` +
    `H${f(x + w - tr)}` +
    (tr ? `A${f(tr)},${f(tr)} 0 0 1 ${f(x + w)},${f(y + tr)}` : '') +
    `V${f(y + h - br)}` +
    (br ? `A${f(br)},${f(br)} 0 0 1 ${f(x + w - br)},${f(y + h)}` : '') +
    `H${f(x + bl)}` +
    (bl ? `A${f(bl)},${f(bl)} 0 0 1 ${f(x)},${f(y + h - bl)}` : '') +
    `V${f(y + tl)}` +
    (tl ? `A${f(tl)},${f(tl)} 0 0 1 ${f(x + tl)},${f(y)}` : '') +
    'Z'
  );
}

export function rrect(x: number, y: number, w: number, h: number, r: number): string {
  return rrect4(x, y, w, h, [r, r, r, r]);
}

/** parte de um círculo ACIMA da linha y = yCut (yCut < cy): calota com linha reta embaixo */
export function capAbove(cx: number, cy: number, r: number, yCut: number): string {
  const dy = cy - yCut;
  const hc = Math.sqrt(Math.max(0, r * r - dy * dy));
  return `M${f(cx - hc)},${f(yCut)}A${f(r)},${f(r)} 0 ${dy < 0 ? 1 : 0} 1 ${f(cx + hc)},${f(yCut)}Z`;
}

/** parte de um círculo ABAIXO da linha y = yCut (yCut > cy) */
export function capBelow(cx: number, cy: number, r: number, yCut: number): string {
  const dy = yCut - cy;
  const hc = Math.sqrt(Math.max(0, r * r - dy * dy));
  return `M${f(cx - hc)},${f(yCut)}A${f(r)},${f(r)} 0 ${dy < 0 ? 1 : 0} 0 ${f(cx + hc)},${f(yCut)}Z`;
}

/** polígono fechado */
export function poly(points: [number, number][]): string {
  return points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${f(x)},${f(y)}`).join('') + 'Z';
}

/** curva quadrática aberta (pra traços: boca, sobrancelha, fio) */
export function quad(x1: number, y1: number, cx: number, cy: number, x2: number, y2: number): string {
  return `M${f(x1)},${f(y1)}Q${f(cx)},${f(cy)} ${f(x2)},${f(y2)}`;
}

export function line(x1: number, y1: number, x2: number, y2: number): string {
  return `M${f(x1)},${f(y1)}L${f(x2)},${f(y2)}`;
}

/** arco aberto de (x1,y1) a (x2,y2) com raio r (sweep=1 → horário na tela) */
export function arc(x1: number, y1: number, x2: number, y2: number, r: number, sweep: 0 | 1 = 1, large: 0 | 1 = 0): string {
  return `M${f(x1)},${f(y1)}A${f(r)},${f(r)} 0 ${large} ${sweep} ${f(x2)},${f(y2)}`;
}

// ---------------- cores ----------------

function clamp255(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => clamp255(v).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** k < 0 escurece (mistura com preto), k > 0 clareia (mistura com branco) */
export function shade(hex: string, k: number): string {
  const [r, g, b] = hexToRgb(hex);
  const t = k < 0 ? 0 : 255;
  const a = Math.abs(k);
  return rgbToHex(r + (t - r) * a, g + (t - g) * a, b + (t - b) * a);
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** luminância aproximada 0..1 (pra decidir contraste de detalhes) */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}
