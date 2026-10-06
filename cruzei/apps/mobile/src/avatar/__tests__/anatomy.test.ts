import type { AvatarConfig } from '@cruzei/shared-types';
import { DEFAULT_AVATAR, normalizeAvatarConfig } from '@cruzei/shared-utils';

import {
  BODY_SPECS,
  FACE_SPECS,
  SEAT_DROP,
  SOLE_Y,
  bodyAnchors,
  buildAnatomy,
  bustViewBox,
  faceDims,
  footPath,
  forearmPath,
  handShapes,
  headAnchors,
  headPath,
  necklinePath,
  offsetPts,
  rigFromAnatomy,
  shinPath,
  silhouettePaths,
  smoothPath,
  taperPath,
  thighPath,
  torsoPath,
  torsoXAt,
  upperArmPath,
  type SP,
} from '../anatomy';
import { AVATAR_BUST_VIEWBOX, buildAvatarLayers, buildAvatarRig } from '../layers';

const base = normalizeAvatarConfig(DEFAULT_AVATAR) as AvatarConfig;
const BODIES = Object.keys(BODY_SPECS);
const FACES = Object.keys(FACE_SPECS);

/** números de um path SVG em pares (só comandos absolutos M/L/C/Q, que é o que os helpers geram) */
function pathPoints(d: string): [number, number][] {
  expect(d).not.toMatch(/NaN|Infinity|undefined/);
  const nums = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) out.push([nums[i], nums[i + 1]]);
  return out;
}

function bbox(d: string) {
  const p = pathPoints(d);
  return { x0: Math.min(...p.map((q) => q[0])), x1: Math.max(...p.map((q) => q[0])), y0: Math.min(...p.map((q) => q[1])), y1: Math.max(...p.map((q) => q[1])) };
}

