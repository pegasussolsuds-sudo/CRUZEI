import React from 'react';
import { Dimensions, ImageBackground, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@cruzei/ui-mobile';
import { colors, spacing, typography } from '@cruzei/ui-mobile';
import type { RootStackParamList } from '../../navigation/RootNavigator';

const { width } = Dimensions.get('window');

type Nav = NativeStackNavigationProp<RootStackParamList, 'Onboarding'>;

export function OnboardingScreen() {
  const nav = useNavigation<Nav>();

  return (
    <ImageBackground
      source={require('../../../assets/splash.png')}
      style={styles.bg}
      blurRadius={2}
    >
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <Text style={styles.logo}>cruzei</Text>
          <Text style={styles.tagline}>quem você quase conheceu hoje</Text>
        </View>

        <View style={styles.bottom}>
          <Text style={styles.title}>conexões reais{'\n'}de lugares reais</Text>
          <Text style={styles.subtitle}>
            O Cruzei mostra quem esteve no mesmo lugar que você.
            Match só rola quando o encontro é possível.
          </Text>

          <View style={{ height: spacing.xl }} />
          <Button
            title="Criar conta"
            variant="primary"
            size="lg"
            fullWidth
            onPress={() => nav.navigate('Login')}
          />
          <View style={{ height: spacing.md }} />
          <Button
            title="Já tenho conta"
            variant="ghostLight"
            size="md"
            fullWidth
            onPress={() => nav.navigate('Login')}
          />
        </View>
      </SafeAreaView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  bg: {
    flex: 1,
    width,
    backgroundColor: colors.black,
  },
  safe: { flex: 1, justifyContent: 'space-between' },
  header: {
    paddingTop: spacing.xxl,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
  },
  logo: {
    ...typography.display,
    color: colors.primary,
    fontSize: 56,
    letterSpacing: -2,
  },
  tagline: {
    ...typography.body,
    color: colors.white,
    opacity: 0.7,
    marginTop: spacing.xs,
  },
  bottom: {
    padding: spacing.xl,
    backgroundColor: 'rgba(10,10,26,0.85)',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  title: {
    ...typography.h1,
    color: colors.white,
    textAlign: 'center',
  },
  subtitle: {
    ...typography.body,
    color: colors.white,
    opacity: 0.7,
    textAlign: 'center',
    marginTop: spacing.md,
  },
});
