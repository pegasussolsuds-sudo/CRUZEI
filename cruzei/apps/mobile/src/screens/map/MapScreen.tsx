import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, type AppStateStatus, BackHandler, type LayoutChangeEvent, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { openChat } from '../../navigation/openChat';
import { Ionicons } from '@expo/vector-icons';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { runOnJS, useAnimatedReaction, useSharedValue } from 'react-native-reanimated';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';

import { isMessagingLockedError, useInvisibleLikePrompt, useMessagingLocked } from '../../hooks/useMessagingLock';
import { api, toApiError } from '../../services/api';
import { connectSocket } from '../../services/socket';
import { useMyLocation } from '../../hooks/useMyLocation';
import { pushLocation } from '../../services/location';
import { useLocationStore } from '../../stores/location';
import { useVisibility } from '../../hooks/useVisibility';
import { useMapTheme } from '../../hooks/useMapTheme';
import { useDiscoveryHints } from '../../hooks/useDiscoveryHints';
import { iLiked, inboxKeys, likeStatusOf, likerIdOf } from '../../hooks/useInbox';
import { useAuthStore } from '../../stores/auth';
import { useBootStore } from '../../stores/boot';
import { useMapPerfStore } from '../../stores/mapPerf';
import { useMapFocusStore } from '../../stores/mapFocus';
import { MatchModal, type MatchInfo } from '../../components/MatchModal';
import { MapBottomSheet, SHEET_SNAP_FRACTIONS, type GroupFilter, type MapBottomSheetHandle, type PoiFilter } from '../../components/map/MapBottomSheet';
import { MapHeader, useActiveBoost } from '../../components/map/MapHeader';
import { DiscoveryToast } from '../../components/map/DiscoveryToast';
import { VibeOverlay } from '../../components/map/VibeOverlay';
import { VenueCard } from '../../components/map/VenueCard';
import { NamePlaceCard, type PlacePromptAnswer } from '../../components/map/NamePlaceCard';
import { votePlace } from '../../hooks/usePlaceContrib';
import { placeKindMeta } from '../../components/map/placeKinds';
import { invisibleTapText } from '../../components/map/invisible';
import type { GeocodeResult } from '../../hooks/useGeocodeSearch';
import { UserPreviewSheet, USER_SHEET_FRACTION, type UserPreviewSheetHandle } from '../../components/map/UserPreviewSheet';
import { PlacePreviewSheet, PLACE_SHEET_FRACTION, type PlacePreviewSheetHandle } from '../../components/map/PlacePreviewSheet';
import { FadeInView } from '../../components/animated/FadeInView';
import { buildAvatarLayers, buildAvatarRig, keyOf, resolveAvatar } from '../../avatar';
import { cmd, type AvatarDefs, type CommandName, type InitTier, type MapCommand, type MapEvent, type MapUser, type PerfTier, type PinPayload } from './bridge';
import { NativeMap, type NativeMapHandle } from './native/NativeMap';
import { colors, radius, shadows, spacing, typography } from '@cruzei/ui-mobile';
import { distanceMeters, encodeGeohash, formatMapName, proximityRank } from '@cruzei/shared-utils';
import type { AvatarConfig, DiscoveryResponse, LikeResult, MapPosition, CatalogPlace, NearbyUser, POI, PlacePrompt, PlaceSuggestResponse, ProximityBand, VibePlace } from '@cruzei/shared-types';
import { BRAND } from '../../brand';

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
const TOAST_MS = 2500;
/** o aviso dos invisíveis é mais comprido: fica um pouco mais na tela */
const INVISIBLE_TOAST_MS = 4000;

// ordem de reaplicação do estado após um 'ready' (mapa novo depois de um erro fatal)
const REPLAY_ORDER: CommandName[] = ['setTier', 'setTheme', 'setActive', 'setMe', 'reveal', 'setData', 'setInvisible', 'select', 'setPadding', 'setPin'];
// one-shots que vale a pena segurar até o 'ready'; comandos de câmera antes do ready só atropelariam o reveal
const QUEUEABLE: ReadonlySet<CommandName> = new Set<CommandName>(['burst']);
const TIER_BELOW: Record<PerfTier, PerfTier | null> = { high: 'mid', mid: 'low', low: null };
const TIER_ABOVE: Record<PerfTier, PerfTier | null> = { low: 'mid', mid: 'high', high: null };

/** conversa do par que o /nearby manda (null = não há ou arquivei) */
function conversationIdOf(u: NearbyUser | null): string | null {
  return u?.conversation?.id ?? null;
}