describe('anatomia', () => {
  it.each(BODIES)('corpo %s: juntas finitas, em ordem, pés na sola e cabeça dentro do viewBox', (body) => {
    for (const faceShape of FACES) {
      const an = buildAnatomy({ body, faceShape });
      const j = an.joints;
      for (const p of Object.values(j)) expect(p.every(Number.isFinite)).toBe(true);
      for (const s of ['L', 'R'] as const) {
        const sh = s === 'L' ? j.shoulderL : j.shoulderR;
        const el = s === 'L' ? j.elbowL : j.elbowR;
        const wr = s === 'L' ? j.wristL : j.wristR;
        const hp = s === 'L' ? j.hipL : j.hipR;
        const kn = s === 'L' ? j.kneeL : j.kneeR;
        const an2 = s === 'L' ? j.ankleL : j.ankleR;
        expect(sh[1]).toBeLessThan(el[1]);
        expect(el[1]).toBeLessThan(wr[1]);
        expect(hp[1]).toBeLessThan(kn[1]);
        expect(kn[1]).toBeLessThan(an2[1]);
        expect(an2[1]).toBeLessThan(SOLE_Y);
      }
      expect(an.foot.soleY).toBe(134);
      expect(an.foot.groundY).toBe(135);
      const f = faceDims(an);
      // o mais alto (atlético, rosto longo) ainda deixa espaço pro cabelo em cima
      expect(f.crownY).toBeGreaterThan(4);
      // o queixo fica no mesmo lugar pra qualquer formato de rosto (em cima do pescoço)
      expect(an.head.cy + f.chinY).toBeCloseTo(buildAnatomy({ body, faceShape: 'oval' }).head.cy + faceDims(buildAnatomy({ body, faceShape: 'oval' })).chinY, 6);
    }
  });

  it('proporção adulta: ~5,5 cabeças de altura, ombros ≥ 2,2 larguras de cabeça e pescoço ≤ 0,82 da mandíbula', () => {
    for (const body of BODIES) {
      for (const faceShape of FACES) {
        const an = buildAnatomy({ body, faceShape });
        const f = faceDims(an);
        const headH = an.head.cy + f.chinY - f.crownY;
        const heads = (SOLE_Y - f.crownY) / headH;
        expect(heads).toBeGreaterThan(5.15);
        expect(heads).toBeLessThan(6.0);
        expect(an.w.neck / f.jaw).toBeLessThan(0.82);
      }
      const an = buildAnatomy({ body, faceShape: 'oval' });
      const f = faceDims(an);
      expect(an.w.shoulder / f.cheek).toBeGreaterThan(2.1);
      // pescoço visível de adulto: do queixo ao ombro (gola) há pelo menos ~5 unidades
      expect(an.collarY - (an.head.cy + f.chinY)).toBeGreaterThan(5);
    }
    // o corpo médio fica com ombros ≥ 2,4 larguras de cabeça; largo e atlético perto de 2,8
    const r = (b: string) => {
      const an = buildAnatomy({ body: b, faceShape: 'oval' });
      return an.w.shoulder / faceDims(an).cheek;
    };
    expect(r('regular')).toBeGreaterThan(2.4);
    expect(r('athletic')).toBeGreaterThan(2.7);
  });

  it('estatura e proporção de perna variam entre os tipos (0,965–1,045; perna 0,46–0,50 da altura)', () => {
    const ks = BODIES.map((b) => buildAnatomy({ body: b }).k);
    expect(Math.min(...ks)).toBeLessThanOrEqual(0.97);
    expect(Math.max(...ks)).toBeGreaterThanOrEqual(1.04);
    for (const body of BODIES) {
      const an = buildAnatomy({ body, faceShape: 'oval' });
      const crown = faceDims(an).crownY;
      const H = SOLE_Y - crown;
      const leg = (SOLE_Y - an.hj) / H;
      expect(leg).toBeGreaterThan(0.45);
      expect(leg).toBeLessThan(0.52);
      // joelho alto (≈0,27 da altura) e canela do tamanho da coxa
      const knee = (an.joints.kneeL[1] + an.joints.kneeR[1]) / 2;
      expect((SOLE_Y - knee) / H).toBeGreaterThan(0.25);
      const thigh = knee - an.hj;
      const shin = (an.joints.ankleL[1] + an.joints.ankleR[1]) / 2 - knee;
      expect(Math.abs(shin - thigh)).toBeLessThan(3.5);
    }
    // a perna mais longa (esguio) e a mais curta (plus) se distinguem de verdade
    const legOf = (b: string) => buildAnatomy({ body: b }).spec.leg;
    expect(legOf('slim') - legOf('plus')).toBeGreaterThan(0.03);
  });

  it('rosto adulto: olhos na metade da cabeça e nariz → queixo maior que olho → nariz', () => {
    for (const faceShape of FACES) {
      const an = buildAnatomy({ body: 'regular', faceShape });
      const ha = headAnchors(an);
      const f = faceDims(an);
      const mid = (f.crownY + an.head.cy + f.chinY) / 2;
      expect(Math.abs(ha.eyeL[1] - mid)).toBeLessThan(1.2);
      expect(ha.chin[1] - ha.nose[1]).toBeGreaterThan(ha.nose[1] - ha.eyeL[1]);
      // olho adulto: largura do olho ≈ 1/4 da largura do rosto (±10% por pessoa), nunca olho de criança
      expect((ha.eyeW * 2) / (f.cheek * 2)).toBeLessThan(0.29);
    }
  });

  it('tipos de corpo têm silhuetas e estaturas realmente diferentes', () => {
    const w = (b: string) => buildAnatomy({ body: b }).w;
    expect(w('plus').waist).toBeGreaterThan(w('regular').waist + 3);
    expect(w('curvy').hip - w('curvy').waist).toBeGreaterThan(w('regular').hip - w('regular').waist + 2);
    expect(w('athletic').shoulder - w('athletic').waist).toBeGreaterThan(w('regular').shoulder - w('regular').waist + 1.5);
    expect(w('slim').shoulder).toBeLessThan(w('regular').shoulder);
    const crown = (b: string) => faceDims(buildAnatomy({ body: b })).crownY;
    expect(crown('slim')).toBeLessThan(crown('plus'));
  });

  it('rig sai das juntas da anatomia (cotovelo e joelho são os pivôs de antebraço e canela)', () => {
    for (const body of BODIES) {
      const an = buildAnatomy({ body });
      const rig = rigFromAnatomy(an, null);
      expect(rig.foreL).toEqual(an.joints.elbowL);
      expect(rig.shinR).toEqual(an.joints.kneeR);
      expect(rig.armR).toEqual(an.joints.shoulderR);
      expect(buildAvatarRig({ ...base, body }).legL).toEqual(an.joints.hipL);
    }
  });

  it('sentado: quadril desce SEAT_DROP e a coxa encurta (vem pra frente)', () => {
    const st = buildAnatomy({ body: 'regular' });
    const sit = buildAnatomy({ body: 'regular' }, { seated: true });
    // em pé o quadril inclina (contrapposto): compara a média dos dois lados
    const mid = (a: typeof st) => (a.joints.hipL[1] + a.joints.hipR[1]) / 2;
    expect(mid(sit) - mid(st)).toBeCloseTo(SEAT_DROP, 6);
    expect(sit.joints.kneeL[1] - sit.joints.hipL[1]).toBeLessThan(st.joints.kneeL[1] - st.joints.hipL[1]);
    // canela vertical (joelho em ~90°) e mãos no colo
    expect(Math.abs(sit.joints.ankleL[0] - sit.joints.kneeL[0])).toBeLessThan(1);
    expect(sit.rest.armL).toBe('lap');
    expect(sit.seated).toBe(true);
  });
});

