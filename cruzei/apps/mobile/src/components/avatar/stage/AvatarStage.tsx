// Palco animado do avatar (Skia + Reanimated): telas grandes (perfil, editor, match, prévia de animação).
// Listas e miniaturas NUNCA usam o palco (usam o <CruzeiAvatar/> estático, por desempenho).
//
// Como funciona (sem re-render por quadro):
//   - no JS, uma vez por visual (stageAssets): camadas da config + expressões/objeto alternativos da animação,
//     gravadas em SkPictures por corrida (grupo + papel), com cache por avatarKey;
//   - na thread de UI: um relógio (useFrameCallback, só ligado quando algo anima) → pose (animação + respiração +
//     cena) → uma matriz por grupo do esqueleto (número fixo de hooks, mesma matemática do avatar/rig.ts) →
//     <Group matrix> de cada corrida. Troca de expressão/objeto = corrida alternativa entra, a outra sai (a matriz
//     de quem não aparece manda o desenho pra fora do canvas: sem saveLayer e sem re-render);
//   - movimento reduzido: sem respiração, a animação mostra o quadro keyK parado, auras paradas (nada anima sozinho);
//   - animações que mexem os braços partem do braço SOLTO da pessoa (restArmDelta da anatomia, somado com o mesmo peso
//     da entrada/saída) e trocam a mão pela aberta quando pedem (emoteHands).
//
// Desenho, de trás pra frente: <BackdropFx/> · <AuraFx layer='back'/> · avatar posado · <AuraFx layer='front'/> ·
// <EmoteFx/> · placa de pronomes por cima, em RN (<PronounTag/>).
// Enquadramento (layout.ts): avatar na caixa interna de 86%, aura transborda; full = canvas size × 0.8·size.

