// Aura do palco (elementos Skia dentro do Canvas do AvatarStage). Dono: efeitos.
//
// As 22 auras moram em fx-auras.ts (desenho contra a caneta de fx-core). Aqui só a ligação com o palco: uma SkPicture
// gravada NA THREAD DE UI (useDerivedValue lendo o relógio `t`), sem re-render do React. Parada (still), grava uma vez;
// viva, regrava a cada passo do relógio — o palco só avança `t` nas janelas curtas e a FX_FPS.
//
// Contrato:
//   - aura = id do slot `aura` ('none' = nada); tint = cor escolhida (null = cor original do efeito, 'a_auto');
//   - level = intensidade: partículas no máximo AURA_PARTICLES[level] (suave 12 / média 20 / intensa 32);
//   - flag = bandeira da config (aura 'pride' usa as cores dela);
//   - box = canvas inteiro {w,h} (a aura transborda a caixa do avatar); body = caixa do avatar no canvas;
//   - t = segundos desde o começo da janela viva (SharedValue, avança na thread de UI; o desenho parte do quadro parado,
//     spec.still + t, então começar a animar não dá salto); still = parado: quadro escolhido a dedo por aura
//     (AuraSpec.still), nada anima;
//   - layer: 'back' atrás do avatar, 'front' na frente (poucas partículas, sempre longe do rosto);
//   - figure (opcional): medidas da figura da config (auraFigure) — a aura acompanha a estatura e a cabeça de cada corpo;
//     sem ela vale o corpo médio. bust (opcional): o palco está no modo busto (padrão: deduz pela caixa quadrada).
//   - sem Math.random por quadro (sementes fixas), sem setState por quadro.

import { Picture, Skia, type SkPicture } from '@shopify/react-native-skia';
import React, { useMemo } from 'react';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import { AVATAR_BUST_VIEWBOX } from '../../../avatar/layers';
import type { FlagDef } from '../../../avatar/parts/flags';

import { AURA_BASE, AURA_PARTICLES, DEFAULT_FIGURE, auraFrame, auraSpec, drawAura, type AuraFigure, type AuraLevel } from './fx-auras';
import { SHAPES } from './fx-shapes';
import { skiaPen } from './fx-skia';
import type { StageBox } from './layout';

export { AURA_BASE, AURA_PARTICLES, type AuraLevel };

export interface AuraFxProps {
  aura: string;
  tint: string | null;
  level: AuraLevel;
  flag: FlagDef;
  box: { w: number; h: number };
  body: StageBox;
  t: SharedValue<number>;
  still: boolean;
  layer: 'back' | 'front';
  figure?: AuraFigure;
  bust?: boolean;
  /** recorte do busto da pessoa (bustBoxFor); padrão AVATAR_BUST_VIEWBOX */
  bustVb?: StageBox;
}

/** o Skia desta plataforma grava SkPicture (só falta nos mocks de teste que não trazem gravador) */
export const FX_CAN_RECORD = typeof (Skia as { PictureRecorder?: unknown } | undefined)?.PictureRecorder === 'function';

export function AuraFx({ aura, tint, level, flag, box, body, t, still, layer, figure, bust: bustIn, bustVb }: AuraFxProps) {
  const bust = bustIn ?? body.w / Math.max(1, body.h) > 0.9;
  const spec = useMemo(() => (FX_CAN_RECORD ? auraSpec(aura, tint, level, flag) : null), [aura, tint, level, flag]);
  const fig = figure ?? DEFAULT_FIGURE;
  const { x: bx, y: by, w: bw, h: bh } = body;
  const frame = useMemo(() => auraFrame({ w: box.w, h: box.h }, { x: bx, y: by, w: bw, h: bh }, bust ? (bustVb ?? AVATAR_BUST_VIEWBOX) : null, fig), [box.w, box.h, bx, by, bw, bh, bust, fig, bustVb]);
  const front = layer === 'front';
  const w = box.w;
  const h = box.h;
  const shapes = SHAPES;
  const picture = useDerivedValue<SkPicture | null>(() => {
    if (!spec) return null;
    const rec = Skia.PictureRecorder();
    const canvas = rec.beginRecording(Skia.XYWHRect(0, 0, w, h));
    drawAura(skiaPen(canvas, shapes, false), spec, frame, still ? spec.still : spec.still + t.value, front);
    return rec.finishRecordingAsPicture();
  }, [spec, frame, still, front, w, h]);
  if (!spec) return null;
  return <Picture picture={picture as SharedValue<SkPicture>} />;
}