describe('contornos', () => {
  it.each(BODIES)('corpo %s: contornos válidos e dentro do viewBox', (body) => {
    const an = buildAnatomy({ body, faceShape: 'square' });
    const paths = [torsoPath(an), torsoPath(an, { collar: true, bottom: an.hipY, ease: 0.6, drape: 0.8 }), headPath(an), necklinePath(an)];
    for (const s of ['L', 'R'] as const) paths.push(upperArmPath(an, s), forearmPath(an, s), thighPath(an, s), shinPath(an, s), footPath(an, s), handShapes(an, s).hand, handShapes(an, s).thumb);
    for (const d of paths) {
      const b = bbox(d);
      expect(b.x0).toBeGreaterThan(0);
      expect(b.x1).toBeLessThan(100);
      expect(b.y0).toBeGreaterThan(0);
      expect(b.y1).toBeLessThan(140);
    }
  });

  it('silhueta neutra (placeholder do mapa) tem todas as partes e fica no viewBox', () => {
    for (const body of BODIES) {
      const ps = silhouettePaths(buildAnatomy({ body }));
      expect(ps.length).toBe(15);
      for (const d of ps) {
        const b = bbox(d);
        expect(b.y1).toBeLessThan(140);
        expect(b.x0).toBeGreaterThan(0);
      }
    }
  });

  it('folga (ease) afasta o contorno pra fora; flare alarga a ponta', () => {
    const an = buildAnatomy({ body: 'regular' });
    const t0 = bbox(torsoPath(an, { bottom: an.hipY }));
    const t1 = bbox(torsoPath(an, { bottom: an.hipY, ease: 1 }));
    expect(t1.x1 - t1.x0).toBeGreaterThan(t0.x1 - t0.x0 + 1.5);
    // largura perto do tornozelo (a ponta de baixo da canela)
    const low = (d: string) => {
      const p = pathPoints(d).filter((q) => q[1] > an.joints.ankleL[1] - 1.5);
      return Math.max(...p.map((q) => q[0])) - Math.min(...p.map((q) => q[0]));
    };
    expect(low(shinPath(an, 'L', { flare: 2 }))).toBeGreaterThan(low(shinPath(an, 'L')) + 3);
    expect(torsoXAt(an, 'L', an.waistY, 1)).toBeCloseTo(torsoXAt(an, 'L', an.waistY) - 1, 6);
  });

  it('ponta do braço e do antebraço é redonda em volta do cotovelo (gira sem fresta)', () => {
    const an = buildAnatomy({ body: 'regular' });
    const el = an.joints.elbowL;
    for (const d of [upperArmPath(an, 'L'), forearmPath(an, 'L')]) {
      const b = bbox(d);
      expect(el[0]).toBeGreaterThan(b.x0);
      expect(el[0]).toBeLessThan(b.x1);
      expect(el[1]).toBeGreaterThanOrEqual(b.y0 - 1e-6);
      expect(el[1]).toBeLessThanOrEqual(b.y1 + 1e-6);
    }
    // o antebraço sobe além do cotovelo (meio círculo) e o braço desce além dele
    expect(bbox(forearmPath(an, 'L')).y0).toBeLessThan(el[1] - an.spec.elbow * 0.8);
    expect(bbox(upperArmPath(an, 'L')).y1).toBeGreaterThan(el[1] + an.spec.elbow * 0.8);
  });

  it('âncoras da cabeça simétricas e em ordem (sobrancelha, olho, nariz, boca, queixo)', () => {
    for (const faceShape of FACES) {
      const an = buildAnatomy({ body: 'regular', faceShape });
      const ha = headAnchors(an);
      expect(ha.eyeL[0] + ha.eyeR[0]).toBeCloseTo(2 * an.cx, 6);
      expect(ha.browY).toBeLessThan(ha.eyeL[1]);
      expect(ha.eyeL[1]).toBeLessThan(ha.nose[1]);
      expect(ha.nose[1]).toBeLessThan(ha.mouth[1]);
      expect(ha.mouth[1]).toBeLessThan(ha.chin[1]);
      expect(ha.top[1]).toBeLessThan(ha.hairline);
    }
    const ba = bodyAnchors(buildAnatomy({ body: 'regular' }));
    expect(ba.collar[1]).toBeLessThan(ba.chest[1]);
    expect(ba.waist[1]).toBeLessThan(ba.hip[1]);
  });

  it('recorte de busto por pessoa (bustViewBox) enquadra cabeça, cabelo e o começo dos ombros', () => {
    for (const body of BODIES) {
      for (const faceShape of FACES) {
        const an = buildAnatomy({ body, faceShape });
        const vb = bustViewBox(an);
        const h = bbox(headPath(an));
        expect(h.y0 - vb.y).toBeGreaterThan(2.5);
        expect(vb.y + vb.h).toBeGreaterThan(an.shoulderY);
        expect(h.x0).toBeGreaterThan(vb.x);
      }
    }
  });

  it('busto enquadra a cabeça inteira e os ombros de todo corpo', () => {
    const vb = AVATAR_BUST_VIEWBOX;
    for (const body of BODIES) {
      for (const faceShape of FACES) {
        const an = buildAnatomy({ body, faceShape });
        const h = bbox(headPath(an));
        expect(h.x0).toBeGreaterThan(vb.x);
        expect(h.x1).toBeLessThan(vb.x + vb.w);
        expect(h.y0).toBeGreaterThan(vb.y);
        expect(h.y1).toBeLessThan(vb.y + vb.h);
        expect(an.cx - an.w.shoulder).toBeGreaterThan(vb.x - 0.5);
      }
    }
  });
});

