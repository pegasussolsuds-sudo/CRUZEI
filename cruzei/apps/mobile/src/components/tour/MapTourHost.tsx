import React, { memo, useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { View } from 'react-native';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../../stores/auth';
import { useMatchCelebrationStore } from '../../stores/matchCelebration';
import { TOUR_LOCATION_WAIT_MS, bindTourToAuth, canBeginTour, tourLocationReady, useTourStore } from '../../stores/tour';
import { track } from '../../services/analytics';
import { MapTour } from './MapTour';
import { listRect, meRect, peopleRect, tabsRect } from './geometry';
import { isTourTargetAvailable, measureView, registerTourTarget } from './targets';
import { resolveTourSteps } from './steps';

// o tour segue a conta logada e é armado no cadastro (uma vez, no boot)
bindTourToAuth(useAuthStore);

/** pós-cadastro: um respiro depois do mapa pronto (tiles e bonecos chegando) antes do tour */
const AUTO_SETTLE_MS = 1_500;
/** revendo pela Ajuda: a volta pro mapa acabou de acontecer */
const REPLAY_SETTLE_MS = 500;
/** abas que o último passo destaca */
const TOUR_TABS = ['Likes', 'Inbox'] as const;

export interface MapTourHostProps {
  /** raiz do MapScreen: dela saem o boneco, a roda de gente, a lista e as abas */
  rootRef: RefObject<View | null>;
  /** altura do header do mapa (padding de cima da câmera) */
  headerH: number;
  /** altura da lista recolhida (padding de baixo da câmera) */
  listH: number;
  /** tenho posição: dá pra mostrar "você no mapa" e a roda de gente */
  hasMe: boolean;
  /** posição resolvida: tenho, ou foi negada/indisponível (o automático espera isso, até TOUR_LOCATION_WAIT_MS) */
  locationSettled: boolean;
  /** pedindo permissão de localização: o diálogo do sistema pode estar na tela (nunca começa por cima) */
  locationAsking: boolean;
  /** mapa pronto e nada por cima (busca aberta, momento/modal do match, erro do mapa) */
  screenReady: boolean;
  /** antes de começar: fecha sheets e recolhe a lista */
  onPrepare: () => void;
  /** câmera em mim (passo "você no mapa") */
  onFocusMe: () => void;
}

/**
 * Liga o tour ao mapa: registra os alvos que não são uma View (boneco, roda de gente, lista, abas), começa quando a
 * tela está livre e a posição resolvida (nunca junto de splash, Termos, cadastro, comemoração do match ou diálogo de
 * permissão; o pedido do push espera o tour no RootNavigator) e segura a comemoração do match enquanto está na tela
 * (não quando some por ter saído do mapa). memo: o MapScreen re-renderiza a cada passo da
 * bússola; o host só muda com as próprias props.
 */
export const MapTourHost = memo(function MapTourHost({
  rootRef,
  headerH,
  listH,
  hasMe,
  locationSettled,
  locationAsking,
  screenReady,
  onPrepare,
  onFocusMe,
}: MapTourHostProps) {
  const isFocused = useIsFocused();
  const navigation = useNavigation();
  const tabBarH = useBottomTabBarHeight();
  const insets = useSafeAreaInsets();

  const phase = useTourStore((s) => s.phase);
  const source = useTourStore((s) => s.source);
  const steps = useTourStore((s) => s.steps);
  const index = useTourStore((s) => s.index);
  const splashing = useTourStore((s) => s.splashing);
  const termsPending = useAuthStore((s) => Boolean(s.user?.legal && s.user.legal.acceptedVersion !== s.user.legal.currentVersion));
  const onboarding = useAuthStore((s) => s.onboardingStep != null);
  const celebrationBusy = useMatchCelebrationStore((s) => s.current != null || s.queue.length > 0);
  const celebrationOn = useMatchCelebrationStore((s) => s.current != null);

  // valores atuais pra quem mede (os alvos são registrados uma vez)
  const live = useRef({ headerH, listH, hasMe, tabBarH, insetBottom: insets.bottom });
  live.current = { headerH, listH, hasMe, tabBarH, insetBottom: insets.bottom };

  useEffect(() => {
    const frame = () => measureView(rootRef.current);
    const offs = [
      registerTourTarget(
        'me',
        async () => {
          const f = await frame();
          return f ? meRect(f, live.current.headerH, live.current.listH) : null;
        },
        () => live.current.hasMe,
      ),
      registerTourTarget(
        'people',
        async () => {
          const f = await frame();
          return f ? peopleRect(f, live.current.headerH, live.current.listH) : null;
        },
        () => live.current.hasMe,
      ),
      registerTourTarget(
        'list',
        async () => {
          const f = await frame();
          return f && live.current.listH > 0 ? listRect(f, live.current.listH) : null;
        },
        () => live.current.listH > 0,
      ),
      registerTourTarget(
        'tabs',
        async () => {
          const f = await frame();
          const routes = navigation.getState()?.routes.map((r) => r.name) ?? [];
          return f ? tabsRect(f, live.current.tabBarH, live.current.insetBottom, routes, TOUR_TABS) : null;
        },
        () => live.current.tabBarH > 0,
      ),
    ];
    return () => offs.forEach((off) => off());
  }, [rootRef, navigation]);

  // ---------- começar ----------
  const prepareRef = useRef(onPrepare);
  prepareRef.current = onPrepare;
  const baseGate = { phase, splashing, screenReady: screenReady && isFocused, termsPending, onboarding, celebrationBusy };
  const screenFree = canBeginTour({ ...baseGate, locationReady: true });
  // tela livre e sem posição ainda: espera até o teto (o relógio para com o diálogo de permissão na tela)
  const [locationWaited, setLocationWaited] = useState(false);
  useEffect(() => {
    if (!screenFree || locationSettled || locationAsking || locationWaited) return;
    const id = setTimeout(() => setLocationWaited(true), TOUR_LOCATION_WAIT_MS);
    return () => clearTimeout(id);
  }, [screenFree, locationSettled, locationAsking, locationWaited]);
  // a espera vale por rodada
  useEffect(() => {
    if (phase === 'idle') setLocationWaited(false);
  }, [phase]);
  const gateOpen = canBeginTour({
    ...baseGate,
    locationReady: tourLocationReady({ settled: locationSettled, asking: locationAsking, waitedOut: locationWaited }),
  });
  useEffect(() => {
    if (!gateOpen) return;
    const id = setTimeout(
      () => {
        // a comemoração pode ter entrado na fila agora: ela vai antes
        const c = useMatchCelebrationStore.getState();
        if (c.current || c.queue.length > 0) return;
        prepareRef.current();
        useTourStore.getState().begin(resolveTourSteps(isTourTargetAvailable));
      },
      source === 'replay' ? REPLAY_SETTLE_MS : AUTO_SETTLE_MS,
    );
    return () => clearTimeout(id);
  }, [gateOpen, source]);

  // começou sem posição (teto) e ela chegou ainda nas boas-vindas: "Esse é você" e a roda de gente entram
  const showing = phase === 'showing';
  useEffect(() => {
    if (!showing || index !== 0) return;
    useTourStore.getState().refreshSteps(resolveTourSteps(isTourTargetAvailable));
  }, [showing, index, hasMe]);

  const stepId = steps[index];
  // fora do mapa (toque num push abriu outra tela), Termos novos ou comemoração do match por cima: some e volta no
  // mesmo passo
  const visible = showing && isFocused && !termsPending && !celebrationOn && stepId != null;
  // só com o tour NA TELA a comemoração do match espera (mesmo mecanismo do modal de quem curtiu); fora do mapa ela
  // aparece, e o tour só volta depois dela. O pedido do push não precisa: só sai no mapa, onde o tour está visível
  useEffect(() => {
    if (!visible) return;
    return useMatchCelebrationStore.getState().holdLocal();
  }, [visible]);

  // ---------- ações ----------
  const report = useCallback((kind: 'done' | 'skipped') => {
    const s = useTourStore.getState();
    track(
      kind === 'done' ? 'map_tour_done' : 'map_tour_skipped',
      { durationMs: Math.max(0, Date.now() - s.startedAt), stepIndex: s.index, ...(kind === 'skipped' ? { skipped: true } : {}) },
      s.steps[s.index],
    );
  }, []);
  const onNext = useCallback(() => {
    const s = useTourStore.getState();
    if (s.index >= s.steps.length - 1) report('done');
    s.next();
  }, [report]);
  const onBack = useCallback(() => useTourStore.getState().back(), []);
  const onSkip = useCallback(() => {
    report('skipped');
    useTourStore.getState().close();
  }, [report]);

  if (!stepId) return null;
  return (
    <MapTour
      visible={visible}
      stepId={stepId}
      index={index}
      total={steps.length}
      replay={source === 'replay'}
      onNext={onNext}
      onBack={onBack}
      onSkip={onSkip}
      onFocusMe={onFocusMe}
    />
  );
});
