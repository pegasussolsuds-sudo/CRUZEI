import React, { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '@cruzei/ui-mobile';
import type { PrivateArea } from '@cruzei/shared-types';
import { api, toApiError } from '../../services/api';
import { getCurrentLocation } from '../../services/location';
import { ScaleOnPress } from '../../components/animated/ScaleOnPress';
import { FadeInView } from '../../components/animated/FadeInView';

const PRESETS = ['Casa', 'Trabalho', 'Faculdade', 'Outro'];
const RADII = [100, 150, 300, 500];

/**
 * Áreas privadas (brief PRIVACIDADE §8/§9): casa, trabalho, escola… Dentro delas ninguém me descobre por
 * proximidade — o servidor decide a cada atualização de posição. A coordenada da área fica só no servidor;
 * aqui aparecem rótulo e raio. Além destas, o servidor aprende sozinho a área de residência (madrugadas).
 */
export function PrivateAreasScreen() {
  const nav = useNavigation();
  const qc = useQueryClient();
  const [label, setLabel] = useState('Casa');
  const [radiusM, setRadiusM] = useState(150);
  const [busy, setBusy] = useState(false);

  const areas = useQuery({
    queryKey: ['private-areas'],
    queryFn: async () => (await api.get<PrivateArea[]>('/me/private-areas')).data,
  });

  const add = useMutation({
    mutationFn: async () => {
      const loc = await getCurrentLocation();
      if (!loc) throw new Error('Não consegui pegar sua posição agora. Liga o GPS e tenta de novo.');
      await api.post('/me/private-areas', { label: label.trim() || 'Área privada', latitude: loc.latitude, longitude: loc.longitude, radiusM });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['private-areas'] });
      qc.invalidateQueries({ queryKey: ['nearby'] });
    },
    onError: (err) => Alert.alert('Não deu', err instanceof Error && !('response' in err) ? err.message : toApiError(err).message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => api.delete(`/me/private-areas/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['private-areas'] }),
  });

  const onAdd = useCallback(async () => {
    setBusy(true);
    try {
      await add.mutateAsync();
    } finally {
      setBusy(false);
    }
  }, [add]);

  const confirmRemove = useCallback(
    (a: PrivateArea) => {
      Alert.alert('Remover área privada?', `"${a.label}" deixa de te esconder.`, [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Remover', style: 'destructive', onPress: () => remove.mutate(a.id) },
      ]);
    },
    [remove],
  );

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => nav.goBack()} accessibilityRole="button" accessibilityLabel="Voltar" style={styles.back}>
          <Ionicons name="chevron-back" size={26} color={colors.black} />
        </Pressable>
        <Text style={styles.title} accessibilityRole="header">
          Áreas privadas
        </Text>
      </View>

      <FlatList
        data={areas.data ?? []}
        keyExtractor={(a) => a.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <FadeInView fromY={8}>
            <Text style={styles.lead}>Dentro de uma área privada ninguém te descobre por proximidade. Você continua vendo todo mundo.</Text>
            <Text style={styles.hint}>O Cruzei também aprende sozinho onde você dorme e te esconde perto de casa, sem você precisar cadastrar nada.</Text>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Adicionar onde estou agora</Text>
              <View style={styles.chips}>
                {PRESETS.map((p) => (
                  <Pressable key={p} onPress={() => setLabel(p)} accessibilityRole="button" accessibilityState={{ selected: label === p }} style={[styles.chip, label === p && styles.chipOn]}>
                    <Text style={[styles.chipText, label === p && styles.chipTextOn]}>{p}</Text>
                  </Pressable>
                ))}
              </View>
              {label === 'Outro' || !PRESETS.includes(label) ? (
                <TextInput value={label === 'Outro' ? '' : label} onChangeText={setLabel} placeholder="Nome da área" maxLength={40} style={styles.input} placeholderTextColor={colors.gray[400]} />
              ) : null}
              <Text style={styles.cardLabel}>Raio</Text>
              <View style={styles.chips}>
                {RADII.map((r) => (
                  <Pressable key={r} onPress={() => setRadiusM(r)} accessibilityRole="button" accessibilityState={{ selected: radiusM === r }} style={[styles.chip, radiusM === r && styles.chipOn]}>
                    <Text style={[styles.chipText, radiusM === r && styles.chipTextOn]}>{r} m</Text>
                  </Pressable>
                ))}
              </View>
              <ScaleOnPress onPress={onAdd} disabled={busy} accessibilityRole="button" accessibilityLabel="Adicionar área privada na minha posição atual" style={[styles.addBtn, ...(busy ? [{ opacity: 0.6 }] : [])]} glowColor={colors.primary}>
                <Ionicons name="home" size={18} color={colors.black} />
                <Text style={styles.addText}>{busy ? 'Adicionando…' : 'Adicionar área aqui'}</Text>
              </ScaleOnPress>
            </View>

            {(areas.data?.length ?? 0) > 0 ? <Text style={styles.section}>Suas áreas</Text> : null}
          </FadeInView>
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={styles.rowIcon}>
              <Ionicons name="home-outline" size={20} color={colors.black} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>{item.label}</Text>
              <Text style={styles.rowHint}>raio de {item.radiusM} m</Text>
            </View>
            <Pressable onPress={() => confirmRemove(item)} accessibilityRole="button" accessibilityLabel={`Remover ${item.label}`} style={styles.remove}>
              <Ionicons name="trash-outline" size={20} color={colors.danger} />
            </Pressable>
          </View>
        )}
        ListEmptyComponent={!areas.isPending ? <Text style={styles.empty}>Nenhuma área cadastrada ainda.</Text> : null}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { ...typography.h2, color: colors.black },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  lead: { ...typography.body, color: colors.black },
  hint: { ...typography.bodySmall, color: colors.gray[500], marginTop: spacing.xs, marginBottom: spacing.md },
  card: { backgroundColor: colors.white, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
  cardTitle: { ...typography.h3, color: colors.black },
  cardLabel: { ...typography.caption, color: colors.gray[500], textTransform: 'uppercase' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: { paddingHorizontal: spacing.md, height: 34, borderRadius: radius.full, backgroundColor: colors.surfaceAlt, justifyContent: 'center' },
  chipOn: { backgroundColor: colors.black },
  chipText: { ...typography.bodySmall, color: colors.black },
  chipTextOn: { color: colors.primary },
  input: { ...typography.body, color: colors.black, borderWidth: 1, borderColor: colors.gray[200], borderRadius: radius.md, paddingHorizontal: spacing.md, height: 44 },
  addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, backgroundColor: colors.primary, minHeight: 48, borderRadius: radius.full, marginTop: spacing.xs },
  addText: { ...typography.label, color: colors.black },
  section: { ...typography.caption, color: colors.gray[500], textTransform: 'uppercase', marginTop: spacing.lg, marginBottom: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.white, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.xs },
  rowIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { ...typography.body, color: colors.black },
  rowHint: { ...typography.caption, color: colors.gray[500] },
  remove: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  empty: { ...typography.bodySmall, color: colors.gray[500], marginTop: spacing.md },
});
