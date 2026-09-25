import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadows, spacing, typography } from '@cruzei/ui-mobile';
import { proximityBandLabel } from '@cruzei/shared-utils';
import type { NearbyUser, ProximityBand } from '@cruzei/shared-types';
import { api } from '../../services/api';
import { resolveAvatar } from '../../avatar';
import { CruzeiAvatar } from '../avatar/CruzeiAvatar';
import { IdentityBubble } from '../identity/IdentityBubble';
import { FadeInView } from '../animated/FadeInView';
import { Pulse } from '../animated/Pulse';
import { ScaleOnPress } from '../animated/ScaleOnPress';
import { presenceLabel } from './PersonRow';

// 56%: a composição foto + avatar (184 px) + chips + ações cabe em telas de ~640 dp sem cortar o "Ver perfil"
export const USER_SHEET_FRACTION = 0.56;
const SNAP_POINTS = ['56%'] as const;

interface UserCardLite {
  bio: string | null;
  interests: string[];
  photos: { url: string; thumbnailUrl?: string | null; isMain: boolean }[];
  placeName?: string | null;
}

export interface UserPreviewSheetHandle {
  close: () => void;
}

export interface UserPreviewSheetProps {
  user: NearbyUser | null;
  /** faixa de proximidade (do servidor) — nunca metros */
  band: ProximityBand | null;
  liked: boolean;
  waved: boolean;
  matchId: string | null;
  onLike: (user: NearbyUser) => void;
  onWave: (user: NearbyUser) => void;
  onChat: (matchId: string, user: NearbyUser) => void;
  onOpenProfile: (user: NearbyUser) => void;
  onClose: () => void;
}

/**
 * Perfil rápido no mapa (doc §5/§20): bottom sheet escuro com o avatar, distância aproximada, status,
 * interesses e as ações Curtir / Acenar (ou Match / Conversar). O mapa continua visível atrás —
 * sensação de continuidade do mundo. O perfil completo (fotos) fica um toque adiante.
 */
