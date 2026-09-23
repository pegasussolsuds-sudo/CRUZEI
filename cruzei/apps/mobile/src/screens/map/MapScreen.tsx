import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { api, toApiError } from '../../services/api';
import { useMyLocation } from '../../hooks/useMyLocation';
import { useVisibility } from '../../hooks/useVisibility';
import { buildMapboxHtml } from './mapbox-html';
import { config } from '../../config';
import { MatchModal, type MatchInfo } from '../../components/MatchModal';
import { colors, radius, shadows, spacing, typography } from '@cruzei/ui-mobile';
import { distanceMeters } from '@cruzei/shared-utils';
import type { NearbyUser, POI } from '@cruzei/shared-types';

const RADIUS_M = 5000;

type WebMsg =
  | { type: 'ready' }
  | { type: 'error'; message: string }
  | { type: 'moveend'; lat: number; lng: number; zoom: number }
  | { type: 'userTap'; id: string }
  | { type: 'poiTap'; id: number }
  | { type: 'mapTap' };

const MAP_HTML = buildMapboxHtml(config.mapboxToken);

export function MapScreen() {
  const webRef = useRef<WebView>(null);
  const [webReady, setWebReady] = useState(false);
  // incrementa a cada 'ready' do WebView (reload/crash) pra reaplicar posição, tema e marcadores
  const [readyTick, setReadyTick] = useState(0);
  const [mapError, setMapError] = useState<string | null>(config.mapboxToken ? null : 'Token do Mapbox não configurado (EXPO_PUBLIC_MAPBOX_TOKEN).');
  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [match, setMatch] = useState<MatchInfo | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const qc = useQueryClient();
  const { lat, lng, status, locate } = useMyLocation();
  const { isAnonymous, toggle, isPending } = useVisibility();

  const queryCenter = center ?? (lat != null && lng != null ? { lat, lng } : null);

  const nearbyQuery = useQuery({
    queryKey: ['nearby', queryCenter?.lat.toFixed(3), queryCenter?.lng.toFixed(3)],
    enabled: Boolean(queryCenter),
    refetchInterval: 45_000,
    queryFn: async () => {
      const params = { lat: queryCenter!.lat, lng: queryCenter!.lng, radius_meters: RADIUS_M };
      const [u, p] = await Promise.all([
        api.get<NearbyUser[]>('/location/nearby', { params }),
        api.get<POI[]>('/pois/nearby', { params }),
      ]);
      return { users: u.data, pois: p.data };
    },
  });

  const users = nearbyQuery.data?.users ?? [];
  const pois = nearbyQuery.data?.pois ?? [];

  const inject = useCallback((js: string) => {
    webRef.current?.injectJavaScript(`${js}; true;`);
  }, []);

  // Posição própria → centraliza e marca
  useEffect(() => {
    if (!webReady || lat == null || lng == null) return;
    inject(`window.cruzei.setMe(${lat}, ${lng}); window.cruzei.setCenter(${lat}, ${lng}, 15)`);
  }, [webReady, readyTick, lat, lng, inject]);

  // Tema noturno quando anônimo
  useEffect(() => {
    if (webReady) inject(`window.cruzei.setTheme(${isAnonymous})`);
  }, [webReady, readyTick, isAnonymous, inject]);

  // Dados → marcadores
  useEffect(() => {
    if (!webReady) return;
    inject(`window.cruzei.setData(${JSON.stringify({ users, pois })})`);
  }, [webReady, readyTick, users, pois, inject]);

  useEffect(() => {
    if (webReady) inject(`window.cruzei.select(${JSON.stringify(selected)})`);
  }, [webReady, readyTick, selected, inject]);

  const onMessage = (e: WebViewMessageEvent) => {
    let msg: WebMsg;
    try {
      msg = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    if (msg.type === 'ready') {
      setWebReady(true);
      setReadyTick((t) => t + 1);
      setMapError(null);
    } else if (msg.type === 'error') setMapError(msg.message);
    else if (msg.type === 'moveend') setCenter({ lat: msg.lat, lng: msg.lng });
    else if (msg.type === 'userTap') setSelected(msg.id);
    else if (msg.type === 'mapTap') setSelected(null);
  };

  const selectedUser = useMemo(() => users.find((u) => u.id === selected) ?? null, [users, selected]);

  // distância sempre a partir de MIM (o backend calcula a partir do centro do mapa, que o usuário arrasta)
  const distFromMe = (u: NearbyUser) =>
    lat != null && lng != null ? Math.round(distanceMeters(lat, lng, u.latitude, u.longitude)) : u.distanceM;

  const showToast = (t: string) => {
    setToast(t);
    setTimeout(() => setToast(null), 2500);
  };

  const like = async (u: NearbyUser) => {
    try {
      const res = await api.post('/likes', { userId: u.id });
      if (res.data.isMatch) {
        setMatch({ matchId: res.data.matchId, name: u.name, photo: u.mainPhotoUrl, context: res.data.context });
      } else {
        showToast(`Curtida enviada pra ${u.name} 💚`);
      }
      qc.invalidateQueries({ queryKey: ['matches'] });
    } catch (err) {
      showToast(toApiError(err).message);
    }
  };

  return (
    <View style={styles.container}>
      <WebView
        ref={webRef}
        source={{ html: MAP_HTML, baseUrl: 'https://app.cruzei.com.br/' }}
        originWhitelist={['*']}
        onMessage={onMessage}
        javaScriptEnabled
        domStorageEnabled
        mixedContentMode="always"
        style={styles.web}
        containerStyle={styles.web}
        setBuiltInZoomControls={false}
        androidLayerType="hardware"
        onError={() => setWebReady(false)}
      />

      <SafeAreaView style={styles.overlay} pointerEvents="box-none" edges={['top']}>
        <View style={styles.top} pointerEvents="box-none">
          <Pressable onPress={toggle} disabled={isPending} style={styles.statusChip}>
            <View style={[styles.dot, { backgroundColor: isAnonymous ? colors.warning : colors.online }]} />
            <Text style={styles.statusText}>{isAnonymous ? 'anônimo' : 'visível'}</Text>
            <Ionicons name={isAnonymous ? 'eye-off-outline' : 'eye-outline'} size={16} color={colors.primary} style={{ marginLeft: spacing.sm }} />
          </Pressable>

          <Pressable onPress={locate} style={styles.roundBtn}>
            <Ionicons name="locate" size={20} color={colors.black} />
          </Pressable>
        </View>
      </SafeAreaView>

      <View style={styles.bottom} pointerEvents="box-none">
        {toast ? (
          <View style={styles.toast}>
            <Text style={styles.toastText}>{toast}</Text>
          </View>
        ) : null}

        {mapError ? (
          <View style={styles.notice}>
            <Ionicons name="warning-outline" size={20} color={colors.warning} />
            <Text style={styles.noticeText}>Mapa indisponível: {mapError}</Text>
            <Pressable onPress={() => { setMapError(null); webRef.current?.reload(); }}>
              <Text style={styles.noticeAction}>Tentar de novo</Text>
            </Pressable>
          </View>
        ) : null}

        {status === 'denied' ? (
          <View style={styles.notice}>
            <Ionicons name="navigate-circle-outline" size={20} color={colors.white} />
            <Text style={styles.noticeText}>Sem localização o mapa não mostra quem tá perto.</Text>
            <Pressable onPress={locate}>
              <Text style={styles.noticeAction}>Permitir</Text>
            </Pressable>
          </View>
        ) : null}

        {selectedUser ? (
          <View style={styles.card}>
            {selectedUser.mainPhotoUrl ? (
              <Image source={{ uri: selectedUser.mainPhotoUrl }} style={styles.cardPhoto} />
            ) : (
              <View style={[styles.cardPhoto, styles.cardPhotoPlaceholder]}>
                <Ionicons name={selectedUser.isAnonymous ? 'eye-off' : 'person'} size={28} color={colors.gray[400]} />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.cardName}>
                {selectedUser.name}
                {selectedUser.age ? `, ${selectedUser.age}` : ''}
              </Text>
              <Text style={styles.cardMeta}>
                {selectedUser.isAnonymous ? 'em modo anônimo — não dá pra curtir ainda' : `a ${fmtDist(distFromMe(selectedUser))} de você`}
              </Text>
            </View>
            {!selectedUser.isAnonymous ? (
              <Pressable onPress={() => like(selectedUser)} style={styles.likeBtn}>
                <Ionicons name="heart" size={22} color={colors.black} />
              </Pressable>
            ) : null}
          </View>
        ) : (
          <FlatList
            horizontal
            data={users}
            keyExtractor={(u) => u.id}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}
            ListHeaderComponent={
              <View style={styles.stats}>
                <Text style={styles.statNum}>{users.length}</Text>
                <Text style={styles.statLabel}>perto</Text>
                <View style={styles.statDivider} />
                <Text style={styles.statNum}>{pois.length}</Text>
                <Text style={styles.statLabel}>lugares</Text>
                {nearbyQuery.isFetching ? <ActivityIndicator size="small" color={colors.primary} style={{ marginLeft: spacing.sm }} /> : null}
              </View>
            }
            renderItem={({ item }) => (
              <Pressable onPress={() => setSelected(item.id)} style={styles.chip}>
                {item.mainPhotoUrl ? (
                  <Image source={{ uri: item.mainPhotoUrl }} style={styles.chipPhoto} />
                ) : (
                  <View style={[styles.chipPhoto, styles.cardPhotoPlaceholder]}>
                    <Ionicons name={item.isAnonymous ? 'eye-off' : 'person'} size={14} color={colors.gray[400]} />
                  </View>
                )}
                <Text style={styles.chipText} numberOfLines={1}>
                  {item.name}
                </Text>
              </Pressable>
            )}
          />
        )}
      </View>

      {status === 'loading' && !webReady ? (
        <View style={styles.loader}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : null}

      <MatchModal match={match} onClose={() => setMatch(null)} />
    </View>
  );
}

function fmtDist(m: number): string {
  if (m < 1000) return `${m} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.black },
  web: { flex: 1, backgroundColor: colors.black },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0 },
  top: { padding: spacing.lg, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.overlayDark,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
  },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: spacing.sm },
  statusText: { ...typography.label, color: colors.white },
  roundBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', ...shadows.medium },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: spacing.xxl + spacing.sm, gap: spacing.sm },
  stats: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.overlayDark, paddingHorizontal: spacing.md, borderRadius: radius.full, height: 44 },
  statNum: { ...typography.h4, color: colors.primary },
  statLabel: { ...typography.bodySmall, color: colors.white, marginLeft: 4 },
  statDivider: { width: 1, height: 16, backgroundColor: colors.gray[600], marginHorizontal: spacing.sm },
  chip: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.white, borderRadius: radius.full, paddingRight: spacing.md, height: 44, ...shadows.medium },
  chipPhoto: { width: 36, height: 36, borderRadius: 18, margin: 4, marginRight: spacing.sm },
  chipText: { ...typography.label, color: colors.black, maxWidth: 110 },
  card: { marginHorizontal: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.white, borderRadius: radius.lg, padding: spacing.md, ...shadows.strong },
  cardPhoto: { width: 56, height: 56, borderRadius: 28 },
  cardPhotoPlaceholder: { backgroundColor: colors.gray[100], alignItems: 'center', justifyContent: 'center' },
  cardName: { ...typography.h4, color: colors.black },
  cardMeta: { ...typography.bodySmall, color: colors.gray[600], marginTop: 2 },
  likeBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  notice: { marginHorizontal: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.overlayDark, padding: spacing.md, borderRadius: radius.md },
  noticeText: { ...typography.bodySmall, color: colors.white, flex: 1 },
  noticeAction: { ...typography.label, color: colors.primary },
  toast: { alignSelf: 'center', backgroundColor: colors.black, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.full },
  toastText: { ...typography.bodySmall, color: colors.white },
  loader: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(10,10,26,0.6)' },
});
