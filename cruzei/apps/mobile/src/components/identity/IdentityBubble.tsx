import React, { memo, useState } from 'react';
import { Image, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors } from '@cruzei/ui-mobile';
import type { AvatarConfig } from '@cruzei/shared-types';
import { CruzeiAvatar } from '../avatar/CruzeiAvatar';

export type IdentityRing = 'none' | 'default' | 'online' | 'boost' | 'match' | 'selected' | 'anon';
export type IdentityBadge = 'new' | 'match' | null;

export interface IdentityBubbleProps {
  /** thumbnail da foto; null/erro → busto do avatar (a foto nunca é obrigatória) */
  photoUrl: string | null;
  avatar: AvatarConfig;
  size: number;
  /** nome (acessibilidade) */
  name: string;
  /** 'none' quando o pai já desenha a borda (ex.: linha da lista) */
  ring?: IdentityRing;
  /** ponto verde de presença */
  online?: boolean;
  badge?: IdentityBadge;
  /** false quando o pai já descreve a pessoa pro leitor de tela (evita "Avatar de X" duas vezes) */
  accessible?: boolean;
  style?: StyleProp<ViewStyle>;
}

const RING_COLOR: Record<Exclude<IdentityRing, 'none'>, string> = {
  default: 'rgba(250,250,250,0.9)',
  online: colors.primary,
  boost: colors.accent,
  match: colors.secondary,
  selected: colors.primary,
  anon: colors.gray[400],
};

/**
 * Bolha de identidade (brief FOTO AVATAR): a MESMA composição da bolha do mapa dentro do app — foto real circular com
 * borda por estado, ponto de presença e selo (novo ✦ / match ♥). Enquanto a foto carrega (ou se falhar) mostra o busto
 * do avatar, então nunca fica um círculo vazio. Reutilizada nas sheets de pessoa/lugar e nas listas.
 *
 * Sem `overflow: hidden` + borda + raio no mesmo View de propósito: essa combinação clipando uma Image com raio próprio
 * derruba o HWUI (SIGSEGV em libhwui drawRRect) em Androids Motorola/MediaTek. Aqui a Image arredonda no Fresco, o
 * busto SVG já é circular e o anel é um View só de traço por cima.
 */
function IdentityBubbleInner({ photoUrl, avatar, size, name, ring = 'default', online = false, badge = null, accessible = true, style }: IdentityBubbleProps) {
  // estado amarrado à URL: trocar de foto volta pro avatar até a nova carregar (sem frame em branco nem "loaded" falso)
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showPhoto = Boolean(photoUrl) && failedUrl !== photoUrl;
  const loaded = showPhoto && loadedUrl === photoUrl;
  const border = Math.max(2, Math.round(size / 24));
  const dot = Math.max(8, Math.round(size / 5));
  const badgeSize = Math.max(14, Math.round(size / 3.4));
  const radius = size / 2;
  const state = [online ? 'online' : null, badge === 'match' ? 'match' : badge === 'new' ? 'novo por aqui' : null].filter(Boolean).join(', ');
  const label = `${showPhoto ? 'Foto' : 'Avatar'} de ${name}${state ? `, ${state}` : ''}`;

  return (
    <View
      style={[{ width: size, height: size }, style]}
      accessible={accessible}
      importantForAccessibility={accessible ? 'auto' : 'no-hide-descendants'}
      accessibilityRole={accessible ? 'image' : undefined}
      accessibilityLabel={accessible ? label : undefined}
    >
      {/* avatar por baixo: aparece enquanto a foto carrega e fica se ela falhar (o busto já é um círculo fechado) */}
      {!loaded ? <CruzeiAvatar config={avatar} mode="bust" size={size} backgroundColor={colors.surfaceAlt} /> : null}
      {showPhoto ? (
        <Image
          source={{ uri: photoUrl as string }}
          style={[StyleSheet.absoluteFill, { width: size, height: size, borderRadius: radius }]}
          resizeMode="cover"
          onLoad={() => setLoadedUrl(photoUrl)}
          onError={() => setFailedUrl(photoUrl)}
          accessible={false}
        />
      ) : null}
      {ring !== 'none' ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, borderWidth: border, borderColor: RING_COLOR[ring] }]} /> : null}
      {online ? <View style={[styles.dot, { width: dot, height: dot, borderRadius: dot / 2, right: -1, bottom: -1 }]} /> : null}
      {badge ? (
        <View style={[styles.badge, { width: badgeSize, height: badgeSize, borderRadius: badgeSize / 2, backgroundColor: badge === 'match' ? colors.secondary : colors.accent }]}>
          <Text style={[styles.badgeText, { fontSize: Math.round(badgeSize * 0.6) }]}>{badge === 'match' ? '♥' : '✦'}</Text>
        </View>
      ) : null}
    </View>
  );
}

export const IdentityBubble = memo(IdentityBubbleInner);

const styles = StyleSheet.create({
  dot: { position: 'absolute', backgroundColor: colors.primary, borderWidth: 2, borderColor: '#12122A' },
  badge: { position: 'absolute', left: -2, top: -2, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#12122A' },
  badgeText: { color: colors.black, fontWeight: '800' },
});
