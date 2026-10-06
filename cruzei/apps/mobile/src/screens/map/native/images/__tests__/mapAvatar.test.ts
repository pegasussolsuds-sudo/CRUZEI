import type { AvatarConfig } from '@cruzei/shared-types';
import { DEFAULT_AVATAR, normalizeAvatarConfig } from '@cruzei/shared-utils';

import { emoteDef, emoteFaceAt, listEmotes } from '../../../../../avatar/emotes';
import { NEUTRAL_VARIATION, poseIsFinite, variationFor, zero } from '../../../../../avatar/pose';
import { FALLBACK_SIGNATURE, signatureEmote } from '../../../../../components/avatar/signature';
import { DUR, EDGE_S, pose, ride, ridePeriod, usesArmsOf } from '../anim';
import { MAP_BUILD, MAP_LAYERS_LRU, drawingStamp, hexToRgb, mapAuraRgb, mapAvatarDef, restArms, sigAssets } from '../mapAvatar';

const cfgOf = (p: Partial<AvatarConfig> = {}) => normalizeAvatarConfig({ ...DEFAULT_AVATAR, ...p }) as AvatarConfig;
const NUM = /-?\d*\.?\d+(?:e[-+]?\d+)?/gi;

describe('mapAvatarDef', () => {
  it('camadas no nível lite, sem NaN, com animação assinatura e config', () => {
    for (const p of [{}, { vehicle: 'bike' }, { vehicle: 'carpet', pet: 'cat_orange' }, { emote: 'guitar', held: 'coffee' }] as Partial<AvatarConfig>[]) {
      const cfg = cfgOf(p);
      const d = mapAvatarDef(cfg);
      expect(MAP_BUILD.lod).toBe('lite');
      expect(d.l.length).toBeGreaterThan(20);
      for (const l of d.l) {
        expect(l.d).not.toMatch(/NaN|Infinity|undefined/);
        expect(l.d.match(NUM)?.every((n) => Number.isFinite(Number(n)))).toBe(true);
      }
      expect(d.c).toBe(cfg);
      expect(d.e).toBe(signatureEmote(cfg));
    }
  });

  it('camadas sob demanda: definir não monta; a primeira leitura monta e as seguintes reaproveitam (LRU)', () => {
    const cfg = cfgOf({ hair: 'long' });
    const d = mapAvatarDef(cfg);
    const first = d.l;
    expect(d.l).toBe(first);
    for (let i = 0; i < MAP_LAYERS_LRU + 2; i++) void mapAvatarDef(cfgOf({ skin: i % 2 ? 's3' : 's7', hairColor: i % 3 ? 'h_dark' : 'h_blonde' })).l;
    const again = d.l; // saiu do LRU: monta de novo, igual
    expect(again).not.toBe(first);
    expect(again.length).toBe(first.length);
  });

  it('a montaria vai na cena do rig (o motor decide ride/hover por ela)', () => {
    expect(mapAvatarDef(cfgOf({ vehicle: 'bike' })).p.scene?.mount).toBe('straddle');
    expect(mapAvatarDef(cfgOf({ vehicle: 'carpet' })).p.scene?.mount).toBe('hover');
    expect(mapAvatarDef(cfgOf({ vehicle: 'wheelchair' })).p.scene?.mount).toBe('seat');
    expect(mapAvatarDef(cfgOf()).p.scene?.mount ?? null).toBeNull();
  });
});

