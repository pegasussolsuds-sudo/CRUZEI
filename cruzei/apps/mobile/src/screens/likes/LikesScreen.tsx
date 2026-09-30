import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  cancelAnimation,
  interpolate,
  runOnJS,
  runOnUI,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  useReducedMotion,
  type SharedValue,
} from 'react-native-reanimated';

import { isMessagingLockedError, useInvisibleLikePrompt, useMessagingLocked } from '../../hooks/useMessagingLock';
import { noteSuperLikeLimit, noteSuperLikeSent, useSuperLikeLimitPrompt, useSuperLikeQuota } from '../../hooks/useSuperLikes';
import { superLikeLimitOf } from '../../services/superLikes';
import { api, toApiError } from '../../services/api';
import { useMyLocation } from '../../hooks/useMyLocation';
import { iLiked, inboxKeys, likeStatusOf } from '../../hooks/useInbox';
import { MatchModal, type MatchInfo } from '../../components/MatchModal';
import { nearbyCountTitle } from '../../components/map/proximityText';
import { FadeInView, Pulse, ScaleOnPress } from '../../components/animated';
import { CruzeiAvatar } from '../../components/avatar/CruzeiAvatar';
import { resolveAvatar } from '../../avatar';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { proximityBandLabel } from '@cruzei/shared-utils';
import { SHOW_ME_LABELS, type DeckResponse, type DeckUser, type LikeResult } from '@cruzei/shared-types';
import { useAuthStore } from '../../stores/auth';
import { colors, fontFamily, radius, shadows, spacing, typography } from '@cruzei/ui-mobile';
import { buildDeckQueue, deckCounts } from './deckQueue';
import { createUndoGate } from './undoGate';

const RADIUS_M = 350; // mesmo teto do servidor (PRIVACY.DISCOVERY_RADIUS_M)
const SWIPE_RATIO = 0.35; // soltar além de 35% da largura = ação
const FLING_VELOCITY = 900; // px/s — um "peteleco" também conta
const MAX_ROTATION = 12; // graus
const AVATAR_BADGE = 44; // bust do avatar no canto do card

type DeckAction = 'like' | 'super' | 'pass';
/** de onde o cartão entra quando volta pro deck ("Voltar", ou ação recusada): o mesmo lado pra onde saiu */
type EnterFrom = 'left' | 'right' | 'top';
type Nav = NativeStackNavigationProp<RootStackParamList>;

const enterFromOf = (action: DeckAction): EnterFrom => (action === 'pass' ? 'left' : action === 'super' ? 'top' : 'right');

export interface SwipeCardHandle {
  /** dispara a animação de saída e, ao terminar, a ação */
  swipe: (action: DeckAction) => void;
}

// faixa de proximidade (nunca metros de outra pessoa): 'bem perto' | 'perto' | 'na região' | 'em destaque na região' (boost até 5 km)
function formatDistance(band: DeckUser['proximityBand'] | null | undefined): string {
  return proximityBandLabel(band);
}

