import React, { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Button, colors, radius, spacing, typography } from '@cruzei/ui-mobile';

import { FadeInView } from '../animated';
import { useVisibility } from '../../hooks/useVisibility';
import type { RootStackParamList } from '../../navigation/RootNavigator';

// Invisível sem Premium: no lugar das conversas (aba Mensagens e chat), o convite pra ficar visível ou assinar.
// Nada se perde: o servidor guarda o que chegar e entrega quando a pessoa volta a ficar visível.

interface Props {
  /** conversas com mensagem nova esperando (só o número, do GET /inbox/counts) */
  waiting?: number;
}

export function MessagingLocked({ waiting = 0 }: Props) {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { toggle, isPending } = useVisibility();
  const goPremium = useCallback(() => nav.navigate('Main', { screen: 'Paywall' }), [nav]);

  return (
    <View style={styles.wrap} accessibilityLiveRegion="polite">
      <FadeInView fromScale={0.7} fromY={10}>
        <View style={styles.icon}>
          <Ionicons name="eye-off-outline" size={52} color={colors.secondary} />
        </View>
      </FadeInView>
      <FadeInView delay={100} fromY={10}>
        <Text style={styles.title} accessibilityRole="header">
          você está invisível
        </Text>
      </FadeInView>
      <FadeInView delay={160} fromY={10}>
        <Text style={styles.body}>
          No modo invisível, mandar e receber mensagens é do Premium. Suas conversas ficam guardadas: é só ficar visível pra ver tudo.
        </Text>
      </FadeInView>
      {waiting > 0 ? (
        <FadeInView delay={220} fromY={10}>
          <View style={styles.waiting}>
            <Ionicons name="chatbubble-ellipses-outline" size={16} color={colors.black} />
            <Text style={styles.waitingText}>
              {waiting} {waiting === 1 ? 'conversa com mensagem nova te esperando' : 'conversas com mensagem nova te esperando'}
            </Text>
          </View>
        </FadeInView>
      ) : null}
      <FadeInView delay={280} fromY={10} style={styles.actions}>
        <Button title="Ficar visível" onPress={toggle} loading={isPending} fullWidth />
        <Button title="Conhecer o Premium" variant="ghost" onPress={goPremium} fullWidth />
      </FadeInView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl, gap: spacing.md },
  icon: {
    width: 104,
    height: 104,
    borderRadius: 52,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.gray[100],
  },
  title: { ...typography.h3, color: colors.black, textAlign: 'center' },
  body: { ...typography.body, color: colors.gray[600], textAlign: 'center' },
  waiting: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
  },
  waitingText: { ...typography.label, color: colors.black },
  actions: { alignSelf: 'stretch', gap: spacing.sm, marginTop: spacing.sm },
});
