import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import {
  BlurMask,
  Canvas,
  Circle,
  Group,
  Path,
  Skia,
  SweepGradient,
  vec,
  type Transforms3d,
} from '@shopify/react-native-skia';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { colors, fontFamily, radius, spacing, typography } from '@cruzei/ui-mobile';
import { formatBRL } from '@cruzei/shared-utils';
import { BlobBackground, Confetti, FadeInView, Glow, Pulse, ScaleOnPress, SlideInView } from '../../components/animated';
import { api, toApiError } from '../../services/api';
import { useAuthStore } from '../../stores/auth';
import { useLocationStore } from '../../stores/location';
import type { RootStackParamList } from '../../navigation/RootNavigator';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Boost'>;

// ───────────────────────────── tipos / constantes ─────────────────────────────

interface ActiveBoost {
  id: string;
  expiresAt: string;
  minutesRemaining: number;
}

const BOOST_PRICE_CENTS = 490;
const BOOST_HOURS = 1;
const BOOST_SECONDS = BOOST_HOURS * 3600;
const ACTIVE_POLL_MS = 30_000;

const PERKS = [
  { icon: 'expand-outline', label: '2x maior' },
  { icon: 'trending-up-outline', label: 'Topo do mapa' },
  { icon: 'time-outline', label: '1 hora' },
  { icon: 'navigate-outline', label: 'Até 5 km' },
] as const;

const FLAME_COLORS = [colors.accent, '#FF6A00', colors.secondary, colors.white] as const;

// Pseudo-aleatório determinístico: mesma "chama" a cada abertura, sem parecer bug
function seeded(i: number, salt: number): number {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function secondsLeft(expiresAt: string): number {
  return Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000));
}

