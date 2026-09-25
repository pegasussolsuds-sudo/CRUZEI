import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, type AppStateStatus, BackHandler, type LayoutChangeEvent, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { useIsFocused, useNavigation, type NavigationProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import type { MainTabParamList } from '../../navigation/MainTabs';
import { Ionicons } from '@expo/vector-icons';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { runOnJS, useAnimatedReaction, useSharedValue } from 'react-native-reanimated';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';

import { api, toApiError } from '../../services/api';
import { connectSocket } from '../../services/socket';
import { config } from '../../config';
import { useMyLocation } from '../../hooks/useMyLocation';
import { useVisibility } from '../../hooks/useVisibility';
import { useMapTheme } from '../../hooks/useMapTheme';
import { useDiscoveryHints } from '../../hooks/useDiscoveryHints';
import { useAuthStore } from '../../stores/auth';
import { useMapPerfStore } from '../../stores/mapPerf';
import { MatchModal, type MatchInfo } from '../../components/MatchModal';
import { MapBottomSheet, SHEET_SNAP_FRACTIONS, type GroupFilter, type MapBottomSheetHandle, type PoiFilter } from '../../components/map/MapBottomSheet';
import { MapHeader, useActiveBoost } from '../../components/map/MapHeader';
import { DiscoveryToast } from '../../components/map/DiscoveryToast';
import { UserPreviewSheet, USER_SHEET_FRACTION, type UserPreviewSheetHandle } from '../../components/map/UserPreviewSheet';
import { PlacePreviewSheet, PLACE_SHEET_FRACTION, type PlacePreviewSheetHandle } from '../../components/map/PlacePreviewSheet';
import { FadeInView } from '../../components/animated/FadeInView';
import { buildAvatarLayers, buildAvatarRig, keyOf, resolveAvatar } from '../../avatar';
import { buildMapboxHtml } from './mapbox-html';
import { buildBeforeContentLoadedScript, cmd, parseWebMsg, type AvatarDefs, type CommandName, type MapUser, type PerfTier } from './bridge';
import { colors, radius, shadows, spacing, typography } from '@cruzei/ui-mobile';
import { distanceMeters, encodeGeohash, formatMapName, proximityRank } from '@cruzei/shared-utils';
import type { AvatarConfig, DiscoveryResponse, MapPosition, NearbyUser, POI, ProximityBand } from '@cruzei/shared-types';

const HOT_MIN = 5;
const MAX_USERS = 300;
// pessoas: raio FIXO de descoberta — o servidor limita a 350 m e usa a MINHA posição como centro (brief PRIVACIDADE);
// o cliente não escolhe centro nem raio. Lugares (públicos) seguem o centro do mapa num raio largo.
const PEOPLE_RADIUS_M = 350;
const WIDE_RADIUS_M = 5000;
const NEARBY_REFETCH_MS = 45_000;
const LOW_FPS_SAMPLES = 4;
const HIGH_FPS_SAMPLES = 3;
// histerese: sobe pra 'mid' com ≥26 fps e pra 'high' com ≥42; desce de 'high' só abaixo de 30 e de 'mid' abaixo de 20
const PROMOTE_FPS: Record<PerfTier, number> = { low: 0, mid: 26, high: 42 };
const DEMOTE_FPS: Record<PerfTier, number> = { high: 30, mid: 20, low: 0 };
// amostras de fps logo após o 'ready' não valem: o mapa ainda está carregando tiles/imagens
const PERF_WARMUP_MS = 12_000;
const HEADING_MIN_DELTA = 4;
const HEADING_THROTTLE_MS = 100;
const PADDING_THROTTLE_MS = 16;
const MATCH_MOMENT_FALLBACK_MS = 3800;
// origem http: página http carrega imagens http (fotos de dev na LAN) e https (Mapbox, R2) sem 'mixed content'
const BASE_URL = 'http://app.cruzei.com.br/';

// ordem de reaplicação do estado após um 'ready' (reload/crash do WebView)
const REPLAY_ORDER: CommandName[] = ['setTier', 'setTheme', 'setActive', 'setMe', 'reveal', 'setData', 'select', 'setPadding'];
// one-shots que vale a pena segurar até o 'ready'; comandos de câmera antes do ready só atropelariam o reveal
const QUEUEABLE: ReadonlySet<CommandName> = new Set<CommandName>(['burst']);
const TIER_BELOW: Record<PerfTier, PerfTier | null> = { high: 'mid', mid: 'low', low: null };
const TIER_ABOVE: Record<PerfTier, PerfTier | null> = { low: 'mid', mid: 'high', high: null };

interface LikeResponse {
  isMatch: boolean;
  matchId?: string;
  context?: string | null;
}

interface WaveResponse {
  ok: boolean;
  duplicate?: boolean;
}

interface NearbyData {
  users: NearbyUser[];
  pois: POI[];
  /** pessoas por perto que existem mas não aparecem (região esparsa) — só o número */
  hiddenCount: number;
  me: DiscoveryResponse['me'] | null;
}

function minTier(a: PerfTier, b: PerfTier): PerfTier {
  const rank: Record<PerfTier, number> = { low: 0, mid: 1, high: 2 };
  return rank[a] <= rank[b] ? a : b;
}

function addTo(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(set);
  next.add(id);
  return next;
}

export function MapScreen() {
  const webRef = useRef<WebView>(null);
  const sheetRef = useRef<MapBottomSheetHandle>(null);
  const userSheetRef = useRef<UserPreviewSheetHandle>(null);
  const placeSheetRef = useRef<PlacePreviewSheetHandle>(null);
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
  const radiusM = PEOPLE_RADIUS_M;
  const myPhotoUrl = useMemo(() => {
    const main = me?.photos?.find((p) => p.isMain) ?? me?.photos?.[0];
    return main?.thumbnailUrl ?? main?.url ?? null;
  }, [me?.photos]);
  // minha bolha de identidade no mapa: preferência "mostrar minha foto no mapa" e nunca em modo anônimo (§7)
  const showMyPhoto = (me?.settings?.showPhotoOnMap ?? true) && !isAnonymous;
  // meu avatar: o mesmo do onboarding/perfil (fallback determinístico enquanto não personalizou)
  const myAvatar = useMemo(() => resolveAvatar(me?.avatar ?? null, me?.id ?? 'me', me?.gender ?? null), [me?.avatar, me?.id, me?.gender]);
  const myAvatarKey = keyOf(myAvatar);

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

  // ---------- definições de avatar (cache por visual, não por pessoa) ----------
  // O WebView desenha silhueta até receber as camadas da chave; mandamos cada chave UMA vez por vida do WebView.
  const sentAvatarKeys = useRef(new Set<string>());
  const knownAvatars = useRef(new Map<string, AvatarConfig>());
  const defineAvatars = useCallback(
    (configs: Iterable<AvatarConfig>) => {
      const defs: AvatarDefs = {};
      let count = 0;
      for (const cfg of configs) {
        const key = keyOf(cfg);
        knownAvatars.current.set(key, cfg);
        if (sentAvatarKeys.current.has(key)) continue;
        sentAvatarKeys.current.add(key);
        defs[key] = { l: buildAvatarLayers(cfg, { groundShadow: true }), p: buildAvatarRig(cfg) };
        count += 1;
      }
      if (count > 0 && readyRef.current) inject(cmd.defineAvatars(defs));
    },
    [inject],
  );
  // depois de um reload do WebView, as chaves precisam ir de novo (o HTML nasceu vazio)
  const resendAvatars = useCallback(() => {
    sentAvatarKeys.current.clear();
    defineAvatars(knownAvatars.current.values());
  }, [defineAvatars]);

  const flushOnReady = useCallback(() => {
    resendAvatars();
    for (const key of REPLAY_ORDER) {
      const js = stateCmds.current.get(key);
      if (js) inject(js);
    }
    for (const js of oneShots.current) inject(js);
    oneShots.current = [];
  }, [inject, resendAvatars]);

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
  const highFpsCount = useRef(0);
  const readyAt = useRef(0);

  // manda o tier EFETIVO (nunca sobe o WebView acima do que ele mediu num reload)
  useEffect(() => {
    if (forcedTier) send(cmd.setTier(tier), 'setTier');
  }, [forcedTier, tier, send]);

  // ---------- centro da query (gesto real no mapa) ----------
  const [userCenter, setUserCenter] = useState<{ lat: number; lng: number } | null>(null);
  const queryCenter = userCenter ?? (lat != null && lng != null ? { lat, lng } : null);
  const centerGeohash = queryCenter ? encodeGeohash(queryCenter.lat, queryCenter.lng, 6) : null;
  // minha célula (~150 m): quando eu ando, as distâncias do servidor são recalculadas a partir de mim
  const meGeohash = lat != null && lng != null ? encodeGeohash(lat, lng, 7) : null;

  // ---------- seleção / filtros / feedback ----------
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedPoiId, setSelectedPoiId] = useState<number | null>(null);
  const rootNav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const tabNav = useNavigation<NavigationProp<MainTabParamList>>();
  const [poiFilter, setPoiFilter] = useState<PoiFilter | null>(null);
  const [groupFilter, setGroupFilter] = useState<GroupFilter | null>(null);
  const [passed, setPassed] = useState<ReadonlySet<string>>(() => new Set());
  const [likedIds, setLikedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [wavedIds, setWavedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [localMatches, setLocalMatches] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [match, setMatch] = useState<MatchInfo | null>(null);
  const [moment, setMoment] = useState<{ name: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
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
  // pessoas: o servidor usa a MINHA posição como centro (não manda centro nem me_lat) e devolve só faixas e posições
  // visuais anonimizadas; lugares (públicos) seguem o centro do mapa no raio largo
  const nearbyQuery = useQuery({
    queryKey: ['nearby', centerGeohash, meGeohash],
    enabled: Boolean(queryCenter),
    refetchInterval: active ? NEARBY_REFETCH_MS : false,
    placeholderData: keepPreviousData, // ao mudar de célula, sheet e card não piscam '0 pessoas'
    queryFn: async (): Promise<NearbyData> => {
      const c = queryCenter as { lat: number; lng: number };
      const [u, p] = await Promise.all([
        api.get<DiscoveryResponse>('/location/nearby', { params: { radius_meters: PEOPLE_RADIUS_M } }),
        api.get<POI[]>('/pois/nearby', { params: { lat: c.lat, lng: c.lng, radius_meters: WIDE_RADIUS_M } }),
      ]);
      return { users: u.data.users, pois: p.data, hiddenCount: u.data.hiddenCount, me: u.data.me };
    },
  });

  // faixa de proximidade vem do SERVIDOR (calculada da posição real de quem consulta contra a posição VISUAL da
  // pessoa): o app nunca vê metros nem coordenada real de ninguém
  const { users, pois, bandById, hiddenCount, meDiscovery } = useMemo(() => {
    const raw = nearbyQuery.data?.users ?? [];
    const bands = new Map<string, ProximityBand>();
    for (const u of raw) bands.set(u.id, u.proximityBand);
    const sorted = raw
      .filter((u) => !passed.has(u.id))
      // match feito nesta sessão vale na hora (bolha, lista e sheet), sem esperar o próximo /nearby
      .map((u) => {
        const local = localMatches.get(u.id);
        return local && u.matchId !== local ? { ...u, matchId: local } : u;
      })
      .sort((a, b) => proximityRank(bands.get(a.id)) - proximityRank(bands.get(b.id)))
      .slice(0, MAX_USERS);
    return { users: sorted, pois: nearbyQuery.data?.pois ?? [], bandById: bands, hiddenCount: nearbyQuery.data?.hiddenCount ?? 0, meDiscovery: nearbyQuery.data?.me ?? null };
  }, [nearbyQuery.data, passed, localMatches]);

  // pessoas como vão pro mapa: cada uma com a chave do seu avatar (o desenho fica em cache no WebView por chave)
  // só quem tem posição VISUAL (o servidor omite o marcador de quem está em região esparsa)
  const mapUsers = useMemo<MapUser[]>(
    () =>
      users
        .filter((u): u is NearbyUser & { mapPosition: MapPosition } => u.mapPosition != null)
        .map((u) => {
          const cfg = resolveAvatar(u.avatar, u.id);
          // rótulo curto (§5) e foto da bolha (§7: só o thumbnail e só com a preferência da pessoa ligada — o servidor já filtra)
          return { ...u, avatarKey: keyOf(cfg), aura: cfg.aura, label: formatMapName(u.name), photo: u.mapPhotoUrl ?? null };
        }),
    [users],
  );

  const selectedUser = useMemo(() => users.find((u) => u.id === selected) ?? null, [users, selected]);
  const selectedPoi = useMemo(() => pois.find((p) => p.id === selectedPoiId) ?? null, [pois, selectedPoiId]);
  const selectedMatchId = selectedUser ? (localMatches.get(selectedUser.id) ?? selectedUser.matchId ?? null) : null;
  const selectedLiked = selectedUser ? likedIds.has(selectedUser.id) || Boolean(selectedUser.likedByMe) : false;

  // pessoas "nesse lugar": só quem o SERVIDOR diz que está lá (presença no lugar; sem cálculo por coordenada aqui)
  const placePeople = useMemo(() => {
    if (!selectedPoi) return [];
    return users.filter((u) => u.poi?.id === selectedPoi.id);
  }, [users, selectedPoi]);
  const placeDistance = useMemo(
    () => (selectedPoi && lat != null && lng != null ? distanceMeters(lat, lng, selectedPoi.latitude, selectedPoi.longitude) : null),
    [selectedPoi, lat, lng],
  );

  // Voltar (Android) com sheet de pessoa/lugar aberta fecha a sheet em vez de sair do app
  useEffect(() => {
    if (!isFocused || (!selected && selectedPoiId == null)) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setSelected(null);
      setSelectedPoiId(null);
      return true;
    });
    return () => sub.remove();
  }, [isFocused, selected, selectedPoiId]);

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
  const measuredTierRef = useRef(measuredTier);
  measuredTierRef.current = measuredTier;

  // ---------- descoberta (dicas discretas) + indicadores do header ----------
  const hints = useDiscoveryHints(users, pois, bandById, active && webReady, `${centerGeohash ?? ''}|${radiusM}`);
  const hintsRef = useRef(hints);
  hintsRef.current = hints;
  const indicators = useMemo(() => {
    const hot = pois.filter((p) => (p.userCount ?? 0) >= HOT_MIN).length;
    const near = users.filter((u) => proximityRank(bandById.get(u.id)) <= 1).length; // bem perto + perto (≤ 250 m)
    return { hot, near, fresh: Boolean(hints.hint) };
  }, [pois, users, bandById, hints.hint]);

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
    defineAvatars([myAvatar]);
    send(
      cmd.setMe({
        lat,
        lng,
        heading,
        tier: myTier,
        isBoosted,
        isAnonymous,
        photoUrl: showMyPhoto ? myPhotoUrl : null,
        name: formatMapName(me?.name) || 'você',
        avatarKey: myAvatarKey,
        aura: myAvatar.aura,
      }),
      'setMe',
    );
  }, [lat, lng, heading, myTier, isBoosted, isAnonymous, myPhotoUrl, showMyPhoto, me?.name, myAvatar, myAvatarKey, defineAvatars, send]);

  // setData quando a lista memoizada muda (dados novos, minha posição pro corte dos 300, passar).
  // As definições de avatar vão ANTES: quem chega novo já nasce desenhado, sem silhueta.
  const hasData = Boolean(nearbyQuery.data);
  useEffect(() => {
    if (!hasData) return;
    defineAvatars(users.map((u) => resolveAvatar(u.avatar, u.id)));
    send(cmd.setData({ users: mapUsers, pois, hotMin: HOT_MIN }), 'setData');
    // o WebView descarta as definições de quem saiu do mapa no mesmo setData: espelha aqui pra não acumular
    const used = new Set(mapUsers.map((u) => u.avatarKey));
    used.add(myAvatarKey);
    for (const key of Array.from(sentAvatarKeys.current)) if (!used.has(key)) sentAvatarKeys.current.delete(key);
    for (const key of Array.from(knownAvatars.current.keys())) if (!used.has(key)) knownAvatars.current.delete(key);
  }, [hasData, users, mapUsers, pois, myAvatarKey, defineAvatars, send]);

  useEffect(() => {
    send(cmd.select(selected), 'select');
  }, [selected, send]);

  // sheet de pessoa e de lugar são exclusivas entre si; abrir uma recolhe a lista
  useEffect(() => {
    if (selected) {
      setSelectedPoiId(null);
      sheetRef.current?.snapToIndex(0);
    }
  }, [selected]);
  useEffect(() => {
    if (selectedPoiId != null) {
      setSelected(null);
      sheetRef.current?.snapToIndex(0);
    }
  }, [selectedPoiId]);

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

  // com uma sheet de pessoa/lugar aberta, o padding é dela (a lista fica recolhida por baixo)
  const previewFraction = selectedUser ? USER_SHEET_FRACTION : selectedPoi ? PLACE_SHEET_FRACTION : null;
  const previewFractionRef = useRef<number | null>(null);
  previewFractionRef.current = previewFraction;

  const sheetPosition = useSharedValue(0);
  const containerHRef = useRef(0);
  containerHRef.current = containerH;
  const onSheetPosition = useCallback(
    (position: number) => {
      const h = containerHRef.current;
      if (h <= 0 || previewFractionRef.current != null) return;
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
  // fallback pro 1º layout (antes do gorhom animar), pra quando a altura muda e pra troca lista <-> preview
  useEffect(() => {
    if (containerH <= 0) return;
    sendPadding(Math.round(containerH * (previewFraction ?? SHEET_SNAP_FRACTIONS[sheetIndex])));
  }, [containerH, sheetIndex, previewFraction, sendPadding]);

  // ---------- match: momento no mapa (doc §7) e depois a celebração ----------
  const pendingMatch = useRef<MatchInfo | null>(null);
  const matchQueue = useRef<{ userId: string; name: string; info: MatchInfo | null }[]>([]);
  const momentActive = useRef(false);
  const momentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finishMoment = useCallback(() => {
    if (momentTimer.current) {
      clearTimeout(momentTimer.current);
      momentTimer.current = null;
    }
    momentActive.current = false;
    setMoment(null);
    const next = pendingMatch.current;
    pendingMatch.current = null;
    if (next) setMatch(next);
  }, []);
  const playMoment = useCallback(
    (userId: string, name: string, then: MatchInfo | null) => {
      if (momentActive.current) {
        // já tem um momento rodando: guarda e toca depois que o modal desse fechar
        matchQueue.current.push({ userId, name, info: then });
        return;
      }
      momentActive.current = true;
      pendingMatch.current = then;
      setSelected(null);
      setSelectedPoiId(null);
      // lista recolhida: o momento acontece no mapa, com os dois avatares enquadrados
      sheetRef.current?.snapToIndex(0);
      setMoment({ name });
      send(cmd.matchMoment(userId));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      if (momentTimer.current) clearTimeout(momentTimer.current);
      momentTimer.current = setTimeout(finishMoment, MATCH_MOMENT_FALLBACK_MS); // se o WebView não responder
    },
    [send, finishMoment],
  );
  useEffect(() => () => {
    if (momentTimer.current) clearTimeout(momentTimer.current);
  }, []);

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
          // WebView que nasceu com tier forçado (remount em low) não mediu de verdade: mantém o teto anterior
          if (savedTier === 'auto') setMeasuredTier(msg.tier);
          lowFpsCount.current = 0;
          highFpsCount.current = 0;
          readyAt.current = Date.now();
          if (__DEV__) console.info('[map] ready tier=' + msg.tier + ' fps=' + msg.fps + ' webgl2=' + msg.webgl2 + ' dpr=' + msg.dpr); // eslint-disable-line no-console
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
          const poi = poisRef.current.find((p) => p.id === msg.id);
          if (poi) {
            setSelectedPoiId(poi.id);
            send(cmd.focusPoi(poi.id));
          }
          break;
        }
        case 'clusterTap': {
          // grupo no mesmo ponto: lista só com quem está ali (doc §13)
          Haptics.selectionAsync().catch(() => {});
          const ids = new Set(msg.ids);
          const n = usersRef.current.filter((u) => ids.has(u.id)).length;
          if (n > 0) {
            setSelected(null);
            setSelectedPoiId(null);
            setPoiFilter(null);
            setGroupFilter({ ids: msg.ids, label: `${n} ${n === 1 ? 'pessoa' : 'pessoas'} nesse ponto` });
            sheetRef.current?.snapToIndex(1);
          }
          break;
        }
        case 'mapTap': {
          setSelected(null);
          setSelectedPoiId(null);
          sheetRef.current?.snapToIndex(0);
          break;
        }
        case 'hotspotBorn': {
          hintsRef.current.onHotspotBorn({ poiId: msg.poiId, name: msg.name, userCount: msg.userCount });
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          break;
        }
        case 'matchMomentDone': {
          finishMoment();
          break;
        }
        case 'perf': {
          if (__DEV__) console.info('[map] fps=' + msg.fps + ' tier=' + tierRef.current); // eslint-disable-line no-console
          if (Date.now() - readyAt.current < PERF_WARMUP_MS) break;
          const upNext = TIER_ABOVE[tierRef.current];
          if (upNext && msg.fps >= PROMOTE_FPS[upNext]) {
            // aparelho folgado: sobe um degrau de cada vez (e libera o teto quando chega no medido)
            highFpsCount.current += 1;
            if (highFpsCount.current >= HIGH_FPS_SAMPLES) {
              highFpsCount.current = 0;
              const cur = tierRef.current;
              const up = TIER_ABOVE[cur];
              if (up) {
                useMapPerfStore.getState().raiseTier(up);
                setMeasuredTier(up); // o teto medido no boot era pessimista
                setForcedTier(null);
                send(cmd.setTier(up), 'setTier');
              }
            }
          } else highFpsCount.current = 0;
          if (msg.fps < DEMOTE_FPS[tierRef.current]) {
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
    [flushOnReady, onWebDead, remountWeb, send, finishMoment, savedTier],
  );

  // ---------- acenos recebidos (socket) ----------
  useEffect(() => {
    if (!active) return;
    // connectSocket resolve quando o socket existir (no 1º mount o App ainda está conectando)
    let cancelled = false;
    let off: (() => void) | null = null;
    const onWave = (p: { fromUserId?: string; name?: string }) => {
      showToast(`👋 ${p?.name ?? 'Alguém'} acenou pra você`);
      if (p?.fromUserId) send(cmd.emote(p.fromUserId, 'wave')); // quem acenou acena no mapa
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    };
    const onLikeReceived = (p: { fromUserId?: string }) => {
      if (p?.fromUserId) send(cmd.emote(p.fromUserId, 'like'));
    };
    connectSocket()
      .then((socket) => {
        if (cancelled || !socket) return;
        socket.on('wave_received' as never, onWave as never);
        socket.on('like_received' as never, onLikeReceived as never);
        off = () => {
          socket.off('wave_received' as never, onWave as never);
          socket.off('like_received' as never, onLikeReceived as never);
        };
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      off?.();
    };
  }, [active, showToast, send]);

  // ---------- ações ----------
  const like = useCallback(
    async (u: NearbyUser, isSuper = false) => {
      if (u.isAnonymous) return;
      try {
        const res = await api.post<LikeResponse>('/likes', { userId: u.id, isSuper });
        setLikedIds((prev) => addTo(prev, u.id));
        send(cmd.emote(u.id, 'like')); // a pessoa reage no mapa
        if (res.data.isMatch && res.data.matchId) {
          const matchId = res.data.matchId;
          setLocalMatches((prev) => {
            const next = new Map(prev);
            next.set(u.id, matchId);
            return next;
          });
          const info: MatchInfo = {
            matchId,
            userId: u.id,
            name: u.name,
            photo: u.mainPhotoUrl,
            avatar: u.avatar ?? null,
            context: res.data.context,
            band: bandById.get(u.id) ?? null,
          };
          playMoment(u.id, u.name, info);
        } else if (u.mapPosition) {
          send(cmd.burst({ lat: u.mapPosition.lat, lng: u.mapPosition.lng, kind: isSuper ? 'super' : 'like' }), undefined, 'burst');
          showToast(isSuper ? `Super curtida enviada pra ${u.name} ⭐` : `Curtida enviada pra ${u.name} 💚`);
        } else {
          showToast(isSuper ? `Super curtida enviada pra ${u.name} ⭐` : `Curtida enviada pra ${u.name} 💚`);
        }
        qc.invalidateQueries({ queryKey: ['matches'] });
      } catch (err) {
        showToast(toApiError(err).message || 'Ops, deu ruim. Tenta de novo?');
      }
    },
    [qc, send, showToast, bandById, playMoment],
  );
  const onLike = useCallback((u: NearbyUser) => void like(u, false), [like]);
  const onSuperLike = useCallback((u: NearbyUser) => void like(u, true), [like]);

  const onWave = useCallback(
    async (u: NearbyUser) => {
      try {
        const res = await api.post<WaveResponse>('/waves', { userId: u.id });
        setWavedIds((prev) => addTo(prev, u.id));
        send(cmd.emote('me', 'wave')); // meu avatar acena no mapa
        if (u.mapPosition) send(cmd.burst({ lat: u.mapPosition.lat, lng: u.mapPosition.lng, kind: 'like' }), undefined, 'burst');
        showToast(res.data.duplicate ? `Você já acenou pra ${u.name} hoje 👋` : `Você acenou pra ${u.name} 👋`);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      } catch (err) {
        showToast(toApiError(err).message || 'Não deu pra acenar agora. Tenta de novo?');
      }
    },
    [send, showToast],
  );

  // 'passar' some na hora (filtro local) e vai pro servidor, pra sumir também do deck de Curtidas e não voltar no refetch
  const onPass = useCallback(
    (u: NearbyUser) => {
      setPassed((prev) => addTo(prev, u.id));
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
  }, []);
  const onOpenProfile = useCallback(
    (u: NearbyUser) => {
      rootNav.navigate('UserCard', { userId: u.id, band: bandById.get(u.id) ?? null });
    },
    [rootNav, bandById],
  );
  const onChat = useCallback(
    (matchId: string, u: NearbyUser) => {
      setSelected(null);
      // initial:false → a lista de matches fica embaixo na pilha e o chat ganha botão de voltar
      tabNav.navigate('Matches', { screen: 'Chat', initial: false, params: { matchId, name: u.name } } as never);
    },
    [tabNav],
  );
  // fechou o modal: se outro match ficou na fila, toca o momento dele agora
  const onMatchClosed = useCallback(() => {
    setMatch(null);
    const next = matchQueue.current.shift();
    if (next) setTimeout(() => playMoment(next.userId, next.name, next.info), 300);
  }, [playMoment]);
  const onViewMatchOnMap = useCallback(
    (info: MatchInfo) => {
      if (!info.userId) return;
      const u = usersRef.current.find((x) => x.id === info.userId);
      if (!u) {
        showToast(`${info.name} não está mais por perto`);
        return;
      }
      playMoment(u.id, u.name, null);
    },
    [playMoment, showToast],
  );

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
    Alert.alert('Quer ver sem aparecer?', 'Em modo anônimo você vê todo mundo, mas ninguém te vê no mapa e não rola match por enquanto.', [
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
  const onSeePlacePeople = useCallback((poi: POI) => {
    setSelectedPoiId(null);
    setGroupFilter(null);
    setPoiFilter({ id: poi.id, name: poi.name });
    sheetRef.current?.snapToIndex(1);
  }, []);
  const onGoToPlace = useCallback(
    (poi: POI) => {
      setSelectedPoiId(null);
      send(cmd.focusPoi(poi.id));
    },
    [send],
  );
  const closeUserSheet = useCallback(() => setSelected(null), []);
  const closePlaceSheet = useCallback(() => setSelectedPoiId(null), []);
  const clearPoiFilter = useCallback(() => setPoiFilter(null), []);
  const clearGroupFilter = useCallback(() => setGroupFilter(null), []);
  const onSheetChange = useCallback((index: number) => setSheetIndex(Math.max(0, index)), []);
  const onLayout = useCallback((e: LayoutChangeEvent) => setContainerH(e.nativeEvent.layout.height), []);

  // pessoas no filtro por lugar = quem o servidor diz que está no lugar (mesma regra da sheet do lugar)
  const poiFilterIds = useMemo(() => {
    if (!poiFilter) return null;
    return users.filter((u) => u.poi?.id === poiFilter.id).map((u) => u.id);
  }, [poiFilter, users]);

  const floatBottom = Math.round(containerH * (previewFraction ?? SHEET_SNAP_FRACTIONS[sheetIndex])) + spacing.sm;
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
        indicators={indicators}
        hiddenReason={meDiscovery && !meDiscovery.discoverable ? meDiscovery.hiddenReason : null}
      />

      {moment ? (
        <View style={styles.momentWrap} pointerEvents="none">
          <FadeInView fromY={-10} fromScale={0.9} style={styles.moment} accessibilityLiveRegion="assertive">
            <Text style={styles.momentTitle}>🔥 CRUZEI!</Text>
            <Text style={styles.momentText}>Você e {moment.name} deram match</Text>
          </FadeInView>
        </View>
      ) : null}

      <View style={[styles.floating, { bottom: floatBottom }]} pointerEvents="box-none">
        <DiscoveryToast hint={hints.hint} onPress={onFocusPoi} onHide={hints.hide} />

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
      </View>

      <MapBottomSheet
        ref={sheetRef}
        users={users}
        bandById={bandById}
        hiddenCount={hiddenCount}
        radiusM={radiusM}
        isFree={isFree}
        isLoading={listLoading}
        poiFilter={poiFilter}
        poiFilterIds={poiFilterIds}
        onClearPoiFilter={clearPoiFilter}
        groupFilter={groupFilter}
        onClearGroupFilter={clearGroupFilter}
        onChange={onSheetChange}
        animatedPosition={sheetPosition}
        onSelect={onSelectUser}
        onLike={onLike}
        onSuperLike={onSuperLike}
        onPass={onPass}
      />

      <UserPreviewSheet
        ref={userSheetRef}
        user={selectedUser}
        band={selectedUser ? (bandById.get(selectedUser.id) ?? null) : null}
        liked={selectedLiked}
        waved={selectedUser ? wavedIds.has(selectedUser.id) : false}
        matchId={selectedMatchId}
        onLike={onLike}
        onWave={onWave}
        onChat={onChat}
        onOpenProfile={onOpenProfile}
        onClose={closeUserSheet}
      />

      <PlacePreviewSheet
        ref={placeSheetRef}
        poi={selectedPoi}
        people={placePeople}
        distanceM={placeDistance}
        hotMin={HOT_MIN}
        onSeePeople={onSeePlacePeople}
        onSelectPerson={onSelectUser}
        onGo={onGoToPlace}
        onClose={closePlaceSheet}
      />

      {!webReady && !mapError ? (
        <View style={styles.loader} pointerEvents="none">
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : null}

      <MatchModal match={match} onClose={onMatchClosed} onViewOnMap={onViewMatchOnMap} />
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
  momentWrap: { position: 'absolute', top: '22%', left: 0, right: 0, alignItems: 'center' },
  moment: { alignItems: 'center', paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.xl, backgroundColor: 'rgba(18,18,42,0.92)', borderWidth: 1.5, borderColor: colors.secondary, ...shadows.strong },
  momentTitle: { ...typography.h1, color: colors.primary, letterSpacing: 2 },
  momentText: { ...typography.body, color: colors.white, marginTop: 2 },
  loader: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.overlay },
});
