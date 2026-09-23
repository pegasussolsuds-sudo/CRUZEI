import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { api, toApiError } from '../../services/api';
import { useMyLocation } from '../../hooks/useMyLocation';
import { MatchModal, type MatchInfo } from '../../components/MatchModal';
import type { NearbyUser } from '@cruzei/shared-types';
import { colors, radius, shadows, spacing, typography } from '@cruzei/ui-mobile';

const RADIUS_M = 5000;

export function LikesScreen() {
  const qc = useQueryClient();
  const { lat, lng, status, locate } = useMyLocation();
  const [queue, setQueue] = useState<NearbyUser[]>([]);
  const [seeded, setSeeded] = useState(false);
  const [match, setMatch] = useState<MatchInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const nearbyQuery = useQuery({
    queryKey: ['nearby', 'deck', lat?.toFixed(3), lng?.toFixed(3)],
    enabled: lat != null && lng != null,
    queryFn: async () => {
      const res = await api.get<NearbyUser[]>('/location/nearby', {
        params: { lat, lng, radius_meters: RADIUS_M },
      });
      return res.data;
    },
  });

  // Monta a fila uma vez por carga (ignora anônimos — não dá pra curtir quem não se revelou)
  useEffect(() => {
    if (nearbyQuery.data && !seeded) {
      setQueue(nearbyQuery.data.filter((u) => !u.isAnonymous));
      setSeeded(true);
    }
  }, [nearbyQuery.data, seeded]);

  const likeMutation = useMutation({
    mutationFn: async ({ userId, isSuper }: { userId: string; isSuper: boolean }) =>
      (await api.post(isSuper ? '/likes/super' : '/likes', { userId })).data,
  });

  const onAction = async (action: 'like' | 'super' | 'pass') => {
    const card = queue[0];
    if (!card) return;
    setError(null);
    setQueue((q) => q.slice(1));
    try {
      if (action === 'pass') {
        await api.post('/passes', { userId: card.id });
        return;
      }
      const res = await likeMutation.mutateAsync({ userId: card.id, isSuper: action === 'super' });
      if (res.isMatch) {
        setMatch({ matchId: res.matchId, name: card.name, photo: card.mainPhotoUrl, context: res.context });
        qc.invalidateQueries({ queryKey: ['matches'] });
      }
    } catch (err) {
      setError(toApiError(err).message);
    }
  };

  const reload = () => {
    setSeeded(false);
    setQueue([]);
    nearbyQuery.refetch();
  };

  if (status === 'denied' || status === 'unavailable') {
    return (
      <SafeAreaView style={styles.center}>
        <Ionicons name="navigate-circle-outline" size={64} color={colors.gray[300]} />
        <Text style={styles.emptyTitle}>cadê você?</Text>
        <Text style={styles.emptySub}>Precisamos da sua localização pra mostrar quem tá por perto.</Text>
        <Pressable onPress={locate} style={styles.reload}>
          <Text style={styles.reloadText}>Permitir localização</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  if (nearbyQuery.isLoading || status === 'loading' || (!seeded && lat != null)) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
      </SafeAreaView>
    );
  }

  const card = queue[0];

  if (!card) {
    return (
      <SafeAreaView style={styles.center}>
        <Ionicons name="heart-outline" size={64} color={colors.gray[300]} />
        <Text style={styles.emptyTitle}>acabou por aqui</Text>
        <Text style={styles.emptySub}>
          Ninguém novo num raio de 5 km agora. Sai um pouco, volta mais tarde ou recarrega.
        </Text>
        <Pressable onPress={reload} style={styles.reload}>
          <Text style={styles.reloadText}>Recarregar</Text>
        </Pressable>
        <MatchModal match={match} onClose={() => setMatch(null)} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title}>quem tá por perto</Text>
        <Text style={styles.subtitle}>{queue.length} {queue.length === 1 ? 'pessoa' : 'pessoas'} num raio de 5 km</Text>
      </View>

      <View style={styles.cardArea}>
        <View style={styles.card}>
          {card.mainPhotoUrl ? (
            <Image source={{ uri: card.mainPhotoUrl }} style={styles.photo} />
          ) : (
            <View style={[styles.photo, styles.photoPlaceholder]}>
              <Ionicons name="person" size={80} color={colors.gray[300]} />
            </View>
          )}
          <View style={styles.cardFooter}>
            <Text style={styles.name}>
              {card.name}
              {card.age ? `, ${card.age}` : ''}
            </Text>
            <View style={styles.distRow}>
              <Ionicons name="location-outline" size={14} color={colors.gray[500]} />
              <Text style={styles.dist}>a {card.distanceM < 1000 ? `${card.distanceM} m` : `${(card.distanceM / 1000).toFixed(1)} km`}</Text>
            </View>
          </View>
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>

      <View style={styles.actions}>
        <Pressable onPress={() => onAction('pass')} style={[styles.btn, styles.btnPass]}>
          <Ionicons name="close" size={28} color={colors.danger} />
        </Pressable>
        <Pressable onPress={() => onAction('like')} style={[styles.btn, styles.btnLike]}>
          <Ionicons name="heart" size={28} color={colors.black} />
        </Pressable>
        <Pressable onPress={() => onAction('super')} style={[styles.btn, styles.btnSuper]}>
          <Ionicons name="star" size={28} color={colors.black} />
        </Pressable>
      </View>

      <MatchModal match={match} onClose={() => setMatch(null)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background, padding: spacing.xl },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  title: { ...typography.h2, color: colors.black },
  subtitle: { ...typography.bodySmall, color: colors.gray[600], marginTop: 2 },
  cardArea: { flex: 1, padding: spacing.lg, justifyContent: 'center' },
  card: { backgroundColor: colors.white, borderRadius: radius.xl, overflow: 'hidden', ...shadows.strong },
  photo: { width: '100%', aspectRatio: 4 / 5 },
  photoPlaceholder: { backgroundColor: colors.gray[100], alignItems: 'center', justifyContent: 'center' },
  cardFooter: { padding: spacing.lg },
  name: { ...typography.h2, color: colors.black },
  distRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  dist: { ...typography.bodySmall, color: colors.gray[500] },
  actions: { flexDirection: 'row', justifyContent: 'space-evenly', padding: spacing.xl, paddingBottom: spacing.xl },
  btn: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', ...shadows.medium },
  btnPass: { backgroundColor: colors.white, borderWidth: 2, borderColor: colors.danger },
  btnLike: { backgroundColor: colors.primary },
  btnSuper: { backgroundColor: colors.accent },
  emptyTitle: { ...typography.h2, color: colors.black, marginTop: spacing.lg },
  emptySub: { ...typography.body, color: colors.gray[600], textAlign: 'center', marginTop: spacing.sm },
  reload: { marginTop: spacing.xl, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.md, backgroundColor: colors.primary },
  reloadText: { ...typography.label, color: colors.black },
  error: { ...typography.bodySmall, color: colors.danger, textAlign: 'center', marginTop: spacing.sm },
});
