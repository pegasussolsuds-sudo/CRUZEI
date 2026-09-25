import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '@cruzei/ui-mobile';
import { proximityBandLabel } from '@cruzei/shared-utils';
import type { NearbyUser, ProximityBand } from '@cruzei/shared-types';
import { Pulse } from '../animated/Pulse';
import { ScaleOnPress } from '../animated/ScaleOnPress';
import { IdentityBubble } from '../identity/IdentityBubble';
import { resolveAvatar } from '../../avatar';

export interface PersonRowProps {
  user: NearbyUser;
  /** faixa de proximidade (vem do servidor) — o app nunca mostra metros de outra pessoa */
  band: ProximityBand | null;
  onPress?: (user: NearbyUser) => void;
  /** dica de acessibilidade do toque (default: 'Mostra no mapa') */
  pressHint?: string;
  onLike: (user: NearbyUser) => void;
  onSuperLike: (user: NearbyUser) => void;
  onPass: (user: NearbyUser) => void;
  /** destaque (ex.: card do selecionado) */
  highlighted?: boolean;
}

/** 'bem perto' | 'perto' | 'na região' | 'por perto' (brief PRIVACIDADE: nunca metros de outra pessoa) */
export function proximityLabel(band: ProximityBand | null | undefined, anonymous: boolean): string {
  if (anonymous) return 'por perto';
  return proximityBandLabel(band);
}

/** presença sem horário (privacidade): online agora / esteve aqui há pouco / esteve por aqui */
export function presenceLabel(user: Pick<NearbyUser, 'isOnline' | 'lastSeen'>): string {
  if (user.isOnline || user.lastSeen === 'online') return 'Online agora';
  if (user.lastSeen === 'recent') return 'Esteve aqui há pouco';
  return 'Esteve por aqui';
}

/** online = lima; recente = dourado; mais cedo = neutro (a borda mantém significado) */
function borderColorFor(user: NearbyUser): string {
  if (user.isAnonymous) return colors.gray[400];
  if (user.isOnline) return colors.primary;
  return user.lastSeen === 'recent' ? colors.accent : colors.gray[300];
}

