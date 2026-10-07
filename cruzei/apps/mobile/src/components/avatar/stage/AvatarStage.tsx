// Palco animado do avatar (Skia + Reanimated): telas grandes (perfil, editor, match, prévia de animação).
// Listas e miniaturas NUNCA usam o palco (usam o <CruzeiAvatar/> estático, por desempenho).
//
// Como funciona (sem re-render por quadro):
//   - no JS, uma vez por visual (stageAssets): camadas da config + expressões/objeto alternativos da animação,
//     gravadas em SkPictures por corrida (grupo + papel), com cache por avatarKey; logo depois (fora do render) cada
//     corrida vira um sprite (stageSprites: imagem de CPU na escala da tela). Por quadro só se desenham imagens com
//     matriz — tocar as SkPictures por quadro refazia ~250–350 paths (metade com desfoque) na thread de UI;
//   - na thread de UI: um relógio (useFrameCallback) → pose (animação + respiração + cena) → uma matriz por grupo do
//     esqueleto (número fixo de hooks, mesma matemática do avatar/rig.ts) → <Group matrix> de cada corrida. Troca de
//     expressão/objeto = corrida alternativa entra, a outra sai (a matriz de quem não aparece manda o desenho pra
//     fora do canvas: sem saveLayer e sem re-render);
//   - o relógio SÓ roda quando há o que animar: animação tocando, respiração pedida (idle, padrão desligado) ou a
//     janela curta da aura/fundo (FX_SHOW_MS depois de trocar a aura/fundo com fxPreview, só o editor; ou enquanto a
//     animação toca). Parado, o canvas não redesenha nada. Aura e fundo regravam no máximo a FX_FPS (30) e só nessas
//     janelas; fora delas, o quadro parado escolhido a dedo (gravado uma vez);
//   - movimento reduzido: sem respiração, a animação mostra o quadro keyK parado, auras paradas (nada anima sozinho);
//   - animações que mexem os braços partem do braço SOLTO da pessoa (restArmDelta da anatomia, somado com o mesmo peso
//     da entrada/saída) e trocam a mão pela aberta quando pedem (emoteHands).
//
// Desenho, de trás pra frente: <BackdropFx/> · <AuraFx layer='back'/> · avatar posado · <AuraFx layer='front'/> ·
// <EmoteFx/> · placa de pronomes por cima, em RN (<PronounTag/>).
// Enquadramento (layout.ts): avatar na caixa interna de 86%, aura transborda; full = canvas size × 0.8·size.

import type { AvatarConfig } from '@cruzei/shared-types';
import { avatarPronounsLabel } from '@cruzei/shared-utils';
import { Canvas, FilterMode, Group, Image as SkiaImage, MipmapMode, Picture } from '@shopify/react-native-skia';
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PixelRatio, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
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
import { holdStage, peekStageSprites, stageAssets, stageSprites, type StageAssets, type StageRun, type StageSprite } from './assets';
import { auraFigure } from './fx-auras';
import { snapToGrid, stageLayout } from './layout';
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
  /** respiração parada (padrão false: parado, o palco não redesenha nada) */
  idle?: boolean;
  /**
   * trocar aura/fundo abre a janela viva (FX_SHOW_MS) pra mostrar o efeito — só o editor pede. Fora dele a config muda
   * por fora (folha do mapa trocando de pessoa, /me chegando no Perfil) e isso não pode animar sozinho
   */
  fxPreview?: boolean;
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
/** aura/fundo animam por esta janela depois de trocar a aura ou o fundo (editor), depois voltam ao quadro parado */
export const FX_SHOW_MS = 4000;
/** quadros por segundo da aura/fundo vivos (a gravação da SkPicture é o que custa) */
export const FX_FPS = 30;
/** amostragem bilinear dos sprites (girando/escalando na animação); sem mipmap (o sprite já vem na escala da tela) */
const LINEAR = { filter: FilterMode?.Linear ?? 1, mipmap: MipmapMode?.None ?? 0 };

/**
 * matriz do grupo pra pose do quadro. `grid` = px da tela por unidade do viewBox: matriz só de translação (parado,
 * sentado na cena) cai num pixel inteiro, então o sprite parado sai nítido (sem borrão de amostragem bilinear)
 */
function useGroupMatrix(g: AvatarGroup, rig: AvatarRig, pose: SharedValue<Pose>, grid: number): SharedValue<number[]> {
  return useDerivedValue(() => mToSkia(snapToGrid(groupMatrix(g, rig, pose.value), grid)), [g, rig, grid]);
}