describe('poça de luz da aura (mapAuraRgb)', () => {
  it('sem aura = vazio', () => {
    expect(mapAuraRgb({ aura: 'none', auraColor: 'a_gold' })).toBe('');
    expect(mapAuraRgb({})).toBe('');
  });
  it("'Original' usa a cor própria do efeito; cor escolhida tem prioridade", () => {
    expect(mapAuraRgb({ aura: 'galaxy', auraColor: 'a_auto' })).toBe('155,92,255');
    expect(mapAuraRgb({ aura: 'flames', auraColor: 'a_auto' })).toBe('255,122,26');
    expect(mapAuraRgb({ aura: 'galaxy', auraColor: 'a_cyan' })).toBe('0,229,255');
    expect(mapAuraRgb({ aura: 'lime', auraColor: 'a_auto' })).toBe('127,255,0');
  });
  it('toda aura do catálogo tem cor de poça', () => {
    const ids = ['lime', 'magenta', 'gold', 'fest', 'sparkle', 'pride', 'galaxy', 'flames', 'electric', 'crystals', 'mist', 'stardust', 'petals', 'hologram', 'golden', 'rainbow', 'hearts', 'bubbles', 'snow', 'fireflies', 'music', 'supernova'];
    for (const id of ids) expect(mapAuraRgb({ aura: id, auraColor: 'a_auto' })).toMatch(/^\d{1,3},\d{1,3},\d{1,3}$/);
  });
  it('hexToRgb', () => {
    expect(hexToRgb('#FF1493')).toBe('255,20,147');
    expect(hexToRgb('nada')).toBe('');
  });
});

describe('animação assinatura (sigAssets)', () => {
  it('sem escolha (ou pedindo pet sem pet) a figura acena', () => {
    expect(signatureEmote(cfgOf({ emote: 'none' }))).toBe(FALLBACK_SIGNATURE);
    expect(signatureEmote(cfgOf({ emote: 'pet_love', pet: 'none' }))).toBe(FALLBACK_SIGNATURE);
    expect(signatureEmote(cfgOf({ emote: 'pet_love', pet: 'dog_caramel' }))).toBe('pet_love');
    expect(signatureEmote(cfgOf({ emote: 'dance_samba' }))).toBe('dance_samba');
  });

  it('troca a expressão no tempo e mostra o objeto da animação na mão', () => {
    const d = mapAvatarDef(cfgOf({ emote: 'guitar', face: 'smile', held: 'none' }));
    const sig = sigAssets(d);
    expect(sig?.def.id).toBe('guitar');
    expect(sigAssets(d)).toBe(sig); // montado uma vez por visual
    const def = emoteDef('guitar');
    const win = def?.face?.find((f) => f.face !== 'smile');
    expect(win).toBeDefined();
    const inside = sig!.layersAt((win!.from + win!.to) / 2);
    let kOut = 0;
    while (kOut < 1 && emoteFaceAt(def, kOut) != null) kOut += 0.01;
    expect(kOut).toBeLessThan(1);
    const outside = sig!.layersAt(kOut);
    const faces = (ls: typeof inside) => ls.filter((l) => l.k === 'face').map((l) => l.d).join('|');
    expect(faces(inside)).not.toBe(faces(outside));
    expect(inside.some((l) => l.k === 'held' || l.k === 'prop')).toBe(true);
    for (const l of inside) expect(l.d).not.toMatch(/NaN/);
  });

  it('todas as animações registradas dão quadros finitos no mapa, com braço solto e com veículo', () => {
    const people = [cfgOf(), cfgOf({ body: 'plus', vehicle: 'moto' }), cfgOf({ body: 'curvy', vehicle: 'wheelchair' })];
    for (const cfg of people) {
      const base = mapAvatarDef(cfg);
      const rest = restArms(base);
      expect(rest).toHaveLength(4);
      for (const def of listEmotes()) {
        const x = { rest, sig: def, mount: base.p.scene?.mount ?? null, bob: 0 };
        for (let i = 0; i <= 12; i++) expect(poseIsFinite(pose('sig', (i / 12) * def.dur, variationFor('abc'), x))).toBe(true);
      }
    }
  });

  it('entra e sai do repouso: quadro 0 e último = figura parada; no meio o braço solto entra inteiro', () => {
    const d = mapAvatarDef(cfgOf({ emote: 'wave' }));
    const sig = sigAssets(d)!;
    const rest = restArms(d)!;
    const x = { rest, sig: sig.def };
    const p0 = pose('sig', 0, NEUTRAL_VARIATION, x);
    expect(p0.armL.r).toBeCloseTo(0, 9);
    expect(p0.armR.r).toBeCloseTo(0, 9);
    expect(p0.body.dy).toBeCloseTo(0, 9);
    const pEnd = pose('sig', sig.def.dur, NEUTRAL_VARIATION, x);
    expect(pEnd.armR.r).toBeCloseTo(0, 9);
    const t = Math.max(EDGE_S, 0.5);
    const raw = sig.def.pose(t / sig.def.dur, t, NEUTRAL_VARIATION);
    const mid = pose('sig', t, NEUTRAL_VARIATION, x);
    expect(mid.armL.r).toBeCloseTo(raw.armL.r + rest[0], 6);
    expect(mid.foreR?.r ?? 0).toBeCloseTo((raw.foreR?.r ?? 0) + rest[3], 6);
    expect(usesArmsOf('sig', sig.def)).toBe(true);
    expect(usesArmsOf('ride', sig.def)).toBe(false);
  });
});

