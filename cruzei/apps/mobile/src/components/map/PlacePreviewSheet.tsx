import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadows, spacing, typography } from '@cruzei/ui-mobile';
import { formatApproxDistance } from '@cruzei/shared-utils';
import type { NearbyUser, POI } from '@cruzei/shared-types';
import { resolveAvatar } from '../../avatar';
import { IdentityBubble } from '../identity/IdentityBubble';
import { FadeInView } from '../animated/FadeInView';
import { Pulse } from '../animated/Pulse';
import { ScaleOnPress } from '../animated/ScaleOnPress';
import { PressScale } from '../animated/PressScale';
import { reportPlace, type PlaceReportReason } from '../../hooks/usePlaceContrib';

export const PLACE_SHEET_FRACTION = 0.42;

const REPORT_REASONS: { key: PlaceReportReason; label: string }[] = [
  { key: 'not_public', label: 'Não é lugar público' },
  { key: 'residence', label: 'É uma casa' },
  { key: 'closed', label: 'Fechou' },
  { key: 'wrong_place', label: 'Lugar errado' },
];
const SNAP_POINTS: string[] = ['42%'];
const MAX_AVATARS = 6;

export const CATEGORY_LABEL: Record<string, { emoji: string; label: string }> = {
  bar: { emoji: '🍻', label: 'Bar' },
  restaurant: { emoji: '🍔', label: 'Restaurante' },
  cafe: { emoji: '☕', label: 'Café' },
  park: { emoji: '🌳', label: 'Parque' },
  shopping: { emoji: '🛍️', label: 'Shopping' },
  gym: { emoji: '🏋️', label: 'Academia' },
  show: { emoji: '🎵', label: 'Show' },
  event: { emoji: '🎤', label: 'Evento' },
  beach: { emoji: '🏖️', label: 'Praia' },
  museum: { emoji: '🎬', label: 'Cultura' },
  other: { emoji: '📍', label: 'Lugar' },
};

export interface PlacePreviewSheetHandle {
  close: () => void;
}

export interface PlacePreviewSheetProps {
  poi: POI | null;
  /** pessoas do universo que estão nesse lugar agora */
  people: NearbyUser[];
  /** distância do lugar a partir de mim (m) */
  distanceM: number | null;
  hotMin: number;
  onSeePeople: (poi: POI) => void;
  onSelectPerson: (user: NearbyUser) => void;
  onGo: (poi: POI) => void;
  onClose: () => void;
}

/**
 * Lugar como parte do universo (doc §8/§9): nome, quantas pessoas no Metch, quantas online, "em alta",
 * avatares de quem está lá e o atalho pra lista. Eventos aparecem com selo próprio (§10).
 */