export const UserPreviewSheet = forwardRef<UserPreviewSheetHandle, UserPreviewSheetProps>(function UserPreviewSheet(
  { user, band, liked, waved, matchId, onLike, onWave, onChat, onOpenProfile, onClose },
  ref,
) {
  const sheetRef = useRef<React.ElementRef<typeof BottomSheet>>(null);
  useImperativeHandle(ref, () => ({ close: () => sheetRef.current?.close() }), []);

  useEffect(() => {
    if (user) sheetRef.current?.snapToIndex(0);
    else sheetRef.current?.close();
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // bio/interesses/foto vêm do cartão público (uma vez por pessoa; cache 5 min)
  const card = useQuery({
    queryKey: ['user-card-lite', user?.id],
    enabled: Boolean(user),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<UserCardLite> => {
      const res = await api.get<UserCardLite>(`/users/${user?.id}`);
      return res.data;
    },
  });

  const avatar = useMemo(() => (user ? resolveAvatar(user.avatar, user.id) : null), [user]);
  const onChange = useCallback(
    (index: number) => {
      if (index === -1) onClose();
    },
    [onClose],
  );

  const nameAge = user ? (user.age ? `${user.name}, ${user.age}` : user.name) : '';
  const distance = band ? `${proximityBandLabel(band)} de você` : 'por perto';
  const place = card.data?.placeName ?? user?.poi?.name ?? null;
  const mainPhoto = card.data?.photos?.find((p) => p.isMain)?.url ?? card.data?.photos?.[0]?.url ?? null;
  // bolha: thumbnail do mapa; sem ele, o thumb do cartão público (o perfil é público — a preferência vale pro MAPA).
  // Nunca a foto grande: sem thumbnail fica o busto do avatar.
  const cardMain = card.data?.photos?.find((p) => p.isMain) ?? card.data?.photos?.[0];
  const photo = user?.mapPhotoUrl ?? cardMain?.thumbnailUrl ?? null;
  const interests = card.data?.interests?.slice(0, 4) ?? [];

  return (
    <BottomSheet
      ref={sheetRef}
      index={-1}
      snapPoints={SNAP_POINTS}
      enablePanDownToClose
      onChange={onChange}
      handleIndicatorStyle={styles.handle}
      backgroundStyle={styles.bg}
      style={styles.sheet}
      enableDynamicSizing={false}
      accessibilityLabel={user ? `Perfil rápido de ${user.name}` : undefined}
    >
      <BottomSheetView style={styles.body}>
        {user && avatar ? (
          <View style={styles.content} key={user.id}>
            <View style={styles.top}>
              <FadeInView fromScale={0.9} fromY={10} style={styles.avatarWrap}>
                <View style={styles.avatarGlow} pointerEvents="none" />
                <CruzeiAvatar config={avatar} mode="full" size={128} groundShadow accessibilityLabel={`Avatar de ${user.name}`} />
                {/* a mesma bolha de identidade do mapa: foto = quem está por trás; avatar = como existe no Metch */}
                <IdentityBubble
                  photoUrl={photo}
                  avatar={avatar}
                  size={60}
                  name={user.name}
                  accessible={false}
                  online={user.isOnline}
                  ring={matchId ? 'match' : user.isBoosted ? 'boost' : user.isOnline ? 'online' : 'default'}
                  badge={matchId ? 'match' : user.isNew ? 'new' : null}
                  style={styles.bubble}
                />
                <View style={styles.bubbleTail} pointerEvents="none" />
              </FadeInView>
              <View style={styles.info}>
                <View style={styles.nameLine}>
                  <Text style={styles.name} numberOfLines={1} accessibilityRole="header">
                    {nameAge}
                  </Text>
                  {user.isVerified ? <Ionicons name="checkmark-circle" size={18} color={colors.info} accessibilityLabel="verificado" /> : null}
                  {user.premiumTier !== 'free' ? <Text style={styles.gem}>{user.premiumTier === 'premium_plus' ? '💎' : '⭐'}</Text> : null}
                </View>
                <View style={styles.statusLine}>
                  <Pulse active={user.isOnline} maxScale={1.25} style={styles.dotWrap}>
                    <View style={[styles.dot, !user.isOnline && styles.dotOff]} />
                  </Pulse>
                  <Text style={styles.status} numberOfLines={1}>
                    {presenceLabel(user)}
                  </Text>
                </View>
                <Text style={styles.distance} numberOfLines={1}>
                  📍 {distance}
                </Text>
                {place ? (
                  <Text style={styles.place} numberOfLines={1}>
                    Está no {place}
                  </Text>
                ) : null}
                {card.data?.bio ? (
                  <Text style={styles.bio} numberOfLines={2}>
                    {card.data.bio}
                  </Text>
                ) : null}
              </View>
            </View>

            {interests.length > 0 ? (
              <FadeInView delay={120} fromY={6} style={styles.chips}>
                {interests.map((it) => (
                  <View key={it} style={styles.chip}>
                    <Text style={styles.chipText}>{it}</Text>
                  </View>
                ))}
              </FadeInView>
            ) : null}

            <View style={styles.actions}>
              {matchId ? (
                <>
                  <View style={[styles.action, styles.actionMatch]} accessibilityLabel="Vocês deram match">
                    <Text style={styles.actionMatchText}>🔥 Match</Text>
                  </View>
                  <ScaleOnPress onPress={() => onChat(matchId, user)} accessibilityRole="button" accessibilityLabel="Conversar" style={[styles.action, styles.actionPrimary]} glowColor={colors.primary}>
                    <Text style={styles.actionPrimaryText}>💬 Conversar</Text>
                  </ScaleOnPress>
                </>
              ) : (
                <>
                  <ScaleOnPress
                    onPress={() => onLike(user)}
                    disabled={liked}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: liked }}
                    accessibilityLabel={liked ? 'Você já curtiu' : 'Curtir'}
                    style={[styles.action, liked ? styles.actionDone : styles.actionPrimary]}
                    glowColor={liked ? undefined : colors.primary}
                  >
                    <Text style={liked ? styles.actionDoneText : styles.actionPrimaryText}>{liked ? '❤️ Curtido' : '❤️ Curtir'}</Text>
                  </ScaleOnPress>
                  <ScaleOnPress
                    onPress={() => onWave(user)}
                    disabled={waved}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: waved }}
                    accessibilityLabel={waved ? 'Você já acenou hoje' : 'Acenar'}
                    style={[styles.action, styles.actionGhost, ...(waved ? [styles.actionDone] : [])]}
                  >
                    <Text style={waved ? styles.actionDoneText : styles.actionGhostText}>{waved ? '👋 Acenou' : '👋 Acenar'}</Text>
                  </ScaleOnPress>
                </>
              )}
              <ScaleOnPress onPress={() => sheetRef.current?.close()} accessibilityRole="button" accessibilityLabel="Fechar" style={styles.closeBtn}>
                <Ionicons name="close" size={20} color={colors.white} />
              </ScaleOnPress>
            </View>

            <Pressable onPress={() => onOpenProfile(user)} accessibilityRole="button" accessibilityLabel="Ver perfil completo" style={styles.profileLink}>
              {mainPhoto ? <View style={styles.photoDot} /> : null}
              <Text style={styles.profileLinkText}>Ver perfil completo{mainPhoto ? ' e fotos' : ''}</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.primary} />
            </Pressable>
          </View>
        ) : null}
      </BottomSheetView>
    </BottomSheet>
  );
});

