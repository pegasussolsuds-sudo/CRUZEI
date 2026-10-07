// Gestos do avatar: registro contra o catálogo, poses finitas que saem e voltam pro neutro, sem salto, e limites (mãos no
// viewBox, fora do rosto e do gancho, tronco no lugar) em todos os corpos, repousos, cadeira de rodas e carro. Partículas
// (gestures-fx): teto de 32 vivas, números finitos, determinismo, nada fora da janela, emenda do loop das danças.
import type { AvatarConfig } from '@cruzei/shared-types';
import { DEFAULT_AVATAR, avatarItem, avatarSlotDef, normalizeAvatarConfig } from '@cruzei/shared-utils';

import type { Pen } from '../../components/avatar/stage/fx-core';
import { BODY_SPECS, FACE_SPECS, bodyAnchors, buildAnatomy, headAnchors, restArmDelta, restOf, rigFromAnatomy } from '../anatomy';
import { fillConfig } from '../ctx';
import { emoteDef } from '../emotes';
import { DANCES } from '../emotes/dances';
import { GESTURES, GESTURE_HANDS } from '../emotes/gestures';
import { EMOTE_SHAPES, FX_MAX, drawEmoteFx, emoteFxSpec, type FxAnchors } from '../emotes/gestures-fx';
import { NEUTRAL_VARIATION, clonePose, poseIsFinite, type Pose, type PoseVariation } from '../pose';
import { groupMatrix, mApply } from '../rig';
import { applyScene, resolveScene } from '../scene';
import type { AvatarRig } from '../types';

// leitura do fonte no teste do 'worklet' (o tsconfig do app não traz os tipos do node)
declare const require: (m: string) => { readFileSync(p: string, enc: string): string };
declare const __dirname: string;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = require('fs');

const FX_KINDS = ['hearts', 'kiss', 'notes', 'sparkles', 'confetti', 'stars', 'bubbles', 'flash', 'fireworks', 'haha', 'petals'];
const ANCHORS = ['mouth', 'handL', 'handR', 'head', 'chest', 'pet', 'feet', 'above'];
const VARS: PoseVariation[] = [NEUTRAL_VARIATION, { ph: 0.3, sp: 0.85, en: 0.9 }, { ph: 0.7, sp: 1.15, en: 1.1 }];
const N = 96;
const IDS = Object.keys(GESTURES);

function flat(p: Pose): number[] {
  return [p.body.r, p.body.dy, p.body.sx, p.body.sy, p.body.dx ?? 0, p.head.r, p.head.dy, p.armL.r, p.armR.r, p.foreL?.r ?? 0, p.foreR?.r ?? 0, p.legL.r, p.legR.r, p.shinL?.r ?? 0, p.shinR?.r ?? 0, p.shadow.s];
}
const NEUTRAL = [0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1];
const ANGLE = [true, false, false, false, false, true, false, true, true, true, true, true, true, true, true, false];
const wrap180 = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

const cfgOf = (partial: Partial<AvatarConfig>) => normalizeAvatarConfig({ ...DEFAULT_AVATAR, ...partial }) as AvatarConfig;

/** uma pessoa por repouso diferente de cada corpo + cadeira de rodas + carro */
function people(): { tag: string; cfg: AvatarConfig }[] {
  const out: { tag: string; cfg: AvatarConfig }[] = [];
  const eyes = ['almond', 'round', 'upturned', 'downturned', 'monolid', 'hooded'];
  for (const body of Object.keys(BODY_SPECS)) {
    const seen = new Set<number>();
    for (const faceShape of Object.keys(FACE_SPECS))
      for (const e of eyes) {
        const id = restOf({ body, faceShape, eyes: e }).id;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({ tag: `${body}/r${id}`, cfg: cfgOf({ body, faceShape, eyes: e }) });
      }
  }
  out.push({ tag: 'cadeira/regular', cfg: cfgOf({ body: 'regular', vehicle: 'wheelchair' }) });
  out.push({ tag: 'cadeira/plus', cfg: cfgOf({ body: 'plus', vehicle: 'wheelchair' }) });
  out.push({ tag: 'carro/curvy', cfg: cfgOf({ body: 'curvy', vehicle: 'car' }) });
  return out;
}