export const PlacePreviewSheet = forwardRef<PlacePreviewSheetHandle, PlacePreviewSheetProps>(function PlacePreviewSheet(
  { poi, people, distanceM, hotMin, onSeePeople, onSelectPerson, onGo, onClose },
  ref,
) {
  const sheetRef = useRef<React.ElementRef<typeof BottomSheet>>(null);
  useImperativeHandle(ref, () => ({ close: () => sheetRef.current?.close() }), []);

  useEffect(() => {
    if (poi) sheetRef.current?.snapToIndex(0);
    else sheetRef.current?.close();
  }, [poi?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const onChange = useCallback(
    (index: number) => {
      if (index === -1) onClose();
    },
    [onClose],
  );

  const cat = poi ? (CATEGORY_LABEL[poi.category] ?? CATEGORY_LABEL.other) : CATEGORY_LABEL.other;
  const isEvent = poi?.category === 'event';
  const count = Math.max(poi?.userCount ?? 0, people.length);
  const online = people.filter((u) => u.isOnline).length;
  const hot = count >= hotMin;
  const shown = people.slice(0, MAX_AVATARS);
  const extra = people.length - shown.length;
  // lugar que a galera pôs no mapa (multidão/pedidos/confirmações): selo + "Reportar"
  const discovered = poi?.source === 'catalog' || poi?.source === 'mapbox'; // 'mapbox': linhas antigas
  const [reportState, setReportState] = useState<'idle' | 'choosing' | 'sent'>('idle');
  useEffect(() => setReportState('idle'), [poi?.id]);
  const sendReport = useCallback(
    (reason: PlaceReportReason) => {
      if (!poi) return;
      setReportState('sent');
      reportPlace(poi.id, reason).catch(() => {});
    },
    [poi],
  );

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
      accessibilityLabel={poi ? `Lugar ${poi.name}` : undefined}
    >
      <BottomSheetView style={styles.body}>
        {poi ? (
          <View style={styles.content} key={poi.id}>
            <View style={styles.titleRow}>
              <View style={[styles.emojiWrap, (hot || isEvent) && styles.emojiHot]}>
                <Text style={styles.emoji}>{isEvent ? '⚡' : cat.emoji}</Text>
              </View>
              <View style={styles.titleCol}>
                <Text style={styles.title} numberOfLines={2} accessibilityRole="header">
                  {poi.name}
                </Text>
                <Text style={styles.subtitle} numberOfLines={1}>
                  {isEvent ? 'Evento · hoje' : cat.label}
                  {distanceM != null ? ` · ${formatApproxDistance(distanceM)}` : ''}
                </Text>
              </View>
              <ScaleOnPress onPress={() => sheetRef.current?.close()} accessibilityRole="button" accessibilityLabel="Fechar" style={styles.closeBtn}>
                <Ionicons name="close" size={20} color={colors.white} />
              </ScaleOnPress>
            </View>

            <View style={styles.stats}>
              <Text style={styles.stat}>👥 {count} {count === 1 ? 'pessoa' : 'pessoas'} no Metch</Text>
              {people.length > 0 || count === 0 ? <Text style={styles.stat}>🟢 {online} online agora</Text> : null}
              {hot ? (
                <Pulse active maxScale={1.05} style={styles.hotPill}>
                  <Text style={styles.hotText}>🔥 Em alta</Text>
                </Pulse>
              ) : null}
              {isEvent ? (
                <View style={[styles.hotPill, styles.eventPill]}>
                  <Text style={styles.hotText}>⚡ Evento Metch</Text>
                </View>
              ) : null}
              {discovered ? (
                <View style={[styles.hotPill, styles.discoveredPill]} accessibilityLabel="Lugar descoberto pela galera do Metch">
                  <Text style={[styles.hotText, styles.discoveredText]}>✨ Descoberto pela galera</Text>
                </View>
              ) : null}
            </View>

            {poi.isPartner && poi.partnerOffer ? (
              <Text style={styles.offer} numberOfLines={2}>
                🎁 {poi.partnerOffer}
              </Text>
            ) : null}

            {shown.length > 0 ? (
              <FadeInView delay={80} fromY={6}>
                <Text style={styles.sectionLabel}>Quem está por aqui</Text>
                <View style={styles.avatars}>
                  {shown.map((u, i) => (
                    <Pressable
                      key={u.id}
                      onPress={() => onSelectPerson(u)}
                      accessibilityRole="button"
                      accessibilityLabel={`${u.name}, ver no mapa`}
                      style={[styles.avatarBtn, i > 0 && styles.avatarOverlap]}
                    >
                      <IdentityBubble photoUrl={u.mapPhotoUrl} avatar={resolveAvatar(u.avatar, u.id)} size={48} name={u.name} online={u.isOnline} ring={u.isOnline ? 'online' : 'default'} accessible={false} />
                    </Pressable>
                  ))}
                  {extra > 0 ? (
                    <View style={[styles.avatarBtn, styles.avatarOverlap, styles.more]}>
                      <Text style={styles.moreText}>+{extra}</Text>
                    </View>
                  ) : null}
                </View>
              </FadeInView>
            ) : (
              <Text style={styles.empty}>
                {count > 0
                  ? `${count} ${count === 1 ? 'pessoa' : 'pessoas'} por aqui — chega mais perto pra ver quem: os nomes só aparecem a até 350 m.`
                  : 'Ninguém do Metch por aqui agora. Passa lá e muda isso 😉'}
              </Text>
            )}

            <View style={styles.actions}>
              {people.length > 0 ? (
                <ScaleOnPress onPress={() => onSeePeople(poi)} accessibilityRole="button" accessibilityLabel="Ver pessoas nesse lugar" style={[styles.action, styles.actionPrimary]} glowColor={colors.primary}>
                  <Text style={styles.actionPrimaryText}>Ver pessoas</Text>
                </ScaleOnPress>
              ) : null}
              <ScaleOnPress onPress={() => onGo(poi)} accessibilityRole="button" accessibilityLabel="Centralizar o mapa no lugar" style={[styles.action, styles.actionGhost]}>
                <Text style={styles.actionGhostText}>🗺️ Ver no mapa</Text>
              </ScaleOnPress>
            </View>

            {discovered ? (
              reportState === 'sent' ? (
                <Text style={styles.reportDone}>Valeu! A gente confere esse lugar 👍</Text>
              ) : reportState === 'choosing' ? (
                <View style={styles.reasons}>
                  {REPORT_REASONS.map((r) => (
                    <PressScale key={r.key} onPress={() => sendReport(r.key)} accessibilityRole="button" accessibilityLabel={r.label} style={styles.reason}>
                      <Text style={styles.reasonText}>{r.label}</Text>
                    </PressScale>
                  ))}
                </View>
              ) : (
                <PressScale onPress={() => setReportState('choosing')} haptic={false} accessibilityRole="button" accessibilityLabel="Reportar este lugar" style={styles.reportBtn} hitSlop={6}>
                  <Text style={styles.reportText}>⚑ Reportar</Text>
                </PressScale>
              )
            ) : null}
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
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  emojiWrap: { width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(255,215,0,0.16)', alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: colors.accent },
  emojiHot: { backgroundColor: 'rgba(255,20,147,0.2)', borderColor: colors.secondary },
  emoji: { fontSize: 24 },
  titleCol: { flex: 1, minWidth: 0 },
  title: { ...typography.h3, color: colors.white },
  subtitle: { ...typography.bodySmall, color: colors.gray[300] },
  closeBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.10)', alignItems: 'center', justifyContent: 'center' },
  stats: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  stat: { ...typography.bodySmall, color: colors.white },
  hotPill: { paddingHorizontal: spacing.md, height: 28, borderRadius: radius.full, backgroundColor: colors.secondary, alignItems: 'center', justifyContent: 'center' },
  eventPill: { backgroundColor: '#5A1E8A' },
  discoveredPill: { backgroundColor: 'rgba(127,255,0,0.14)', borderWidth: 1, borderColor: 'rgba(127,255,0,0.5)' },
  discoveredText: { color: colors.primary },
  reportBtn: { alignSelf: 'center', paddingVertical: 4, paddingHorizontal: spacing.md },
  reportText: { ...typography.caption, color: colors.gray[400] },
  reportDone: { ...typography.caption, color: colors.gray[300], textAlign: 'center' },
  reasons: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'center' },
  reason: { paddingHorizontal: spacing.md, minHeight: 36, borderRadius: radius.full, borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center' },
  reasonText: { ...typography.caption, color: colors.white },
  hotText: { ...typography.caption, color: colors.white },
  offer: { ...typography.bodySmall, color: colors.accent },
  sectionLabel: { ...typography.caption, color: colors.gray[400], marginBottom: spacing.xs, textTransform: 'uppercase' },
  avatars: { flexDirection: 'row', alignItems: 'center' },
  // sem overflow:hidden + borda + raio no mesmo View (crash do HWUI em alguns Androids); a bolha já é circular
  avatarBtn: { width: 52, height: 52, borderRadius: 26, borderWidth: 2, borderColor: BG, backgroundColor: '#1E1E3A', alignItems: 'center', justifyContent: 'center' },
  avatarOverlap: { marginLeft: -12 },
  more: { backgroundColor: 'rgba(255,255,255,0.12)' },
  moreText: { ...typography.label, color: colors.white },
  empty: { ...typography.bodySmall, color: colors.gray[300] },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1, minHeight: 48, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  actionPrimary: { backgroundColor: colors.primary },
  actionPrimaryText: { ...typography.label, color: colors.black },
  actionGhost: { borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.35)' },
  actionGhostText: { ...typography.label, color: colors.white },
});
