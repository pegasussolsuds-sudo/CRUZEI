// Danças do avatar: registro, ritmo, loop sem tranco, poses finitas e limites (mãos no viewBox, fora do rosto e do
// gancho) em todos os corpos, todos os repousos, de cadeira de rodas e de carro.
import type { AvatarConfig } from '@cruzei/shared-types';
import { DEFAULT_AVATAR, avatarItem, avatarSlotDef, normalizeAvatarConfig } from '@cruzei/shared-utils';

import { BODY_SPECS, FACE_SPECS, bodyAnchors, buildAnatomy, headAnchors, restArmDelta, restOf, rigFromAnatomy } from '../anatomy';
import { fillConfig } from '../ctx';
import { emoteDef } from '../emotes';
import { DANCES, DANCE_HANDS, DANCE_TEMPO } from '../emotes/dances';
import { NEUTRAL_VARIATION, clonePose, poseIsFinite, type Pose, type PoseVariation } from '../pose';
import { groupMatrix, mApply } from '../rig';
import { applyScene, resolveScene } from '../scene';
import type { AvatarRig } from '../types';

// leitura do fonte no teste do 'worklet' (o jest roda em node, mas o tsconfig do app não traz os tipos do node)
declare const require: (m: string) => { readFileSync(p: string, enc: string): string };
declare const __dirname: string;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = require('fs');

const IDS = ['dance_samba', 'dance_passinho', 'dance_hiphop', 'dance_disco', 'dance_robot', 'dance_kpop', 'dance_vogue', 'dance_shuffle'];
const FX_KINDS = ['hearts', 'kiss', 'notes', 'sparkles', 'confetti', 'stars', 'bubbles', 'flash', 'fireworks', 'haha', 'petals'];
const ANCHORS = ['mouth', 'handL', 'handR', 'head', 'chest', 'pet', 'feet', 'above'];
const VARS: PoseVariation[] = [NEUTRAL_VARIATION, { ph: 0.3, sp: 0.85, en: 0.9 }, { ph: 0.7, sp: 1.15, en: 1.1 }];
const N = 96;

/** todos os números da pose, numa ordem fixa (campo ausente = neutro) */
function flat(p: Pose): number[] {
  return [
    p.body.r, p.body.dy, p.body.sx, p.body.sy, p.body.dx ?? 0, p.head.r, p.head.dy, p.armL.r, p.armR.r, p.foreL?.r ?? 0, p.foreR?.r ?? 0,
    p.legL.r, p.legR.r, p.shinL?.r ?? 0, p.shinR?.r ?? 0, p.shadow.s,
  ];
}

/** campos de flat() que são ângulo (body.r, head.r, braços, antebraços, pernas, canelas) */
const ANGLE = [true, false, false, false, false, true, false, true, true, true, true, true, true, true, true, false];
const wrap180 = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

const cfgOf = (partial: Partial<AvatarConfig>) => normalizeAvatarConfig({ ...DEFAULT_AVATAR, ...partial }) as AvatarConfig;

/** uma pessoa por repouso diferente de cada corpo + cadeira de rodas (dois corpos) + carro */
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
  out.push({ tag: 'cadeira esportiva/athletic', cfg: cfgOf({ body: 'athletic', vehicle: 'wheelchair_sport' }) });
  out.push({ tag: 'carro/curvy', cfg: cfgOf({ body: 'curvy', vehicle: 'car' }) });
  return out;
}

/** pose como o palco deveria montar: dança + braço solto da pessoa (restArmDelta) + cena (veículo) */
function staged(id: string, k: number, v: PoseVariation, cfg: AvatarConfig, rig: AvatarRig, d: ReturnType<typeof restArmDelta>): Pose {
  const def = DANCES[id];
  let p = clonePose(def.pose(k, k * def.dur, v));
  p.armL.r += d.armL;
  p.armR.r += d.armR;
  p.foreL = { r: (p.foreL?.r ?? 0) + d.foreL };
  p.foreR = { r: (p.foreR?.r ?? 0) + d.foreR };
  if (rig.scene) p = applyScene(p, rig.scene, k * def.dur, { usesArms: def.usesArms });
  void cfg;
  return p;
}