/** pose como o palco monta: gesto + braço solto da pessoa (restArmDelta, se usa os braços) + cena */
function staged(id: string, k: number, v: PoseVariation, rig: AvatarRig, d: ReturnType<typeof restArmDelta>): Pose {
  const def = GESTURES[id];
  let p = clonePose(def.pose(k, k * def.dur, v));
  if (def.usesArms) {
    p.armL.r += d.armL;
    p.armR.r += d.armR;
    p.foreL = { r: (p.foreL?.r ?? 0) + d.foreL };
    p.foreR = { r: (p.foreR?.r ?? 0) + d.foreR };
  }
  if (rig.scene) p = applyScene(p, rig.scene, k * def.dur, { usesArms: def.usesArms });
  return p;
}

describe('gestos: registro', () => {
  it('todo gesto do catálogo (slot emote, fora as danças) está registrado e toca uma vez', () => {
    const catalog = avatarSlotDef('emote')
      .items.map((i) => i.id)
      .filter((i) => i !== 'none' && !i.startsWith('dance_'));
    expect([...IDS].sort()).toEqual([...catalog].sort());
    for (const id of IDS) {
      const def = emoteDef(id);
      expect(def).toBe(GESTURES[id]);
      expect(def?.id).toBe(id);
      expect(def?.loop).toBe(false);
      expect(def?.dur).toBeGreaterThanOrEqual(1.5);
      expect(def?.dur).toBeLessThanOrEqual(4.5);
      expect(def?.keyK).toBeGreaterThan(0.1);
      expect(def?.keyK).toBeLessThan(0.9);
      expect(!!def?.needsPet).toBe(id === 'pet_love');
    }
  });

  it('expressões, objetos e mãos abertas que existem', () => {
    for (const id of IDS) {
      const def = GESTURES[id];
      for (const f of def.face ?? []) {
        expect(avatarItem('face', f.face)).toBeDefined();
        expect(f.to).toBeGreaterThan(f.from);
        expect(f.from).toBeGreaterThanOrEqual(0);
      }
      if (def.prop) expect(avatarItem('held', def.prop)).toBeDefined();
    }
    expect(GESTURES.guitar.prop).toBe('guitar');
    expect(GESTURES.mic.prop).toBe('mic');
    expect(GESTURES.pandeiro.prop).toBe('tambourine');
    expect(GESTURES.magic.prop).toBe('wand');
    expect(GESTURES.kiss.face?.some((f) => f.face === 'kiss')).toBe(true);
    expect(GESTURES.bow.face?.some((f) => f.face === 'serene')).toBe(true);
    expect(GESTURES.laugh.face?.some((f) => f.face === 'laugh')).toBe(true);
    for (const id of Object.keys(GESTURE_HANDS)) expect(IDS).toContain(id);
  });

  it('efeitos válidos (tipo, âncora, janela, taxa) e as lendárias com chuva de estrelas e fogos', () => {
    for (const id of IDS) {
      for (const f of GESTURES[id].fx ?? []) {
        expect(FX_KINDS).toContain(f.kind);
        expect(ANCHORS).toContain(f.from);
        expect(f.start).toBeGreaterThanOrEqual(0);
        expect(f.end).toBeLessThanOrEqual(1);
        expect(f.end).toBeGreaterThan(f.start);
        expect(f.rate).toBeGreaterThan(0);
        expect(f.rate).toBeLessThanOrEqual(12);
      }
      expect(GESTURES[id].fx?.length).toBeGreaterThan(0);
    }
    expect(GESTURES.starfall.fx?.some((f) => f.kind === 'stars')).toBe(true);
    expect(GESTURES.fireworks.fx?.some((f) => f.kind === 'fireworks')).toBe(true);
  });

  it("toda função exportada dos gestos começa com 'worklet' (as do fx também, menos as de montagem no JS)", () => {
    for (const f of ['gestures-moves.ts', 'gestures-kit.ts', 'gestures-fx.ts']) {
      const src = fs.readFileSync(`${__dirname}/../emotes/${f}`, 'utf8');
      const all = (src.match(/^(export )?function \w+\(/gm) ?? []).filter((s) => !/emoteFxSpec|emoteFxStillT|function K\(/.test(s));
      const ok = src.match(/^(export )?function \w+\([^)]*\)[^{]*\{\s*'worklet';/gm) ?? [];
      expect(all.length).toBeGreaterThan(0);
      expect({ f, n: ok.length }).toEqual({ f, n: all.length });
    }
  });
});

describe('gestos: poses', () => {
  it('finitas, determinísticas, saem e voltam pro neutro', () => {
    for (const id of IDS) {
      const def = GESTURES[id];
      for (const v of VARS) {
        for (let i = 0; i <= N; i++) {
          const k = i / N;
          const p = def.pose(k, k * def.dur, v);
          expect(poseIsFinite(p)).toBe(true);
          expect(flat(def.pose(k, k * def.dur, v))).toEqual(flat(p));
        }
        for (const k of [0, 1]) flat(def.pose(k, k * def.dur, v)).forEach((x, j) => expect({ id, k, j, x: Math.round(x * 1e4) / 1e4 + 0 }).toEqual({ id, k, j, x: NEUTRAL[j] }));
        expect(def.pose(0.5, 0.5 * def.dur, v).pet === undefined).toBe(id !== 'pet_love');
      }
    }
  });

  it('sem salto: entre amostras vizinhas (1/480) nenhum ângulo pula mais que 30°', () => {
    for (const id of IDS) {
      const def = GESTURES[id];
      let prev = flat(def.pose(0, 0, NEUTRAL_VARIATION));
      for (let i = 1; i <= 480; i++) {
        const k = i / 480;
        const cur = flat(def.pose(k, k * def.dur, NEUTRAL_VARIATION));
        cur.forEach((x, j) => expect({ id, k, j, ok: Math.abs(ANGLE[j] ? wrap180(x - prev[j]) : x - prev[j]) < 30 }).toEqual({ id, k, j, ok: true }));
        prev = cur;
      }
    }
  });

  it('o tronco fica no lugar: deslocamento ≤ 3,6, giro ≤ 8°, cabeça ≤ 12°, sy entre 0,9 e 1,06', () => {
    for (const id of IDS) {
      const def = GESTURES[id];
      for (let i = 0; i <= N; i++) {
        const k = i / N;
        const p = def.pose(k, k * def.dur, VARS[2]);
        expect(Math.abs(p.body.dx ?? 0)).toBeLessThanOrEqual(2.5);
        expect(Math.abs(p.body.dy)).toBeLessThanOrEqual(3.6);
        expect(Math.abs(p.body.r)).toBeLessThanOrEqual(8);
        expect(Math.abs(p.head.r)).toBeLessThanOrEqual(12);
        expect(p.body.sy).toBeGreaterThanOrEqual(0.9);
        expect(p.body.sy).toBeLessThanOrEqual(1.06);
        expect(p.body.sx).toBe(1);
      }
    }
  });
});

describe('gestos: limites em todos os corpos, repousos, cadeira e carro', () => {
  const ppl = people().map(({ tag, cfg }) => {
    const full = fillConfig(cfg);
    const scene = resolveScene(full);
    const an = buildAnatomy(full, scene);
    const rig = rigFromAnatomy(an, scene);
    return { tag, cfg, rig, an, d: restArmDelta(an), ba: bodyAnchors(an), ha: headAnchors(an) };
  });

  it('cobre os 6 corpos e as variantes de repouso', () => {
    expect(new Set(ppl.map((p) => p.cfg.body)).size).toBe(Object.keys(BODY_SPECS).length);
    expect(ppl.length).toBeGreaterThanOrEqual(Object.keys(BODY_SPECS).length * 4);
  });

  it('mãos dentro do viewBox, fora do rosto (olhos) e longe do gancho de quem está em pé', () => {
    const bad: string[] = [];
    for (const id of IDS) {
      // sem braços na animação (carinho no pet) as mãos ficam no repouso da pessoa, que é da anatomia
      if (!GESTURES[id].usesArms) continue;
      for (const { tag, rig, an, d, ba, ha } of ppl) {
        const hr = an.arm.handR;
        for (let i = 0; i <= N; i++) {
          const k = i / N;
          const p = staged(id, k, VARS[2], rig, d);
          const H = groupMatrix('head', rig, p);
          const eyes = [mApply(H, ha.eyeL[0], ha.eyeL[1]), mApply(H, ha.eyeR[0], ha.eyeR[1])];
          const crotch = mApply(groupMatrix('body', rig, p), an.cx, an.torsoBottom);
          const standing = !rig.scene || (!rig.scene.seated && rig.scene.mount !== 'cover');
          for (const s of ['L', 'R'] as const) {
            const pm = s === 'L' ? ba.palmL : ba.palmR;
            const [x, y] = mApply(groupMatrix(s === 'L' ? 'foreL' : 'foreR', rig, p), pm[0], pm[1]);
            const at = `${id} ${tag} k=${k.toFixed(3)} ${s}`;
            if (y - hr < 1) bad.push(`${at}: mão acima do viewBox (${(y - hr).toFixed(2)})`);
            if (x - hr < 0 || x + hr > 100) bad.push(`${at}: mão fora do viewBox (x ${x.toFixed(2)})`);
            for (const e of eyes) if (Math.hypot(x - e[0], y - e[1]) < 4) bad.push(`${at}: mão em cima do olho`);
            // (no violão a mão esquerda dedilha na frente do corpo do instrumento, que cobre o quadril)
            const overGuitar = id === 'guitar' && s === 'L';
            if (standing && !overGuitar && Math.abs(x - crotch[0]) < 6 && y > an.hipY && y < an.torsoBottom + 6) bad.push(`${at}: mão no gancho`);
          }
        }
      }
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it('as mãos se encontram no coração e na palma (centros das palmas a ≤ 7) e se afastam entre as palmas', () => {
    // repouso com o polegar no passante/bolso: o antebraço do repouso é desenhado em escorço (mais curto) e a mão não
    // alcança o meio — pedido ao dono da anatomia (antebraço inteiro quando a animação usa os braços)
    for (const { tag, rig, d, ba, an } of ppl) {
      if (rig.scene?.mount || an.rest.armL === 'soft' || an.rest.armR === 'soft') continue;
      const gap = (id: string, k: number) => {
        const p = staged(id, k, NEUTRAL_VARIATION, rig, d);
        const l = mApply(groupMatrix('foreL', rig, p), ba.palmL[0], ba.palmL[1]);
        const r = mApply(groupMatrix('foreR', rig, p), ba.palmR[0], ba.palmR[1]);
        return Math.hypot(r[0] - l[0], r[1] - l[1]);
      };
      expect({ tag, ok: gap('heart', GESTURES.heart.keyK) <= 6 }).toEqual({ tag, ok: true });
      expect({ tag, ok: gap('clap', 0.5) <= 7 }).toEqual({ tag, ok: true });
      expect({ tag, ok: gap('clap', 0.43) >= 6 }).toEqual({ tag, ok: true });
    }
  });

  it('de carro e de cadeira as pernas são da cena (o gesto não mexe nelas)', () => {
    for (const { tag, rig, d } of ppl) {
      if (!rig.scene?.mount) continue;
      for (const id of IDS) {
        const legs = (p: Pose) => [p.legL.r, p.legR.r, p.shinL?.r ?? 0, p.shinR?.r ?? 0];
        expect({ tag, id, legs: legs(staged(id, 0.5, NEUTRAL_VARIATION, rig, d)) }).toEqual({ tag, id, legs: legs(staged(id, 0.2, NEUTRAL_VARIATION, rig, d)) });
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// partículas
// ---------------------------------------------------------------------------------------------------------------

/** caneta que só anota as chamadas (e confere que todo número é finito) */
function fakePen(): Pen & { calls: string[]; bad: string[] } {
  const calls: string[] = [];
  const bad: string[] = [];
  const check = (name: string, args: unknown[]) => {
    const walk = (v: unknown): void => {
      if (typeof v === 'number') {
        if (!Number.isFinite(v)) bad.push(`${name}: ${String(v)}`);
      } else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v as Record<string, unknown>).forEach(walk);
    };
    walk(args);
    calls.push(name + ':' + JSON.stringify(args.map((a) => (typeof a === 'number' ? Math.round(a * 1000) / 1000 : a))));
  };
  const rec =
    (name: string) =>
    (...args: unknown[]) =>
      check(name, args);
  return {
    calls,
    bad,
    lite: false,
    save: rec('save'),
    restore: rec('restore'),
    translate: rec('translate'),
    rotate: rec('rotate'),
    scale: rec('scale'),
    circle: rec('circle'),
    oval: rec('oval'),
    rect: rec('rect'),
    rrect: rec('rrect'),
    path: rec('path'),
    shape: (key: string, ...rest: unknown[]) => {
      if (!EMOTE_SHAPES[key]) bad.push(`forma desconhecida: ${key}`);
      check('shape', [key, ...rest]);
    },
    glow: rec('glow'),
    glowOval: rec('glowOval'),
    ring: rec('ring'),
    clipRRect: rec('clipRRect'),
    clipOval: rec('clipOval'),
  } as Pen & { calls: string[]; bad: string[] };
}

/** âncoras de um palco de 300 px (escala ~1,84 px por unidade) */
const ANCH: FxAnchors = {
  mouth: { x: 120, y: 82 },
  handL: { x: 70, y: 150 },
  handR: { x: 170, y: 150 },
  head: { x: 120, y: 30 },
  chest: { x: 120, y: 135 },
  pet: { x: 200, y: 230 },
  feet: { x: 120, y: 274 },
  above: { x: 120, y: 11.6 },
};

describe('partículas (EmoteFx)', () => {
  const all = [...IDS.map((id) => GESTURES[id]), ...Object.values(DANCES)];

  it('o teto de 32 é dividido entre os efeitos de cada animação', () => {
    for (const def of all) {
      const S = emoteFxSpec(def);
      expect(S).not.toBeNull();
      const caps = S!.em.reduce((a, e) => a + e.cap, 0);
      expect(caps).toBeLessThanOrEqual(FX_MAX);
      for (const e of S!.em) expect(e.cap).toBeGreaterThanOrEqual(1);
    }
    expect(emoteFxSpec(null)).toBeNull();
    expect(emoteFxSpec({ dur: 1, loop: false, fx: [] })).toBeNull();
  });

  it('em todo quadro: ≤ 32 vivas, números finitos, formas conhecidas; save/restore casados; mesmo t = mesmo desenho', () => {
    for (const def of all) {
      const S = emoteFxSpec(def);
      const D = def.dur * (def.loop ? 2 : 1);
      let peak = 0;
      for (let i = 1; i < 120; i++) {
        const t = (i / 120) * D;
        const P = fakePen();
        const n = drawEmoteFx(P, S, t, ANCH, false);
        expect(n).toBeLessThanOrEqual(FX_MAX);
        expect({ id: def.id, t, bad: P.bad.slice(0, 3) }).toEqual({ id: def.id, t, bad: [] });
        expect(P.calls.filter((c) => c.startsWith('save')).length).toBe(P.calls.filter((c) => c.startsWith('restore')).length);
        const Q = fakePen();
        drawEmoteFx(Q, S, t, ANCH, true);
        expect(Q.calls).toEqual(P.calls);
        peak = Math.max(peak, n);
      }
      expect({ id: def.id, some: peak > 0 }).toEqual({ id: def.id, some: true });
    }
  });

  it('nada antes de começar nem depois do fim de um gesto; o quadro-chave (movimento reduzido) tem partículas', () => {
    const STILL_WITHOUT_FX = new Set(['pose_hero', 'kiss', 'jump']);
    for (const id of IDS) {
      const def = GESTURES[id];
      const S = emoteFxSpec(def);
      for (const t of [-1, 0, def.dur, def.dur + 0.5]) expect(drawEmoteFx(fakePen(), S, t, ANCH, true)).toBe(0);
      // até o fim as partículas morrem sozinhas (a vida encurta): no último quadro quase nada
      expect(drawEmoteFx(fakePen(), S, def.dur - 0.01, ANCH, false)).toBeLessThanOrEqual(2);
      const key = drawEmoteFx(fakePen(), S, def.keyK * def.dur, ANCH, true);
      // o quadro parado do beijo (mão na boca, biquinho) e do pulo (agachado pegando impulso) vem antes das partículas:
      // a pose já diz o que é, e com elas no alto as miniaturas saíam iguais às do acenar e da vitória
      if (!STILL_WITHOUT_FX.has(id)) expect({ id, key: key > 0 }).toEqual({ id, key: true });
    }
  });

  it('em loop (danças) as partículas do ciclo anterior seguem vivas na emenda', () => {
    const def = DANCES.dance_samba;
    const S = emoteFxSpec(def)!;
    const n = drawEmoteFx(fakePen(), S, def.dur + 0.05, ANCH, false);
    expect(n).toBeGreaterThan(0);
  });

  it('nenhum centro de coração/nota/beijo cai em cima do rosto', () => {
    const face = { x: ANCH.mouth.x, y0: ANCH.head.y + 6, y1: ANCH.mouth.y };
    for (const id of ['heart', 'kiss', 'mic', 'shy', 'laugh']) {
      const def = GESTURES[id];
      const S = emoteFxSpec(def);
      for (let i = 1; i < 60; i++) {
        const P = fakePen();
        drawEmoteFx(P, S, (i / 60) * def.dur, ANCH, false);
        for (const c of P.calls.filter((x) => x.startsWith('shape:["heart"') || x.startsWith('shape:["note') || x.startsWith('shape:["em_lips"'))) {
          const [, x, y] = JSON.parse(c.slice(6)) as [string, number, number];
          const inside = Math.abs(x - face.x) < 14 && y > face.y0 && y < face.y1;
          expect({ id, c: inside ? c.slice(0, 40) : null }).toEqual({ id, c: null });
        }
      }
    }
  });
});
