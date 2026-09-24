import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, type AppStateStatus, BackHandler, type LayoutChangeEvent, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { Ionicons } from '@expo/vector-icons';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { runOnJS, useAnimatedReaction, useSharedValue } from 'react-native-reanimated';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';

import { api, toApiError } from '../../services/api';
import { config } from '../../config';
import { useMyLocation } from '../../hooks/useMyLocation';
import { useVisibility } from '../../hooks/useVisibility';
import { useMapTheme } from '../../hooks/useMapTheme';
import { useAuthStore } from '../../stores/auth';
import { useMapPerfStore } from '../../stores/mapPerf';
import { MatchModal, type MatchInfo } from '../../components/MatchModal';
import { MapBottomSheet, SHEET_SNAP_FRACTIONS, type MapBottomSheetHandle, type PoiFilter } from '../../components/map/MapBottomSheet';
import { MapHeader, useActiveBoost } from '../../components/map/MapHeader';
import { HotspotToast, type HotspotBorn } from '../../components/map/HotspotToast';
import { PersonRow } from '../../components/map/PersonRow';
import { FadeInView } from '../../components/animated/FadeInView';
import { buildMapboxHtml } from './mapbox-html';
import { buildBeforeContentLoadedScript, cmd, parseWebMsg, type CommandName, type PerfTier } from './bridge';
import { colors, radius, shadows, spacing, typography } from '@cruzei/ui-mobile';
import { distanceMeters, encodeGeohash } from '@cruzei/shared-utils';
import type { NearbyUser, POI } from '@cruzei/shared-types';

const HOT_MIN = 5;
const MAX_USERS = 300;
const FREE_RADIUS_M = 800;
const WIDE_RADIUS_M = 5000;
const NEARBY_REFETCH_MS = 45_000;
const LOW_FPS = 40;
const LOW_FPS_SAMPLES = 3;
const HEADING_MIN_DELTA = 4;
const HEADING_THROTTLE_MS = 100;
const PADDING_THROTTLE_MS = 16;
// origem http: página http carrega imagens http (fotos de dev na LAN) e https (Mapbox, R2) sem 'mixed content'
const BASE_URL = 'http://app.cruzei.com.br/';

// ordem de reaplicação do estado após um 'ready' (reload/crash do WebView)
const REPLAY_ORDER: CommandName[] = ['setTier', 'setTheme', 'setActive', 'setMe', 'reveal', 'setData', 'select', 'setPadding'];
// one-shots que vale a pena segurar até o 'ready'; comandos de câmera antes do ready só atropelariam o reveal
const QUEUEABLE: ReadonlySet<CommandName> = new Set<CommandName>(['burst']);
const TIER_BELOW: Record<PerfTier, PerfTier | null> = { high: 'mid', mid: 'low', low: null };

interface LikeResponse {
  isMatch: boolean;
  matchId?: string;
  context?: string | null;
}

interface NearbyData {
  users: NearbyUser[];
  pois: POI[];
}

function minTier(a: PerfTier, b: PerfTier): PerfTier {
  const rank: Record<PerfTier, number> = { low: 0, mid: 1, high: 2 };
  return rank[a] <= rank[b] ? a : b;
}

