import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

import { colors, radius, spacing, typography } from '@cruzei/ui-mobile';
import { BlobBackground } from '../../components/animated/BlobBackground';
import { FadeInView, Glow, Pulse, ScaleOnPress, SlideInView, StaggerText } from '../../components/animated';
import type { RootStackParamList } from '../../navigation/RootNavigator';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Onboarding'>;

const PROOFS = [
  { icon: 'map-outline', text: 'Vê no mapa quem esteve onde você esteve' },
  { icon: 'eye-off-outline', text: 'Modo anônimo pra olhar sem aparecer' },
  { icon: 'chatbubble-ellipses-outline', text: 'Match com contexto — nunca mais "oi"' },
] as const;

/**
 * Welcome: converte visitante em usuário.
 * Headline letra por letra, subtítulo em slide, provas sociais em stagger,
 * CTA "Começar" com glow pulsante e fundo de blobs vivos (Skia).
 */
export function WelcomeScreen() {
  const nav = useNavigation<Nav>();
  const focused = useIsFocused();

  return (
    <View style={styles.root}>
      <BlobBackground intensity={0.38} paused={!focused} />
      {/* véu inferior pra garantir contraste do texto sobre os blobs */}
      <LinearGradient
        colors={['rgba(10,10,26,0)', 'rgba(10,10,26,0.75)', 'rgba(10,10,26,0.98)']}
        locations={[0, 0.45, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <SafeAreaView style={styles.safe}>
        <FadeInView delay={100} fromY={-8} style={styles.header}>
          <Text style={styles.logo}>cruzei</Text>
        </FadeInView>

        <View style={styles.bottom}>
          <StaggerText
            text="Quem você quase conheceu hoje"
            by="letter"
            stagger={26}
            delay={350}
            style={styles.headline}
            containerStyle={{ maxWidth: 340 }}
          />

          <SlideInView from="up" distance={18} delay={1200} style={{ marginTop: spacing.md }}>
            <Text style={styles.subtitle}>
              O Cruzei mostra quem esteve no mesmo lugar que você. Match só rola quando o encontro é possível.
            </Text>
          </SlideInView>

          <View style={styles.proofs}>
            {PROOFS.map((p, i) => (
              <FadeInView key={p.text} delay={1500 + i * 140} fromX={-14} style={styles.proof}>
                <Ionicons name={p.icon} size={18} color={colors.primary} />
                <Text style={styles.proofText}>{p.text}</Text>
              </FadeInView>
            ))}
          </View>

          <FadeInView delay={2000} fromY={16} style={{ marginTop: spacing.xl }}>
            <Glow color={colors.primary} spread={14} intensity={0.55} shape="pill" style={{ alignSelf: 'stretch' }}>
              <ScaleOnPress
                onPress={() => nav.navigate('Login')}
                glowColor={colors.primary}
                accessibilityRole="button"
                accessibilityLabel="Começar, criar conta"
                style={styles.cta}
              >
                <Text style={styles.ctaText}>Bora te encontrar?</Text>
                <Pulse maxScale={1.15} cycleMs={1400}>
                  <Ionicons name="arrow-forward-circle" size={26} color={colors.black} />
                </Pulse>
              </ScaleOnPress>
            </Glow>
          </FadeInView>

          <FadeInView delay={2250} style={{ marginTop: spacing.md }}>
            <ScaleOnPress
              onPress={() => nav.navigate('Login')}
              haptic={false}
              accessibilityRole="button"
              accessibilityLabel="Já tenho conta, entrar"
              style={styles.secondary}
            >
              <Text style={styles.secondaryText}>Já tenho conta</Text>
            </ScaleOnPress>
          </FadeInView>

          <FadeInView delay={2500}>
            <Text style={styles.legal}>Ao continuar você aceita os Termos e a Política de Privacidade (LGPD).</Text>
          </FadeInView>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.black },
  safe: { flex: 1, justifyContent: 'space-between' },
  header: { paddingTop: spacing.xxl, alignItems: 'center' },
  logo: {
    ...typography.display,
    fontSize: 44,
    lineHeight: 52,
    letterSpacing: -2,
    color: colors.primary,
    textShadowColor: 'rgba(127,255,0,0.45)',
    textShadowRadius: 18,
    textShadowOffset: { width: 0, height: 0 },
  },
  bottom: { paddingHorizontal: spacing.xl, paddingBottom: spacing.lg },
  headline: {
    ...typography.display,
    fontSize: 38,
    lineHeight: 44,
    color: colors.white,
  },
  subtitle: { ...typography.bodyLarge, color: colors.white, opacity: 0.78 },
  proofs: { marginTop: spacing.lg, gap: spacing.sm },
  proof: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  proofText: { ...typography.body, color: colors.white, opacity: 0.9 },
  cta: {
    height: 58,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  ctaText: { ...typography.h3, color: colors.black },
  secondary: {
    height: 50,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: 'rgba(250,250,250,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: { ...typography.label, color: colors.white },
  legal: { ...typography.caption, color: colors.gray[500], textAlign: 'center', marginTop: spacing.md },
});