function formatCountdown(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = h > 0 ? Math.floor((totalSec % 3600) / 60) : Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function friendlyBoostError(err: unknown): string {
  const e = toApiError(err);
  const msg = e.message.toLowerCase();
  if (e.status === 409 || msg.includes('active') || msg.includes('ativo') || msg.includes('already')) {
    return 'Você já tá com boost ativo. Deixa ele brilhar 🔥';
  }
  if (e.status === 402 || msg.includes('payment') || msg.includes('receipt')) {
    return 'O pagamento não rolou. Dá uma conferida e tenta de novo.';
  }
  if (e.error === 'unknown' || msg.includes('network') || msg.includes('timeout')) {
    return 'Sem sinal por aqui. Confere a internet e tenta de novo 📡';
  }
  return e.message || 'Não deu pra ativar agora. Tenta de novo em instantes.';
}

// ───────────────────────────── foguete (Skia) ─────────────────────────────

const ROCKET_W = 240;
const ROCKET_H = 230;
const FLAME_PARTICLES = 18;
const SPARKS = 10;

// Geometria do foguete em coordenadas locais (centro 0,0; bico em y=-60; base em y=+40)
const ROCKET_BODY = Skia.Path.MakeFromSVGString(
  'M0,-60 C22,-40 26,-10 26,20 L26,40 L-26,40 L-26,20 C-26,-10 -22,-40 0,-60 Z',
);
const ROCKET_NOSE = Skia.Path.MakeFromSVGString('M0,-60 C14,-48 20,-38 22,-25 L-22,-25 C-20,-38 -14,-48 0,-60 Z');
const ROCKET_FIN_L = Skia.Path.MakeFromSVGString('M-26,8 L-46,46 L-26,44 Z');
const ROCKET_FIN_R = Skia.Path.MakeFromSVGString('M26,8 L46,46 L26,44 Z');
const ROCKET_NOZZLE = Skia.Path.MakeFromSVGString('M-14,40 L14,40 L11,50 L-11,50 Z');
const FLAME_OUTER = Skia.Path.MakeFromSVGString('M-13,50 Q0,118 13,50 Z');
const FLAME_INNER = Skia.Path.MakeFromSVGString('M-6,50 Q0,88 6,50 Z');

interface RocketHeroProps {
  /** 0 = parado (flutuando); 1 = decolou e saiu da tela */
  launch: SharedValue<number>;
  paused: boolean;
}

/**
 * Foguete desenhado em Skia: corpo + bico dourado + aletas magenta + janela,
 * chama que tremula (scaleY) e partículas de fogo/faíscas em loop com blur.
 * Tudo dirigido por 3 shared values (bob, flicker, fire) — zero setState por frame.
 */
function RocketHero({ launch, paused }: RocketHeroProps) {
  const bob = useSharedValue(0);
  const flicker = useSharedValue(0);
  const fire = useSharedValue(0);

  useEffect(() => {
    if (paused) {
      cancelAnimation(bob);
      cancelAnimation(flicker);
      cancelAnimation(fire);
      return;
    }
    bob.value = withRepeat(withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.sin) }), -1, true);
    flicker.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 110, easing: Easing.inOut(Easing.quad) }),
        withTiming(0.35, { duration: 140, easing: Easing.inOut(Easing.quad) }),
        withTiming(0.8, { duration: 90, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 160, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
    fire.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.linear }), -1, false);
    return () => {
      cancelAnimation(bob);
      cancelAnimation(flicker);
      cancelAnimation(fire);
    };
  }, [bob, fire, flicker, paused]);

  const cx = ROCKET_W / 2;
  const cy = ROCKET_H / 2 - 24;

  const rocketTransform = useDerivedValue<Transforms3d>(() => {
    const l = launch.value;
    const ease = l * l; // acelera conforme sobe
    return [
      { translateX: cx + Math.sin(bob.value * Math.PI) * 3 },
      { translateY: cy + (bob.value - 0.5) * 12 - ease * 520 },
      { rotate: (bob.value - 0.5) * 0.06 },
      { scale: 1 - l * 0.25 },
    ];
  });

  // A chama cresce na decolagem e tremula sempre (escala a partir do bocal, y=50)
  const flameTransform = useDerivedValue<Transforms3d>(() => [
    { translateY: 50 },
    { scaleY: 0.75 + flicker.value * 0.35 + launch.value * 0.6 },
    { scaleX: 0.9 + flicker.value * 0.2 },
    { translateY: -50 },
  ]);
  const flameOpacity = useDerivedValue(() => 0.75 + flicker.value * 0.25);

  const particles = useMemo(
    () =>
      Array.from({ length: FLAME_PARTICLES }, (_, i) => ({
        phase: seeded(i, 1),
        drift: (seeded(i, 2) - 0.5) * 34,
        size: 3 + seeded(i, 3) * 5,
        wobble: 2 + seeded(i, 4) * 5,
        color: FLAME_COLORS[i % FLAME_COLORS.length],
      })),
    [],
  );
  const sparks = useMemo(
    () =>
      Array.from({ length: SPARKS }, (_, i) => ({
        phase: seeded(i, 7),
        angle: (seeded(i, 8) - 0.5) * Math.PI * 0.9 + Math.PI / 2, // leque pra baixo
        dist: 60 + seeded(i, 9) * 70,
        size: 1.2 + seeded(i, 10) * 1.6,
        color: i % 2 === 0 ? colors.accent : colors.white,
      })),
    [],
  );

  const particleValues = particles.map((p) => {
    /* eslint-disable react-hooks/rules-of-hooks */
    const prog = useDerivedValue(() => (fire.value + p.phase) % 1);
    const px = useDerivedValue(() => {
      const t = prog.value;
      const baseX = cx + Math.sin(bob.value * Math.PI) * 3;
      return baseX + p.drift * t + Math.sin(t * Math.PI * 4 + p.phase * 6) * p.wobble * t;
    });
    const py = useDerivedValue(() => {
      const t = prog.value;
      const baseY = cy + (bob.value - 0.5) * 12 - launch.value * launch.value * 520 + 52;
      return baseY + t * (90 + launch.value * 70);
    });
    const pr = useDerivedValue(() => p.size * (1 - prog.value * 0.85) * (1 - launch.value * 0.25));
    const po = useDerivedValue(() => (1 - prog.value) * 0.9);
    /* eslint-enable react-hooks/rules-of-hooks */
    return { px, py, pr, po, color: p.color };
  });

  const sparkValues = sparks.map((s) => {
    /* eslint-disable react-hooks/rules-of-hooks */
    const prog = useDerivedValue(() => (fire.value * 0.7 + s.phase) % 1);
    const sx = useDerivedValue(() => {
      const baseX = cx + Math.sin(bob.value * Math.PI) * 3;
      return baseX + Math.cos(s.angle) * s.dist * prog.value;
    });
    const sy = useDerivedValue(() => {
      const baseY = cy + (bob.value - 0.5) * 12 - launch.value * launch.value * 520 + 52;
      return baseY + Math.sin(s.angle) * s.dist * prog.value + 20 * prog.value * prog.value;
    });
    const so = useDerivedValue(() => (prog.value < 0.08 ? 0 : (1 - prog.value) * 0.95));
    /* eslint-enable react-hooks/rules-of-hooks */
    return { sx, sy, so, r: s.size, color: s.color };
  });

  // Halo dourado atrás do foguete some quando ele decola
  const haloOpacity = useDerivedValue(() => (0.22 + bob.value * 0.12) * (1 - launch.value));
  const haloR = useDerivedValue(() => 78 + bob.value * 10);

  if (!ROCKET_BODY || !ROCKET_NOSE || !ROCKET_FIN_L || !ROCKET_FIN_R || !ROCKET_NOZZLE || !FLAME_OUTER || !FLAME_INNER) {
    return null;
  }

  return (
    <Canvas style={{ width: ROCKET_W, height: ROCKET_H }} pointerEvents="none">
      <Group opacity={haloOpacity}>
        <Circle cx={cx} cy={cy} r={haloR} color={colors.accent}>
          <BlurMask blur={40} style="normal" />
        </Circle>
      </Group>

      {/* partículas de fogo (atrás do foguete) */}
      {particleValues.map((p, i) => (
        <Circle key={`f${i}`} cx={p.px} cy={p.py} r={p.pr} color={p.color} opacity={p.po}>
          <BlurMask blur={3} style="normal" />
        </Circle>
      ))}

      <Group transform={rocketTransform}>
        {/* chama principal */}
        <Group transform={flameTransform} opacity={flameOpacity}>
          <Path path={FLAME_OUTER} color={colors.accent}>
            <BlurMask blur={6} style="normal" />
          </Path>
          <Path path={FLAME_INNER} color={colors.white}>
            <BlurMask blur={2} style="normal" />
          </Path>
        </Group>
        <Path path={ROCKET_NOZZLE} color={colors.gray[600]} />
        <Path path={ROCKET_FIN_L} color={colors.secondary} />
        <Path path={ROCKET_FIN_R} color={colors.secondary} />
        <Path path={ROCKET_BODY} color={colors.white} />
        <Path path={ROCKET_BODY} color={colors.gray[300]} style="stroke" strokeWidth={1.5} opacity={0.6} />
        <Path path={ROCKET_NOSE} color={colors.accent} />
        {/* janela */}
        <Circle cx={0} cy={-2} r={11} color={colors.gray[800]} />
        <Circle cx={0} cy={-2} r={8} color={colors.info} />
        <Circle cx={-3} cy={-5} r={2.5} color={colors.white} opacity={0.8} />
      </Group>

      {/* faíscas (na frente) */}
      {sparkValues.map((s, i) => (
        <Circle key={`s${i}`} cx={s.sx} cy={s.sy} r={s.r} color={s.color} opacity={s.so} />
      ))}
    </Canvas>
  );
}