export function MapScreen() {
  const webRef = useRef<WebView>(null);
  const sheetRef = useRef<MapBottomSheetHandle>(null);
  const qc = useQueryClient();
  const isFocused = useIsFocused();

  // ---------- estado de app / foco ----------
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => setAppActive(s === 'active'));
    return () => sub.remove();
  }, []);
  const active = isFocused && appActive;

  // ---------- dados próprios ----------
  const me = useAuthStore((s) => s.user);
  const { lat, lng, status: locStatus, locate } = useMyLocation();
  const { isAnonymous, toggle: toggleVisibility, isPending: togglePending } = useVisibility();
  const { theme } = useMapTheme();
  const boostQuery = useActiveBoost(Boolean(me), active);
  const boost = boostQuery.data ?? null;
  const isBoosted = Boolean(boost && boost.minutesRemaining > 0);
  const myTier = me?.premiumTier ?? 'free';
  const isFree = myTier === 'free';
  const radiusM = !isFree || isBoosted ? WIDE_RADIUS_M : FREE_RADIUS_M;
  const myPhotoUrl = useMemo(() => {
    const main = me?.photos?.find((p) => p.isMain) ?? me?.photos?.[0];
    return main?.thumbnailUrl ?? main?.url ?? null;
  }, [me?.photos]);

  // ---------- WebView ----------
  // tier inicial vem do store (sobrevive a remount): define o clamp de DPR e o HTML já nasce no tier certo.
  // `webKey` remonta o WebView (retry / renderer morto) — reload() não ressuscita um renderer morto no Android.
  const savedTier = useMapPerfStore((s) => s.tier);
  const [webKey, setWebKey] = useState(0);
  const html = useMemo(() => buildMapboxHtml(config.mapboxToken, { theme, tier: savedTier }), [savedTier]); // eslint-disable-line react-hooks/exhaustive-deps -- tema só na 1ª carga; depois vai por setTheme
  const beforeScript = useMemo(() => buildBeforeContentLoadedScript(savedTier), [savedTier]);

  const readyRef = useRef(false);
  const stateCmds = useRef(new Map<CommandName, string>());
  const oneShots = useRef<string[]>([]);
  const [webReady, setWebReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(config.mapboxToken ? null : 'o mapa não tá disponível agora');

  useEffect(() => {
    if (__DEV__ && !config.mapboxToken) {
      // eslint-disable-next-line no-console
      console.warn('[map] EXPO_PUBLIC_MAPBOX_TOKEN não configurado — o mapa não vai carregar');
    }
  }, []);

  const inject = useCallback((js: string) => {
    webRef.current?.injectJavaScript(js);
  }, []);

  /**
   * Envia um comando. Com `key`, guarda como "último estado" pra reaplicar no próximo 'ready'.
   * Antes do 'ready' só os one-shots em QUEUEABLE são segurados (câmera antes do ready atropelaria o reveal).
   */
  const send = useCallback(
    (js: string, key?: CommandName, oneShot?: CommandName) => {
      if (key) stateCmds.current.set(key, js);
      if (readyRef.current) inject(js);
      else if (!key && oneShot && QUEUEABLE.has(oneShot)) oneShots.current.push(js);
    },
    [inject],
  );

  const flushOnReady = useCallback(() => {
    for (const key of REPLAY_ORDER) {
      const js = stateCmds.current.get(key);
      if (js) inject(js);
    }
    for (const js of oneShots.current) inject(js);
    oneShots.current = [];
  }, [inject]);

  const onWebDead = useCallback((why: string) => {
    readyRef.current = false;
    setWebReady(false);
    setMapError(why);
  }, []);

  const remountWeb = useCallback(() => {
    readyRef.current = false;
    setWebReady(false);
    setWebKey((k) => k + 1); // o próximo 'ready' faz o replay do estado (REPLAY_ORDER)
  }, []);

  const retryMap = useCallback(() => {
    setMapError(null);
    remountWeb();
  }, [remountWeb]);

  // ---------- tier de performance ----------
  const [measuredTier, setMeasuredTier] = useState<PerfTier>('high');
  const [forcedTier, setForcedTier] = useState<PerfTier | null>(null);
  const tier = forcedTier ? minTier(measuredTier, forcedTier) : measuredTier;
  const lowFpsCount = useRef(0);

  // manda o tier EFETIVO (nunca sobe o WebView acima do que ele mediu num reload)
  useEffect(() => {
    if (forcedTier) send(cmd.setTier(tier), 'setTier');
  }, [forcedTier, tier, send]);

  // ---------- centro da query (gesto real no mapa) ----------
  const [userCenter, setUserCenter] = useState<{ lat: number; lng: number } | null>(null);
  const queryCenter = userCenter ?? (lat != null && lng != null ? { lat, lng } : null);
  const centerGeohash = queryCenter ? encodeGeohash(queryCenter.lat, queryCenter.lng, 6) : null;

  // ---------- seleção / filtros / feedback ----------
  const [selected, setSelected] = useState<string | null>(null);
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [poiFilter, setPoiFilter] = useState<PoiFilter | null>(null);
  const [passed, setPassed] = useState<ReadonlySet<string>>(() => new Set());
  const [match, setMatch] = useState<MatchInfo | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [hotspot, setHotspot] = useState<HotspotBorn | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [containerH, setContainerH] = useState(0);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [canAskLocation, setCanAskLocation] = useState(true);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((t: string) => {
    setToast(t);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }, []);
  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  // ---------- nearby ----------
  // pessoas no raio do plano; lugares sempre no raio largo (a restrição do free é sobre pessoas, não hotspots)
  const nearbyQuery = useQuery({
    queryKey: ['nearby', centerGeohash, radiusM],
    enabled: Boolean(queryCenter),
    refetchInterval: active ? NEARBY_REFETCH_MS : false,
    placeholderData: keepPreviousData, // ao mudar de célula, sheet e card não piscam '0 pessoas'
    queryFn: async (): Promise<NearbyData> => {
      const c = queryCenter as { lat: number; lng: number };
      const [u, p] = await Promise.all([
        api.get<NearbyUser[]>('/location/nearby', { params: { lat: c.lat, lng: c.lng, radius_meters: radiusM } }),
        api.get<POI[]>('/pois/nearby', { params: { lat: c.lat, lng: c.lng, radius_meters: WIDE_RADIUS_M } }),
      ]);
      return { users: u.data, pois: p.data };
    },
  });

  // distância sempre a partir de MIM (o backend calcula a partir do centro, que o usuário arrasta);
  // os NearbyUser que vão pro HTML já levam a distância recalculada, consistente com o sheet
  const { users, pois, distanceById } = useMemo(() => {
    const raw = nearbyQuery.data?.users ?? [];
    const dist = new Map<string, number>();
    for (const u of raw) {
      dist.set(u.id, lat != null && lng != null ? distanceMeters(lat, lng, u.latitude, u.longitude) : u.distanceM);
    }
    const sorted = raw
      .filter((u) => !passed.has(u.id))
      .map((u) => ({ ...u, distanceM: dist.get(u.id) ?? u.distanceM }))
      .sort((a, b) => a.distanceM - b.distanceM)
      .slice(0, MAX_USERS);
    return { users: sorted, pois: nearbyQuery.data?.pois ?? [], distanceById: dist };
  }, [nearbyQuery.data, lat, lng, passed]);

  const selectedUser = useMemo(() => users.find((u) => u.id === selected) ?? null, [users, selected]);
  // Voltar (Android) com card aberto fecha o card em vez de sair do app
  useEffect(() => {
    if (!selected) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setSelected(null);
      return true;
    });
    return () => sub.remove();
  }, [selected]);

  // selecionado sumiu da lista (refetch, corte dos 300, passou) => limpa o anel no mapa também
  useEffect(() => {
    if (selected && !selectedUser) setSelected(null);
  }, [selected, selectedUser]);

  // refs pra onMessage ficar estável (o WebView recebe a mesma prop em todo ciclo)
  const usersRef = useRef(users);
  usersRef.current = users;
  const poisRef = useRef(pois);
  poisRef.current = pois;
  const tierRef = useRef(tier);
  tierRef.current = tier;

  // ---------- heading (só tier high, só em foco, só com o mapa pronto; throttle 100ms) ----------
  useEffect(() => {
    if (tier !== 'high' || !active || !webReady || locStatus !== 'ready') {
      setHeading(null);
      return;
    }
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    let last: number | null = null;
    let lastAt = 0;
    Location.watchHeadingAsync((h) => {
      const now = Date.now();
      if (now - lastAt < HEADING_THROTTLE_MS) return;
      const value = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
      if (!Number.isFinite(value) || value < 0) return;
      if (last != null && Math.abs(((value - last + 540) % 360) - 180) < HEADING_MIN_DELTA) return;
      last = value;
      lastAt = now;
      setHeading(Math.round(value));
    })
      .then((s) => {
        if (cancelled) s.remove();
        else sub = s;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [tier, active, webReady, locStatus]);

  // ---------- comandos de estado (idempotentes; reaplicados no próximo 'ready') ----------
  useEffect(() => {
    // antes do ready o HTML já nasce no tema (init.theme): reaplicar sem animação, senão faz um crossfade de 800ms
    // pro MESMO tema no meio do reveal
    send(cmd.setTheme(theme, readyRef.current), 'setTheme');
  }, [theme, send]);

  useEffect(() => {
    send(cmd.setActive(active), 'setActive');
  }, [active, send]);

  const revealedRef = useRef(false);
  useEffect(() => {
    if (lat == null || lng == null) return;
    const revealJs = cmd.reveal(lat, lng);
    if (!revealedRef.current) {
      revealedRef.current = true;
      send(revealJs, 'reveal');
    } else {
      stateCmds.current.set('reveal', revealJs); // só pro próximo 'ready' (retry/crash): voa pra onde estou AGORA
    }
    send(
      cmd.setMe({
        lat,
        lng,
        heading,
        tier: myTier,
        isBoosted,
        isAnonymous,
        photoUrl: myPhotoUrl,
        name: me?.name ?? 'você',
      }),
      'setMe',
    );
  }, [lat, lng, heading, myTier, isBoosted, isAnonymous, myPhotoUrl, me?.name, send]);

  // setData quando a lista memoizada muda (dados novos, minha posição pro corte dos 300, passar)
  const hasData = Boolean(nearbyQuery.data);
  useEffect(() => {
    if (!hasData) return;
    send(cmd.setData({ users, pois, hotMin: HOT_MIN }), 'setData');
  }, [hasData, users, pois, send]);

  useEffect(() => {
    send(cmd.select(selected), 'select');
  }, [selected, send]);

  // padding do mapa acompanha o sheet frame a frame (animatedPosition do gorhom), throttle 16ms
  const paddingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPaddingAt = useRef(0);
  const sendPadding = useCallback(
    (bottom: number) => {
      const fire = () => {
        paddingTimer.current = null;
        lastPaddingAt.current = Date.now();
        send(cmd.setPadding({ bottom }), 'setPadding');
      };
      const wait = PADDING_THROTTLE_MS - (Date.now() - lastPaddingAt.current);
      if (paddingTimer.current) clearTimeout(paddingTimer.current);
      if (wait <= 0) fire();
      else paddingTimer.current = setTimeout(fire, wait);
    },
    [send],
  );
  useEffect(() => () => {
    if (paddingTimer.current) clearTimeout(paddingTimer.current);
  }, []);

  const sheetPosition = useSharedValue(0);
  const containerHRef = useRef(0);
  containerHRef.current = containerH;
  const onSheetPosition = useCallback(
    (position: number) => {
      const h = containerHRef.current;
      if (h <= 0) return;
      sendPadding(Math.max(0, Math.round(h - position)));
    },
    [sendPadding],
  );
  useAnimatedReaction(
    () => sheetPosition.value,
    (position, prev) => {
      if (position !== prev) runOnJS(onSheetPosition)(position);
    },
    [onSheetPosition],
  );
  // fallback pro 1º layout (antes do gorhom animar) e pra quando a posição não muda mas a altura muda
  useEffect(() => {
    if (containerH > 0) sendPadding(Math.round(containerH * SHEET_SNAP_FRACTIONS[sheetIndex]));
  }, [containerH, sheetIndex, sendPadding]);

  // ---------- mensagens do WebView ----------
  const onMessage = useCallback(
    (e: WebViewMessageEvent) => {
      const msg = parseWebMsg(e.nativeEvent.data);
      if (!msg) return;
      switch (msg.type) {
        case 'ready': {
          readyRef.current = true;
          setWebReady(true);
          setMapError(null);
          setMeasuredTier(msg.tier);
          lowFpsCount.current = 0;
          flushOnReady();
          break;
        }
        case 'styleLoaded':
          break;
        case 'error': {
          if (msg.fatal) {
            onWebDead(msg.message);
          } else {
            // eslint-disable-next-line no-console
            console.warn('[map]', msg.message);
          }
          break;
        }
        case 'moveend': {
          if (msg.userMoved) setUserCenter({ lat: msg.lat, lng: msg.lng });
          break;
        }
        case 'userTap': {
          Haptics.selectionAsync().catch(() => {});
          setSelected(msg.id);
          break;
        }
        case 'poiTap': {
          Haptics.selectionAsync().catch(() => {});
          send(cmd.focusPoi(msg.id));
          const poi = poisRef.current.find((p) => p.id === msg.id);
          const hasPeople = usersRef.current.some((u) => u.poi?.id === msg.id);
          if (poi && hasPeople) {
            setPoiFilter({ id: poi.id, name: poi.name });
            sheetRef.current?.snapToIndex(1);
          }
          break;
        }
        case 'mapTap': {
          setSelected(null);
          sheetRef.current?.snapToIndex(0);
          break;
        }
        case 'hotspotBorn': {
          setHotspot({ poiId: msg.poiId, name: msg.name, userCount: msg.userCount });
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          break;
        }
        case 'perf': {
          if (msg.fps < LOW_FPS) {
            lowFpsCount.current += 1;
            if (lowFpsCount.current >= LOW_FPS_SAMPLES) {
              lowFpsCount.current = 0;
              const next = TIER_BELOW[tierRef.current];
              if (next) {
                setForcedTier(next);
                if (next === 'low') {
                  // o clamp de DPR 1.5 só vale num load novo: guarda no store e remonta uma vez
                  useMapPerfStore.getState().setTier('low');
                  remountWeb();
                }
              }
            }
          } else {
            lowFpsCount.current = 0;
          }
          break;
        }
        case 'photoBlocked': {
          if (__DEV__) {
            // eslint-disable-next-line no-console
            console.info('[map] foto sem CORS, caiu no placeholder:', msg.url);
          }
          break;
        }
        default:
          break;
      }
    },
    [flushOnReady, onWebDead, remountWeb, send],
  );

  // ---------- ações ----------
  const like = useCallback(
    async (u: NearbyUser, isSuper = false) => {
      if (u.isAnonymous) return;
      try {
        const res = await api.post<LikeResponse>('/likes', { userId: u.id, isSuper });
        if (res.data.isMatch && res.data.matchId) {
          send(cmd.burst({ lat: u.latitude, lng: u.longitude, kind: 'match' }), undefined, 'burst');
          setMatch({ matchId: res.data.matchId, name: u.name, photo: u.mainPhotoUrl, context: res.data.context });
        } else {
          send(cmd.burst({ lat: u.latitude, lng: u.longitude, kind: isSuper ? 'super' : 'like' }), undefined, 'burst');
          showToast(isSuper ? `Super curtida enviada pra ${u.name} ⭐` : `Curtida enviada pra ${u.name} 💚`);
        }
        qc.invalidateQueries({ queryKey: ['matches'] });
      } catch (err) {
        showToast(toApiError(err).message || 'Ops, deu ruim. Tenta de novo?');
      }
    },
    [qc, send, showToast],
  );
  const onLike = useCallback((u: NearbyUser) => void like(u, false), [like]);
  const onSuperLike = useCallback((u: NearbyUser) => void like(u, true), [like]);
  // 'passar' some na hora (filtro local) e vai pro servidor, pra sumir também do deck de Curtidas e não voltar no refetch
  const onPass = useCallback(
    (u: NearbyUser) => {
      setPassed((prev) => {
        const next = new Set(prev);
        next.add(u.id);
        return next;
      });
      setSelected((cur) => (cur === u.id ? null : cur));
      api
        .post('/passes', { userId: u.id })
        .then(() => qc.invalidateQueries({ queryKey: ['nearby', 'deck'] }))
        .catch(() => {
          /* silencioso: o filtro local já escondeu */
        });
    },
    [qc],
  );
  const onSelectUser = useCallback((u: NearbyUser) => {
    setSelected(u.id);
    sheetRef.current?.snapToIndex(0);
  }, []);

  const onCenter = useCallback(async () => {
    const loc = lat != null && lng != null ? { latitude: lat, longitude: lng } : await locate();
    if (!loc) return;
    setUserCenter(null);
    send(cmd.setCenter(loc.latitude, loc.longitude, 16, { pitch: 58, bearing: -12, duration: 1100 }));
  }, [lat, lng, locate, send]);

  const onToggleVisibility = useCallback(() => {
    if (isAnonymous) {
      toggleVisibility();
      return;
    }
    Alert.alert('Quer ver sem aparecer?', 'Em modo anônimo você vê todo mundo, mas não rola match por enquanto.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Ficar anônimo', onPress: toggleVisibility },
    ]);
  }, [isAnonymous, toggleVisibility]);

  // permissão negada com "não perguntar de novo": o único caminho é a tela de ajustes
  useEffect(() => {
    if (locStatus !== 'denied') return;
    let cancelled = false;
    Location.getForegroundPermissionsAsync()
      .then((perm) => {
        if (!cancelled) setCanAskLocation(perm.granted || perm.canAskAgain);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [locStatus]);
  const onAllowLocation = useCallback(async () => {
    if (!canAskLocation) {
      Linking.openSettings().catch(() => {});
      return;
    }
    await locate();
  }, [canAskLocation, locate]);

  const onFocusPoi = useCallback((poiId: number) => send(cmd.focusPoi(poiId)), [send]);
  const hideHotspot = useCallback(() => setHotspot(null), []);
  const clearPoiFilter = useCallback(() => setPoiFilter(null), []);
  const onSheetChange = useCallback((index: number) => setSheetIndex(Math.max(0, index)), []);
  const onLayout = useCallback((e: LayoutChangeEvent) => setContainerH(e.nativeEvent.layout.height), []);

  const floatBottom = Math.round(containerH * SHEET_SNAP_FRACTIONS[sheetIndex]) + spacing.sm;
  const peopleCount = users.length;
  const listLoading = Boolean(queryCenter) && (nearbyQuery.isPending || nearbyQuery.isPlaceholderData);

  return (
    <View style={styles.container} onLayout={onLayout}>
      <WebView
        key={webKey}
        ref={webRef}
        source={{ html, baseUrl: BASE_URL }}
        originWhitelist={['*']}
        injectedJavaScriptBeforeContentLoaded={beforeScript}
        injectedJavaScriptBeforeContentLoadedForMainFrameOnly
        onMessage={onMessage}
        javaScriptEnabled
        domStorageEnabled
        cacheEnabled
        mixedContentMode="always" // fotos de dev vêm por http (LAN); em prod tudo é https (R2)
        allowsFullscreenVideo={false}
        overScrollMode="never"
        style={styles.web}
        containerStyle={styles.web}
        setBuiltInZoomControls={false}
        androidLayerType="hardware"
        onError={() => onWebDead('sem conexão com o mapa')}
        onRenderProcessGone={() => onWebDead('o mapa travou')}
        accessibilityLabel={`Mapa com ${peopleCount} ${peopleCount === 1 ? 'pessoa' : 'pessoas'} perto e ${pois.length} lugares`}
      />

      <MapHeader
        lat={queryCenter?.lat ?? null}
        lng={queryCenter?.lng ?? null}
        isAnonymous={isAnonymous}
        togglePending={togglePending}
        onToggleVisibility={onToggleVisibility}
        onCenter={onCenter}
        boostMinutes={isBoosted && boost ? boost.minutesRemaining : null}
      />

      <View style={[styles.floating, { bottom: floatBottom }]} pointerEvents="box-none">
        <HotspotToast hotspot={hotspot} onPress={onFocusPoi} onHide={hideHotspot} />

        {toast ? (
          <FadeInView fromY={8} style={styles.toast} accessibilityLiveRegion="polite" accessibilityRole="alert">
            <Text style={styles.toastText}>{toast}</Text>
          </FadeInView>
        ) : null}

        {mapError ? (
          <View style={styles.notice} accessibilityRole="alert">
            <Ionicons name="warning-outline" size={20} color={colors.warning} />
            <Text style={styles.noticeText}>Ops, {mapError}. Bora tentar de novo?</Text>
            {config.mapboxToken ? (
              <Pressable onPress={retryMap} accessibilityRole="button" accessibilityLabel="Tentar de novo" style={styles.noticeBtn}>
                <Text style={styles.noticeAction}>Tentar de novo</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {locStatus === 'denied' ? (
          <View style={styles.notice} accessibilityRole="alert">
            <Ionicons name="navigate-circle-outline" size={20} color={colors.white} />
            <Text style={styles.noticeText}>Sem localização o mapa não mostra quem tá perto.</Text>
            <Pressable
              onPress={onAllowLocation}
              accessibilityRole="button"
              accessibilityLabel={canAskLocation ? 'Permitir localização' : 'Abrir ajustes de localização'}
              style={styles.noticeBtn}
            >
              <Text style={styles.noticeAction}>{canAskLocation ? 'Permitir' : 'Abrir ajustes'}</Text>
            </Pressable>
          </View>
        ) : null}

        {locStatus === 'unavailable' ? (
          <View style={styles.notice} accessibilityRole="alert">
            <Ionicons name="navigate-circle-outline" size={20} color={colors.white} />
            <Text style={styles.noticeText}>Não consegui te achar no mapa. Liga o GPS?</Text>
            <Pressable onPress={locate} accessibilityRole="button" accessibilityLabel="Tentar localizar de novo" style={styles.noticeBtn}>
              <Text style={styles.noticeAction}>Tentar de novo</Text>
            </Pressable>
          </View>
        ) : null}

        {selectedUser ? (
          <FadeInView fromY={12} fromScale={0.97} style={styles.card}>
            <PersonRow
              user={selectedUser}
              distanceM={distanceById.get(selectedUser.id) ?? selectedUser.distanceM}
              onPress={(u) => nav.navigate('UserCard', { userId: u.id, distanceM: distanceById.get(u.id) ?? u.distanceM })}
              pressHint="Abre o perfil"
              onLike={onLike}
              onSuperLike={onSuperLike}
              onPass={onPass}
              highlighted
            />
            <Pressable onPress={() => setSelected(null)} accessibilityRole="button" accessibilityLabel="Fechar card" style={styles.cardClose} hitSlop={8}>
              <Ionicons name="close" size={16} color={colors.gray[500]} />
            </Pressable>
          </FadeInView>
        ) : null}
      </View>

      <MapBottomSheet
        ref={sheetRef}
        users={users}
        distanceById={distanceById}
        radiusM={radiusM}
        isFree={isFree}
        isLoading={listLoading}
        poiFilter={poiFilter}
        onClearPoiFilter={clearPoiFilter}
        onChange={onSheetChange}
        animatedPosition={sheetPosition}
        onSelect={onSelectUser}
        onLike={onLike}
        onSuperLike={onSuperLike}
        onPass={onPass}
      />

      {!webReady && !mapError ? (
        <View style={styles.loader} pointerEvents="none">
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : null}

      <MatchModal match={match} onClose={() => setMatch(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.black },
  web: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.black },
  floating: { position: 'absolute', left: 0, right: 0, gap: spacing.sm },
  toast: { alignSelf: 'center', backgroundColor: colors.black, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.full, minHeight: 36, justifyContent: 'center' },
  toastText: { ...typography.bodySmall, color: colors.white },
  notice: { marginHorizontal: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.overlayDark, padding: spacing.md, borderRadius: radius.md },
  noticeText: { ...typography.bodySmall, color: colors.white, flex: 1 },
  noticeBtn: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.sm },
  noticeAction: { ...typography.label, color: colors.primary },
  card: { marginHorizontal: spacing.lg, backgroundColor: colors.white, borderRadius: radius.lg, paddingVertical: spacing.xs, ...shadows.strong },
  cardClose: { position: 'absolute', top: spacing.xs, right: spacing.xs, width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  loader: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.overlay },
});