const BG = '#12122A';

const styles = StyleSheet.create({
  sheet: { ...shadows.strong, zIndex: 20, elevation: 20 },
  bg: { backgroundColor: BG, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl },
  handle: { width: 40, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.28)' },
  body: { flex: 1 },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.md },
  top: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  avatarWrap: { width: 116, height: 184, alignItems: 'center', justifyContent: 'flex-end' },
  bubble: { position: 'absolute', top: 0, zIndex: 2 },
  bubbleTail: { position: 'absolute', top: 58, width: 0, height: 0, borderLeftWidth: 5, borderRightWidth: 5, borderTopWidth: 6, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: 'rgba(250,250,250,0.9)', zIndex: 2 },
  avatarGlow: { position: 'absolute', bottom: 8, width: 110, height: 44, borderRadius: 55, backgroundColor: colors.primary, opacity: 0.16, transform: [{ scaleY: 0.5 }] },
  info: { flex: 1, minWidth: 0, gap: 4, paddingTop: spacing.xs },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  name: { ...typography.h2, color: colors.white, flexShrink: 1 },
  gem: { fontSize: 14 },
  statusLine: { flexDirection: 'row', alignItems: 'center' },
  dotWrap: { width: 14, height: 14, alignItems: 'center', justifyContent: 'center', marginRight: spacing.xs },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.primary },
  dotOff: { backgroundColor: colors.gray[500] },
  status: { ...typography.bodySmall, color: colors.gray[300], flexShrink: 1 },
  distance: { ...typography.body, color: colors.white },
  place: { ...typography.bodySmall, color: colors.accent },
  bio: { ...typography.bodySmall, color: colors.gray[300], marginTop: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: { paddingHorizontal: spacing.md, height: 30, borderRadius: radius.full, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', justifyContent: 'center' },
  chipText: { ...typography.caption, color: colors.white },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  action: { flex: 1, minHeight: 48, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  actionPrimary: { backgroundColor: colors.primary },
  actionPrimaryText: { ...typography.label, color: colors.black },
  actionGhost: { borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.35)' },
  actionGhostText: { ...typography.label, color: colors.white },
  actionDone: { backgroundColor: 'rgba(255,255,255,0.10)', borderWidth: 0 },
  actionDoneText: { ...typography.label, color: colors.gray[300] },
  actionMatch: { backgroundColor: 'rgba(255,20,147,0.22)', borderWidth: 1.5, borderColor: colors.secondary },
  actionMatchText: { ...typography.label, color: colors.white },
  closeBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.10)', alignItems: 'center', justifyContent: 'center' },
  profileLink: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 44, alignSelf: 'flex-start' },
  photoDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
  profileLinkText: { ...typography.label, color: colors.primary },
});