// ───────────────────────────── avatar com órbita ─────────────────────────────

interface AvatarOrbitProps {
  uri: string | null;
  initial: string;
  size: number;
  paused: boolean;
  /** cor do halo (dourado no boost) */
  glowColor?: string;
}

const ORBIT_INNER = 7;
const ORBIT_OUTER = 5;

/**
 * Meu avatar com Glow (blur real) e dois anéis de partículas orbitando em sentidos opostos.
 */
function AvatarOrbit({ uri, initial, size, paused, glowColor = colors.accent }: AvatarOrbitProps) {
  const pad = 40;
  const box = size + pad * 2;
  const c = box / 2;
  const spin = useSharedValue(0);

  useEffect(() => {
    if (paused) {
      cancelAnimation(spin);
      return;
    }
    spin.value = withRepeat(withTiming(1, { duration: 7000, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(spin);
  }, [paused, spin]);

  const dots = useMemo(() => {
    const inner = Array.from({ length: ORBIT_INNER }, (_, i) => ({
      ring: size / 2 + 12,
      offset: (i / ORBIT_INNER) * Math.PI * 2,
      dir: 1,
      r: 2.2 + seeded(i, 21) * 1.6,
      wobble: 2 + seeded(i, 22) * 3,
      color: i % 3 === 0 ? colors.white : glowColor,
    }));
    const outer = Array.from({ length: ORBIT_OUTER }, (_, i) => ({
      ring: size / 2 + 26,
      offset: (i / ORBIT_OUTER) * Math.PI * 2 + 0.4,
      dir: -1,
      r: 1.6 + seeded(i, 23) * 1.4,
      wobble: 3 + seeded(i, 24) * 3,
      color: i % 2 === 0 ? colors.primary : glowColor,
    }));
    return [...inner, ...outer];
  }, [glowColor, size]);

  const dotValues = dots.map((d) => {
    /* eslint-disable react-hooks/rules-of-hooks */
    const angle = useDerivedValue(() => spin.value * Math.PI * 2 * d.dir + d.offset);
    const radius = useDerivedValue(() => d.ring + Math.sin(spin.value * Math.PI * 6 + d.offset) * d.wobble);
    const dx = useDerivedValue(() => c + Math.cos(angle.value) * radius.value);
    const dy = useDerivedValue(() => c + Math.sin(angle.value) * radius.value * 0.92);
    // partículas "atrás" do avatar ficam mais fracas — dá volume à órbita
    const dop = useDerivedValue(() => 0.45 + 0.55 * (0.5 + Math.sin(angle.value) * 0.5));
    /* eslint-enable react-hooks/rules-of-hooks */
    return { dx, dy, dop, r: d.r, color: d.color };
  });

  return (
    <View style={{ width: box, height: box, alignItems: 'center', justifyContent: 'center' }}>
      <Glow color={glowColor} spread={18} intensity={0.85} shape="circle">
        <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
          {uri ? (
            <Image source={{ uri }} style={{ width: size, height: size }} accessibilityIgnoresInvertColors />
          ) : (
            <Text style={[styles.avatarInitial, { fontSize: size * 0.4 }]}>{initial}</Text>
          )}
        </View>
      </Glow>
      <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
        {dotValues.map((d, i) => (
          <Circle key={i} cx={d.dx} cy={d.dy} r={d.r} color={d.color} opacity={d.dop}>
            <BlurMask blur={1.5} style="normal" />
          </Circle>
        ))}
      </Canvas>
    </View>
  );
}

// ───────────────────────────── gauge circular ─────────────────────────────

interface BoostGaugeProps {
  /** fração restante 0..1 (shared value, animada por segundo) */
  progress: SharedValue<number>;
  size: number;
  children?: React.ReactNode;
}

/**
 * Arco de progresso restante em Skia: trilha + arco com gradiente lima→dourado,
 * halo desfocado por baixo e ponta luminosa. `start/end` do Path fazem o trim na GPU.
 */
function BoostGauge({ progress, size, children }: BoostGaugeProps) {
  const stroke = 10;
  const c = size / 2;
  const r = c - stroke;
  const circle = useMemo(() => {
    const p = Skia.Path.Make();
    p.addCircle(c, c, r);
    return p;
  }, [c, r]);

  const end = useDerivedValue(() => Math.max(0.002, Math.min(1, progress.value)));
  const tipX = useDerivedValue(() => c + Math.cos(-Math.PI / 2 + end.value * Math.PI * 2) * r);
  const tipY = useDerivedValue(() => c + Math.sin(-Math.PI / 2 + end.value * Math.PI * 2) * r);
  const rotate = useMemo<Transforms3d>(() => [{ rotate: -Math.PI / 2 }], []);
  const origin = useMemo(() => vec(c, c), [c]);

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
        <Path path={circle} style="stroke" strokeWidth={stroke} color={colors.white} opacity={0.08} />
        <Group transform={rotate} origin={origin}>
          <Path
            path={circle}
            style="stroke"
            strokeWidth={stroke + 6}
            strokeCap="round"
            color={colors.accent}
            opacity={0.45}
            end={end}
          >
            <BlurMask blur={12} style="normal" />
          </Path>
          <Path path={circle} style="stroke" strokeWidth={stroke} strokeCap="round" end={end}>
            <SweepGradient c={origin} colors={[colors.primary, colors.accent, colors.primary]} />
          </Path>
        </Group>
        <Circle cx={tipX} cy={tipY} r={7} color={colors.white}>
          <BlurMask blur={3} style="solid" />
        </Circle>
      </Canvas>
      {children}
    </View>
  );
}

// ───────────────────────────── tela ─────────────────────────────

/**
 * Boost ⚡: foguete em Skia + avatar orbitado (estado sem boost) e gauge com countdown (estado ativo).
 * Fluxo: CTA → localização atual (fallback store) → POST /boosts → haptics + decolagem → estado ativo.
 * GET /boosts/active a cada 30s mantém a tela sincronizada com o backend.
 */
export function BoostScreen() {
  const nav = useNavigation<Nav>();
  const focused = useIsFocused();
  const { width } = useWindowDimensions();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const storeLat = useLocationStore((s) => s.lat);
  const storeLng = useLocationStore((s) => s.lng);

  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [celebrate, setCelebrate] = useState(false);
  const [remaining, setRemaining] = useState<number>(0);

  const launch = useSharedValue(0);
  const progress = useSharedValue(1);
  const ctaGlow = useSharedValue(0);

  const mainPhoto = user?.photos.find((p) => p.isMain) ?? user?.photos[0] ?? null;
  const avatarUri = mainPhoto?.thumbnailUrl ?? mainPhoto?.url ?? null;
  const initial = (user?.name?.trim().charAt(0) || '?').toUpperCase();

  const activeQuery = useQuery({
    queryKey: ['boosts', 'active'],
    queryFn: async () => (await api.get<ActiveBoost | null>('/boosts/active')).data ?? null,
    refetchInterval: focused ? ACTIVE_POLL_MS : false,
    enabled: focused,
  });
  const active = activeQuery.data ?? null;
  const isActive = !!active && secondsLeft(active.expiresAt) > 0;

  // Countdown por segundo (setState 1x/s — não é por frame) + arco animado suave
  useEffect(() => {
    if (!active) return;
    const tick = () => {
      const left = secondsLeft(active.expiresAt);
      setRemaining(left);
      progress.value = withTiming(left / BOOST_SECONDS, { duration: 1000, easing: Easing.linear });
      if (left <= 0) {
        qc.setQueryData(['boosts', 'active'], null);
        setInfo('Seu boost acabou. Bora de novo? 🚀');
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [active, progress, qc]);

  // CTA "respira" em dourado enquanto não tem boost
  useEffect(() => {
    if (isActive || !focused) {
      cancelAnimation(ctaGlow);
      return;
    }
    ctaGlow.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.sin) }), -1, true);
    return () => cancelAnimation(ctaGlow);
  }, [ctaGlow, focused, isActive]);

  const resolveLocation = useCallback(async (): Promise<{ latitude: number; longitude: number } | null> => {
    try {
      const perm = await Location.getForegroundPermissionsAsync();
      const granted =
        perm.status === 'granted' ? true : (await Location.requestForegroundPermissionsAsync()).status === 'granted';
      if (granted) {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
      }
    } catch {
      /* GPS lento/indisponível — cai no fallback abaixo */
    }
    if (storeLat != null && storeLng != null) return { latitude: storeLat, longitude: storeLng };
    return null;
  }, [storeLat, storeLng]);

  const activate = useMutation({
    mutationFn: async (): Promise<ActiveBoost> => {
      const loc = await resolveLocation();
      if (!loc) throw new Error('no_location');
      const res = await api.post<{ id: string; expiresAt: string }>('/boosts', {
        durationHours: BOOST_HOURS,
        latitude: loc.latitude,
        longitude: loc.longitude,
        platform: 'android',
        receipt: 'dev',
      });
      return { id: res.data.id, expiresAt: res.data.expiresAt, minutesRemaining: BOOST_HOURS * 60 };
    },
    onMutate: () => {
      setError(null);
      setInfo(null);
    },
    onSuccess: async (boost) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      progress.value = 1;
      setCelebrate(true);
      // decolagem: o foguete sobe e some; depois trocamos pro estado ativo
      launch.value = withTiming(1, { duration: 650, easing: Easing.in(Easing.cubic) });
      await new Promise<void>((resolve) => setTimeout(resolve, 600));
      qc.setQueryData(['boosts', 'active'], boost);
      launch.value = 0;
    },
    onError: (err) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      if (err instanceof Error && err.message === 'no_location') {
        setError('Não achei você no mapa. Liga a localização e tenta de novo 📍');
        return;
      }
      const friendly = friendlyBoostError(err);
      setError(friendly);
      if (friendly.includes('já tá com boost')) qc.invalidateQueries({ queryKey: ['boosts', 'active'] });
    },
  });

  const ctaGlowStyle = useAnimatedStyle(() => ({
    opacity: 0.35 + ctaGlow.value * 0.4,
    transform: [{ scaleX: 1 + ctaGlow.value * 0.03 }, { scaleY: 1 + ctaGlow.value * 0.12 }],
  }));

  const goBack = () => {
    if (nav.canGoBack()) nav.goBack();
    else nav.navigate('Main');
  };

  const price = formatBRL(BOOST_PRICE_CENTS);
  const gaugeSize = Math.min(260, width - spacing.xl * 2);
  const countdown = formatCountdown(remaining);
  const countdownLabel = `Faltam ${Math.floor(remaining / 60)} minutos e ${remaining % 60} segundos de boost`;

  return (
    <View style={styles.root}>
      <BlobBackground
        intensity={isActive ? 0.42 : 0.34}
        palette={[colors.accent, colors.primary, colors.accent]}
        speed={isActive ? 1.4 : 1}
        paused={!focused}
      />
      <LinearGradient
        colors={['rgba(10,10,26,0.2)', 'rgba(10,10,26,0.7)', 'rgba(10,10,26,0.98)']}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <Confetti
        active={celebrate}
        count={70}
        palette={[colors.accent, colors.primary, colors.white]}
        origin={{ x: 0.5, y: 0.3 }}
        onDone={() => setCelebrate(false)}
      />

      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        {/* header */}
        <FadeInView delay={60} fromY={-6} style={styles.header}>
          <Pressable onPress={goBack} hitSlop={8} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Voltar">
            <Ionicons name="chevron-back" size={26} color={colors.white} />
          </Pressable>
          <Text style={styles.title} accessibilityRole="header">
            Boost ⚡
          </Text>
          <View style={styles.backBtn} />
        </FadeInView>

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} bounces={false}>
          {isActive ? (
            // ─────────── estado ATIVO ───────────
            <FadeInView key="active" fromScale={0.94} durationMs={320} style={styles.center}>
              <SlideInView from="up" distance={14} delay={80} springPreset="bouncy">
                <View style={styles.activePill} accessibilityRole="text">
                  <Pulse maxScale={1.25} cycleMs={1000}>
                    <View style={styles.activeDot} />
                  </Pulse>
                  <Text style={styles.activePillText}>BOOST ATIVO</Text>
                </View>
              </SlideInView>

              <View style={{ marginTop: spacing.xl }}>
                <BoostGauge progress={progress} size={gaugeSize}>
                  <AvatarOrbit uri={avatarUri} initial={initial} size={gaugeSize * 0.42} paused={!focused} />
                </BoostGauge>
              </View>

              <Text
                style={styles.countdown}
                accessibilityRole="timer"
                accessibilityLabel={countdownLabel}
                accessibilityLiveRegion="polite"
              >
                {countdown}
              </Text>
              <Text style={styles.countdownHint}>pra esse boost acabar</Text>

              <SlideInView from="up" distance={16} delay={200} style={{ alignItems: 'center' }}>
                <Text style={styles.activeHeadline}>Você tá no topo do mapa 🔥</Text>
                <Text style={styles.subtitle}>
                  Seu avatar tá 2x maior pra quem tá num raio de 5 km. Aproveita e dá uma olhada em quem cruzou com você.
                </Text>
              </SlideInView>

              <ScaleOnPress
                onPress={() => nav.navigate('Main')}
                style={styles.secondaryBtn}
                accessibilityRole="button"
                accessibilityLabel="Ver o mapa"
              >
                <Ionicons name="map-outline" size={18} color={colors.primary} />
                <Text style={styles.secondaryBtnText}>Ver quem tá por perto</Text>
              </ScaleOnPress>
            </FadeInView>
          ) : (
            // ─────────── estado SEM BOOST ───────────
            <FadeInView key="idle" fromY={10} durationMs={260} style={styles.center}>
              <View style={styles.hero} accessible accessibilityLabel="Foguete decolando com fogo">
                <RocketHero launch={launch} paused={!focused} />
              </View>

              <View style={styles.avatarRow}>
                <AvatarOrbit uri={avatarUri} initial={initial} size={96} paused={!focused} />
              </View>

              <SlideInView from="up" distance={16} delay={120} style={{ alignItems: 'center' }}>
                <Text style={styles.headline}>Bora aparecer?</Text>
                <Text style={styles.subtitle}>
                  Seu avatar fica 2x maior e no topo do mapa por 1 hora. Visível pra até 5 km.
                </Text>
              </SlideInView>

              <View style={styles.perks}>
                {PERKS.map((perk, i) => (
                  <FadeInView key={perk.label} delay={260 + i * 70} fromY={8} fromScale={0.96}>
                    <View style={styles.perk}>
                      <Ionicons name={perk.icon} size={14} color={colors.accent} />
                      <Text style={styles.perkText}>{perk.label}</Text>
                    </View>
                  </FadeInView>
                ))}
              </View>

              <FadeInView delay={520} fromY={6} style={styles.priceRow}>
                <Text style={styles.price}>{price}</Text>
                <Text style={styles.priceHint}>por 1 hora · cobrança única</Text>
              </FadeInView>

              {info ? (
                <FadeInView fromY={4} style={styles.banner}>
                  <Ionicons name="sparkles-outline" size={16} color={colors.accent} />
                  <Text style={styles.bannerText}>{info}</Text>
                </FadeInView>
              ) : null}
              {error ? (
                <FadeInView fromY={4} style={[styles.banner, styles.bannerError]} accessibilityLiveRegion="assertive">
                  <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
                  <Text style={[styles.bannerText, { color: colors.white }]}>{error}</Text>
                </FadeInView>
              ) : null}
            </FadeInView>
          )}
        </ScrollView>

        {/* CTA fixo no rodapé (só sem boost) */}
        {!isActive ? (
          <SlideInView from="up" distance={28} delay={300} style={styles.footer}>
            <View style={styles.ctaWrap}>
              <Animated.View style={[styles.ctaHalo, ctaGlowStyle]} pointerEvents="none" />
              <ScaleOnPress
                onPress={() => activate.mutate()}
                disabled={activate.isPending}
                glowColor={colors.accent}
                style={[styles.cta, activate.isPending ? styles.ctaPending : {}]}
                accessibilityRole="button"
                accessibilityLabel={`Ativar boost por ${price}`}
                accessibilityState={{ disabled: activate.isPending, busy: activate.isPending }}
              >
                <LinearGradient
                  colors={[colors.accent, '#FFB800']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={StyleSheet.absoluteFill}
                />
                {activate.isPending ? (
                  <>
                    <ActivityIndicator color={colors.black} />
                    <Text style={styles.ctaText}>Preparando decolagem…</Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.ctaEmoji}>🚀</Text>
                    <Text style={styles.ctaText}>Ativar boost por {price}</Text>
                  </>
                )}
              </ScaleOnPress>
            </View>
            <Text style={styles.footerHint}>Sem assinatura, sem pegadinha. Vale por 1 hora a partir de agora.</Text>
          </SlideInView>
        ) : null}
      </SafeAreaView>
    </View>
  );
}

