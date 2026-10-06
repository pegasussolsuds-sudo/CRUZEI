// Modelo SVG dos efeitos (fx-svg.ts) em react-native-svg: a aura e o fundo ESTÁTICOS do <CruzeiAvatar/> das listas.
// Dono: efeitos. `idp` prefixa os ids (único por instância), como no resto do CruzeiAvatar.

import React from 'react';
import { ClipPath, Defs, G, LinearGradient, Path, RadialGradient, Stop } from 'react-native-svg';

import type { FxSvgModel, FxSvgNode } from './fx-svg';

function paintOf(p: string | undefined, idp: string): string {
  if (!p) return 'none';
  return p.startsWith('url:') ? `url(#${idp}${p.slice(4)})` : p;
}

function node(n: FxSvgNode, i: number, idp: string): React.ReactElement {
  let el: React.ReactElement = (
    <Path
      key={i}
      d={n.d}
      fill={paintOf(n.fill, idp)}
      fillRule={n.eo ? 'evenodd' : undefined}
      stroke={n.stroke ? paintOf(n.stroke, idp) : undefined}
      strokeWidth={n.sw}
      strokeLinecap={n.cap}
      strokeLinejoin={n.stroke ? 'round' : undefined}
      opacity={n.o}
    />
  );
  if (n.clip) {
    for (let k = n.clip.length - 1; k >= 0; k--) {
      el = (
        <G key={i} clipPath={`url(#${idp}${n.clip[k]})`}>
          {el}
        </G>
      );
    }
  }
  return el;
}

/** defs (gradientes, recortes) + nós de um modelo de efeito */
export function FxSvgLayer({ model, idp }: { model: FxSvgModel; idp: string }) {
  return (
    <>
      {model.grads.length || model.clips.length ? (
        <Defs>
          {model.grads.map((g) => {
            const stops = g.stops.map((s, i) => <Stop key={i} offset={s.o} stopColor={s.c} stopOpacity={s.a} />);
            const units = g.bbox ? 'objectBoundingBox' : 'userSpaceOnUse';
            return g.kind === 'l' ? (
              <LinearGradient key={g.id} id={idp + g.id} gradientUnits={units} gradientTransform={g.tf} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2}>
                {stops}
              </LinearGradient>
            ) : (
              <RadialGradient key={g.id} id={idp + g.id} gradientUnits={units} gradientTransform={g.tf} cx={g.cx} cy={g.cy} r={g.r}>
                {stops}
              </RadialGradient>
            );
          })}
          {model.clips.map((c) => (
            <ClipPath key={c.id} id={idp + c.id}>
              <Path d={c.d} />
            </ClipPath>
          ))}
        </Defs>
      ) : null}
      {model.nodes.map((n, i) => node(n, i, idp))}
    </>
  );
}
