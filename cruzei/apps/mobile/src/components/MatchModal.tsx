import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NavigationProp } from '@react-navigation/native';

import { useAuthStore } from '../stores/auth';
import { colors, radius, spacing, typography } from '@cruzei/ui-mobile';
import type { MainTabParamList } from '../navigation/MainTabs';

export interface MatchInfo {
  matchId: string;
  name: string;
  photo: string | null;
  context?: string | null;
}

// "Deu match!" — a animação de contexto: mostra ONDE vocês se cruzaram e abre o chat.
export function MatchModal({ match, onClose }: { match: MatchInfo | null; onClose: () => void }) {
  const nav = useNavigation<NavigationProp<MainTabParamList>>();
  const me = useAuthStore((s) => s.user);
  const scale = useRef(new Animated.Value(0.6)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!match) return;
    scale.setValue(0.6);
    opacity.setValue(0);
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 5, tension: 80 }),
      Animated.timing(opacity, { toValue: 1, duration: 250, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start();
  }, [match, scale, opacity]);

  if (!match) return null;
  const myPhoto = me?.photos?.find((p) => p.isMain)?.url ?? me?.photos?.[0]?.url ?? null;

  const openChat = () => {
    onClose();
    // initial:false → MatchesList fica embaixo na pilha e o chat ganha botão de voltar
    nav.navigate('Matches', { screen: 'Chat', initial: false, params: { matchId: match.matchId, name: match.name } } as never);
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Animated.View style={[styles.card, { opacity, transform: [{ scale }] }]}>
          <Text style={styles.eyebrow}>deu match</Text>
          <Text style={styles.title}>você e {match.name}</Text>

          <View style={styles.avatars}>
            <Avatar uri={myPhoto} />
            <View style={styles.heart}>
              <Ionicons name="heart" size={22} color={colors.black} />
            </View>
            <Avatar uri={match.photo} />
          </View>

          <View style={styles.contextBox}>
            <Ionicons name="location" size={16} color={colors.secondary} />
            <Text style={styles.contextText}>{match.context ?? 'Vocês estiveram perto hoje.'}</Text>
          </View>

          <Pressable onPress={openChat} style={styles.primary}>
            <Text style={styles.primaryText}>Mandar mensagem</Text>
          </Pressable>
          <Pressable onPress={onClose} style={styles.secondary}>
            <Text style={styles.secondaryText}>Continuar explorando</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

function Avatar({ uri }: { uri: string | null }) {
  return uri ? (
    <Image source={{ uri }} style={styles.avatar} />
  ) : (
    <View style={[styles.avatar, styles.avatarPlaceholder]}>
      <Ionicons name="person" size={32} color={colors.gray[400]} />
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(10,10,26,0.88)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  card: { width: '100%', backgroundColor: colors.white, borderRadius: radius.xl, padding: spacing.xl, alignItems: 'center' },
  eyebrow: { ...typography.label, color: colors.secondary, letterSpacing: 2, textTransform: 'uppercase' },
  title: { ...typography.h2, color: colors.black, marginTop: spacing.xs, textAlign: 'center' },
  avatars: { flexDirection: 'row', alignItems: 'center', marginVertical: spacing.xl, gap: spacing.md },
  avatar: { width: 96, height: 96, borderRadius: 48, borderWidth: 3, borderColor: colors.primary },
  avatarPlaceholder: { backgroundColor: colors.gray[100], alignItems: 'center', justifyContent: 'center' },
  heart: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  contextBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: '#FFE0F0', padding: spacing.md, borderRadius: radius.md, width: '100%' },
  contextText: { ...typography.body, color: colors.secondary, flex: 1 },
  primary: { marginTop: spacing.xl, backgroundColor: colors.primary, borderRadius: radius.md, height: 52, alignItems: 'center', justifyContent: 'center', width: '100%' },
  primaryText: { ...typography.label, color: colors.black, fontSize: 16 },
  secondary: { marginTop: spacing.sm, height: 44, alignItems: 'center', justifyContent: 'center', width: '100%' },
  secondaryText: { ...typography.label, color: colors.gray[600] },
});
