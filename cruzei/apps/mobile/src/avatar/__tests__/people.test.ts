// Rodada 2 do diretor de arte: repouso por pessoa, contrapposto, variação real de rosto, mão, nível de detalhe "lite".
import type { AvatarConfig } from '@cruzei/shared-types';
import { DEFAULT_AVATAR, normalizeAvatarConfig } from '@cruzei/shared-utils';

import { BODY_SPECS, FACE_SPECS, NECK_JAW, SEAT_DROP, SEAT_SOLE_Y, SOLE_Y, buildAnatomy, faceDims, footPts, footYaw, forearmPath, handShapes, headAnchors, legAxis, limbWidthAt, restArmDelta, restOf, rigFromAnatomy, seatDropFor, torsoPts, torsoXAt, upperArmPath } from '../anatomy';
import { buildAvatarLayers, buildAvatarRig } from '../layers';
import { teeFit } from '../parts/clothes';
import { zero } from '../pose';
import { groupMatrix, mApply } from '../rig';
import { EMPTY_SCENE } from '../scene';

const base = normalizeAvatarConfig(DEFAULT_AVATAR) as AvatarConfig;
const FACES = Object.keys(FACE_SPECS);
const EYES = ['almond', 'round', 'upturned', 'downturned', 'monolid', 'hooded'];