export function LikesScreen() {
  const qc = useQueryClient();
  const nav = useNavigation<Nav>();
  const { width } = useWindowDimensions();
  const { lat, lng, status, locate } = useMyLocation();
  // ids já curtidos/passados aqui — somem do deck até o servidor refletir
  const [acted, setActed] = useState<Set<string>>(() => new Set());
  // cartão devolvido pelo "Voltar" (fica no topo mesmo que a carga nova não traga ele)
  const [front, setFront] = useState<DeckUser | null>(null);
  // último cartão passado aqui: o "Voltar" desfaz só ele (some depois de usar ou de outra ação)
  const [lastPassed, setLastPassed] = useState<DeckUser | null>(null);
  // cartão que volta pro topo animado, entrando pelo lado de onde saiu (n muda a key → remonta)
  const [entry, setEntry] = useState<{ id: string; from: EnterFrom; n: number } | null>(null);
  const [match, setMatch] = useState<MatchInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const topRef = useRef<SwipeCardHandle>(null);
  const busy = useRef(false);
  // cada ação ganha um número: resposta atrasada de uma ação velha não mexe no "Voltar"
  const actionSeq = useRef(0);
  // "Voltar" voando: o deck não aceita swipe nem botão, e ação que já saiu só vai pro servidor depois do DELETE
  const [undoGate] = useState(createUndoGate);
  const [undoBusy, setUndoBusy] = useState(false);

  // progresso 0..1 do card de cima rumo ao limiar — o card de baixo cresce 0.95 → 1 com isso
  const progress = useSharedValue(0);

  const nearbyQuery = useQuery({
    queryKey: ['nearby', 'deck', lat?.toFixed(3), lng?.toFixed(3)],
    enabled: lat != null && lng != null,
    // o servidor centra na MINHA presença (lat/lng só entram na chave do cache). deck=1: sem quem eu passei nos
    // últimos 30 dias nem quem já curti, e quem me deu super curtida vem primeiro (mesmo de longe)
    queryFn: async () => {
      const res = await api.get<DeckResponse>('/location/nearby', {
        params: { radius_meters: RADIUS_M, deck: 1 },
      });
      return res.data; // { users, hiddenCount, radiusM, me, superLikesPending }
    },
  });

  // Fila derivada de cada carga: sem anônimos (não dá pra curtir quem não se revelou), sem quem já curti (sozinho ou
  // os dois), sem quem acabei de passar/curtir aqui; o cartão do "Voltar" no topo
  const queue = useMemo(
    () => buildDeckQueue(nearbyQuery.data?.users ?? [], acted, front, (u) => iLiked(likeStatusOf(u))),
    [nearbyQuery.data, acted, front],
  );
  const radiusM = nearbyQuery.data?.radiusM ?? RADIUS_M;
  // 'no_presence' = presença ainda não chegou no servidor (1ª carga) — não é "invisível"
  const hiddenReason = nearbyQuery.data?.me?.hiddenReason ?? null;
  const hidden = hiddenReason != null && hiddenReason !== 'no_presence';
  // GPS falso detectado pelo servidor: o deck fica vazio até a posição normalizar (texto próprio)
  const gpsHidden = hiddenReason === 'location_mocked' || hiddenReason === 'location_unverified';
  // "Mostrar: Mulheres/Homens" (recíproco, no servidor): o deck vazio explica o filtro
  const showMe = useAuthStore((s) => s.user?.settings?.showMe ?? 'everyone');

  // invisível sem Premium não curte: o cartão volta pro lugar e a explicação aparece (o servidor também barra)
  const likeLocked = useMessagingLocked();
  const askInvisibleLike = useInvisibleLikePrompt();

  // super curtidas de hoje (grátis 1, Premium 7): contador no botão; acabou → explica (no grátis, convite pro Premium)
  const { quota: superQuota, remaining: superLeft } = useSuperLikeQuota();
  const askSuperLimit = useSuperLikeLimitPrompt();

  const likeMutation = useMutation({
    mutationFn: async ({ userId, isSuper }: { userId: string; isSuper: boolean }) =>
      (await api.post<LikeResult>(isSuper ? '/likes/super' : '/likes', { userId })).data,
  });

  // o cartão volta pro topo, entrando animado pelo lado de onde saiu
  const bringBack = useCallback((card: DeckUser, from: EnterFrom) => {
    setActed((s) => {
      if (!s.has(card.id)) return s;
      const next = new Set(s);
      next.delete(card.id);
      return next;
    });
    setEntry({ id: card.id, from, n: Date.now() });
  }, []);

  // Chamado quando o card já saiu da tela (fim da animação).
  const onAction = useCallback(
    async (action: DeckAction) => {
      const card = queue[0];
      busy.current = false;
      if (!card) return;
      setError(null);
      progress.value = 0;
      const from = enterFromOf(action);
      if (likeLocked && action !== 'pass') {
        // o cartão tinha saído: volta pro lugar (antes ficava preso fora da tela)
        bringBack(card, from);
        askInvisibleLike();
        return;
      }
      const seq = ++actionSeq.current;
      // "Voltar" é só pro último passar: qualquer outra ação encerra
      setLastPassed(null);
      setActed((s) => new Set(s).add(card.id));
      try {
        // gesto começado antes do "Voltar": o POST vai depois do DELETE (senão o DELETE atrasado apagava o passar novo)
        await undoGate.settled();
        if (action === 'pass') {
          await api.post('/passes', { userId: card.id });
          if (actionSeq.current === seq) setLastPassed(card);
          return;
        }
        const res = await likeMutation.mutateAsync({ userId: card.id, isSuper: action === 'super' });
        if (action === 'super') noteSuperLikeSent(qc, res);
        if (res.isMutual) {
          setMatch({
            userId: card.id,
            name: card.name,
            photo: card.mainPhotoUrl,
            avatar: card.avatar ?? null,
            // a curtida mútua promove a conversa do par (se já existia) pra principal
            conversationId: res.promotedConversationIds[0] ?? card.conversation?.id ?? null,
            band: card.proximityBand ?? null,
          });
          qc.invalidateQueries({ queryKey: inboxKeys.all });
        }
      } catch (err) {
        const e = toApiError(err);
        const limit = superLikeLimitOf(err);
        // o cartão já tinha saído: volta pro deck (sem rede, timeout, 5xx, limite, invisível), senão a curtida se perdia.
        // Só fica fora quando o servidor recusou ESSA pessoa (404 sumiu/anônima, 400 bloqueio): voltar só repetiria o erro
        if (e.status !== 404 && e.status !== 400) bringBack(card, from);
        if (limit) {
          // acabou a super curtida do dia (o contador estava velho): zera e explica — no grátis, convite pro Premium
          noteSuperLikeLimit(qc, limit);
          askSuperLimit(limit);
        } else if (isMessagingLockedError(err)) askInvisibleLike(true);
        else setError(e.status === 429 ? 'Calma aí: rápido demais. Espera um pouquinho e tenta de novo.' : e.message);
      }
    },
    [likeMutation, progress, qc, queue, likeLocked, askInvisibleLike, askSuperLimit, bringBack, undoGate],
  );

  // Botões do rodapé: mesma animação de saída do swipe.
  const trigger = useCallback(
    (action: DeckAction) => {
      if (busy.current || undoGate.busy) return;
      // super sem cota hoje: o cartão nem sai do lugar — explica (no grátis, convite pro Premium)
      if (action === 'super' && superLeft === 0 && !likeLocked) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        askSuperLimit({
          canUpgrade: (superQuota?.tier ?? 'free') === 'free',
          limit: superQuota?.limit,
          resetsAt: superQuota?.resetsAt,
        });
        return;
      }
      busy.current = true;
      topRef.current?.swipe(action);
    },
    [superLeft, superQuota, likeLocked, askSuperLimit, undoGate],
  );

  // "Voltar": desfaz o último passar (grátis). Otimista: o cartão volta na hora, entrando pela esquerda
  const undo = useCallback(async () => {
    const card = lastPassed;
    if (!card || busy.current) return;
    // um "Voltar" por vez; enquanto ele voa, swipe e botões esperam
    const req = undoGate.run(() => api.delete(`/passes/${card.id}`));
    if (!req) return;
    setUndoBusy(true);
    const seq = ++actionSeq.current;
    setLastPassed(null);
    setError(null);
    progress.value = 0;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setFront(card);
    bringBack(card, 'left');
    try {
      await req;
    } catch (err) {
      const e = toApiError(err);
      // servidor antigo, sem a rota (404): lá o passar nem era salvo, então a volta local já basta
      if (e.status === 404) return;
      // não desfez no servidor: o cartão sai de novo (senão sumiria na próxima carga sem aviso)
      if (actionSeq.current === seq) {
        setActed((s) => new Set(s).add(card.id));
        if (e.status === 409) {
          // não é mais o último passar ou passou do prazo: tentar de novo não adianta, o "Voltar" some
          setError(e.message);
        } else {
          setLastPassed(card);
          setError(e.status ? 'Não deu pra voltar agora. Tenta de novo.' : e.message);
        }
      }
    } finally {
      setUndoBusy(false);
    }
  }, [lastPassed, bringBack, progress, undoGate]);

  const openCard = useCallback(
    (card: DeckUser) => {
      nav.navigate('UserCard', { userId: card.id, band: card.proximityBand ?? null });
    },
    [nav],
  );

  // Recarregar: busca de novo e só então libera o que foi feito aqui (passados e curtidos o servidor já tira do deck)
  const reload = async () => {
    progress.value = 0;
    const r = await nearbyQuery.refetch();
    if (r.isSuccess) {
      setActed(new Set());
      setFront(null);
      setLastPassed(null);
    }
  };

  if (status === 'denied' || status === 'unavailable') {
    return (
      <SafeAreaView style={styles.center}>
        <FadeInView fromScale={0.92} style={styles.centerInner}>
          <Ionicons name="navigate-circle-outline" size={64} color={colors.gray[300]} />
          <Text style={styles.emptyTitle}>cadê você?</Text>
          <Text style={styles.emptySub}>Precisamos da sua localização pra mostrar quem tá por perto.</Text>
          <ScaleOnPress onPress={locate} style={styles.reload} accessibilityRole="button" accessibilityLabel="Permitir localização">
            <Text style={styles.reloadText}>Permitir localização</Text>
          </ScaleOnPress>
        </FadeInView>
      </SafeAreaView>
    );
  }

  if (nearbyQuery.isError && !nearbyQuery.data) {
    return (
      <SafeAreaView style={styles.center}>
        <FadeInView fromScale={0.92} style={styles.centerInner}>
          <Ionicons name="cloud-offline-outline" size={64} color={colors.gray[300]} />
          <Text style={styles.emptyTitle}>não deu pra carregar</Text>
          <Text style={styles.emptySub}>{toApiError(nearbyQuery.error).message}</Text>
          <ScaleOnPress onPress={reload} style={styles.reload} accessibilityRole="button" accessibilityLabel="Tentar de novo">
            <Text style={styles.reloadText}>Tentar de novo</Text>
          </ScaleOnPress>
        </FadeInView>
      </SafeAreaView>
    );
  }

  // isPending cobre "ainda sem localização" (query desligada) e a 1ª carga
  if (status === 'idle' || status === 'loading' || nearbyQuery.isPending || (nearbyQuery.isFetching && queue.length === 0)) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
      </SafeAreaView>
    );
  }

  const top = queue[0];
  const next = queue[1];
  const counts = deckCounts(queue);
  const undoButton = lastPassed ? (
    <FadeInView key={lastPassed.id} fromScale={0.85} durationMs={220}>
      <ScaleOnPress
        onPress={undo}
        pressedScale={0.92}
        style={styles.undoBtn}
        accessibilityRole="button"
        accessibilityLabel="Voltar"
        accessibilityHint={`Desfaz o passar e traz ${lastPassed.name} de volta`}
      >
        <Ionicons name="arrow-undo" size={16} color={colors.black} />
        <Text style={styles.undoText}>Voltar</Text>
      </ScaleOnPress>
    </FadeInView>
  ) : null;

  if (!top) {
    return (
      <SafeAreaView style={styles.center}>
        <FadeInView fromScale={0.92} style={styles.centerInner}>
          <Ionicons name="heart-outline" size={64} color={colors.gray[300]} />
          <Text style={styles.emptyTitle}>{gpsHidden ? 'confirmando tua posição' : hidden ? 'tu tá invisível' : 'acabou por aqui'}</Text>
          <Text style={styles.emptySub}>
            {hiddenReason === 'location_mocked'
              ? 'Teu celular tá com localização simulada. Desliga o GPS falso pra voltar a ver e aparecer pra galera.'
              : hiddenReason === 'location_unverified'
                ? 'Tua posição mudou rápido demais. Em menos de um minuto a gente confirma e o deck volta.'
                : hidden
                  ? 'Enquanto tu tá oculto (anônimo, pausado ou em área privada), o deck pode ficar vazio. Dá pra mudar na privacidade.'
                  : `Ninguém novo num raio de ${radiusM} m agora.${
                      showMe !== 'everyone' ? ` Mostrando só ${SHOW_ME_LABELS[showMe].toLowerCase()} (dá pra mudar no Perfil, em "quem você vê").` : ''
                    } Sai um pouco, volta mais tarde ou recarrega.`}
          </Text>
          <ScaleOnPress onPress={reload} style={styles.reload} accessibilityRole="button" accessibilityLabel="Recarregar">
            <Text style={styles.reloadText}>Recarregar</Text>
          </ScaleOnPress>
          {/* passou o último sem querer: dá pra trazer de volta */}
          {undoButton ? <View style={styles.emptyUndo}>{undoButton}</View> : null}
        </FadeInView>
        <MatchModal match={match} onClose={() => setMatch(null)} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>quem tá por perto</Text>
          <Text style={styles.subtitle}>
            {/* Boost de longe (até 5 km) conta à parte, fora do "raio de 350 m" */}
            {nearbyCountTitle(counts.inRadius, counts.boosted, `num raio de ${radiusM} m`)} · arrasta pro lado
          </Text>
          {counts.superPending > 0 ? (
            <View style={styles.pendingPill}>
              <Text style={styles.pendingText} numberOfLines={1}>
                ⭐ {counts.superPending} {counts.superPending === 1 ? 'pessoa te deu' : 'pessoas te deram'} super curtida
              </Text>
            </View>
          ) : null}
        </View>
        {undoButton}
      </View>

      <View style={styles.deck}>
        {next ? <NextCard key={next.id} card={next} progress={progress} /> : null}
        <SwipeCard
          key={entry?.id === top.id ? `${top.id}:${entry.n}` : top.id}
          ref={topRef}
          card={top}
          width={width}
          progress={progress}
          enterFrom={entry?.id === top.id ? entry.from : null}
          locked={undoBusy}
          onSwiped={onAction}
          onOpen={() => openCard(top)}
        />
        {error ? (
          <FadeInView fromY={6} style={styles.errorWrap}>
            <Text style={styles.error}>{error}</Text>
          </FadeInView>
        ) : null}
      </View>

      <View style={styles.actions}>
        <ScaleOnPress
          onPress={() => trigger('pass')}
          pressedScale={0.88}
          style={[styles.btn, styles.btnPass]}
          accessibilityRole="button"
          accessibilityLabel="Passar"
          accessibilityHint={`Pula ${top.name}`}
        >
          <Ionicons name="close" size={30} color={colors.danger} />
        </ScaleOnPress>
        <ScaleOnPress
          onPress={() => trigger('like')}
          pressedScale={0.88}
          glowColor={colors.primary}
          style={[styles.btn, styles.btnLike]}
          accessibilityRole="button"
          accessibilityLabel="Curtir"
          accessibilityHint={`Curte ${top.name}`}
        >
          <Ionicons name="heart" size={34} color={colors.black} />
        </ScaleOnPress>
        <View>
          <ScaleOnPress
            onPress={() => trigger('super')}
            pressedScale={0.88}
            glowColor={colors.accent}
            style={superLeft === 0 ? [styles.btn, styles.btnSuper, styles.btnSuperEmpty] : [styles.btn, styles.btnSuper]}
            accessibilityRole="button"
            accessibilityLabel={
              superLeft == null ? 'Super curtir' : `Super curtir, ${superLeft} ${superLeft === 1 ? 'restante' : 'restantes'} hoje`
            }
            accessibilityHint={superLeft === 0 ? 'As super curtidas de hoje acabaram' : `Manda uma super curtida pra ${top.name}`}
          >
            <Ionicons name="star" size={28} color={colors.black} />
          </ScaleOnPress>
          {/* quantas super curtidas restam hoje (grátis 1, Premium 7) */}
          {superLeft != null ? (
            <View pointerEvents="none" style={superLeft === 0 ? [styles.superCount, styles.superCountEmpty] : styles.superCount}>
              <Text style={styles.superCountText}>{superLeft}</Text>
            </View>
          ) : null}
        </View>
      </View>

      <MatchModal match={match} onClose={() => setMatch(null)} />
    </SafeAreaView>
  );
}