describe('danças: registro e ritmo', () => {
  it('as 8 danças do catálogo estão registradas, em loop, mexendo braços e pernas', () => {
    const catalog = avatarSlotDef('emote').items.map((i) => i.id).filter((i) => i.startsWith('dance_'));
    expect(catalog.sort()).toEqual([...IDS].sort());
    expect(Object.keys(DANCES).sort()).toEqual([...IDS].sort());
    for (const id of IDS) {
      const def = emoteDef(id);
      expect(def).toBe(DANCES[id]);
      expect(def?.id).toBe(id);
      expect(def?.loop).toBe(true);
      expect(def?.usesArms).toBe(true);
      expect(def?.usesLegs).toBe(true);
      expect(def?.needsPet).toBeFalsy();
    }
  });

  it('dur = batidas · 60 / bpm, com andamento de dança (90 a 140 bpm) e ciclo de 1,5 a 6 s', () => {
    for (const id of IDS) {
      const t = DANCE_TEMPO[id];
      expect(t.bpm).toBeGreaterThanOrEqual(90);
      expect(t.bpm).toBeLessThanOrEqual(140);
      expect(DANCES[id].dur).toBeCloseTo((t.beats * 60) / t.bpm, 2);
      expect(DANCES[id].dur).toBeGreaterThanOrEqual(1.5);
      expect(DANCES[id].dur).toBeLessThanOrEqual(6);
    }
  });

  it('trocas de expressão cobrem o ciclo inteiro, sem buraco, com expressões que existem', () => {
    for (const id of IDS) {
      const face = DANCES[id].face ?? [];
      expect(face.length).toBeGreaterThanOrEqual(2);
      expect(face[0].from).toBe(0);
      expect(face[face.length - 1].to).toBeGreaterThan(1);
      for (let i = 0; i < face.length; i++) {
        expect(avatarItem('face', face[i].face)).toBeDefined();
        expect(face[i].to).toBeGreaterThan(face[i].from);
        if (i > 0) expect(face[i].from).toBeCloseTo(face[i - 1].to, 9);
      }
    }
  });

  it('efeitos válidos (tipo, âncora, janela 0..1, taxa) e quadro-chave dentro do ciclo', () => {
    for (const id of IDS) {
      const def = DANCES[id];
      expect(def.keyK).toBeGreaterThanOrEqual(0);
      expect(def.keyK).toBeLessThanOrEqual(1);
      expect(def.fx?.length).toBeGreaterThan(0);
      for (const f of def.fx ?? []) {
        expect(FX_KINDS).toContain(f.kind);
        expect(ANCHORS).toContain(f.from);
        expect(f.start).toBeGreaterThanOrEqual(0);
        expect(f.end).toBeLessThanOrEqual(1);
        expect(f.end).toBeGreaterThan(f.start);
        expect(f.rate).toBeGreaterThan(0);
        expect(f.rate).toBeLessThanOrEqual(12);
      }
    }
  });

  it('mão aberta só nas danças registradas', () => {
    for (const id of Object.keys(DANCE_HANDS)) expect(IDS).toContain(id);
  });

  it("toda função exportada da coreografia e do kit começa com 'worklet'", () => {
    for (const f of ['dances-moves.ts', 'dances-kit.ts']) {
      const src = fs.readFileSync(`${__dirname}/../emotes/${f}`, 'utf8');
      const all = src.match(/export function \w+\(/g) ?? [];
      const ok = src.match(/export function \w+\([^)]*\)[^{]*\{\s*'worklet';/g) ?? [];
      expect(all.length).toBeGreaterThan(0);
      expect(ok.length).toBe(all.length);
    }
  });
});

describe('danças: poses', () => {
  it('finitas, determinísticas e periódicas (o loop emenda sem tranco)', () => {
    for (const id of IDS) {
      const def = DANCES[id];
      for (const v of VARS) {
        for (let i = 0; i <= N; i++) {
          const k = i / N;
          const p = def.pose(k, k * def.dur, v);
          expect(poseIsFinite(p)).toBe(true);
          expect(flat(def.pose(k, k * def.dur, v))).toEqual(flat(p));
        }
        const a = flat(def.pose(0, 0, v));
        const b = flat(def.pose(1, def.dur, v));
        a.forEach((x, j) => expect(b[j]).toBeCloseTo(x, 6));
      }
    }
  });

  it('sem salto: entre amostras vizinhas (1/960 do ciclo) nenhum ângulo pula mais que 45° (pela menor volta)', () => {
    // o rig desenha igual em r e r ± 360: a dança devolve os giros em (-180, 180], então a virada de 180 pra -180 não é salto
    for (const id of IDS) {
      const def = DANCES[id];
      let prev = flat(def.pose(0, 0, NEUTRAL_VARIATION));
      for (let i = 1; i <= 960; i++) {
        const k = i / 960;
        const cur = flat(def.pose(k, k * def.dur, NEUTRAL_VARIATION));
        cur.forEach((x, j) => expect(Math.abs(ANGLE[j] ? wrap180(x - prev[j]) : x - prev[j])).toBeLessThan(45));
        prev = cur;
      }
    }
  });

  it('na entrada (fade do palco) e na emenda do loop nenhum giro vira de 180 pra -180 (o palco mistura com blend linear)', () => {
    for (const id of IDS) {
      const def = DANCES[id];
      const fadeK = Math.min(0.5, 0.25 / def.dur); // FADE_S = 0,2 s no AvatarStage, com folga
      // sem virada nas janelas = os números crus andam junto com o giro e chegam em pose(1) = pose(0) (teste acima)
      for (const [a, b] of [
        [0, fadeK],
        [0.9, 1], // SEAM = 8% finais: o palco mistura pose(k) com pose(0)
      ]) {
        let prev = flat(def.pose(a, a * def.dur, NEUTRAL_VARIATION));
        for (let i = 1; i <= 240; i++) {
          const k = a + (i / 240) * (b - a);
          const cur = flat(def.pose(k, k * def.dur, NEUTRAL_VARIATION));
          cur.forEach((x, j) => expect({ id, k, j, ok: Math.abs(x - prev[j]) < 45 }).toEqual({ id, k, j, ok: true }));
          prev = cur;
        }
      }
    }
  });

  it('o tronco não sai do lugar: deslocamento ≤ 2,5, giro ≤ 8°, cabeça ≤ 12°', () => {
    for (const id of IDS) {
      const def = DANCES[id];
      for (let i = 0; i <= N; i++) {
        const k = i / N;
        const p = def.pose(k, k * def.dur, VARS[2]);
        expect(Math.abs(p.body.dx ?? 0)).toBeLessThanOrEqual(2.5);
        expect(Math.abs(p.body.dy)).toBeLessThanOrEqual(2.5);
        expect(Math.abs(p.body.r)).toBeLessThanOrEqual(8);
        expect(Math.abs(p.head.r)).toBeLessThanOrEqual(12);
      }
    }
  });
});

describe('danças: limites em todos os corpos, repousos, cadeira e carro', () => {
  const ppl = people().map(({ tag, cfg }) => {
    // mesmo que buildAvatarRig (layers.ts), sem puxar o desenho das partes
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

  it('mãos dentro do viewBox (y ≥ 1, 0 ≤ x ≤ 100), fora do rosto e longe do gancho de quem está em pé', () => {
    const bad: string[] = [];
    for (const id of IDS) {
      for (const { tag, cfg, rig, an, d, ba, ha } of ppl) {
        const hr = an.arm.handR;
        for (let i = 0; i <= N; i++) {
          const k = i / N;
          const p = staged(id, k, VARS[2], cfg, rig, d);
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
            if (standing && Math.abs(x - crotch[0]) < 6 && y > an.hipY && y < an.torsoBottom + 6) bad.push(`${at}: mão no gancho`);
          }
        }
      }
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it('de cadeira de rodas e de carro as pernas são da cena (a dança não mexe nelas) e o tronco só ginga', () => {
    for (const { tag, cfg, rig, d } of ppl) {
      if (!rig.scene?.mount) continue;
      for (const id of IDS) {
        const a = staged(id, 0.13, NEUTRAL_VARIATION, cfg, rig, d);
        const b = staged(id, 0.61, NEUTRAL_VARIATION, cfg, rig, d);
        const legs = (p: Pose) => [p.legL.r, p.legR.r, p.shinL?.r ?? 0, p.shinR?.r ?? 0];
        expect({ tag, id, legs: legs(b) }).toEqual({ tag, id, legs: legs(a) });
      }
    }
  });
});