function nums(d: string): number[] {
  expect(d).not.toMatch(/NaN|Infinity|undefined/);
  return (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
}

describe('repouso por pessoa', () => {
  it('as 8 variantes aparecem, a maioria com os dois braços soltos, e a escolha é determinística pelos traços', () => {
    const seen = new Set<number>();
    let hang = 0;
    let n = 0;
    for (const body of Object.keys(BODY_SPECS)) {
      for (const faceShape of FACES) {
        for (const eyes of EYES) {
          const r = restOf({ body, faceShape, eyes });
          seen.add(r.id);
          n++;
          if (r.armL === 'hang' && r.armR === 'hang') hang++;
        }
      }
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    // o gesto de mão na cintura/bolso/passante não se repete no elenco inteiro
    expect(hang / n).toBeGreaterThan(0.5);
    const a = restOf({ body: 'regular', faceShape: 'oval', eyes: 'almond' });
    expect(restOf({ body: 'regular', faceShape: 'oval', eyes: 'almond' })).toEqual(a);
  });

  it('trocar roupa ou cabelo não muda o jeito de ficar em pé', () => {
    const a = buildAnatomy({ ...base, top: 'tee', hair: 'long' });
    const b = buildAnatomy({ ...base, top: 'hoodie', hair: 'afro', topColor: 'c_red' });
    expect(b.rest).toEqual(a.rest);
    expect(b.joints).toEqual(a.joints);
  });

  it('mãos ocupadas, objeto, bandeirinha, veículo e cadeira mandam no braço', () => {
    const cfg = { body: 'regular', faceShape: 'oval', eyes: 'downturned' }; // variante "mão na cintura"
    expect(restOf(cfg).armL).toBe('hip');
    expect(restOf({ ...cfg, pride: 'flag' }).armL).toBe('hang');
    const pocket = { body: 'broad', faceShape: 'oval', eyes: 'round' };
    expect(restOf(pocket).armR).toBe('pocket');
    expect(restOf({ ...pocket, held: 'phone' }).armR).toBe('hang');
    for (const hands of ['wheel', 'bars', 'cradle'] as const) {
      const r = restOf(cfg, { ...EMPTY_SCENE, hands });
      expect([r.armL, r.armR]).toEqual(['hang', 'hang']);
    }
    const moto = restOf(cfg, { ...EMPTY_SCENE, mount: 'straddle', hands: 'bars' });
    expect(moto.weight).toBeNull();
    const chair = restOf(cfg, { ...EMPTY_SCENE, mount: 'seat', seated: true });
    expect([chair.armL, chair.armR, chair.weight]).toEqual(['lap', 'lap', null]);
  });

  it('contrapposto sem X: quadril do lado do peso sobe, pélvis vai pro apoio, joelho livre só um pouco pra dentro', () => {
    for (const body of Object.keys(BODY_SPECS)) {
      for (const eyes of EYES) {
        const an = buildAnatomy({ body, faceShape: 'oval', eyes });
        const w = an.rest.weight;
        if (!w) continue;
        const j = an.joints;
        const [hipW, hipF] = w === 'L' ? [j.hipL, j.hipR] : [j.hipR, j.hipL];
        expect(hipW[1]).toBeLessThan(hipF[1] - 2);
        const free = w === 'L' ? 'R' : 'L';
        const g = free === 'L' ? -1 : 1;
        const hip = free === 'L' ? j.hipL : j.hipR;
        const knee = free === 'L' ? j.kneeL : j.kneeR;
        const ankle = free === 'L' ? j.ankleL : j.ankleR;
        // joelho livre: no máximo ~2 pra dentro da linha do quadril (nada de joelho valgo); tornozelo um pouco pra fora
        expect(g * (knee[0] - hip[0])).toBeLessThan(0.3);
        expect(g * (knee[0] - hip[0])).toBeGreaterThan(-2.2);
        expect(g * (ankle[0] - knee[0])).toBeGreaterThan(1);
        expect(g * (ankle[0] - knee[0])).toBeLessThan(4);
        // calcanhar da perna livre erguido: o tornozelo dela fica mais alto que o de apoio
        const ankleW = w === 'L' ? j.ankleL : j.ankleR;
        expect(ankle[1]).toBeLessThan(ankleW[1]);
        // pé de apoio embaixo do corpo e a pélvis deslocada pro lado dele
        expect(Math.abs(ankleW[0] - an.cx)).toBeLessThan(an.spec.legSep);
        expect(Math.sign(an.pelvis)).toBe(w === 'L' ? -1 : 1);
        // a barra (corte do tronco abaixo da cintura) acompanha o quadril
        const pts = torsoPts(an, { bottom: an.hipY + 1.5, ease: 0.6 });
        const yL = Math.max(...pts.filter((p) => p[0] < an.cx - 8).map((p) => p[1]));
        const yR = Math.max(...pts.filter((p) => p[0] > an.cx + 8).map((p) => p[1]));
        if (w === 'L') expect(yL).toBeLessThan(yR);
        else expect(yR).toBeLessThan(yL);
      }
    }
  });

  it('restArmDelta leva o braço de qualquer repouso de volta pro solto (animação de braço parte do mesmo lugar)', () => {
    for (const eyes of EYES) {
      const an = buildAnatomy({ body: 'regular', faceShape: 'oval', eyes });
      const d = restArmDelta(an);
      if (an.rest.armL === 'hang' && an.rest.armR === 'hang') expect(d).toEqual({ armL: 0, foreL: 0, armR: 0, foreR: 0 });
      const rig = rigFromAnatomy(an, null);
      const p = zero();
      p.armL.r = d.armL;
      p.armR.r = d.armR;
      p.foreL = { r: d.foreL };
      p.foreR = { r: d.foreR };
      // mesmas direções do braço solto (o comprimento visto de frente pode mudar: antebraço em escorço)
      const dir = (a: number[], b: number[]) => Math.atan2(b[1] - a[1], b[0] - a[0]);
      for (const s of ['L', 'R'] as const) {
        const sh = s === 'L' ? an.joints.shoulderL : an.joints.shoulderR;
        const el = s === 'L' ? an.joints.elbowL : an.joints.elbowR;
        const wr = s === 'L' ? an.joints.wristL : an.joints.wristR;
        const hel = s === 'L' ? an.hangArms.elbowL : an.hangArms.elbowR;
        const hwr = s === 'L' ? an.hangArms.wristL : an.hangArms.wristR;
        const e2 = mApply(groupMatrix(s === 'L' ? 'armL' : 'armR', rig, p), el[0], el[1]);
        const w2 = mApply(groupMatrix(s === 'L' ? 'foreL' : 'foreR', rig, p), wr[0], wr[1]);
        expect(Math.abs(dir(sh, e2) - dir(sh, hel))).toBeLessThan(0.01);
        expect(Math.abs(dir(e2, w2) - dir(hel, hwr))).toBeLessThan(0.01);
      }
    }
  });

  it('corpo cheio: o braço solto abre só ~10° a mais que o médio, acompanhando o tronco (nem colado, nem asa)', () => {
    // mesmo lado e mesma variante (peso na esquerda: o braço direito é o da perna livre)
    const ang = (b: string) => {
      const an = buildAnatomy({ body: b, faceShape: 'oval', eyes: 'almond' });
      const sh = an.joints.shoulderR;
      const el = an.hangArms.elbowR;
      return (Math.abs(Math.atan2(el[0] - sh[0], el[1] - sh[1])) * 180) / Math.PI;
    };
    const d = ang('plus') - ang('regular');
    expect(d).toBeGreaterThan(4);
    expect(d).toBeLessThan(16);
    // de frente o braço quase cai reto: médio abre 4–15°, plus no máximo ~24°
    expect(ang('regular')).toBeGreaterThan(4);
    expect(ang('regular')).toBeLessThan(15);
    expect(ang('plus')).toBeLessThan(24);
  });

  it('braço tem o mesmo comprimento em todo repouso (cotovelo sai de uma cadeia de dois ossos)', () => {
    for (const body of Object.keys(BODY_SPECS)) {
      for (const eyes of EYES) {
        const an = buildAnatomy({ body, faceShape: 'oval', eyes });
        const [L1, L2] = an.armLen;
        const j = an.joints;
        for (const [sh, el, wr] of [
          [j.shoulderL, j.elbowL, j.wristL],
          [j.shoulderR, j.elbowR, j.wristR],
        ]) {
          expect(Math.hypot(el[0] - sh[0], el[1] - sh[1])).toBeCloseTo(L1, 4);
          expect(Math.hypot(wr[0] - el[0], wr[1] - el[1])).toBeLessThanOrEqual(L2 + 1e-6);
        }
      }
    }
  });

  it('braço solto: cotovelo levemente dobrado e pulso fora da coxa (fica um vão entre a mão e a calça)', () => {
    const an = buildAnatomy({ body: 'regular', faceShape: 'oval', eyes: 'round' });
    expect([an.rest.armL, an.rest.armR]).toEqual(['hang', 'hang']);
    for (const s of ['L', 'R'] as const) {
      const g = s === 'L' ? -1 : 1;
      const sh = s === 'L' ? an.joints.shoulderL : an.joints.shoulderR;
      const el = s === 'L' ? an.joints.elbowL : an.joints.elbowR;
      const wr = s === 'L' ? an.joints.wristL : an.joints.wristR;
      // de frente o cotovelo dobra só 12–22° (a dobra principal é pra FRENTE, em escorço): nem soldadinho de braço reto,
      // nem "pistoleiro" com o cotovelo espetado
      const a1 = Math.atan2(el[1] - sh[1], el[0] - sh[0]);
      const a2 = Math.atan2(wr[1] - el[1], wr[0] - el[0]);
      const bend = (Math.abs(a1 - a2) * 180) / Math.PI;
      expect(bend).toBeGreaterThan(12);
      expect(bend).toBeLessThan(22);
      // o braço abre um pouco e o antebraço volta pra dentro; o cotovelo não passa ~5 da linha do ombro
      expect(g * (el[0] - sh[0])).toBeGreaterThan(1.2);
      expect(g * (el[0] - sh[0])).toBeLessThan(5);
      expect(g * (wr[0] - el[0])).toBeLessThan(0);
      // pulso a ~0,8–1,5 da lateral do quadril (com a folga do jeans): vão pequeno entre a mão e a calça
      const gap = g * (wr[0] - torsoXAt(an, s, wr[1], 0.95)) - an.spec.wrist;
      expect(gap).toBeGreaterThan(0.6);
      expect(gap).toBeLessThan(2.0);
    }
  });

  it('pés: o de apoio quase de frente, o da perna livre mais girado; sola na linha do chão; sentado no apoio', () => {
    for (const eyes of EYES) {
      const an = buildAnatomy({ body: 'regular', faceShape: 'oval', eyes });
      const w = an.rest.weight;
      if (w) {
        const free = w === 'L' ? 'R' : 'L';
        expect(footYaw(an, w)).toBeLessThan(12);
        expect(footYaw(an, free)).toBeGreaterThan(15);
        expect(footYaw(an, free)).toBeLessThanOrEqual(22);
      }
      for (const s of ['L', 'R'] as const) {
        const ys = footPts(an, s, { ease: 0.8 }).map((p) => p[1]);
        expect(Math.max(...ys)).toBeGreaterThan(SOLE_Y - 1);
        expect(Math.max(...ys)).toBeLessThan(SOLE_Y + 1.4);
      }
    }
    const sit = buildAnatomy({ body: 'regular' }, { seated: true });
    const ys = footPts(sit, 'L', { ease: 0.8 }).map((p) => p[1]);
    expect(Math.max(...ys)).toBeLessThan(SOLE_Y - 0.5);
    expect(sit.foot.soleY).toBe(SEAT_SOLE_Y);
  });

  it('mão aberta (palma pra câmera) tem dedos em leque e polegar do lado de fora', () => {
    const an = buildAnatomy({ body: 'regular', faceShape: 'oval', eyes: 'round' });
    const o = handShapes(an, 'R', { open: true });
    const r = handShapes(an, 'R');
    for (const d of [o.hand, o.thumb, o.nails, o.knuckle, ...o.grooves]) expect(d).not.toMatch(/NaN|Infinity|undefined/);
    // polegar do lado de fora do corpo (mão direita da tela: x maior que o centro da palma)
    const tx = (o.thumb.match(/-?\d+(\.\d+)?/g) ?? []).map(Number).filter((_, i) => i % 2 === 0);
    expect(Math.max(...tx)).toBeGreaterThan(o.palm[0]);
    expect(o.hand.length).toBeGreaterThan(r.hand.length);
  });

  it('caimento da camiseta varia por pessoa (justa, normal, solta) e é sempre por fora da calça', () => {
    const fits = new Set<string>();
    for (const body of Object.keys(BODY_SPECS)) for (const faceShape of FACES) for (const eyes of EYES) fits.add(teeFit({ ...base, body, faceShape, eyes, bottom: 'jeans' }));
    expect([...fits].sort()).toEqual(['fitted', 'regular', 'relaxed']);
  });
});

describe('rosto: pessoas diferentes', () => {
  // as seis cabeças carecas da prova do crítico (mesma pele, sem cabelo)
  const six: Partial<AvatarConfig>[] = [
    { faceShape: 'oval', eyes: 'almond', brows: 'soft', nose: 'soft' },
    { faceShape: 'heart', eyes: 'upturned', brows: 'arched', nose: 'small' },
    { faceShape: 'round', eyes: 'round', brows: 'thin', nose: 'button' },
    { faceShape: 'long', eyes: 'monolid', brows: 'straight', nose: 'straight' },
    { faceShape: 'square', eyes: 'downturned', brows: 'thick', nose: 'aquiline' },
    { faceShape: 'diamond', eyes: 'hooded', brows: 'bushy', nose: 'wide' },
  ];
  const sig = (c: Partial<AvatarConfig>) => {
    const ha = headAnchors(buildAnatomy({ body: 'regular', ...c }));
    return [ha.eyeL[0], ha.eyeL[1], ha.eyeW, ha.browY, ha.nose[1], ha.noseW, ha.mouth[1], ha.mouthW, ha.chin[1] - ha.top[1], ha.cheekW, ha.jawL[0], ha.jawL[1]];
  };

  it('as seis combinações têm geometria de rosto realmente diferente (olhos, nariz, boca, mandíbula)', () => {
    const s = six.map(sig);
    for (let i = 0; i < s.length; i++) {
      for (let k = i + 1; k < s.length; k++) {
        const d = Math.hypot(...s[i].map((v, n) => v - s[k][n]));
        expect(d).toBeGreaterThan(1.2);
      }
    }
  });

  it('cada traço mexe no que é dele', () => {
    const ha = (c: Partial<AvatarConfig>) => headAnchors(buildAnatomy({ body: 'regular', faceShape: 'oval', eyes: 'almond', brows: 'soft', nose: 'soft', ...c }));
    expect(ha({ nose: 'wide' }).noseW).toBeGreaterThan(ha({ nose: 'small' }).noseW + 1);
    expect(ha({ nose: 'aquiline' }).nose[1]).toBeGreaterThan(ha({ nose: 'button' }).nose[1] + 1);
    expect(ha({ nose: 'wide' }).mouthW).toBeGreaterThan(ha({ nose: 'small' }).mouthW + 0.6);
    expect(ha({ brows: 'thin' }).browY).toBeLessThan(ha({ brows: 'bushy' }).browY - 0.4);
    expect(Math.abs(ha({ eyes: 'monolid' }).eyeL[0] - 50)).toBeGreaterThan(Math.abs(ha({ eyes: 'round' }).eyeL[0] - 50) + 0.2);
    // idade: orelha um pouco maior e lábio mais fino, sem caricatura
    expect(ha({ lines: 'marked' }).earR0).toBeGreaterThan(ha({}).earR0);
    expect(ha({ lines: 'marked' }).lipUp).toBeLessThan(ha({}).lipUp);
  });

  it('formatos de rosto mudam comprimento e mandíbula (queixo fixo em cima do pescoço)', () => {
    const len = (faceShape: string) => {
      const ha = headAnchors(buildAnatomy({ body: 'regular', faceShape }));
      return ha.chin[1] - ha.top[1];
    };
    expect(len('long')).toBeGreaterThan(len('round') + 1.5);
    const jaw = (faceShape: string) => Math.abs(headAnchors(buildAnatomy({ body: 'regular', faceShape })).jawL[0] - 50);
    expect(jaw('square')).toBeGreaterThan(jaw('heart') + 1.4);
    // quadrado: mandíbula marcada mas DENTRO da maçã (não vira caixa)
    const sq = headAnchors(buildAnatomy({ body: 'regular', faceShape: 'square' }));
    expect(sq.cheekW - Math.abs(sq.jawL[0] - 50)).toBeGreaterThan(0.4);
  });
});

describe('mão, membros e calça contínua', () => {
  it('pulso da mão tem a largura da ponta do antebraço (sem degrau) e a mão tem comprimento de adulto', () => {
    for (const body of Object.keys(BODY_SPECS)) {
      const an = buildAnatomy({ body, faceShape: 'oval', eyes: 'round' });
      const w = limbWidthAt(an, 'forearm', 'R', 1);
      const h = handShapes(an, 'R');
      const n = nums(h.hand);
      expect(n.length).toBeGreaterThan(40);
      // a ponta do dedo médio fica a ~9–12 unidades do pulso
      const wr = an.joints.wristR;
      expect(Math.hypot(h.tip[0] - wr[0], h.tip[1] - wr[1])).toBeGreaterThan(8.5);
      expect(Math.hypot(h.tip[0] - wr[0], h.tip[1] - wr[1])).toBeLessThan(13);
      expect(w.l + w.r).toBeCloseTo(an.spec.wrist * 2, 6);
    }
  });

  it('mão aberta (aceno) existe e é válida', () => {
    const an = buildAnatomy({ body: 'regular' });
    const o = handShapes(an, 'R', { open: true });
    expect(nums(o.hand).length).toBeGreaterThan(60);
    expect(nums(o.thumb).length).toBeGreaterThan(10);
  });

  it('boca da manga inclinada e copa achatada mudam o contorno', () => {
    const an = buildAnatomy({ body: 'regular' });
    expect(upperArmPath(an, 'L', { to: 0.5, slant: 1.4 })).not.toBe(upperArmPath(an, 'L', { to: 0.5 }));
    expect(upperArmPath(an, 'L', { capScale: 0.45 })).not.toBe(upperArmPath(an, 'L'));
    expect(forearmPath(an, 'L')).not.toMatch(/NaN/);
  });

  it('calça: coxa e canela usam o MESMO gradiente (perna contínua no joelho, sem joelheira)', () => {
    const cfg = { ...base, top: 'tee', bottom: 'jeans', shoes: 'sneakers' };
    const layers = buildAvatarLayers(cfg);
    const thigh = layers.find((l) => l.g === 'legL' && l.gf);
    const shin = layers.find((l) => l.g === 'shinL' && l.gf);
    expect(thigh?.gf).toEqual(shin?.gf);
    const ax = legAxis(buildAnatomy(cfg), 'L');
    expect(ax.b[1]).toBeGreaterThan(ax.a[1] + 40);
  });
});

describe('nível de detalhe e orçamento', () => {
  it('lite tira quase todo desfoque e fica bem mais leve', () => {
    for (const hair of ['short', 'long', 'curly', 'afro']) {
      const cfg = { ...base, top: 'tee', bottom: 'jeans', shoes: 'sneakers', hair };
      const full = buildAvatarLayers(cfg, { groundShadow: true });
      const lite = buildAvatarLayers(cfg, { groundShadow: true, lod: 'lite' } as Parameters<typeof buildAvatarLayers>[1]);
      // (rodada 5: itens novos mais ricos — jeans +2, cabelos texturizados — levaram o completo a ~261; o que pesa no
      // aparelho são bytes e desfoques, que continuam com o teto de antes)
      expect(full.length).toBeLessThan(275);
      expect(lite.length).toBeLessThan(180);
      expect(lite.filter((l) => l.b).length).toBeLessThan(20);
      const bytes = (ls: typeof full) => ls.reduce((s, l) => s + l.d.length, 0);
      expect(bytes(full)).toBeLessThan(290_000);
      expect(bytes(lite)).toBeLessThan(200_000);
      expect(bytes(lite)).toBeLessThan(bytes(full) * 0.8);
    }
  });

  it('busto e sentado montam sem NaN; sentado põe as mãos no colo', () => {
    const chair = { ...base, vehicle: 'wheelchair' };
    for (const l of buildAvatarLayers(chair)) nums(l.d);
    const rig = buildAvatarRig(chair);
    expect(rig.scene?.seated).toBe(true);
    for (const l of buildAvatarLayers(base, { mode: 'bust' })) nums(l.d);
  });
});

describe('rodada 5 da base (polimento)', () => {
  const ALL = (fn: (an: ReturnType<typeof buildAnatomy>) => void) => {
    for (const body of Object.keys(BODY_SPECS)) for (const eyes of EYES) for (const nose of ['soft', 'wide', 'aquiline']) fn(buildAnatomy({ body, faceShape: 'oval', eyes, nose }));
  };

  it('repousos com gesto: cotovelo nunca abre em "asa" e a mão na cintura fica FORA do tronco', () => {
    ALL((an) => {
      for (const s of ['L', 'R'] as const) {
        const kind = s === 'L' ? an.rest.armL : an.rest.armR;
        const g = s === 'L' ? -1 : 1;
        const sh = s === 'L' ? an.joints.shoulderL : an.joints.shoulderR;
        const el = s === 'L' ? an.joints.elbowL : an.joints.elbowR;
        const wr = s === 'L' ? an.joints.wristL : an.joints.wristR;
        // bolso e passante: braço quase cai (cotovelo no máximo ~6 além do ombro), antebraço vem pra frente
        if (kind === 'pocket' || kind === 'soft') expect(g * (el[0] - sh[0])).toBeLessThan(6);
        // mão na cintura: o pulso fica do lado de fora da silhueta do tronco (nada de mão na frente da barriga)
        if (kind === 'hip') expect(g * (wr[0] - torsoXAt(an, s, wr[1]))).toBeGreaterThan(0);
      }
    });
  });

  it('pescoço fino: no máximo NECK_JAW da mandíbula (0,64 esguio/curvilíneo … 0,8 largo/atlético)', () => {
    for (const body of Object.keys(BODY_SPECS)) {
      for (const faceShape of FACES) {
        const an = buildAnatomy({ body, faceShape });
        expect(an.w.neck / faceDims(an).jaw).toBeLessThanOrEqual(NECK_JAW[body] + 0.03);
      }
    }
    const r = (b: string) => buildAnatomy({ body: b }).w.neck / faceDims(buildAnatomy({ body: b })).jaw;
    expect(r('slim')).toBeLessThan(r('athletic'));
  });

  it('sentado: perna longa senta mais fundo (até +1,5) — valor pra cena guardar em scene.seatDrop', () => {
    expect(seatDropFor({ body: 'regular' })).toBeCloseTo(SEAT_DROP, 6);
    expect(seatDropFor({ body: 'slim' })).toBeGreaterThan(SEAT_DROP + 0.8);
    expect(seatDropFor({ body: 'athletic' })).toBeLessThanOrEqual(SEAT_DROP + 1.5);
    expect(seatDropFor({ body: 'plus' })).toBeCloseTo(SEAT_DROP, 6);
    // a anatomia usa o valor da cena quando ela manda um
    const sit = buildAnatomy({ body: 'slim' }, { seated: true, seatDrop: seatDropFor({ body: 'slim' }) } as Parameters<typeof buildAnatomy>[1]);
    expect(sit.seatDrop).toBeCloseTo(seatDropFor({ body: 'slim' }), 6);
  });

  it('estatura visível entre os tipos sem sair do viewBox', () => {
    const crown = (b: string) => faceDims(buildAnatomy({ body: b, hair: 'bald' })).crownY;
    expect(crown('curvy') - crown('athletic')).toBeGreaterThan(9);
    for (const b of Object.keys(BODY_SPECS)) expect(crown(b)).toBeGreaterThan(4);
  });

  it('expressões suaves se distinguem (camadas k:face diferentes entre si) e idade não gera NaN', () => {
    const faces = ['smile', 'calm', 'cool', 'blush', 'serene', 'smirk'];
    const sig = (face: string, extra: Partial<AvatarConfig> = {}) =>
      JSON.stringify(buildAvatarLayers({ ...base, face, ...extra }, { lod: 'lite' }).filter((l) => l.k === 'face').map((l) => l.d));
    for (const extra of [{}, { skin: 's8' }] as Partial<AvatarConfig>[]) {
      const set = new Set(faces.map((f) => sig(f, extra)));
      expect(set.size).toBe(faces.length);
    }
    for (const lines of ['soft', 'marked'] as const) {
      for (const face of ['smile', 'laugh', 'calm']) for (const l of buildAvatarLayers({ ...base, lines, face, skin: 's14' })) nums(l.d);
    }
  });
});