// ───────────────────────────── card de cima (swipe) ─────────────────────────────

interface SwipeCardProps {
  card: DeckUser;
  width: number;
  progress: SharedValue<number>;
  /** voltou pro topo ("Voltar" ou ação recusada): entra animado por esse lado */
  enterFrom?: EnterFrom | null;
  /** "Voltar" voando: não arrasta (tocar pra abrir o perfil continua) */
  locked?: boolean;
  onSwiped: (action: DeckAction) => void;
  onOpen: () => void;
}

function hapticThreshold() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}
function hapticCommit(action: DeckAction) {
  if (action === 'super') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  else Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

const SwipeCard = forwardRef<SwipeCardHandle, SwipeCardProps>(function SwipeCard({ card, width, progress, enterFrom, locked = false, onSwiped, onOpen }, ref) {
  // "reduzir movimento": o cartão que volta aparece direto no lugar
  const reduceMotion = useReducedMotion();
  const enter = reduceMotion ? null : (enterFrom ?? null);
  // já nasce fora da tela (sem piscar no meio antes de sair): o efeito abaixo traz pro lugar
  const tx = useSharedValue(enter === 'left' ? -width * 1.3 : enter === 'right' ? width * 1.3 : 0);
  const ty = useSharedValue(enter === 'top' ? -width * 1.5 : 0);
  const superStamp = useSharedValue(0);
  const crossed = useSharedValue(0); // 0 = dentro, 1 = além do limiar (pra haptic único)
  const leaving = useSharedValue(0);
  const threshold = width * SWIPE_RATIO;

  useEffect(
    () => () => {
      cancelAnimation(tx);
      cancelAnimation(ty);
      cancelAnimation(superStamp);
    },
    [tx, ty, superStamp],
  );

  // entrada de volta: mola até o centro (a rotação acompanha o tx). Só na montagem: a key muda a cada volta
  useEffect(() => {
    if (!enter) return;
    const cfg = { damping: 18, stiffness: 150, mass: 0.8 };
    if (enter === 'top') ty.value = withSpring(0, cfg);
    else tx.value = withSpring(0, cfg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finish = (action: DeckAction) => {
    onSwiped(action);
  };

  // Animação de saída — usada pelo gesto E pelos botões.
  const flyOut = (action: DeckAction, velocityX = 0, velocityY = 0) => {
    'worklet';
    if (leaving.value === 1) return;
    leaving.value = 1;
    progress.value = withTiming(1, { duration: 180 });
    runOnJS(hapticCommit)(action);
    const cfg = { damping: 24, stiffness: 140, mass: 0.7, overshootClamping: true };
    if (action === 'super') {
      superStamp.value = withTiming(1, { duration: 120 });
      tx.value = withSpring(tx.value * 0.4, { ...cfg, velocity: velocityX });
      ty.value = withSpring(-width * 2.2, { ...cfg, velocity: velocityY }, (finished) => {
        if (finished) runOnJS(finish)(action);
      });
      return;
    }
    const dir = action === 'like' ? 1 : -1;
    // se o dedo não puxou pra direção certa, empurra o card pra ela
    if (Math.sign(tx.value) !== dir) tx.value = dir * 24;
    ty.value = withSpring(ty.value * 0.6, { ...cfg, velocity: velocityY });
    tx.value = withSpring(dir * width * 1.6, { ...cfg, velocity: velocityX }, (finished) => {
      if (finished) runOnJS(finish)(action);
    });
  };

  useImperativeHandle(ref, () => ({ swipe: (action) => runOnUI(flyOut)(action) }), [flyOut]);

  const pan = Gesture.Pan()
    .enabled(!locked)
    .activeOffsetX([-8, 8])
    .onUpdate((e) => {
      if (leaving.value === 1) return;
      tx.value = e.translationX;
      ty.value = e.translationY * 0.6;
      const p = Math.min(1, Math.abs(e.translationX) / threshold);
      progress.value = p;
      const over = p >= 1 ? 1 : 0;
      if (over !== crossed.value) {
        crossed.value = over;
        if (over === 1) runOnJS(hapticThreshold)();
      }
    })
    .onEnd((e) => {
      if (leaving.value === 1) return;
      const far = Math.abs(tx.value) > threshold;
      const fast = Math.abs(e.velocityX) > FLING_VELOCITY;
      if (far || fast) {
        const dir = far ? Math.sign(tx.value) : Math.sign(e.velocityX);
        flyOut(dir > 0 ? 'like' : 'pass', e.velocityX, e.velocityY);
        return;
      }
      crossed.value = 0;
      progress.value = withSpring(0, { damping: 16, stiffness: 180 });
      tx.value = withSpring(0, { damping: 15, stiffness: 160, mass: 0.8, velocity: e.velocityX });
      ty.value = withSpring(0, { damping: 15, stiffness: 160, mass: 0.8, velocity: e.velocityY });
    });

  const tap = Gesture.Tap()
    .maxDuration(260)
    .maxDistance(8)
    .onEnd(() => {
      if (leaving.value === 1) return;
      runOnJS(onOpen)();
    });

  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { rotate: `${interpolate(tx.value, [-width, 0, width], [-MAX_ROTATION, 0, MAX_ROTATION], Extrapolation.CLAMP)}deg` },
    ],
  }));
  const likeStamp = useAnimatedStyle(() => ({
    opacity: interpolate(tx.value, [0, threshold * 0.6], [0, 1], Extrapolation.CLAMP),
    transform: [{ rotate: '-14deg' }, { scale: interpolate(tx.value, [0, threshold * 0.6], [1.3, 1], Extrapolation.CLAMP) }],
  }));
  const passStamp = useAnimatedStyle(() => ({
    opacity: interpolate(tx.value, [-threshold * 0.6, 0], [1, 0], Extrapolation.CLAMP),
    transform: [{ rotate: '14deg' }, { scale: interpolate(tx.value, [-threshold * 0.6, 0], [1, 1.3], Extrapolation.CLAMP) }],
  }));
  const superStampStyle = useAnimatedStyle(() => ({
    opacity: superStamp.value,
    transform: [{ scale: interpolate(superStamp.value, [0, 1], [1.4, 1], Extrapolation.CLAMP) }],
  }));
  const likeTint = useAnimatedStyle(() => ({
    opacity: interpolate(tx.value, [0, threshold], [0, 0.28], Extrapolation.CLAMP),
  }));
  const passTint = useAnimatedStyle(() => ({
    opacity: interpolate(tx.value, [-threshold, 0], [0.28, 0], Extrapolation.CLAMP),
  }));

  return (
    <GestureDetector gesture={Gesture.Race(pan, tap)}>
      <Animated.View
        style={[styles.card, cardStyle]}
        accessible
        accessibilityRole="button"
        accessibilityLabel={`${card.name}${card.age ? `, ${card.age} anos` : ''}${
          card.proximityBand ? `, ${formatDistance(card.proximityBand)}` : ''
        }${card.superLikedMe ? ', te deu uma super curtida' : ''}`}
        accessibilityHint="Toca pra ver o perfil. Arrasta pra direita pra curtir, pra esquerda pra passar"
      >
        <CardBody card={card} />

        {/* tintas de direção */}
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.primary }, likeTint]} />
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.danger }, passTint]} />

        {/* carimbos */}
        <Animated.View pointerEvents="none" style={[styles.stamp, styles.stampLike, likeStamp]}>
          <Text style={[styles.stampText, { color: colors.primary }]}>CURTIR</Text>
        </Animated.View>
        <Animated.View pointerEvents="none" style={[styles.stamp, styles.stampPass, passStamp]}>
          <Text style={[styles.stampText, { color: colors.danger }]}>PASSAR</Text>
        </Animated.View>
        <Animated.View pointerEvents="none" style={[styles.stamp, styles.stampSuper, superStampStyle]}>
          <Text style={[styles.stampText, { color: colors.accent }]}>SUPER ⭐</Text>
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
});

