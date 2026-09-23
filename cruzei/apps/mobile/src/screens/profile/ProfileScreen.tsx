import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';

import { api, toApiError } from '../../services/api';
import { useAuthStore } from '../../stores/auth';
import { useVisibility } from '../../hooks/useVisibility';
import { Button } from '@cruzei/ui-mobile';
import { colors, radius, shadows, spacing, typography } from '@cruzei/ui-mobile';
import type { User } from '@cruzei/shared-types';
import type { ProfileStackParamList } from '../../navigation/ProfileStack';

const LOOKING_FOR_LABEL: Record<string, string> = {
  relationship: 'Namorar',
  casual: 'Algo casual',
  friendship: 'Amizade',
  network: 'Networking',
  unspecified: 'Ainda decidindo',
};

export function ProfileScreen() {
  const nav = useNavigation<NativeStackNavigationProp<ProfileStackParamList>>();
  const qc = useQueryClient();
  const { logout, setUser } = useAuthStore();
  const { isAnonymous, toggle: toggleAnonymous } = useVisibility();
  const [busy, setBusy] = useState(false);

  const query = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const me = (await api.get<User>('/me')).data;
      setUser(me);
      return me;
    },
  });

  const settings = useMutation({
    mutationFn: async (patch: { showDistance?: boolean; showAge?: boolean }) => (await api.patch('/me/settings', patch)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
    onError: (err) => Alert.alert('Ops', toApiError(err).message),
  });

  if (query.isLoading || !query.data) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
      </SafeAreaView>
    );
  }

  const me = query.data;
  const mainPhoto = me.photos?.find((p) => p.isMain) ?? me.photos?.[0];

  const confirmLogout = () =>
    Alert.alert('Sair da conta?', 'Você vai precisar do código SMS pra entrar de novo.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Sair', style: 'destructive', onPress: () => logout() },
    ]);

  const pause = () =>
    Alert.alert('Pausar perfil', 'Você some do mapa e das curtidas por 24h. Seus matches continuam.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Pausar 24h',
        onPress: async () => {
          setBusy(true);
          try {
            await api.patch('/me/pause', { durationHours: 24 });
            qc.invalidateQueries({ queryKey: ['me'] });
          } catch (err) {
            Alert.alert('Ops', toApiError(err).message);
          } finally {
            setBusy(false);
          }
        },
      },
    ]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => query.refetch()} tintColor={colors.primary} />}
      >
        <View style={styles.titleRow}>
          <Text style={styles.title}>seu perfil</Text>
          <Pressable onPress={() => nav.navigate('EditProfile')} style={styles.editBtn}>
            <Ionicons name="create-outline" size={18} color={colors.black} />
            <Text style={styles.editText}>Editar</Text>
          </Pressable>
        </View>

        <View style={styles.header}>
          <Pressable onPress={() => nav.navigate('EditProfile')}>
            {mainPhoto ? (
              <Image source={{ uri: mainPhoto.url }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarPlaceholder]}>
                <Ionicons name="camera-outline" size={32} color={colors.gray[400]} />
                <Text style={styles.avatarHint}>adicionar foto</Text>
              </View>
            )}
          </Pressable>
          <Text style={styles.name}>
            {me.name}, {me.age}
          </Text>
          <Text style={styles.age}>{LOOKING_FOR_LABEL[me.lookingFor] ?? me.lookingFor}</Text>
          <View style={styles.complete}>
            <View style={[styles.completeBar, { width: `${Math.max(4, me.profileCompleteness)}%` }]} />
            <Text style={styles.completeText}>{me.profileCompleteness}% completo</Text>
          </View>
        </View>

        {me.bio ? <Text style={styles.bio}>{me.bio}</Text> : null}

        {me.interests?.length ? (
          <View style={styles.chips}>
            {me.interests.map((i) => (
              <View key={i} style={styles.chip}>
                <Text style={styles.chipText}>{i}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.statsRow}>
          <Stat label="curtidas" value={me.stats?.likesReceived ?? 0} />
          <Stat label="matches" value={me.stats?.matches ?? 0} />
          <Stat label="fotos" value={me.photos?.length ?? 0} />
        </View>

        <Section title="visibilidade">
          <Row icon={isAnonymous ? 'eye-off-outline' : 'eye-outline'} label="Modo anônimo" hint="Você vê todo mundo, ninguém vê você" value={isAnonymous} onToggle={toggleAnonymous} />
          <Row icon="navigate-outline" label="Mostrar distância" value={me.settings.showDistance} onToggle={() => settings.mutate({ showDistance: !me.settings.showDistance })} />
          <Row icon="calendar-outline" label="Mostrar idade" value={me.settings.showAge} onToggle={() => settings.mutate({ showAge: !me.settings.showAge })} />
        </Section>

        <Section title="conta">
          <Link icon="shield-checkmark-outline" label="Verificação por selfie" hint={me.isVerified ? 'verificado' : 'em breve'} onPress={() => Alert.alert('Em breve', 'A verificação por selfie chega no beta.')} />
          <Link icon="pause-circle-outline" label={me.settings.isPaused ? 'Perfil pausado' : 'Pausar perfil por 24h'} onPress={pause} disabled={busy || me.settings.isPaused} />
          <Link icon="download-outline" label="Baixar meus dados (LGPD)" onPress={() => Alert.alert('LGPD', 'Pedido registrado. Você recebe o arquivo por SMS em até 15 dias.')} />
          <Link icon="trash-outline" label="Excluir conta" danger onPress={() => Alert.alert('Excluir conta', 'Manda um "excluir" pro suporte@cruzei.com.br — a exclusão automática chega no beta.')} />
        </Section>

        <View style={{ height: spacing.lg }} />
        <Button title="Sair" variant="ghost" onPress={confirmLogout} fullWidth />
        <Text style={styles.version}>cruzei 0.1.0 · {me.phone}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function Row({ icon, label, hint, value, onToggle }: { icon: string; label: string; hint?: string; value: boolean; onToggle: () => void }) {
  return (
    <View style={styles.row}>
      <Ionicons name={icon as never} size={22} color={colors.black} />
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onToggle} trackColor={{ false: colors.gray[200], true: colors.primary }} thumbColor={colors.white} />
    </View>
  );
}

function Link({ icon, label, hint, danger, disabled, onPress }: { icon: string; label: string; hint?: string; danger?: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.link, disabled && { opacity: 0.5 }]} onPress={onPress} disabled={disabled}>
      <Ionicons name={icon as never} size={22} color={danger ? colors.danger : colors.black} />
      <Text style={[styles.linkText, danger && { color: colors.danger }]}>{label}</Text>
      {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
      <Ionicons name="chevron-forward" size={22} color={colors.gray[400]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.lg },
  title: { ...typography.h1, color: colors.black },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.primary, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.full },
  editText: { ...typography.label, color: colors.black },
  header: { alignItems: 'center', marginBottom: spacing.lg },
  avatar: { width: 128, height: 128, borderRadius: 64, marginBottom: spacing.md, borderWidth: 3, borderColor: colors.primary },
  avatarPlaceholder: { backgroundColor: colors.gray[100], alignItems: 'center', justifyContent: 'center', borderStyle: 'dashed', borderColor: colors.gray[300] },
  avatarHint: { ...typography.bodySmall, color: colors.gray[500], marginTop: 4 },
  name: { ...typography.h2, color: colors.black },
  age: { ...typography.body, color: colors.gray[600], marginTop: spacing.xs },
  complete: { marginTop: spacing.md, width: 200, height: 26, borderRadius: radius.full, backgroundColor: colors.gray[200], overflow: 'hidden', justifyContent: 'center' },
  completeBar: { ...StyleSheet.absoluteFillObject, backgroundColor: '#C8FF7A' },
  completeText: { ...typography.label, color: '#3A7A00', textAlign: 'center' },
  bio: { ...typography.body, color: colors.black, textAlign: 'center', marginBottom: spacing.lg, paddingHorizontal: spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'center', marginBottom: spacing.lg },
  chip: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.gray[200], borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: 6 },
  chipText: { ...typography.bodySmall, color: colors.black },
  statsRow: { flexDirection: 'row', backgroundColor: colors.white, borderRadius: radius.lg, marginBottom: spacing.xl, ...shadows.light },
  stat: { flex: 1, alignItems: 'center', paddingVertical: spacing.md },
  statValue: { ...typography.h3, color: colors.black },
  statLabel: { ...typography.bodySmall, color: colors.gray[500] },
  section: { marginBottom: spacing.xl },
  sectionTitle: { ...typography.label, color: colors.gray[500], textTransform: 'uppercase', marginBottom: spacing.sm },
  sectionBody: { backgroundColor: colors.white, borderRadius: radius.lg, ...shadows.light },
  row: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.gray[100], gap: spacing.md },
  rowLabel: { ...typography.body, color: colors.black },
  rowHint: { ...typography.bodySmall, color: colors.gray[500] },
  link: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.gray[100], gap: spacing.md },
  linkText: { ...typography.body, color: colors.black, flex: 1 },
  version: { ...typography.bodySmall, color: colors.gray[400], textAlign: 'center', marginTop: spacing.lg },
});