describe('montado (ride)', () => {
  it('desliza sem passada: pernas paradas, balanço do veículo fecha o ciclo', () => {
    for (const kind of ['straddle', 'cover', 'stand', 'seat', 'hover'] as const) {
      const P = ridePeriod(kind);
      const a = ride(0, NEUTRAL_VARIATION, kind, 0);
      const b = ride(P, NEUTRAL_VARIATION, kind, 0);
      expect(poseIsFinite(a)).toBe(true);
      expect(a.legL.r).toBe(0);
      expect(a.legR.r).toBe(0);
      expect(b.mount?.dy ?? 0).toBeCloseTo(a.mount?.dy ?? 0, 9);
      expect(b.mount?.r ?? 0).toBeCloseTo(a.mount?.r ?? 0, 9);
    }
  });
  it('flutuante sobe e desce com a amplitude da cena; no chão o balanço é pequeno', () => {
    const P = ridePeriod('hover');
    const up = ride(P / 4, NEUTRAL_VARIATION, 'hover', 2);
    expect(up.mount?.dy).toBeCloseTo(2, 6);
    expect(up.shadow.s).toBeLessThan(1);
    for (let i = 0; i < 12; i++) expect(Math.abs(ride(i * 0.1, NEUTRAL_VARIATION, 'straddle', 0).mount?.dy ?? 0)).toBeLessThanOrEqual(0.36);
    expect(pose('ride', 0.3, NEUTRAL_VARIATION, { mount: 'hover', bob: 1.6 }).mount).toBeDefined();
  });
});

describe('estados antigos', () => {
  it('sem extras dão exatamente a matemática de antes; com o braço solto, a caminhada parte dele', () => {
    const rest = [10, -20, -12, 25];
    const plain = pose('walk', 0.3, NEUTRAL_VARIATION);
    const withRest = pose('walk', 0.3, NEUTRAL_VARIATION, { rest });
    expect(withRest.armL.r).toBeCloseTo(plain.armL.r + 10, 9);
    expect(withRest.foreR?.r).toBeCloseTo((plain.foreR?.r ?? 0) + 25, 9);
    // estado que não mexe nos braços: o repouso fica
    expect(pose('arrive', 0.3, NEUTRAL_VARIATION, { rest }).armL.r).toBeCloseTo(pose('arrive', 0.3, NEUTRAL_VARIATION).armL.r, 9);
    expect(DUR.sig).toBe(0);
    expect(DUR.ride).toBe(0);
    expect(pose('sig', 1, NEUTRAL_VARIATION)).toEqual(pose('idle', 1, NEUTRAL_VARIATION));
    expect(zero().mount).toBeUndefined();
  });
});

describe('drawingStamp', () => {
  it('estável na sessão', () => {
    const a = drawingStamp();
    expect(a).toMatch(/^[0-9a-z]+$/);
    expect(drawingStamp()).toBe(a);
  });
});
