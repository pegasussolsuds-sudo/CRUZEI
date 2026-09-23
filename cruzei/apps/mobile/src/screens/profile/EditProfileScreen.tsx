import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

import { api, toApiError } from '../../services/api';
import { pickPhoto, takePhoto, uploadPhoto } from '../../services/photos';
import { useAuthStore } from '../../stores/auth';
import { Button } from '@cruzei/ui-mobile';
import { colors, radius, spacing, typography } from '@cruzei/ui-mobile';
import type { User, UserPhoto } from '@cruzei/shared-types';

const LOOKING_FOR = [
  { value: 'relationship', label: 'Namorar' },
  { value: 'casual', label: 'Algo casual' },
  { value: 'friendship', label: 'Amizade' },
  { value: 'network', label: 'Networking' },
];

const MAX_PHOTOS = 6;
const MAX_INTERESTS = 10;

export function EditProfileScreen() {
  const nav = useNavigation();
  const qc = useQueryClient();
  const setUser = useAuthStore((s) => s.setUser);

  const meQuery = useQuery({ queryKey: ['me'], queryFn: async () => (await api.get<User>('/me')).data });
  const interestsQuery = useQuery({
    queryKey: ['interests'],
    queryFn: async () => (await api.get<{ id: number; name: string }[]>('/interests')).data,
  });

  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [lookingFor, setLookingFor] = useState('unspecified');
  const [interests, setInterests] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (meQuery.data && !loaded) {
      setName(meQuery.data.name);
      setBio(meQuery.data.bio ?? '');
      setLookingFor(meQuery.data.lookingFor);
      setInterests(meQuery.data.interests ?? []);
      setLoaded(true);
    }
  }, [meQuery.data, loaded]);

  const save = useMutation({
    mutationFn: async () => {
      const res = await api.patch<User>('/me', { name: name.trim(), bio: bio.trim(), lookingFor, interests });
      return res.data;
    },
    onSuccess: (me) => {
      setUser(me);
      qc.setQueryData(['me'], me);
      qc.invalidateQueries({ queryKey: ['nearby'] });
      nav.goBack();
    },
    onError: (err) => Alert.alert('Não salvou', toApiError(err).message),
  });

  const refreshMe = async () => {
    const me = (await api.get<User>('/me')).data;
    qc.setQueryData(['me'], me);
    setUser(me);
  };

  const addPhoto = () => {
    if ((meQuery.data?.photos.length ?? 0) >= MAX_PHOTOS) {
      Alert.alert('Limite', `Máximo de ${MAX_PHOTOS} fotos.`);
      return;
    }
    Alert.alert('Nova foto', 'De onde?', [
      { text: 'Câmera', onPress: () => handlePhoto(takePhoto) },
      { text: 'Galeria', onPress: () => handlePhoto(pickPhoto) },
      { text: 'Cancelar', style: 'cancel' },
    ]);
  };

  const handlePhoto = async (picker: () => Promise<string | null>) => {
    try {
      const uri = await picker();
      if (!uri) return;
      setUploading(true);
      const up = await uploadPhoto(uri);
      await api.post('/me/photos', { url: up.url, thumbnailUrl: up.thumbnailUrl });
      await refreshMe();
    } catch (err) {
      Alert.alert('Falha no upload', toApiError(err).message);
    } finally {
      setUploading(false);
    }
  };

  const photoActions = (p: UserPhoto) =>
    Alert.alert('Foto', undefined, [
      ...(!p.isMain
        ? [
            {
              text: 'Usar como principal',
              onPress: async () => {
                try {
                  await api.put(`/me/photos/${p.id}/main`);
                  await refreshMe();
                } catch (err) {
                  Alert.alert('Ops', toApiError(err).message);
                }
              },
            },
          ]
        : []),
      {
        text: 'Remover',
        style: 'destructive' as const,
        onPress: async () => {
          try {
            await api.delete(`/me/photos/${p.id}`);
            await refreshMe();
          } catch (err) {
            Alert.alert('Ops', toApiError(err).message);
          }
        },
      },
      { text: 'Cancelar', style: 'cancel' as const },
    ]);

  const toggleInterest = (n: string) => {
    setInterests((cur) => {
      if (cur.includes(n)) return cur.filter((x) => x !== n);
      if (cur.length >= MAX_INTERESTS) return cur;
      return [...cur, n];
    });
  };

  if (!meQuery.data || !loaded) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  const photos = meQuery.data.photos ?? [];

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>fotos ({photos.length}/{MAX_PHOTOS})</Text>
        <View style={styles.grid}>
          {photos.map((p) => (
            <Pressable key={p.id} onPress={() => photoActions(p)} style={styles.tile}>
              <Image source={{ uri: p.url }} style={styles.tileImg} />
              {p.isMain ? (
                <View style={styles.mainTag}>
                  <Text style={styles.mainTagText}>principal</Text>
                </View>
              ) : null}
            </Pressable>
          ))}
          {photos.length < MAX_PHOTOS ? (
            <Pressable onPress={addPhoto} style={[styles.tile, styles.tileAdd]} disabled={uploading}>
              {uploading ? <ActivityIndicator color={colors.primary} /> : <Ionicons name="add" size={32} color={colors.gray[500]} />}
            </Pressable>
          ) : null}
        </View>
        <Text style={styles.hint}>Toca numa foto pra torná-la principal ou remover.</Text>

        <Text style={styles.label}>nome</Text>
        <TextInput style={styles.input} value={name} onChangeText={setName} maxLength={50} placeholder="Seu nome" placeholderTextColor={colors.gray[400]} />

        <Text style={styles.label}>bio</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={bio}
          onChangeText={setBio}
          maxLength={500}
          multiline
          placeholder="Conta em uma frase o que você curte fazer por aí."
          placeholderTextColor={colors.gray[400]}
        />
        <Text style={styles.counter}>{bio.length}/500</Text>

        <Text style={styles.label}>o que você procura</Text>
        <View style={styles.chips}>
          {LOOKING_FOR.map((o) => (
            <Pressable key={o.value} onPress={() => setLookingFor(o.value)} style={[styles.chip, lookingFor === o.value && styles.chipActive]}>
              <Text style={[styles.chipText, lookingFor === o.value && styles.chipTextActive]}>{o.label}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>interesses ({interests.length}/{MAX_INTERESTS})</Text>
        {interestsQuery.isLoading ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <View style={styles.chips}>
            {(interestsQuery.data ?? []).map((i) => {
              const on = interests.includes(i.name);
              return (
                <Pressable key={i.id} onPress={() => toggleInterest(i.name)} style={[styles.chip, on && styles.chipActive]}>
                  <Text style={[styles.chipText, on && styles.chipTextActive]}>{i.name}</Text>
                </Pressable>
              );
            })}
          </View>
        )}

        <View style={{ height: spacing.xl }} />
        <Button title="Salvar" onPress={() => save.mutate()} loading={save.isPending} disabled={name.trim().length < 2} fullWidth size="lg" />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  label: { ...typography.label, color: colors.gray[500], textTransform: 'uppercase', marginTop: spacing.lg, marginBottom: spacing.sm },
  hint: { ...typography.bodySmall, color: colors.gray[500], marginTop: spacing.xs },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: { width: '31%', aspectRatio: 4 / 5, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.white },
  tileImg: { width: '100%', height: '100%' },
  tileAdd: { borderWidth: 1, borderStyle: 'dashed', borderColor: colors.gray[300], alignItems: 'center', justifyContent: 'center' },
  mainTag: { position: 'absolute', bottom: 6, left: 6, backgroundColor: colors.primary, borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  mainTagText: { ...typography.bodySmall, color: colors.black, fontWeight: '800', fontSize: 10 },
  input: { ...typography.body, color: colors.black, backgroundColor: colors.white, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.gray[200] },
  multiline: { minHeight: 96, textAlignVertical: 'top' },
  counter: { ...typography.bodySmall, color: colors.gray[400], textAlign: 'right', marginTop: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.gray[200], borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: 8 },
  chipActive: { backgroundColor: '#F5FFE0', borderColor: colors.primary },
  chipText: { ...typography.bodySmall, color: colors.black },
  chipTextActive: { fontWeight: '700' },
});
