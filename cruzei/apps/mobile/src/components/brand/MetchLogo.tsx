import React from 'react';
import { View, type ViewProps } from 'react-native';
import { BRAND } from '../../brand';
import { MARK_BASE, MetchMark } from './MetchMark';
import { MetchWordmark, WORDMARK_BASELINE_FROM_CENTER } from './MetchWordmark';

export interface MetchLogoProps extends ViewProps {
  /** monograma ao lado do wordmark (row) ou acima dele (stack) */
  layout?: 'row' | 'stack';
  /** lado do monograma em px (default 40); o wordmark é proporcional */
  size?: number;
  /** tamanho da fonte do wordmark (default: 0.82×size em row, 0.5×size em stack) */
  wordmarkSize?: number;
  /** anima a entrada (traços desenhando + wordmark revelando) — default true */
  animated?: boolean;
  /** brilho que atravessa o wordmark: 'once' (default), 'loop' ou 'none' */
  shimmer?: 'none' | 'once' | 'loop';
  glow?: boolean;
  /** pausa halo e brilho (tela fora de foco) — nada redesenha por frame */
  paused?: boolean;
  delay?: number;
}

/**
 * Logo completo: monograma + wordmark, com a mesma coreografia em qualquer tela
 * (o wordmark começa a aparecer quando os traços do monograma se encontram).
 * Ex.: <MetchLogo layout="row" size={44} shimmer="loop" paused={!focused} />
 */
export function MetchLogo({
  layout = 'row',
  size = 40,
  wordmarkSize,
  animated = true,
  shimmer = 'once',
  glow = true,
  paused = false,
  delay = 0,
  style,
  ...rest
}: MetchLogoProps) {
  const row = layout === 'row';
  const ws = wordmarkSize ?? Math.round(size * (row ? 0.82 : 0.5));
  const drawMs = animated ? 800 : 0;
  // Em linha, alinha a linha de base das letras com a base do M. Com alignItems:'center' a margem move a caixa
  // pela metade, por isso o dobro: 2 × (base do M abaixo do centro − linha de base do wordmark abaixo do centro)
  const wordmarkOffset = Math.round(2 * ((MARK_BASE - 0.5) * size - WORDMARK_BASELINE_FROM_CENTER * ws));

  return (
    <View
      style={[row ? { flexDirection: 'row', alignItems: 'center', gap: Math.round(size * 0.12) } : { alignItems: 'center', gap: Math.round(size * 0.06) }, style]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={BRAND.name}
      {...rest}
    >
      <MetchMark size={size} animated={animated} drawMs={drawMs} delay={delay} glow={glow} paused={paused} accessible={false} />
      <MetchWordmark
        size={ws}
        animated={animated}
        autoShimmer={shimmer}
        glow={glow}
        paused={paused}
        delay={delay + Math.round(drawMs * 0.7)}
        accessible={false}
        style={row ? { marginTop: wordmarkOffset } : undefined}
      />
    </View>
  );
}