// ───────────────────────────── estilos ─────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.black },
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    height: 56,
  },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { ...typography.h3, color: colors.white },
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xl },
  center: { alignItems: 'center' },

  hero: { height: ROCKET_H, alignItems: 'center', justifyContent: 'center', marginTop: -spacing.md },
  avatarRow: { marginTop: -spacing.xl, alignItems: 'center' },
  avatar: {
    overflow: 'hidden',
    backgroundColor: colors.gray[800],
    borderWidth: 3,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { fontFamily: fontFamily.display, color: colors.accent },

  headline: { ...typography.h1, color: colors.white, textAlign: 'center', marginTop: spacing.sm },
  subtitle: {
    ...typography.bodyLarge,
    color: colors.gray[300],
    textAlign: 'center',
    marginTop: spacing.sm,
    maxWidth: 320,
  },
  perks: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  perk: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    height: 32,
    borderRadius: radius.full,
    backgroundColor: 'rgba(255,215,0,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.35)',
  },
  perkText: { ...typography.label, color: colors.white },
  priceRow: { alignItems: 'center', marginTop: spacing.xl },
  price: { ...typography.display, color: colors.accent, letterSpacing: -1.5 },
  priceHint: { ...typography.bodySmall, color: colors.gray[400], marginTop: 2 },

  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,215,0,0.12)',
    maxWidth: 360,
  },
  bannerError: { backgroundColor: 'rgba(255,59,48,0.16)' },
  bannerText: { ...typography.body, color: colors.accent, flexShrink: 1 },

  footer: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.md },
  ctaWrap: { alignItems: 'stretch', justifyContent: 'center' },
  ctaHalo: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    shadowColor: colors.accent,
    shadowOpacity: 0.9,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
  },
  cta: {
    height: 56,
    borderRadius: radius.full,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  ctaPending: { opacity: 0.85 },
  ctaEmoji: { fontSize: 20 },
  ctaText: { ...typography.h4, color: colors.black },
  footerHint: { ...typography.caption, color: colors.gray[500], textAlign: 'center', marginTop: spacing.md },

  activePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: 'rgba(127,255,0,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(127,255,0,0.45)',
    marginTop: spacing.sm,
  },
  activeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  activePillText: { ...typography.label, color: colors.primary, letterSpacing: 1.2 },
  countdown: {
    fontFamily: fontFamily.mono,
    fontSize: 48,
    lineHeight: 56,
    color: colors.white,
    marginTop: spacing.lg,
    fontVariant: ['tabular-nums'],
  },
  countdownHint: { ...typography.bodySmall, color: colors.gray[400], marginTop: -2 },
  activeHeadline: { ...typography.h2, color: colors.white, textAlign: 'center', marginTop: spacing.xl },
  secondaryBtn: {
    marginTop: spacing.xl,
    height: 48,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  secondaryBtnText: { ...typography.label, color: colors.primary },
});
