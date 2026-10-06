// Partículas das animações (corações, beijo, notas, brilhos, confete, estrelas, bolhas, flash, fogos, "HA", pétalas)
// dentro do Canvas do AvatarStage. Dono: gestos. O desenho mora em avatar/emotes/gestures-fx.ts (caneta de fx-core);
// aqui só a ligação com o palco: uma SkPicture gravada por quadro NA THREAD DE UI (useDerivedValue lendo t e as âncoras),
// sem re-render do React.
//
// Contrato:
//   - def = animação atual (def.fx = efeitos com janela start..end no progresso, taxa em partículas/s, âncora);
//   - t = segundos desde o início da animação (SharedValue; ≤ 0 = parada/sem animação: não desenha nada; sem loop,
//     t ≥ dur = acabou: nada);
//   - anchors = posição de cada âncora em px do canvas, recalculada a cada quadro na thread de UI (SharedValue);
//   - still = movimento reduzido/pausado: nada se mexe sozinho — o quadro é função só de t, então com t congelado o
//     desenho fica parado (o palco passa t = keyK·dur no movimento reduzido pra mostrar o quadro-chave);
//   - no máximo 32 partículas vivas, sementes fixas (nada de Math.random), sem setState por quadro.

import { Picture, Skia, type SkPicture } from '@shopify/react-native-skia';
import React, { useMemo } from 'react';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import { EMOTE_SHAPES, drawEmoteFx, emoteFxSpec } from '../../../avatar/emotes/gestures-fx';
import type { EmoteDef } from '../../../avatar/emotes/types';

import { FX_CAN_RECORD } from './AuraFx';
import type { StageAnchors } from './anchors';
import { skiaPen } from './fx-skia';

export interface EmoteFxProps {
  def: EmoteDef | null;
  t: SharedValue<number>;
  anchors: SharedValue<StageAnchors>;
  still: boolean;
}

/** área de gravação (só uma dica de recorte pro Skia; as partículas ficam perto do avatar) */
const BOUNDS = { x: -512, y: -512, w: 4096, h: 4096 };

export function EmoteFx({ def, t, anchors, still }: EmoteFxProps) {
  const spec = useMemo(() => (FX_CAN_RECORD ? emoteFxSpec(def) : null), [def]);
  const shapes = EMOTE_SHAPES;
  const picture = useDerivedValue<SkPicture | null>(() => {
    if (!spec) return null;
    const rec = Skia.PictureRecorder();
    const canvas = rec.beginRecording(Skia.XYWHRect(BOUNDS.x, BOUNDS.y, BOUNDS.w, BOUNDS.h));
    drawEmoteFx(skiaPen(canvas, shapes, false), spec, t.value, anchors.value, still);
    return rec.finishRecordingAsPicture();
  }, [spec, still]);
  if (!spec) return null;
  return <Picture picture={picture as SharedValue<SkPicture>} />;
}