function StaticRun({ run, mat }: { run: StageRun; mat: SharedValue<number[]> }) {
  return (
    <Group matrix={mat}>
      <Picture picture={run.picture} />
    </Group>
  );
}

type Swap = SharedValue<{ face: number; prop: boolean; hands: boolean }>;

function SwapRun({ run, mat, swap }: { run: StageRun; mat: SharedValue<number[]>; swap: Swap }) {
  const role = run.role;
  const m = useDerivedValue(() => (roleVisible(role, swap.value.face, swap.value.prop, swap.value.hands) ? mat.value : OFF), [role, mat]);
  return (
    <Group matrix={m}>
      <Picture picture={run.picture} />
    </Group>
  );
}

function SpriteImage({ sp }: { sp: StageSprite }) {
  return <SkiaImage image={sp.img} x={sp.x} y={sp.y} width={sp.w} height={sp.h} fit="fill" sampling={LINEAR} />;
}

function StaticSprite({ sp, mat }: { sp: StageSprite; mat: SharedValue<number[]> }) {
  return (
    <Group matrix={mat}>
      <SpriteImage sp={sp} />
    </Group>
  );
}

function SwapSprite({ sp, mat, swap }: { sp: StageSprite; mat: SharedValue<number[]>; swap: Swap }) {
  const role = sp.role;
  const m = useDerivedValue(() => (roleVisible(role, swap.value.face, swap.value.prop, swap.value.hands) ? mat.value : OFF), [role, mat]);
  return (
    <Group matrix={m}>
      <SpriteImage sp={sp} />
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
    idle = false,
    fxPreview = false,
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
  // montado segura o cache do palco; o último a sair solta os sprites depois de STAGE_IDLE_MS
  useEffect(() => holdStage(), []);
  // key resume a config (o objeto pode mudar de identidade sem mudar o visual)
  const assets = useMemo(() => stageAssets(config, mode, shadow, def), [key, mode, shadow, def]); // eslint-disable-line react-hooks/exhaustive-deps
  const full = useMemo(() => fillConfig(config), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const bustVb = useMemo(() => (mode === 'bust' ? bustBoxFor(full) : undefined), [full, mode]);
  const layout = useMemo(() => stageLayout(mode, size, bustVb), [mode, size, bustVb]);
  const pr = PixelRatio.get() || 1;
  // origem do viewBox num pixel inteiro da tela: o sprite parado cai pixel a pixel (sem borrão de amostragem)
  const base = useMemo(() => {
    const b = layout.base.slice();
    b[2] = Math.round(b[2] * pr) / pr;
    b[5] = Math.round(b[5] * pr) / pr;
    return b;
  }, [layout, pr]);
  const spriteScale = layout.s * pr;
  // sprites: os do cache entram já; senão rasteriza logo depois do render (até lá o canvas toca as SkPictures)
  const [spriteState, setSpriteState] = useState<{ a: StageAssets; s: number; list: StageSprite[] | null } | null>(null);
  const peeked = peekStageSprites(assets, spriteScale);
  const sprites = peeked !== undefined ? peeked : spriteState && spriteState.a === assets && spriteState.s === spriteScale ? spriteState.list : null;
  useEffect(() => {
    if (peekStageSprites(assets, spriteScale) !== undefined) return;
    const id = setTimeout(() => setSpriteState({ a: assets, s: spriteScale, list: stageSprites(assets, spriteScale) }), 0);
    return () => clearTimeout(id);
  }, [assets, spriteScale]);
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
  const backdropOn = showBackdrop && !!full.backdrop && full.backdrop !== 'none';
  const still = reduce || paused;

  // ---------------- janela da aura/fundo vivos ----------------
  // trocou a aura/intensidade/cor ou o fundo com fxPreview (editor): anima FX_SHOW_MS e volta ao quadro parado. Na
  // montagem não, e sem fxPreview nunca.
  const fxKey = `${full.aura}|${full.auraLevel}|${colors.aura ?? ''}|${backdropOn ? full.backdrop : ''}`;
  const fxKeyRef = useRef(fxKey);
  const [fxShow, setFxShow] = useState(false);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (fxKeyRef.current === fxKey) return;
    fxKeyRef.current = fxKey;
    if (!fxPreview || still || (!auraOn && !backdropOn)) return;
    setFxShow(true);
    if (showTimer.current) clearTimeout(showTimer.current);
    showTimer.current = setTimeout(() => {
      showTimer.current = null;
      setFxShow(false);
    }, FX_SHOW_MS);
  }, [fxKey, fxPreview, still, auraOn, backdropOn]);
  useEffect(
    () => () => {
      if (showTimer.current) clearTimeout(showTimer.current);
    },
    [],
  );
  const emoteOn = !!def && playing;
  const fxLive = !still && (auraOn || backdropOn) && (fxShow || emoteOn);

  // ---------------- relógio (thread de UI) ----------------
  const clock = useSharedValue(0);
  /** relógio da aura/fundo (s desde o começo da janela viva, em degraus de 1/FX_FPS); 0 = quadro parado */
  const fxT = useSharedValue(0);
  const fxAcc = useSharedValue(0);
  const fxLiveSV = useSharedValue(false);
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
  useEffect(() => {
    fxLiveSV.value = fxLive;
    if (!fxLive) {
      fxAcc.value = 0;
      fxT.value = 0;
    }
  }, [fxLive, fxLiveSV, fxAcc, fxT]);
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
      if (fxLiveSV.value) {
        fxAcc.value += dt;
        const q = Math.floor(fxAcc.value * FX_FPS) / FX_FPS;
        if (q !== fxT.value) fxT.value = q;
      }
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
    [clock, te, emPlaying, loopSV, durSV, fireEnd, progress, fxLiveSV, fxAcc, fxT],
  );
  const fc = useFrameCallback(frame, false);
  const shouldRun = !paused && !reduce && (emoteOn || idle || fxLive);
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
    shadow: useGroupMatrix('shadow', rig, pose, spriteScale),
    body: useGroupMatrix('body', rig, pose, spriteScale),
    head: useGroupMatrix('head', rig, pose, spriteScale),
    armL: useGroupMatrix('armL', rig, pose, spriteScale),
    armR: useGroupMatrix('armR', rig, pose, spriteScale),
    foreL: useGroupMatrix('foreL', rig, pose, spriteScale),
    foreR: useGroupMatrix('foreR', rig, pose, spriteScale),
    legL: useGroupMatrix('legL', rig, pose, spriteScale),
    legR: useGroupMatrix('legR', rig, pose, spriteScale),
    shinL: useGroupMatrix('shinL', rig, pose, spriteScale),
    shinR: useGroupMatrix('shinR', rig, pose, spriteScale),
    mount: useGroupMatrix('mount', rig, pose, spriteScale),
    pet: useGroupMatrix('pet', rig, pose, spriteScale),
  };

  // âncoras dos efeitos (só recalcula por quadro se a animação tem partículas)
  const hasFx = !!def?.fx?.length;
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
        {showBackdrop ? <BackdropFx backdrop={full.backdrop} flag={flag} box={box} radius={mode === 'bust' ? layout.w / 2 : 24} t={fxT} still={!fxLive} /> : null}
        <AuraFx aura={full.aura} tint={colors.aura} level={(full.auraLevel as AuraLevel) || 'medium'} flag={flag} box={box} body={layout.body} t={fxT} still={!fxLive} layer="back" figure={figure} bust={mode === 'bust'} bustVb={bustVb} />
        <Group matrix={base}>
          {/* key com grupo e papel: se a lista desloca (config nova), a corrida remonta com a matriz do grupo certo */}
          {sprites
            ? sprites.map((sp, i) => (sp.role === 'n' ? <StaticSprite key={`${sp.g}|n|${i}`} sp={sp} mat={mats[sp.g]} /> : <SwapSprite key={`${sp.g}|${sp.role}|${i}`} sp={sp} mat={mats[sp.g]} swap={swap} />))
            : assets.runs.map((run, i) => (run.role === 'n' ? <StaticRun key={`${run.g}|n|${i}`} run={run} mat={mats[run.g]} /> : <SwapRun key={`${run.g}|${run.role}|${i}`} run={run} mat={mats[run.g]} swap={swap} />))}
        </Group>
        <AuraFx aura={full.aura} tint={colors.aura} level={(full.auraLevel as AuraLevel) || 'medium'} flag={flag} box={box} body={layout.body} t={fxT} still={!fxLive} layer="front" figure={figure} bust={mode === 'bust'} bustVb={bustVb} />
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