import type { AvatarConfig } from '@cruzei/shared-types';
import { avatarPronounsLabel } from '@cruzei/shared-utils';
import { Canvas, Group, Picture } from '@shopify/react-native-skia';
import React, { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { runOnJS, useDerivedValue, useFrameCallback, useReducedMotion, useSharedValue, type FrameInfo, type SharedValue } from 'react-native-reanimated';

import { bustBoxFor, keyOf } from '../../../avatar';
import { buildAnatomy, headAnchors, restArmDelta } from '../../../avatar/anatomy';
import { fillConfig, resolveColors } from '../../../avatar/ctx';
import { emoteDef, emoteFaceAt } from '../../../avatar/emotes';
import { flagOf } from '../../../avatar/parts/flags';
import { NEUTRAL_VARIATION, addPose, blend, breathe, clamp, easeInOut, easeOut, zero, type Pose } from '../../../avatar/pose';
import { groupMatrix, mToSkia } from '../../../avatar/rig';
import { applyScene } from '../../../avatar/scene';
import type { AvatarGroup, AvatarRig } from '../../../avatar/types';

import { AuraFx, type AuraLevel } from './AuraFx';
import { BackdropFx } from './BackdropFx';
import { EmoteFx } from './EmoteFx';
import { PronounTag } from './PronounTag';
import { computeAnchors, type AnchorSpec, type StageAnchors } from './anchors';
import { stageAssets, type StageRun } from './assets';
import { auraFigure } from './fx-auras';
import { stageLayout } from './layout';
import { roleVisible } from './stageLayers';

export interface AvatarStageProps {
  config: AvatarConfig;
  /** altura do canvas em px no full (largura = 0.8 × size); lado no bust */
  size: number;
  mode?: 'full' | 'bust';
  /** id da animação (slot `emote`); null/'none' = só parado/respirando */
  emote?: string | null;
  /** a animação está tocando */
  playing?: boolean;
  /** repete (padrão: o da animação — danças repetem, gestos não) */
  loop?: boolean;
  /** muda → recomeça a animação do início */
  replayToken?: number;
  /** a animação (sem loop) chegou ao fim */
  onEmoteEnd?: () => void;
  /** respiração parada (padrão true) */
  idle?: boolean;
  /** desenha o fundo da config (slot `backdrop`) */
  showBackdrop?: boolean;
  /** mostra a placa de pronomes (slot `pronouns`) */
  showPronouns?: boolean;
  /** sombra no chão (padrão: só no full) */
  groundShadow?: boolean;
  /** congela tudo (tela fora de foco) */
  paused?: boolean;
  /** movimento reduzido (padrão: o do sistema) */
  reduceMotion?: boolean;
  accessibilityLabel?: string;
  /** dentro de um botão que já tem rótulo: some do leitor de tela (sem foco nem leitura dobrada) */
  decorative?: boolean;
  style?: StyleProp<ViewStyle>;
  /** (opcional) progresso 0..1 escrito pelo palco a cada quadro (useEmotePlayer().progress) */
  progress?: SharedValue<number>;
}

const OFF = mToSkia([1, 0, 0, 1, -100000, -100000]);
/** entrada/saída suave da animação (s) e emenda do loop (fração do ciclo) */
const FADE_S = 0.2;
const SEAM = 0.08;

function useGroupMatrix(g: AvatarGroup, rig: AvatarRig, pose: SharedValue<Pose>): SharedValue<number[]> {
  return useDerivedValue(() => mToSkia(groupMatrix(g, rig, pose.value)), [g, rig]);
}

function StaticRun({ run, mat }: { run: StageRun; mat: SharedValue<number[]> }) {
  return (
    <Group matrix={mat}>
      <Picture picture={run.picture} />
    </Group>
  );
}

function SwapRun({ run, mat, swap }: { run: StageRun; mat: SharedValue<number[]>; swap: SharedValue<{ face: number; prop: boolean; hands: boolean }> }) {
  const role = run.role;
  const m = useDerivedValue(() => (roleVisible(role, swap.value.face, swap.value.prop, swap.value.hands) ? mat.value : OFF), [role, mat]);
  return (
    <Group matrix={m}>
      <Picture picture={run.picture} />
    </Group>
  );
}

function AvatarStageInner(props: AvatarStageProps) {
  const {
    config,
    size,
    mode = 'full',
    emote = null,
    playing = false,
    loop,
    replayToken = 0,
    onEmoteEnd,
    idle = true,
    showBackdrop = false,
    showPronouns = false,
    groundShadow,
    paused = false,
    reduceMotion,
    accessibilityLabel,
    decorative = false,
    style,
    progress,
  } = props;
  const sysReduce = useReducedMotion();
  const reduce = reduceMotion ?? sysReduce;
  const def = useMemo(() => emoteDef(emote), [emote]);
  const shadow = groundShadow ?? mode === 'full';
  const key = keyOf(config);
  // key resume a config (o objeto pode mudar de identidade sem mudar o visual)
  const assets = useMemo(() => stageAssets(config, mode, shadow, def), [key, mode, shadow, def]); // eslint-disable-line react-hooks/exhaustive-deps
  const full = useMemo(() => fillConfig(config), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const bustVb = useMemo(() => (mode === 'bust' ? bustBoxFor(full) : undefined), [full, mode]);
  const layout = useMemo(() => stageLayout(mode, size, bustVb), [mode, size, bustVb]);
  const figure = useMemo(() => auraFigure(full, mode), [full, mode]);
  const colors = useMemo(() => resolveColors(full), [full]);
  const flag = useMemo(() => flagOf(full.prideFlag), [full]);
  const rig = assets.rig;
  const scene = rig.scene ?? null;
  const an = useMemo(() => buildAnatomy(full, scene), [full, scene]);
  const anchorSpec = useMemo<AnchorSpec>(() => {
    const ha = headAnchors(an);
    return { mouth: ha.mouth, headTop: ha.top, handL: [an.arm.xL, an.arm.handY], handR: [an.arm.xR, an.arm.handY], chest: [an.cx, an.shoulderY + 12], feet: [an.cx, an.foot.soleY] };
  }, [an]);
  // braço solto desta pessoa (de onde partem as animações de braço), como pose pra somar
  const restPose = useMemo(() => {
    const d = restArmDelta(an);
    const p = zero();
    p.armL.r = d.armL;
    p.armR.r = d.armR;
    p.foreL = { r: d.foreL };
    p.foreR = { r: d.foreR };
    return p;
  }, [an]);

  const loopOn = loop ?? def?.loop ?? false;
  const dur = Math.max(0.1, def?.dur ?? 1);
  const keyK = def?.keyK ?? 0;
  const altFaces = assets.altFaces;
  const hasProp = assets.hasProp;
  const hasHands = assets.hasHands;
  const auraOn = !!full.aura && full.aura !== 'none';
  const still = reduce || paused;

  // ---------------- relógio (thread de UI) ----------------
  const clock = useSharedValue(0);
  const te = useSharedValue(-1);
  const emPlaying = useSharedValue(false);
  const loopSV = useSharedValue(loopOn);
  const durSV = useSharedValue(dur);
  const endRef = useRef(onEmoteEnd);
  endRef.current = onEmoteEnd;
  const fireEnd = useCallback(() => endRef.current?.(), []);

  useEffect(() => {
    loopSV.value = loopOn;
    durSV.value = dur;
  }, [loopOn, dur, loopSV, durSV]);
  // animação nova ou replay: volta pro início
  useEffect(() => {
    te.value = def ? 0 : -1;
    if (progress) progress.value = 0;
  }, [def, replayToken, te, progress]);
  useEffect(() => {
    if (def && playing && !loopOn && te.value >= dur) te.value = 0; // tocar de novo depois do fim recomeça
    emPlaying.value = !!def && playing;
  }, [def, playing, loopOn, dur, replayToken, te, emPlaying]);
  // movimento reduzido: sem relógio, o fim da animação (sem loop) vem por tempo
  useEffect(() => {
    if (!reduce || !def || !playing || loopOn) return;
    const id = setTimeout(() => endRef.current?.(), dur * 1000);
    return () => clearTimeout(id);
  }, [reduce, def, playing, loopOn, dur, replayToken]);
  // movimento reduzido: as partículas mostram o quadro-chave parado (o relógio fica desligado)
  useEffect(() => {
    if (reduce && def) te.value = playing ? keyK * dur : 0;
  }, [reduce, def, playing, keyK, dur, replayToken, te]);

  const frame = useCallback(
    (info: FrameInfo) => {
      'worklet';
      const prev = info.timeSincePreviousFrame;
      const dt = prev == null ? 0 : Math.min(0.05, prev / 1000);
      clock.value += dt;
      if (emPlaying.value && te.value >= 0) {
        const D = durSV.value;
        let n = te.value + dt;
        if (!loopSV.value && n >= D) {
          n = D;
          emPlaying.value = false;
          runOnJS(fireEnd)();
        }
        te.value = n;
        if (progress) progress.value = loopSV.value ? (n % D) / D : Math.min(1, n / D);
      }
    },
    [clock, te, emPlaying, loopSV, durSV, fireEnd, progress],
  );
  const fc = useFrameCallback(frame, false);
  const shouldRun = !paused && !reduce && ((!!def && playing) || idle || auraOn);
  // (o próprio useFrameCallback desregistra o relógio ao desmontar)
  useEffect(() => {
    fc.setActive(shouldRun);
  }, [fc, shouldRun]);

  // ---------------- pose ----------------
  const breathing = idle && !reduce;
  const pose = useDerivedValue<Pose>(() => {
    const tE = te.value;
    const D = durSV.value;
    const lp = loopSV.value;
    const v = NEUTRAL_VARIATION;
    let p: Pose = zero();
    let active = false;
    let w = 0;
    if (def) {
      if (reduce) {
        active = emPlaying.value;
        if (active) {
          p = def.pose(keyK, keyK * D, v);
          w = 1;
        }
      } else if (tE > 0 && (lp || tE < D)) {
        active = true;
        const k = lp ? (tE % D) / D : Math.min(1, tE / D);
        let ep = def.pose(k, tE, v);
        if (lp && k > 1 - SEAM) ep = blend(ep, def.pose(0, tE, v), (k - (1 - SEAM)) / SEAM);
        const fadeIn = easeOut(Math.min(1, tE / FADE_S));
        const fadeOut = lp ? 1 : 1 - easeInOut(clamp((tE - (D - FADE_S)) / FADE_S, 0, 1));
        w = fadeIn * fadeOut;
        p = blend(zero(), ep, w);
      }
    }
    const arms = active && !!def && def.usesArms;
    if (arms) p = addPose(p, restPose, w);
    if (breathing) p = addPose(p, breathe(clock.value, v));
    if (!arms || w >= 1) return applyScene(p, scene, clock.value, { usesArms: arms });
    // entrando/saindo de animação de braço: mistura a cena de mãos ocupadas (volante, colo) com a de mãos livres pelo
    // peso da animação — os braços saem do volante/colo e o pet desce do colo sem salto (igual ao mapa, draw.ts)
    return blend(applyScene(p, scene, clock.value, { usesArms: false }), applyScene(p, scene, clock.value, { usesArms: true }), w);
  }, [def, reduce, breathing, scene, keyK, restPose]);

  // troca de expressão, de objeto e de mão
  const swap = useDerivedValue(() => {
    const tE = te.value;
    const D = durSV.value;
    const lp = loopSV.value;
    if (!def) return { face: -1, prop: false, hands: false };
    const active = reduce ? emPlaying.value : tE > 0 && (lp || tE < D);
    if (!active) return { face: -1, prop: false, hands: false };
    const k = reduce ? keyK : lp ? (tE % D) / D : Math.min(1, tE / D);
    const f = emoteFaceAt(def, k);
    return { face: f == null ? -1 : altFaces.indexOf(f), prop: hasProp, hands: hasHands };
  }, [def, reduce, keyK, altFaces, hasProp, hasHands]);

  // uma matriz por grupo (número fixo de hooks)
  const mats: Record<AvatarGroup, SharedValue<number[]>> = {
    shadow: useGroupMatrix('shadow', rig, pose),
    body: useGroupMatrix('body', rig, pose),
    head: useGroupMatrix('head', rig, pose),
    armL: useGroupMatrix('armL', rig, pose),
    armR: useGroupMatrix('armR', rig, pose),
    foreL: useGroupMatrix('foreL', rig, pose),
    foreR: useGroupMatrix('foreR', rig, pose),
    legL: useGroupMatrix('legL', rig, pose),
    legR: useGroupMatrix('legR', rig, pose),
    shinL: useGroupMatrix('shinL', rig, pose),
    shinR: useGroupMatrix('shinR', rig, pose),
    mount: useGroupMatrix('mount', rig, pose),
    pet: useGroupMatrix('pet', rig, pose),
  };

  // âncoras dos efeitos (só recalcula por quadro se a animação tem partículas)
  const hasFx = !!def?.fx?.length;
  const base = layout.base;
  const staticAnchors = useMemo(() => computeAnchors(rig, zero(), anchorSpec, base), [rig, anchorSpec, base]);
  const anchors = useDerivedValue<StageAnchors>(() => (hasFx ? computeAnchors(rig, pose.value, anchorSpec, base) : staticAnchors), [hasFx, rig, anchorSpec, base, staticAnchors]);

  const pron = useMemo(() => {
    if (!showPronouns || !full.pronouns || full.pronouns === 'none') return null;
    const fn = avatarPronounsLabel as unknown;
    return typeof fn === 'function' ? (fn as (id: string) => string | null)(full.pronouns) : null;
  }, [showPronouns, full]);
  const label = accessibilityLabel ?? (pron ? `Avatar, pronomes ${pron}` : 'Avatar');
  const box = { w: layout.w, h: layout.h };

  return (
    <View
      style={[{ width: layout.w, height: layout.h }, style]}
      {...(decorative ? { accessible: false, importantForAccessibility: 'no-hide-descendants' as const } : { accessible: true, accessibilityRole: 'image' as const, accessibilityLabel: label })}
    >
      <Canvas style={{ width: layout.w, height: layout.h }} pointerEvents="none">
        {showBackdrop ? <BackdropFx backdrop={full.backdrop} flag={flag} box={box} radius={mode === 'bust' ? layout.w / 2 : 24} t={clock} still={still} /> : null}
        <AuraFx aura={full.aura} tint={colors.aura} level={(full.auraLevel as AuraLevel) || 'medium'} flag={flag} box={box} body={layout.body} t={clock} still={still} layer="back" figure={figure} bust={mode === 'bust'} bustVb={bustVb} />
        <Group matrix={base}>
          {/* key com grupo e papel: se a lista desloca (config nova), a corrida remonta com a matriz do grupo certo */}
          {assets.runs.map((run, i) => (run.role === 'n' ? <StaticRun key={`${run.g}|n|${i}`} run={run} mat={mats[run.g]} /> : <SwapRun key={`${run.g}|${run.role}|${i}`} run={run} mat={mats[run.g]} swap={swap} />))}
        </Group>
        <AuraFx aura={full.aura} tint={colors.aura} level={(full.auraLevel as AuraLevel) || 'medium'} flag={flag} box={box} body={layout.body} t={clock} still={still} layer="front" figure={figure} bust={mode === 'bust'} bustVb={bustVb} />
        <EmoteFx def={def} t={te} anchors={anchors} still={still} />
      </Canvas>
      {pron ? (
        <View style={layout.h >= 260 ? styles.pron : styles.pronLow} pointerEvents="none">
          <PronounTag pronouns={pron} size={layout.h >= 260 ? 'md' : 'sm'} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pron: { position: 'absolute', top: 2, left: 0, right: 0, alignItems: 'center' },
  // palco pequeno: em cima a placa cobriria a cabeça/chapéu — vai pro pé
  pronLow: { position: 'absolute', bottom: 2, left: 0, right: 0, alignItems: 'center' },
});

export const AvatarStage = memo(AvatarStageInner);
