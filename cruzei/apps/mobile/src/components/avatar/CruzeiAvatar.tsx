import React, { memo, useMemo } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import Svg, { Defs, Ellipse, Path, RadialGradient, Stop } from 'react-native-svg';
import type { AvatarConfig } from '@cruzei/shared-types';
import { AVATAR_BUST_VIEWBOX, AVATAR_VIEWBOX, buildAvatarLayers, keyOf } from '../../avatar';

export type AvatarMode = 'full' | 'bust';

export interface CruzeiAvatarProps {
  config: AvatarConfig;
  /** altura em px no modo full (largura = size * 100/140); lado no modo bust */
  size?: number;
  mode?: AvatarMode;
  /** sombra elíptica embaixo dos pés (só full) */
  groundShadow?: boolean;
  /** fundo circular atrás (bust) — cor ou undefined */
  backgroundColor?: string;
  style?: ViewStyle;
  accessibilityLabel?: string;
}

const AURA_COLORS: Record<string, string> = {
  lime: '#7FFF00',
  magenta: '#FF1493',
  gold: '#FFD700',
  fest: '#FF6FB1',
};

/**
 * Avatar Cruzei em vetor (react-native-svg). Mesmas camadas do mapa → identidade consistente em todo lugar.
 * `mode="bust"` recorta cabeça + ombros (listas, chat, perfil); `mode="full"` corpo inteiro (customizador, match).
 */
function CruzeiAvatarInner({ config, size = 64, mode = 'bust', groundShadow = false, backgroundColor, style, accessibilityLabel }: CruzeiAvatarProps) {
  const key = keyOf(config);
  const layers = useMemo(() => buildAvatarLayers(config, { groundShadow: groundShadow && mode === 'full' }), [key, groundShadow, mode]); // eslint-disable-line react-hooks/exhaustive-deps -- key resume a config
  const vb = mode === 'bust' ? AVATAR_BUST_VIEWBOX : AVATAR_VIEWBOX;
  const width = mode === 'bust' ? size : Math.round((size * vb.w) / vb.h);
  const height = size;
  const aura = AURA_COLORS[config.aura];
  const auraId = `aura-${key}`;

  return (
    <View
      style={[{ width, height }, backgroundColor ? { backgroundColor, borderRadius: mode === 'bust' ? size / 2 : 16, overflow: 'hidden' } : null, style]}
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel ?? 'Avatar'}
    >
      <Svg width={width} height={height} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} style={StyleSheet.absoluteFill}>
        {aura ? (
          <Defs>
            <RadialGradient id={auraId} cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor={aura} stopOpacity={0.55} />
              <Stop offset="70%" stopColor={aura} stopOpacity={0.18} />
              <Stop offset="100%" stopColor={aura} stopOpacity={0} />
            </RadialGradient>
          </Defs>
        ) : null}
        {aura ? (
          mode === 'bust' ? (
            <Ellipse cx={50} cy={38} rx={34} ry={34} fill={`url(#${auraId})`} />
          ) : (
            <Ellipse cx={50} cy={72} rx={52} ry={66} fill={`url(#${auraId})`} />
          )
        ) : null}
        {layers.map((l, i) => (
          <Path
            key={i}
            d={l.d}
            fill={l.f ?? 'none'}
            fillRule={l.r ?? 'nonzero'}
            stroke={l.s}
            strokeWidth={l.w}
            strokeLinecap={l.c ?? 'round'}
            strokeLinejoin="round"
            opacity={l.o ?? 1}
          />
        ))}
      </Svg>
    </View>
  );
}

export const CruzeiAvatar = memo(CruzeiAvatarInner);