// ───────────────────────────── card de baixo ─────────────────────────────

function NextCard({ card, progress }: { card: DeckUser; progress: SharedValue<number> }) {
  const style = useAnimatedStyle(() => ({
    transform: [{ scale: 0.95 + 0.05 * progress.value }, { translateY: 12 - 12 * progress.value }],
    opacity: 0.85 + 0.15 * progress.value,
  }));
  return (
    <Animated.View pointerEvents="none" style={[styles.card, style]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <CardBody card={card} />
    </Animated.View>
  );
}

// ───────────────────────────── conteúdo do card ─────────────────────────────

function CardBody({ card }: { card: DeckUser }) {
  // foto que falha (404, apagada, sem rede) não pode deixar o card em branco: cai no avatar da pessoa
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showPhoto = Boolean(card.mainPhotoUrl) && failedUrl !== card.mainPhotoUrl;
  return (
    <View style={styles.cardInner}>
      {showPhoto ? (
        <Image
          source={{ uri: card.mainPhotoUrl as string }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          onError={() => setFailedUrl(card.mainPhotoUrl)}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.photoPlaceholder]}>
          <CruzeiAvatar config={resolveAvatar(card.avatar, card.id)} mode="full" size={260} accessibilityLabel={`Avatar de ${card.name}`} />
        </View>
      )}
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(10,10,26,0)', 'rgba(10,10,26,0.1)', 'rgba(10,10,26,0.85)']}
        locations={[0.5, 0.65, 1]}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.badges} pointerEvents="none">
        {/* avatar Cruzei da pessoa — o mesmo que aparece no mapa */}
        <View style={styles.avatarBadge}>
          <CruzeiAvatar
            config={resolveAvatar(card.avatar, card.id)}
            mode="bust"
            size={AVATAR_BADGE}
            backgroundColor={colors.black}
            accessibilityLabel={`Avatar de ${card.name}`}
          />
        </View>
        {card.isBoosted ? (
          <View style={[styles.badge, { backgroundColor: colors.secondary }]}>
            <Ionicons name="flame" size={12} color={colors.white} />
            <Text style={[styles.badgeText, { color: colors.white }]}>em alta</Text>
          </View>
        ) : null}
        {card.premiumTier !== 'free' ? (
          <View style={[styles.badge, { backgroundColor: 'rgba(10,10,26,0.55)' }]}>
            <Ionicons name="sparkles" size={12} color={colors.accent} />
            <Text style={[styles.badgeText, { color: colors.accent }]}>premium</Text>
          </View>
        ) : null}
      </View>

      {/* super curtida recebida: moldura dourada (o selo vai no rodapé) */}
      {card.superLikedMe ? <View pointerEvents="none" style={styles.superRing} /> : null}

      <View style={styles.cardFooter} pointerEvents="none">
        {card.superLikedMe ? (
          <View style={styles.superBadge}>
            <Text style={styles.superBadgeText}>⭐ Te deu uma super curtida</Text>
          </View>
        ) : null}
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>
            {card.name}
            {card.age ? <Text style={styles.age}>, {card.age}</Text> : null}
          </Text>
          {card.isVerified ? (
            <View style={styles.verified}>
              <Ionicons name="checkmark" size={12} color={colors.black} />
            </View>
          ) : null}
        </View>
        <View style={styles.metaRow}>
          {/* super curtida de longe vem sem faixa: a super revela quem é, nunca onde está */}
          {card.proximityBand ? (
            <View style={styles.metaChip}>
              <Ionicons name="location" size={13} color={colors.primary} />
              <Text style={styles.metaText}>{formatDistance(card.proximityBand)}</Text>
            </View>
          ) : null}
          {card.isOnline ? (
            <View style={styles.metaChip}>
              <Pulse maxScale={1.35} minOpacity={0.6} cycleMs={1400}>
                <View style={styles.onlineDot} />
              </Pulse>
              <Text style={styles.metaText}>online</Text>
            </View>
          ) : null}
          {card.poi?.name ? (
            <View style={styles.metaChip}>
              <Ionicons name="pin" size={12} color={colors.secondary} />
              <Text style={styles.metaText} numberOfLines={1}>
                {card.poi.name}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

// ───────────────────────────── estilos ─────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background, padding: spacing.xl },
  centerInner: { alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  headerText: { flex: 1, minWidth: 0 },
  pendingPill: {
    alignSelf: 'flex-start',
    marginTop: spacing.xs + 2,
    backgroundColor: colors.accent,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 3,
    maxWidth: '100%',
  },
  pendingText: { ...typography.caption, fontSize: 12, color: colors.black },
  undoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.white,
    borderWidth: 1.5,
    borderColor: colors.gray[300],
    ...shadows.light,
  },
  undoText: { ...typography.label, fontSize: 13, color: colors.black },
  emptyUndo: { marginTop: spacing.md },
  title: { ...typography.h2, color: colors.black },
  subtitle: { ...typography.bodySmall, color: colors.gray[600], marginTop: 2 },

  deck: { flex: 1, margin: spacing.lg, marginBottom: spacing.sm },
  card: {
    ...StyleSheet.absoluteFill,
    borderRadius: radius.xl,
    backgroundColor: colors.white,
    overflow: 'hidden',
    ...shadows.strong,
  },
  cardInner: { flex: 1, backgroundColor: colors.gray[100] },
  photoPlaceholder: { backgroundColor: '#1B1B33', alignItems: 'center', justifyContent: 'center', paddingBottom: 90 },
  badges: { position: 'absolute', top: spacing.md, left: spacing.md, right: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  avatarBadge: {
    width: AVATAR_BADGE + 4,
    height: AVATAR_BADGE + 4,
    borderRadius: (AVATAR_BADGE + 4) / 2,
    borderWidth: 2,
    borderColor: colors.white,
    backgroundColor: colors.black,
    ...shadows.medium,
  },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.full, paddingHorizontal: spacing.sm + 2, height: 26 },
  badgeText: { ...typography.caption, textTransform: 'uppercase', letterSpacing: 0.8 },

  cardFooter: { position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: spacing.lg },
  superRing: { ...StyleSheet.absoluteFill, borderRadius: radius.xl, borderWidth: 3, borderColor: colors.accent },
  superBadge: {
    alignSelf: 'flex-start',
    justifyContent: 'center',
    backgroundColor: colors.accent,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    height: 28,
    marginBottom: spacing.sm,
    ...shadows.medium,
  },
  superBadgeText: { ...typography.label, fontSize: 13, lineHeight: 18, color: colors.black },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { fontFamily: fontFamily.display, fontSize: 30, lineHeight: 36, letterSpacing: -0.5, color: colors.white, flexShrink: 1 },
  age: { fontFamily: fontFamily.displayMedium, fontSize: 26, color: colors.gray[200] },
  verified: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(250,250,250,0.16)',
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    height: 28,
    maxWidth: 200,
  },
  metaText: { ...typography.caption, fontSize: 12, color: colors.white },
  onlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.online },

  stamp: { position: 'absolute', top: spacing.xl + spacing.md, borderWidth: 4, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 4 },
  stampLike: { left: spacing.lg, borderColor: colors.primary },
  stampPass: { right: spacing.lg, borderColor: colors.danger },
  stampSuper: { alignSelf: 'center', top: '42%', borderColor: colors.accent },
  stampText: { fontFamily: fontFamily.display, fontSize: 34, letterSpacing: 2 },

  errorWrap: { position: 'absolute', left: 0, right: 0, bottom: -spacing.lg, alignItems: 'center' },
  error: { ...typography.bodySmall, color: colors.danger, textAlign: 'center' },

  actions: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: spacing.xl, paddingHorizontal: spacing.xl, paddingVertical: spacing.lg },
  btn: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', ...shadows.medium },
  btnPass: { backgroundColor: colors.white, borderWidth: 2, borderColor: colors.danger },
  btnLike: { width: 74, height: 74, borderRadius: 37, backgroundColor: colors.primary },
  btnSuper: { backgroundColor: colors.accent },
  btnSuperEmpty: { opacity: 0.5 },
  superCount: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.black,
    borderWidth: 2,
    borderColor: colors.background,
  },
  superCountEmpty: { backgroundColor: colors.gray[400] },
  superCountText: { fontFamily: fontFamily.bodySemiBold, fontSize: 11, lineHeight: 14, color: colors.white },

  emptyTitle: { ...typography.h2, color: colors.black, marginTop: spacing.lg },
  emptySub: { ...typography.body, color: colors.gray[600], textAlign: 'center', marginTop: spacing.sm },
  reload: { marginTop: spacing.xl, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.md, backgroundColor: colors.primary },
  reloadText: { ...typography.label, color: colors.black },
});
