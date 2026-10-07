// Fundo do palco (elementos Skia dentro do Canvas do AvatarStage). Dono: efeitos.
//
// Os 15 fundos moram em fx-backdrops.ts. Cada um tem três partes: a de trás e a da frente são paradas e ficam gravadas
// UMA vez (SkPicture no JS, por fundo e tamanho); só a do meio (nuvens, estrelas, confete, holofotes…) é regravada na
// thread de UI quando o relógio `t` anda (o palco só o avança nas janelas vivas, a FX_FPS). Nada de re-render por quadro.
//
// Contrato:
//   - backdrop = id do slot `backdrop` ('none' = nada); flag = bandeira da config (fundo 'pride');
//   - box = canvas inteiro {w,h}; radius = raio dos cantos (busto: metade do lado = círculo);
//   - t = s desde o começo da janela viva (desenha spec.still + t: sem salto ao começar); still = parado: quadro
//     escolhido por fundo. Sem Math.random por quadro.

import { Group, Picture, Skia, type SkPicture } from '@shopify/react-native-skia';
import React, { useMemo } from 'react';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import type { FlagDef } from '../../../avatar/parts/flags';

import { FX_CAN_RECORD } from './AuraFx';
import { backdropSpec, drawBackdropStage, type BackdropSpec } from './fx-backdrops';
import { SHAPES } from './fx-shapes';
import { skiaPen } from './fx-skia';

export interface BackdropFxProps {
  backdrop: string;
  flag: FlagDef;
  box: { w: number; h: number };
  radius: number;
  t: SharedValue<number>;
  still: boolean;
}

function recordPart(spec: BackdropSpec, box: { w: number; h: number }, radius: number, t: number, part: number): SkPicture {
  const rec = Skia.PictureRecorder();
  const canvas = rec.beginRecording(Skia.XYWHRect(0, 0, box.w, box.h));
  drawBackdropStage(skiaPen(canvas, SHAPES, false), spec, box, radius, t, part);
  return rec.finishRecordingAsPicture();
}

export function BackdropFx({ backdrop, flag, box, radius, t, still }: BackdropFxProps) {
  const w = box.w;
  const h = box.h;
  const spec = useMemo(() => (FX_CAN_RECORD ? backdropSpec(backdrop, flag, { w, h }) : null), [backdrop, flag, w, h]);
  const fixed = useMemo(() => (spec ? { back: recordPart(spec, { w, h }, radius, spec.still, 0), front: recordPart(spec, { w, h }, radius, spec.still, 2) } : null), [spec, w, h, radius]);
  const shapes = SHAPES;
  const mid = useDerivedValue<SkPicture | null>(() => {
    if (!spec) return null;
    const rec = Skia.PictureRecorder();
    const canvas = rec.beginRecording(Skia.XYWHRect(0, 0, w, h));
    drawBackdropStage(skiaPen(canvas, shapes, false), spec, { w, h }, radius, still ? spec.still : spec.still + t.value, 1);
    return rec.finishRecordingAsPicture();
  }, [spec, still, w, h, radius]);
  if (!spec || !fixed) return null;
  return (
    <Group>
      <Picture picture={fixed.back} />
      <Picture picture={mid as SharedValue<SkPicture>} />
      <Picture picture={fixed.front} />
    </Group>
  );
}