interface WaveResponse {
  ok: boolean;
  duplicate?: boolean;
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
  const mapRef = useRef<NativeMapHandle>(null);
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
  // tracking: posição acompanhada + presença renovada só enquanto o mapa está em foco e o app em primeiro plano
  const { lat, lng, status: locStatus, locate, refresh: refreshLocation } = useMyLocation(true, active);
  const { isAnonymous, askToggle: askToggleVisibility, isPending: togglePending } = useVisibility();
  // invisível sem Premium não curte: explica e oferece ficar visível ou o Premium (o servidor também barra)
  const likeLocked = useMessagingLocked();
  const askInvisibleLike = useInvisibleLikePrompt();
  const { theme } = useMapTheme();
  const boostQuery = useActiveBoost(Boolean(me), active);
  const boost = boostQuery.data ?? null;
  // boost vale até expiresAt (não pelo snapshot de minutos): some na hora certa mesmo sem novo poll
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!active || !boost) return;
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [active, boost]);
  const boostMsLeft = boost ? Date.parse(boost.expiresAt) - nowMs : 0;
  const isBoosted = boostMsLeft > 0;
  const boostMinutes = isBoosted ? Math.ceil(boostMsLeft / 60_000) : null;
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

  // ---------- mapa nativo (MapLibre, tiles do OpenFreeMap: sem token) ----------
  // tier e tema iniciais são lidos só na montagem; promoção de tier e troca de tema ao vivo vão por setTier/setTheme.
  // `mapKey` só remonta o mapa depois de um erro fatal de carregamento (não há mapa na tela); vivo, ele nunca é recriado.
  const [initTier] = useState<InitTier>(() => useMapPerfStore.getState().tier);
  const [mapKey, setMapKey] = useState(0);
  const themeRef = useRef(theme);
  themeRef.current = theme;

  const readyRef = useRef(false);
  const stateCmds = useRef(new Map<CommandName, MapCommand>());
  const oneShots = useRef<MapCommand[]>([]);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  const inject = useCallback((c: MapCommand) => {
    mapRef.current?.run(c);
  }, []);

  /**
   * Envia um comando. Com `key`, guarda como "último estado" pra reaplicar no próximo 'ready'.
   * Antes do 'ready' só os one-shots em QUEUEABLE são segurados (câmera antes do ready atropelaria o reveal).
   */
  const send = useCallback(
    (c: MapCommand, key?: CommandName, oneShot?: CommandName) => {
      if (key) stateCmds.current.set(key, c);
      if (readyRef.current) inject(c);
      else if (!key && oneShot && QUEUEABLE.has(oneShot)) oneShots.current.push(c);
    },
    [inject],
  );

  // ---------- definições de avatar (cache por visual, não por pessoa) ----------
  // O mapa desenha silhueta até receber as camadas da chave; mandamos cada chave UMA vez por vida do mapa.
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
  // mapa novo (retry depois de erro fatal): as chaves precisam ir de novo
  const resendAvatars = useCallback(() => {
    sentAvatarKeys.current.clear();
    defineAvatars(knownAvatars.current.values());
  }, [defineAvatars]);

  const flushOnReady = useCallback(() => {
    resendAvatars();
    for (const key of REPLAY_ORDER) {
      const c = stateCmds.current.get(key);
      if (c) inject(c);
    }
    for (const c of oneShots.current) inject(c);
    oneShots.current = [];
  }, [inject, resendAvatars]);

  const onMapDead = useCallback((why: string) => {
    readyRef.current = false;
    setMapReady(false);
    setMapError(why);
  }, []);

  const retryMap = useCallback(() => {
    setMapError(null);
    readyRef.current = false;
    setMapReady(false);
    setMapKey((k) => k + 1); // o próximo 'ready' faz o replay do estado (REPLAY_ORDER)
  }, []);

  // ---------- tier de performance ----------
  const [measuredTier, setMeasuredTier] = useState<PerfTier>('high');
  const [forcedTier, setForcedTier] = useState<PerfTier | null>(null);
  const tier = forcedTier ? minTier(measuredTier, forcedTier) : measuredTier;
  const lowFpsCount = useRef(0);
  const highFpsCount = useRef(0);
  const readyAt = useRef(0);

  // manda o tier EFETIVO (nunca sobe o mapa acima do que ele mediu)
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
  // busca "Onde tá a vibe": overlay + lugar escolhido (pode estar fora do recorte atual do /pois/nearby)
  const [vibeOpen, setVibeOpen] = useState(false);
  const [pickedPoi, setPickedPoi] = useState<POI | null>(null);
  // lugar da cidade (bar, balada…) escolhido na busca: pino no mapa até fechar; o card some com toque no mapa e volta tocando no pino
  const [venue, setVenue] = useState<CatalogPlace | null>(null);
  const [venueCardOpen, setVenueCardOpen] = useState(false);
  const pendingFocus = useRef<number | null>(null);
  // altura real do header (barra de busca + linha da localização + banners): o mapa e o cartão do match se guiam por ela
  const [headerH, setHeaderH] = useState(0);
  const headerHRef = useRef(0);
  headerHRef.current = headerH;
  const lastBottomRef = useRef(0);
  const rootNav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [poiFilter, setPoiFilter] = useState<PoiFilter | null>(null);
  const [groupFilter, setGroupFilter] = useState<GroupFilter | null>(null);
  const [passed, setPassed] = useState<ReadonlySet<string>>(() => new Set());
  const [likedIds, setLikedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [wavedIds, setWavedIds] = useState<ReadonlySet<string>>(() => new Set());
  // curtida mútua feita nesta sessão vale na hora (bolha, lista e sheet), sem esperar o próximo /nearby
  const [localMutual, setLocalMutual] = useState<ReadonlySet<string>>(() => new Set());
  const [match, setMatch] = useState<MatchInfo | null>(null);
  const [moment, setMoment] = useState<{ name: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [containerH, setContainerH] = useState(0);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [peekH, setPeekH] = useState(0);
  const [canAskLocation, setCanAskLocation] = useState(true);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((t: string, ms: number = TOAST_MS) => {
    setToast(t);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), ms);
  }, []);
  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  // ---------- nearby ----------
  // pessoas: o servidor usa a MINHA posição como centro (não manda centro nem me_lat) e devolve só faixas e posições
  // visuais anonimizadas; lugares (públicos) seguem o centro do mapa no raio largo
  // pessoas: só a MINHA célula (~150 m) muda a consulta — arrastar o mapa não refaz a descoberta
  const nearbyQuery = useQuery({
    queryKey: ['nearby', 'people', meGeohash],
    enabled: Boolean(queryCenter),
    refetchInterval: active ? NEARBY_REFETCH_MS : false,
    placeholderData: keepPreviousData, // ao mudar de célula, sheet e card não piscam '0 pessoas'
    queryFn: async (): Promise<DiscoveryResponse> =>
      (await api.get<DiscoveryResponse>('/location/nearby', { params: { radius_meters: PEOPLE_RADIUS_M } })).data,
  });
  // lugares (públicos): seguem o centro do mapa (célula de ~1 km)
  const poisQuery = useQuery({
    queryKey: ['nearby', 'pois', centerGeohash],
    enabled: Boolean(queryCenter),
    refetchInterval: active ? NEARBY_REFETCH_MS : false,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<POI[]> => {
      const c = queryCenter as { lat: number; lng: number };
      return (await api.get<POI[]>('/pois/nearby', { params: { lat: c.lat, lng: c.lng, radius_meters: WIDE_RADIUS_M } })).data;
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
      // curtida mútua feita nesta sessão vale na hora (bolha, lista e sheet), sem esperar o próximo /nearby
      .map((u): NearbyUser => (localMutual.has(u.id) && u.likeStatus !== 'MUTUAL' ? { ...u, likeStatus: 'MUTUAL' } : u))
      .sort((a, b) => proximityRank(bands.get(a.id)) - proximityRank(bands.get(b.id)))
      .slice(0, MAX_USERS);
    return { users: sorted, pois: poisQuery.data ?? [], bandById: bands, hiddenCount: nearbyQuery.data?.hiddenCount ?? 0, meDiscovery: nearbyQuery.data?.me ?? null };
  }, [nearbyQuery.data, poisQuery.data, passed, localMutual]);

  // servidor sem minha presença (TTL venceu / push falhou): republica uma vez por transição, em vez de ficar invisível
  const repushedRef = useRef(false);
  const noPresence = Boolean(meDiscovery && !meDiscovery.discoverable && meDiscovery.hiddenReason === 'no_presence');
  const refetchNearby = nearbyQuery.refetch;
  useEffect(() => {
    if (!noPresence) {
      repushedRef.current = false;
      return;
    }
    if (repushedRef.current || !active) return;
    const cur = useLocationStore.getState();
    if (cur.lat == null || cur.lng == null) return;
    repushedRef.current = true;
    pushLocation({ latitude: cur.lat, longitude: cur.lng })
      .then((r) => {
        if (r.ok) refetchNearby();
      })
      .catch(() => {});
  }, [noPresence, active, lat, lng, refetchNearby]);
  // "Tentar de novo" da sheet quando o /nearby falha (o evento do toque não vai pro refetch como opção)
  const retryNearby = useCallback(() => {
    refetchNearby();
  }, [refetchNearby]);

  // pessoas como vão pro mapa: cada uma com a chave do seu avatar (o desenho fica em cache no mapa por chave)
  // só quem tem posição VISUAL (o servidor omite o marcador de quem está em região esparsa)
  const mapUsers = useMemo<MapUser[]>(
    () =>
      users
        .filter((u): u is NearbyUser & { mapPosition: MapPosition } => u.mapPosition != null)
        .map((u) => {
          const cfg = resolveAvatar(u.avatar, u.id);
          // rótulo curto (§5) e foto da bolha (§7: só o thumbnail e só com a preferência da pessoa ligada — o servidor já filtra)
          return {
            ...u,
            avatarKey: keyOf(cfg),
            aura: cfg.aura,
            label: formatMapName(u.name),
            photo: u.mapPhotoUrl ?? null,
            mutual: likeStatusOf(u) === 'MUTUAL',
          };
        }),
    [users],
  );

  const selectedUser = useMemo(() => users.find((u) => u.id === selected) ?? null, [users, selected]);
  const selectedPoi = useMemo(
    () => pois.find((p) => p.id === selectedPoiId) ?? (pickedPoi && pickedPoi.id === selectedPoiId ? pickedPoi : null),
    [pois, selectedPoiId, pickedPoi],
  );

  // fechar a sheet / tocar no mapa / escolher outra coisa cancela o destaque pendente do lugar da busca
  useEffect(() => {
    if (selectedPoiId == null) pendingFocus.current = null;
  }, [selectedPoiId]);
  const selectedMutual = selectedUser ? likeStatusOf(selectedUser) === 'MUTUAL' : false;
  const selectedConversationId = conversationIdOf(selectedUser);
  const selectedLiked = selectedUser ? likedIds.has(selectedUser.id) || iLiked(likeStatusOf(selectedUser)) : false;

  // pessoas "nesse lugar": só quem o SERVIDOR diz que está lá (presença no lugar; sem cálculo por coordenada aqui)
  const placePeople = useMemo(() => {
    if (!selectedPoi) return [];
    return users.filter((u) => u.poi?.id === selectedPoi.id);
  }, [users, selectedPoi]);
  const placeDistance = useMemo(
    () => (selectedPoi && lat != null && lng != null ? distanceMeters(lat, lng, selectedPoi.latitude, selectedPoi.longitude) : null),
    [selectedPoi, lat, lng],
  );

  // Voltar (Android): fecha sheet de pessoa/lugar -> recolhe a lista expandida -> limpa filtro de grupo/lugar, em vez de sair do app
  useEffect(() => {
    const overlayOpen = Boolean(selected) || selectedPoiId != null || sheetIndex > 0 || groupFilter != null || poiFilter != null;
    if (!isFocused || !overlayOpen) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (selected || selectedPoiId != null) {
        setSelected(null);
        setSelectedPoiId(null);
      } else if (sheetIndex > 0) {
        sheetRef.current?.snapToIndex(0);
      } else {
        setGroupFilter(null);
        setPoiFilter(null);
      }
      return true;
    });
    return () => sub.remove();
  }, [isFocused, selected, selectedPoiId, sheetIndex, groupFilter, poiFilter]);

  // selecionado sumiu da lista (refetch, corte dos 300, passou) => limpa o anel no mapa também
  useEffect(() => {
    if (selected && !selectedUser) setSelected(null);
  }, [selected, selectedUser]);

  // refs pra onMapEvent ficar estável
  const usersRef = useRef(users);
  usersRef.current = users;
  const poisRef = useRef(pois);
  poisRef.current = pois;
  const tierRef = useRef(tier);
  tierRef.current = tier;
  const measuredTierRef = useRef(measuredTier);
  measuredTierRef.current = measuredTier;

  // ---------- descoberta (dicas discretas) + indicadores do header ----------
  const hints = useDiscoveryHints(users, pois, bandById, active && mapReady, `${centerGeohash ?? ''}|${radiusM}`);
  const hintsRef = useRef(hints);
  hintsRef.current = hints;
  const indicators = useMemo(() => {
    const hot = pois.filter((p) => (p.userCount ?? 0) >= HOT_MIN).length;
    const near = users.filter((u) => proximityRank(bandById.get(u.id)) <= 1).length; // bem perto + perto (≤ 250 m)
    return { hot, near, fresh: Boolean(hints.hint) };
  }, [pois, users, bandById, hints.hint]);

  // ---------- heading (só tier high, só em foco, só com o mapa pronto; throttle 100ms) ----------
  useEffect(() => {
    if (tier !== 'high' || !active || !mapReady || locStatus !== 'ready') {
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
  }, [tier, active, mapReady, locStatus]);

  // ---------- comandos de estado (idempotentes; reaplicados no próximo 'ready') ----------
  useEffect(() => {
    // replay após (re)montagem sem animação: o HTML já nasce no tema atual (init.theme lido na montagem)
    stateCmds.current.set('setTheme', cmd.setTheme(theme, false));
    // mudança ao vivo (17h/19h/6h ou override): crossfade
    if (readyRef.current) inject(cmd.setTheme(theme, true));
  }, [theme, inject]);

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
  const hasData = Boolean(nearbyQuery.data || poisQuery.data);
  useEffect(() => {
    if (!hasData) return;
    defineAvatars(users.map((u) => resolveAvatar(u.avatar, u.id)));
    send(cmd.setData({ users: mapUsers, pois, hotMin: HOT_MIN }), 'setData');
    const focusId = pendingFocus.current;
    if (focusId != null && pois.some((p) => p.id === focusId)) {
      pendingFocus.current = null;
      send(cmd.focusPoi(focusId));
    }
    // o mapa descarta as definições de quem saiu no mesmo setData: espelha aqui pra não acumular
    const used = new Set(mapUsers.map((u) => u.avatarKey));
    used.add(myAvatarKey);
    for (const key of Array.from(sentAvatarKeys.current)) if (!used.has(key)) sentAvatarKeys.current.delete(key);
    for (const key of Array.from(knownAvatars.current.keys())) if (!used.has(key)) knownAvatars.current.delete(key);
  }, [hasData, users, mapUsers, pois, myAvatarKey, defineAvatars, send]);

  // gente invisível (modo anônimo) por perto: só Premium — pra quem é grátis o servidor manda null e o mapa fica vazio.
  // Vai direto do /nearby pro mapa, agrupada por lugar/quadra (nunca quem é); nada disso é guardado ou registrado aqui
  const invisible = nearbyQuery.data?.invisible ?? null;
  const invisibleGroups = invisible?.groups ?? null;
  useEffect(() => {
    send(cmd.setInvisible(invisibleGroups), 'setInvisible');
  }, [invisibleGroups, send]);

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
        lastBottomRef.current = bottom;
        send(cmd.setPadding({ top: headerHRef.current, bottom }), 'setPadding');
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
  useEffect(() => {
    if (mapReady && headerH > 0) send(cmd.setPadding({ top: headerH, bottom: lastBottomRef.current }), 'setPadding');
  }, [headerH, mapReady, send]);

  // com uma sheet de pessoa/lugar aberta, o padding é dela (a lista fica recolhida por baixo)
  const previewFraction = selectedUser ? USER_SHEET_FRACTION : selectedPoi ? PLACE_SHEET_FRACTION : null;
  const previewFractionRef = useRef<number | null>(null);
  previewFractionRef.current = previewFraction;
  // altura da lista: recolhida = a que a sheet mediu (nunca corta título e filtros); aberta = 68%
  const listSheetH = useCallback(
    (i: number) => (i === 0 && peekH > 0 ? peekH : Math.round(containerH * SHEET_SNAP_FRACTIONS[i])),
    [peekH, containerH],
  );

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
    sendPadding(previewFraction != null ? Math.round(containerH * previewFraction) : listSheetH(sheetIndex));
  }, [containerH, sheetIndex, previewFraction, sendPadding, listSheetH]);

  // ---------- match: momento no mapa (doc §7) e depois a celebração ----------
  const pendingMatch = useRef<MatchInfo | null>(null);
  const matchQueue = useRef<{ userId: string; name: string; info: MatchInfo | null }[]>([]);
  const momentActive = useRef(false);
  const momentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queueTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playMomentRef = useRef<(userId: string, name: string, then: MatchInfo | null) => void>(() => {});
  const finishMoment = useCallback(() => {
    if (momentTimer.current) {
      clearTimeout(momentTimer.current);
      momentTimer.current = null;
    }
    momentActive.current = false;
    setMoment(null);
    const next = pendingMatch.current;
    pendingMatch.current = null;
    if (next) {
      setMatch(next); // o modal esvazia a fila no onMatchClosed
      return;
    }
    // momento sem modal (ex.: 'Ver no mapa'): se um match chegou no meio, toca agora em vez de perder
    const queued = matchQueue.current.shift();
    if (queued) queueTimer.current = setTimeout(() => playMomentRef.current(queued.userId, queued.name, queued.info), 300);
  }, []);
  const playMoment = useCallback(
    (userId: string, name: string, then: MatchInfo | null) => {
      if (momentActive.current) {
        // já tem um momento rodando: guarda e toca depois que ele (ou o modal dele) terminar; sem repetir a pessoa
        if (!matchQueue.current.some((q) => q.userId === userId)) matchQueue.current.push({ userId, name, info: then });
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
      momentTimer.current = setTimeout(finishMoment, MATCH_MOMENT_FALLBACK_MS); // se o mapa não responder
    },
    [send, finishMoment],
  );
  playMomentRef.current = playMoment;
  useEffect(() => () => {
    if (momentTimer.current) clearTimeout(momentTimer.current);
    if (queueTimer.current) clearTimeout(queueTimer.current);
    matchQueue.current = [];
  }, []);

  // ---------- eventos do mapa ----------
  const onMapEvent = useCallback(
    (msg: MapEvent) => {
      switch (msg.type) {
        case 'ready': {
          readyRef.current = true;
          setMapReady(true);
          setMapError(null);
          // o tier do 'ready' é o efetivo (medido, ou o salvo de uma abertura anterior): é ele que vale daqui pra frente
          setMeasuredTier(msg.tier);
          lowFpsCount.current = 0;
          highFpsCount.current = 0;
          readyAt.current = Date.now();
          if (__DEV__) console.info('[map] ready tier=' + msg.tier + ' fps=' + msg.fps); // eslint-disable-line no-console
          flushOnReady();
          break;
        }
        case 'styleLoaded':
          // estilo carregado: a splash pode sair por cima de um mapa já vivo (ver stores/boot.ts)
          useBootStore.getState().setMapReady(true);
          break;
        case 'error': {
          if (msg.fatal) {
            onMapDead(msg.message);
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
        case 'pinTap': {
          Haptics.selectionAsync().catch(() => {});
          setSelected(null);
          setSelectedPoiId(null);
          setVenueCardOpen(true);
          break;
        }
        case 'invisibleTap': {
          // nunca abre cartão de pessoa: só quantos (e o lugar, que é público)
          Haptics.selectionAsync().catch(() => {});
          showToast(invisibleTapText(msg.count, msg.place), INVISIBLE_TOAST_MS);
          break;
        }
        case 'mapTap': {
          setSelected(null);
          setSelectedPoiId(null);
          setVenueCardOpen(false);
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
                // rebaixamento persistido: a próxima abertura já nasce no tier menor
                if (next === 'low') useMapPerfStore.getState().setTier('low');
              }
            }
          } else {
            lowFpsCount.current = 0;
          }
          break;
        }
        default:
          break;
      }
    },
    [flushOnReady, onMapDead, send, finishMoment, showToast],
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
    // quem curtiu só vem pra Premium+ (ou na curtida mútua); sem id, nada no mapa entrega quem foi
    const onLikeReceived = (p: unknown) => {
      const from = likerIdOf(p);
      if (from) send(cmd.emote(from, 'like'));
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
  const likingRef = useRef(new Set<string>());
  const like = useCallback(
    async (u: NearbyUser, isSuper = false) => {
      if (u.isAnonymous) return;
      // já curtiu / já se curtiram: o servidor devolveria o like antigo e o app celebraria de novo (ou fingiria "enviada")
      const status = likeStatusOf(u);
      if (status === 'MUTUAL' || localMutual.has(u.id)) {
        showToast(`Você e ${u.name} já se curtiram 🔥`);
        return;
      }
      if (iLiked(status) || likedIds.has(u.id)) {
        showToast(`Você já curtiu ${u.name} 💚`);
        return;
      }
      if (likeLocked) {
        askInvisibleLike();
        return;
      }
      if (likingRef.current.has(u.id)) return; // toque duplo: um POST só
      likingRef.current.add(u.id);
      try {
        const res = await api.post<LikeResult>('/likes', { userId: u.id, isSuper });
        setLikedIds((prev) => addTo(prev, u.id));
        send(cmd.emote(u.id, 'like')); // a pessoa reage no mapa
        if (res.data.isMutual) {
          setLocalMutual((prev) => addTo(prev, u.id));
          // a curtida mútua promove a conversa do par pra principal (se já existia)
          qc.invalidateQueries({ queryKey: inboxKeys.all });
          const info: MatchInfo = {
            userId: u.id,
            name: u.name,
            photo: u.mainPhotoUrl,
            avatar: u.avatar ?? null,
            conversationId: res.data.promotedConversationIds[0] ?? conversationIdOf(u),
            band: bandById.get(u.id) ?? null,
          };
          playMoment(u.id, u.name, info);
        } else if (u.mapPosition) {
          send(cmd.burst({ lat: u.mapPosition.lat, lng: u.mapPosition.lng, kind: isSuper ? 'super' : 'like' }), undefined, 'burst');
          showToast(isSuper ? `Super curtida enviada pra ${u.name} ⭐` : `Curtida enviada pra ${u.name} 💚`);
        } else {
          showToast(isSuper ? `Super curtida enviada pra ${u.name} ⭐` : `Curtida enviada pra ${u.name} 💚`);
        }
      } catch (err) {
        if (isMessagingLockedError(err)) askInvisibleLike(true);
        else showToast(toApiError(err).message || 'Ops, deu ruim. Tenta de novo?');
      } finally {
        likingRef.current.delete(u.id);
      }
    },
    [qc, send, showToast, bandById, playMoment, likedIds, localMutual, likeLocked, askInvisibleLike],
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
  // "Mensagem"/"Conversar" da sheet: sem conversa ainda, o chat abre em rascunho (a 1ª mensagem cria)
  const onChat = useCallback((u: NearbyUser, conversationId: string | null) => {
    setSelected(null);
    openChat({ id: u.id, name: u.name, avatar: u.avatar ?? null }, conversationId);
  }, []);
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
    const cached = lat != null && lng != null ? { latitude: lat, longitude: lng } : null;
    // com posição em mãos centraliza na hora e renova o GPS por trás, sem status 'loading' (piscaria o heading/banner)
    if (cached) void refreshLocation();
    const loc = cached ?? (await locate());
    if (!loc) return;
    setUserCenter(null);
    send(cmd.setCenter(loc.latitude, loc.longitude, 16, { pitch: 58, bearing: -12, duration: 1100 }));
  }, [lat, lng, locate, refreshLocation, send]);

  // ligar explica o prazo e as mensagens do plano grátis (useVisibility.askToggle)
  const onToggleVisibility = askToggleVisibility;

  // permissão negada com "não perguntar de novo": o único caminho é a tela de ajustes. Re-checa a cada volta pro app;
  // se o usuário liberou nos ajustes, o useMyLocation re-localiza sozinho (e o banner some)
  useEffect(() => {
    if (locStatus !== 'denied' || !appActive) return;
    let cancelled = false;
    Location.getForegroundPermissionsAsync()
      .then((perm) => {
        if (!cancelled) setCanAskLocation(perm.granted || perm.canAskAgain);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [locStatus, appActive]);
  const onAllowLocation = useCallback(async () => {
    if (!canAskLocation) {
      Linking.openSettings().catch(() => {});
      return;
    }
    await locate();
  }, [canAskLocation, locate]);

  const onFocusPoi = useCallback((poiId: number) => send(cmd.focusPoi(poiId)), [send]);
  const showVenue = useCallback(
    (m: CatalogPlace) => {
      const pin: PinPayload = { id: m.id, lat: m.latitude, lng: m.longitude, name: m.name, emoji: placeKindMeta(m.kind).emoji, nightlife: m.nightlife };
      setVenue(m);
      setVenueCardOpen(true);
      // replay (mapa novo) recoloca o pino sem voar de novo; agora, voa com o pino caindo
      stateCmds.current.set('setPin', cmd.setPin(pin, false));
      if (readyRef.current) inject(cmd.setPin(pin, true));
    },
    [inject],
  );
  const clearVenue = useCallback(() => {
    setVenue(null);
    setVenueCardOpen(false);
    stateCmds.current.delete('setPin');
    if (readyRef.current) inject(cmd.setPin(null));
  }, [inject]);
  // '📌 Pôr no Metch': já está no mapa → a câmera vai até o lugar; pendente → agradece (aparece quando mais gente confirmar)
  const onVenueSuggested = useCallback(
    (res: PlaceSuggestResponse) => {
      if (res.status === 'active' && res.poi) {
        const poi = res.poi;
        clearVenue();
        qc.invalidateQueries({ queryKey: ['nearby', 'pois'] });
        qc.invalidateQueries({ queryKey: ['vibe'] });
        pendingFocus.current = poi.id;
        setUserCenter({ lat: poi.latitude, lng: poi.longitude });
        send(cmd.setCenter(poi.latitude, poi.longitude, 16.5, { pitch: 58, bearing: -12, duration: 1200 }));
        showToast('Já tá no mapa ✨');
        return;
      }
      showToast('Valeu! Quando mais gente confirmar, aparece no mapa ✨');
    },
    [clearVenue, qc, send, showToast],
  );

  // '✨ Tá rolando algo aqui?': o servidor manda no máximo 1 vez a cada 6 h; o app guarda até a pessoa responder
  const [placePrompt, setPlacePrompt] = useState<PlacePrompt | null>(null);
  const incomingPrompt = nearbyQuery.data?.me?.placePrompt ?? null;
  useEffect(() => {
    if (incomingPrompt && incomingPrompt.options.length > 0) setPlacePrompt(incomingPrompt);
  }, [incomingPrompt]);
  const answerPlacePrompt = useCallback(
    (a: PlacePromptAnswer) => {
      const current = placePrompt;
      setPlacePrompt(null);
      if (!current || a.kind === 'dismiss') return;
      if (a.kind === 'confirm') {
        votePlace(a.candidateId, 'confirm').then((ok) => showToast(ok ? `Valeu! ${a.name} logo aparece no mapa ✨` : 'Não deu agora. Tenta de novo já já'));
        return;
      }
      Promise.all(current.options.map((o) => votePlace(o.candidateId, 'deny'))).then(() => showToast('Anotado 👍'));
    },
    [placePrompt, showToast],
  );

  const openVibe = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    setVibeOpen(true);
  }, []);
  const closeVibe = useCallback(() => setVibeOpen(false), []);
  // lugar do Metch (busca ou aviso de evento/lugar): câmera vai até lá, a sheet do lugar abre na hora e o destaque no
  // mapa vem quando o recorte carregar
  const showPoi = useCallback(
    (v: POI) => {
      if (venue) clearVenue();
      setPickedPoi(v);
      setSelectedPoiId(v.id);
      setUserCenter({ lat: v.latitude, lng: v.longitude });
      if (poisRef.current.some((p) => p.id === v.id)) {
        pendingFocus.current = null;
        send(cmd.focusPoi(v.id));
      } else {
        pendingFocus.current = v.id;
        send(cmd.setCenter(v.latitude, v.longitude, 16.5, { pitch: 58, bearing: -12, duration: 1400 }));
      }
    },
    [send, clearVenue, venue],
  );
  const onPickVibePlace = useCallback(
    (place: VibePlace | CatalogPlace) => {
      setVibeOpen(false);
      setSelected(null);
      setGroupFilter(null);
      setPoiFilter(null);
      // POI do Cruzei tem `id` numérico e existe no `poisRef` (vem do /pois/nearby); lugar da cidade (busca) tem `source`
      const v: VibePlace | null = 'source' in place ? null : place;
      if (!v) {
        const m = place as CatalogPlace; // sem v = lugar da cidade (tem source)
        setPickedPoi(null);
        setSelectedPoiId(null);
        pendingFocus.current = null;
        setUserCenter({ lat: m.latitude, lng: m.longitude });
        // lugar da cidade: a câmera voa até lá e o pino cai no ponto, com o nome
        showVenue(m);
        return;
      }
      showPoi(v);
    },
    [showVenue, showPoi],
  );

  // toque num aviso de evento/lugar (push, central): foca o lugar quando o mapa estiver pronto. Fora do recorte, a
  // coordenada vem do GET /pois/:id (lugar é público)
  const focusRequest = useMapFocusStore((s) => s.pending);
  const showPoiRef = useRef(showPoi);
  showPoiRef.current = showPoi;
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;
  useEffect(() => {
    if (!focusRequest || !mapReady) return;
    useMapFocusStore.getState().clear();
    const { poiId } = focusRequest;
    setVibeOpen(false);
    setSelected(null);
    setGroupFilter(null);
    setPoiFilter(null);
    const known = poisRef.current.find((p) => p.id === poiId);
    if (known) {
      showPoiRef.current(known);
      return;
    }
    api
      .get<POI>(`/pois/${poiId}`)
      .then((res) => showPoiRef.current(res.data))
      .catch(() => showToastRef.current('Esse lugar não tá mais no mapa'));
  }, [focusRequest, mapReady]);
  // bairro/rua/cidade da busca: só leva a câmera (o recorte de lugares e pessoas re-centraliza sozinho)
  const onPickGeocode = useCallback(
    (r: GeocodeResult) => {
      setVibeOpen(false);
      setSelected(null);
      setSelectedPoiId(null);
      pendingFocus.current = null;
      setUserCenter({ lat: r.lat, lng: r.lng });
      send(cmd.setCenter(r.lat, r.lng, r.zoom, { pitch: 50, bearing: 0, duration: 1400 }));
    },
    [send],
  );
  const onSeePlacePeople = useCallback((poi: POI) => {
    setSelectedPoiId(null);
    setGroupFilter(null);
    setPoiFilter({ id: poi.id, name: poi.name });
    sheetRef.current?.snapToIndex(1);
  }, []);
  const onGoToPlace = useCallback(
    (poi: POI) => {
      setSelectedPoiId(null);
      pendingFocus.current = null;
      if (poisRef.current.some((p) => p.id === poi.id)) {
        send(cmd.focusPoi(poi.id));
      } else {
        // lugar escolhido na busca ainda fora do recorte do /pois/nearby: a coordenada é pública e já está em mãos
        setUserCenter({ lat: poi.latitude, lng: poi.longitude });
        send(cmd.setCenter(poi.latitude, poi.longitude, 16.5, { pitch: 58, bearing: -12, duration: 1200 }));
      }
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

  const floatBottom = (previewFraction != null ? Math.round(containerH * previewFraction) : listSheetH(sheetIndex)) + spacing.sm;
  // logo do MapLibre e ⓘ da atribuição (OpenFreeMap © OpenMapTiles, dados do OpenStreetMap: obrigatória pela ODbL) logo
  // acima da lista recolhida
  const ornamentBottom = listSheetH(0) + 6;
  const peopleCount = users.length;
  const listLoading = Boolean(queryCenter) && (nearbyQuery.isPending || nearbyQuery.isPlaceholderData);
  // /nearby falhou (servidor fora / sem rede): a sheet avisa em vez de "0 pessoas" ou lista velha com cara de atual.
  // isFetching e dataUpdatedAt só são lidos depois de uma falha: o react-query re-renderiza pelo que a tela leu, e o
  // dataUpdatedAt muda a cada /nearby que dá certo (mesmo com a resposta igual)
  const nearbyError = nearbyQuery.isError;
  const nearbyUpdatedAt = nearbyError && nearbyQuery.data ? nearbyQuery.dataUpdatedAt : 0;
  const nearbyRetrying = nearbyError && nearbyQuery.isFetching;
  // sem resposta = rede; com status (503 "muita gente procurando", 429, 5xx) = servidor no ar, só ocupado
  const nearbyFailKind = nearbyError && toApiError(nearbyQuery.error).status !== undefined ? 'server' : 'network';

  return (
    <View style={styles.container} onLayout={onLayout}>
      <NativeMap
        key={mapKey}
        ref={mapRef}
        initTheme={themeRef.current}
        initTier={initTier}
        onEvent={onMapEvent}
        ornamentBottom={ornamentBottom}
        accessibilityLabel={`Mapa com ${peopleCount} ${peopleCount === 1 ? 'pessoa' : 'pessoas'} perto e ${pois.length} lugares`}
      />

      <MapHeader
        lat={queryCenter?.lat ?? null}
        lng={queryCenter?.lng ?? null}
        isAnonymous={isAnonymous}
        togglePending={togglePending}
        onToggleVisibility={onToggleVisibility}
        onCenter={onCenter}
        boostMinutes={boostMinutes}
        indicators={indicators}
        hiddenReason={meDiscovery && !meDiscovery.discoverable ? meDiscovery.hiddenReason : null}
        onOpenVibe={openVibe}
        paused={!active}
        onHeaderHeight={setHeaderH}
      />

      <VibeOverlay
        visible={vibeOpen}
        center={queryCenter}
        myLocation={lat != null && lng != null ? { lat, lng } : null}
        paused={!active}
        onClose={closeVibe}
        onPickPlace={onPickVibePlace}
        onPickGeocode={onPickGeocode}
      />

      {moment ? (
        <View style={[styles.momentWrap, { top: Math.max(headerH + spacing.sm, containerH * 0.12) }]} pointerEvents="none">
          <FadeInView fromY={-10} fromScale={0.9} style={styles.moment} accessibilityLiveRegion="assertive">
            <Text style={styles.momentTitle}>🔥 {BRAND.matchShout}</Text>
            <Text style={styles.momentText}>Você e {moment.name} deram match</Text>
          </FadeInView>
        </View>
      ) : null}

      <View style={[styles.floating, { bottom: floatBottom }]} pointerEvents="box-none">
        {venue && venueCardOpen && !vibeOpen && !selected && selectedPoiId == null ? (
          <VenueCard
            key={venue.id}
            place={venue}
            me={lat != null && lng != null ? { lat, lng } : null}
            onClose={clearVenue}
            onSuggested={onVenueSuggested}
            onMessage={showToast}
          />
        ) : placePrompt && !vibeOpen && !selected && selectedPoiId == null ? (
          <NamePlaceCard prompt={placePrompt} onAnswer={answerPlacePrompt} />
        ) : null}

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
            <Pressable onPress={retryMap} accessibilityRole="button" accessibilityLabel="Tentar de novo" style={styles.noticeBtn}>
              <Text style={styles.noticeAction}>Tentar de novo</Text>
            </Pressable>
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
        invisibleTotal={invisible?.total ?? 0}
        radiusM={radiusM}
        isFree={isFree}
        isLoading={listLoading}
        isOffline={nearbyError}
        failKind={nearbyFailKind}
        updatedAt={nearbyUpdatedAt}
        isRetrying={nearbyRetrying}
        onRetry={retryNearby}
        containerHeight={containerH}
        onPeekHeight={setPeekH}
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
        mutual={selectedMutual}
        conversationId={selectedConversationId}
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

      {!mapReady && !mapError ? (
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
  floating: { position: 'absolute', left: 0, right: 0, gap: spacing.sm },
  toast: { alignSelf: 'center', marginHorizontal: spacing.lg, backgroundColor: colors.black, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.full, minHeight: 36, justifyContent: 'center' },
  toastText: { ...typography.bodySmall, color: colors.white, textAlign: 'center' },
  notice: { marginHorizontal: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.overlayDark, padding: spacing.md, borderRadius: radius.md },
  noticeText: { ...typography.bodySmall, color: colors.white, flex: 1 },
  noticeBtn: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.sm },
  noticeAction: { ...typography.label, color: colors.primary },
  momentWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  moment: { alignItems: 'center', paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.xl, backgroundColor: 'rgba(18,18,42,0.92)', borderWidth: 1.5, borderColor: colors.secondary, ...shadows.strong },
  momentTitle: { ...typography.h1, color: colors.primary, letterSpacing: 2 },
  momentText: { ...typography.body, color: colors.white, marginTop: 2 },
  loader: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.overlay },
});
