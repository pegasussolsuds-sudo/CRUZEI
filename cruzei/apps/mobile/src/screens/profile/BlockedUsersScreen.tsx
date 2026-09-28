import React from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BlockedUser } from '@cruzei/shared-types';
import { colors, radius, spacing, typography } from '@cruzei/ui-mobile';
import { api, toApiError } from '../../services/api';

/** quem eu bloqueei (e desbloquear) */
export function BlockedUsersScreen() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['blocks'], queryFn: async () => (await api.get<BlockedUser[]>('/blocks')).data });
  const unblock = useMutation({
    mutationFn: async (userId: string) => api.delete(`/blocks/${userId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['blocks'] });
      qc.invalidateQueries({ queryKey: ['nearby'] });
    },
    onError: (e) => Alert.alert('Não deu pra desbloquear', toApiError(e).message),
  });

  const confirm = (b: BlockedUser) =>
    Alert.alert(`Desbloquear ${b.user.name}?`, 'Vocês voltam a se ver no mapa quando estiverem perto. O match antigo não volta.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Desbloquear', onPress: () => unblock.mutate(b.user.id) },
    ]);

  if (q.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.black} />
      </View>
    );
  }
  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <FlatList
        data={q.data ?? []}
        keyExtractor={(b) => b.id}
        contentContainerStyle={styles.content}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="shield-checkmark-outline" size={48} color={colors.gray[400]} />
            <Text style={styles.emptyText}>Você não bloqueou ninguém.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            {item.user.mainPhotoUrl ? (
              <Image source={{ uri: item.user.mainPhotoUrl }} style={styles.photo} />
            ) : (
              <View style={[styles.photo, styles.noPhoto]}>
                <Ionicons name="person" size={20} color={colors.gray[400]} />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.user.name}</Text>
              <Text style={styles.when}>bloqueado em {new Date(item.createdAt).toLocaleDateString('pt-BR')}</Text>
            </View>
            <Pressable
              onPress={() => confirm(item)}
              disabled={unblock.isPending}
              style={({ pressed }) => [styles.btn, pressed && { opacity: 0.6 }]}
              accessibilityRole="button"
              accessibilityLabel={`Desbloquear ${item.user.name}`}
            >
              <Text style={styles.btnText}>Desbloquear</Text>
            </Pressable>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.sm, flexGrow: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.white, borderRadius: radius.lg, padding: spacing.md },
  photo: { width: 44, height: 44, borderRadius: 22 },
  noPhoto: { backgroundColor: colors.gray[100], alignItems: 'center', justifyContent: 'center' },
  name: { ...typography.body, fontWeight: '600', color: colors.black },
  when: { ...typography.caption, color: colors.gray[500] },
  btn: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: 999, borderWidth: 1, borderColor: colors.gray[300] },
  btnText: { ...typography.bodySmall, fontWeight: '600', color: colors.black },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, paddingTop: spacing.xxxl },
  emptyText: { ...typography.body, color: colors.gray[500] },
});