function PersonRowInner({ user, band, onPress, pressHint = 'Mostra no mapa', onLike, onSuperLike, onPass, highlighted = false }: PersonRowProps) {
  const avatar = resolveAvatar(user.avatar, user.id);
  const nameAge = user.age ? `${user.name}, ${user.age}` : user.name;
  const distance = proximityLabel(band, user.isAnonymous);
  const presence = presenceLabel(user);
  const a11y = `${nameAge}, ${distance}, ${presence}${user.isVerified ? ', verificado' : ''}${user.isBoosted ? ', com boost' : ''}`;

  return (
    // raiz NÃO acessível: senão iOS agrupa e os botões Curtir/Super/Passar somem do VoiceOver (e o TalkBack lê em dobro).
    // O nó acessível é o bloco de info (nome/distância/presença); os botões são irmãos alcançáveis.
    <Pressable onPress={onPress ? () => onPress(user) : undefined} accessible={false} style={[styles.row, highlighted && styles.rowHighlighted]}>
      <View style={[styles.photoWrap, { borderColor: borderColorFor(user) }]}>
        {user.isAnonymous ? (
          <View style={[styles.photo, styles.photoAnon]}>
            <Ionicons name="glasses" size={22} color={colors.white} />
          </View>
        ) : (
          <IdentityBubble photoUrl={user.mapPhotoUrl} avatar={avatar} size={PHOTO} name={user.name} ring="none" badge={user.matchId ? 'match' : user.isNew ? 'new' : null} accessible={false} />
        )}
      </View>

      <View
        style={styles.info}
        accessible
        accessibilityRole={onPress ? 'button' : 'text'}
        accessibilityLabel={a11y}
        accessibilityHint={onPress ? pressHint : undefined}
      >
        <View style={styles.nameLine}>
          <Text style={styles.name} numberOfLines={1}>
            {nameAge}
          </Text>
          {user.isVerified ? (
            <Ionicons name="checkmark-circle" size={16} color={colors.info} accessibilityLabel="verificado" style={styles.badge} />
          ) : null}
          {user.premiumTier === 'premium_plus' ? (
            <Text style={styles.badge} accessibilityLabel="premium plus">
              💎
            </Text>
          ) : null}
          {user.isBoosted ? (
            <Text style={styles.badge} accessibilityLabel="boost ativo">
              ⚡
            </Text>
          ) : null}
        </View>
        <Text style={styles.meta} numberOfLines={1}>
          📍 {distance}
          {user.poi?.name ? ` · ${user.poi.name}` : ''}
        </Text>
        <View style={styles.statusLine}>
          {user.isOnline ? (
            <Pulse active maxScale={1.2} style={styles.dotWrap}>
              <View style={styles.dot} />
            </Pulse>
          ) : (
            <Ionicons name="time-outline" size={12} color={colors.gray[500]} style={styles.dotWrap} />
          )}
          <Text style={[styles.status, user.isOnline && styles.statusOnline]} numberOfLines={1}>
            {presence}
          </Text>
        </View>
      </View>

      <View style={styles.actions}>
        {user.isAnonymous ? (
          <Text style={styles.anonNote} numberOfLines={2}>
            em modo anônimo
          </Text>
        ) : (
          <>
            <ScaleOnPress
              onPress={() => onLike(user)}
              accessibilityRole="button"
              accessibilityLabel={`Curtir ${user.name}`}
              style={[styles.actionBtn, styles.likeBtn]}
              glowColor={colors.primary}
            >
              <Ionicons name="heart" size={20} color={colors.black} />
            </ScaleOnPress>
            <ScaleOnPress
              onPress={() => onSuperLike(user)}
              accessibilityRole="button"
              accessibilityLabel={`Super curtir ${user.name}`}
              style={[styles.actionBtn, styles.superBtn]}
              glowColor={colors.accent}
            >
              <Ionicons name="star" size={18} color={colors.black} />
            </ScaleOnPress>
          </>
        )}
        <ScaleOnPress
          onPress={() => onPass(user)}
          accessibilityRole="button"
          accessibilityLabel={`Passar ${user.name}`}
          style={[styles.actionBtn, styles.passBtn]}
        >
          <Ionicons name="close" size={20} color={colors.danger} />
        </ScaleOnPress>
      </View>
    </Pressable>
  );
}

export const PersonRow = memo(PersonRowInner);

const PHOTO = 48;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 72,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  rowHighlighted: { backgroundColor: colors.surfaceAlt, borderRadius: radius.lg },
  photoWrap: { width: PHOTO + 6, height: PHOTO + 6, borderRadius: (PHOTO + 6) / 2, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  photo: { width: PHOTO, height: PHOTO, borderRadius: PHOTO / 2 },
  photoAnon: { backgroundColor: colors.gray[400], alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1, minWidth: 0 },
  nameLine: { flexDirection: 'row', alignItems: 'center' },
  name: { ...typography.h4, color: colors.black, flexShrink: 1 },
  badge: { marginLeft: spacing.xs, fontSize: 13 },
  meta: { ...typography.bodySmall, color: colors.gray[600], marginTop: 2 },
  statusLine: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  dotWrap: { width: 12, height: 12, alignItems: 'center', justifyContent: 'center', marginRight: spacing.xs },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  status: { ...typography.caption, color: colors.gray[500] },
  statusOnline: { color: colors.gray[700] },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  actionBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  likeBtn: { backgroundColor: colors.primary },
  superBtn: { backgroundColor: colors.accent },
  passBtn: { borderWidth: 2, borderColor: colors.danger, backgroundColor: colors.surface },
  anonNote: { ...typography.caption, color: colors.gray[500], maxWidth: 72, textAlign: 'right' },
});