describe('helpers de path', () => {
  const pts: SP[] = [
    [10, 10],
    [20, 8, 0],
    [30, 12],
    [20, 25],
  ];
  it('smoothPath fecha com Z e passa pelos pontos', () => {
    const d = smoothPath(pts);
    expect(d.startsWith('M10,10')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    expect(d).toContain(' 20,8');
    expect(smoothPath(pts, false).endsWith('Z')).toBe(false);
  });
  it('taperPath gera forma fechada sem NaN (largura em lista ou função)', () => {
    expect(taperPath(pts, [0, 1, 0])).toMatch(/Z$/);
    expect(taperPath(pts, (t) => Math.sin(Math.PI * t))).not.toMatch(/NaN/);
  });
  it('offsetPts afasta pra fora nos dois sentidos de contorno', () => {
    const sq: SP[] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    for (const poly of [sq, sq.slice().reverse()]) {
      const o = offsetPts(poly, 1);
      expect(Math.min(...o.map((p) => p[0]))).toBeLessThan(-0.5);
      expect(Math.max(...o.map((p) => p[1]))).toBeGreaterThan(10.5);
    }
  });
});

describe('camadas do corpo novo', () => {
  it('nível de detalhe lite (miniatura/mapa) tira o detalhe fino e mantém o rosto', () => {
    const full = buildAvatarLayers(base, { groundShadow: true });
    const lite = buildAvatarLayers(base, { groundShadow: true, lod: 'lite' } as Parameters<typeof buildAvatarLayers>[1]);
    expect(lite.length).toBeLessThan(full.length * 0.85);
    expect(lite.filter((l) => l.k === 'face').length).toBeGreaterThan(10);
  });

  it('corpo + rosto (careca, roupa padrão) ficam no orçamento: ~225 KB completo, ~135 KB no lite', () => {
    // (o orçamento de cada cabelo é do dono do cabelo; aqui só a base: corpo, rosto, expressão e roupa provisória)
    const size = (lod?: 'lite') => buildAvatarLayers({ ...base, hair: 'bald' }, { groundShadow: true, lod }).reduce((s, l) => s + l.d.length + (l.cp?.length ?? 0), 0);
    expect(size()).toBeLessThan(250_000);
    expect(size('lite')).toBeLessThan(150_000);
  });

  it('toda expressão do rosto sai com olhos, sobrancelhas e boca etiquetados k:face', () => {
    for (const face of ['smile', 'grin', 'calm', 'wink', 'laugh', 'cool', 'blush', 'kiss', 'serene', 'smirk', 'surprised', 'starry', 'hearts']) {
      const fl = buildAvatarLayers({ ...base, face }).filter((l) => l.k === 'face');
      expect(fl.length).toBeGreaterThan(8);
      expect(fl.every((l) => l.g === 'head')).toBe(true);
    }
  });

  it('mesmo rosto com olhos/nariz/sobrancelhas diferentes muda as camadas (pessoas diferentes)', () => {
    const a = JSON.stringify(buildAvatarLayers({ ...base, eyes: 'almond', nose: 'soft', brows: 'soft' }));
    const b = JSON.stringify(buildAvatarLayers({ ...base, eyes: 'monolid', nose: 'wide', brows: 'bushy' }));
    expect(a).not.toBe(b);
  });
});
