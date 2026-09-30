import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { useHeaderHeight } from '@react-navigation/elements';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, {
  cancelAnimation,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { api, toApiError } from '../../services/api';
import { PhotoPermissionError, explainPhotoPermission, pickPhoto, takePhoto, uploadPhoto } from '../../services/photos';
import { useAuthStore } from '../../stores/auth';
import { FadeInView, ScaleOnPress, SlideInView } from '../../components/animated';
import { Button } from '@cruzei/ui-mobile';
import { colors, duration, radius, shadows, spacing, spring, typography } from '@cruzei/ui-mobile';
import { ORIENTATIONS, ORIENTATION_LABELS, type Orientation, type User, type UserPhoto } from '@cruzei/shared-types';
import { INSTAGRAM_HANDLE_MAX, isValidInstagramHandle, normalizeInstagramHandle } from '@cruzei/shared-utils';

const LOOKING_FOR = [
  { value: 'relationship', label: 'Namorar' },
  { value: 'casual', label: 'Algo casual' },
  { value: 'friendship', label: 'Amizade' },
  { value: 'network', label: 'Networking' },
];

const MAX_PHOTOS = 6;
const MAX_INTERESTS = 10;
// Tempo que o "Salvo ✅" fica na tela antes de voltar
const SAVED_FEEDBACK_MS = 750;

const CHIP_ON_BG = '#F0FFD6';
const INPUT_FOCUS_BG = '#FDFFF7';

export function EditProfileScreen() {
  const nav = useNavigation();
  const headerHeight = useHeaderHeight();
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
  // orientação: null = não informar (apaga no servidor e revoga o consentimento)
  const [orientation, setOrientation] = useState<Orientation | null>(null);
  // @ do Instagram como a pessoa digitou (o servidor guarda normalizado: sem @, minúsculo)
  const [instagram, setInstagram] = useState('');
  const [uploading, setUploading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);
  const backTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (meQuery.data && !loaded) {
      setName(meQuery.data.name);
      setBio(meQuery.data.bio ?? '');
      setLookingFor(meQuery.data.lookingFor);
      setInterests(meQuery.data.interests ?? []);
      setOrientation(meQuery.data.orientation ?? null);
      setInstagram(meQuery.data.instagram ?? '');
      setLoaded(true);
    }
  }, [meQuery.data, loaded]);

  // validação ao vivo do @ (mesma regra do servidor): vazio = sem Instagram
  const instaHandle = normalizeInstagramHandle(instagram);
  const instaInvalid = instaHandle !== null && !isValidInstagramHandle(instaHandle);

  useEffect(
    () => () => {
      if (backTimer.current) clearTimeout(backTimer.current);
    },
    [],
  );

  const save = useMutation({
    mutationFn: async () => {
      const patch: Record<string, unknown> = { name: name.trim(), bio: bio.trim(), lookingFor, interests };
      // orientação e Instagram só quando mudaram (orientação nova recarimba o consentimento no servidor)
      const before = meQuery.data;
      if (orientation !== (before?.orientation ?? null)) patch.orientation = orientation;
      if (instaHandle !== (before?.instagram ?? null)) patch.instagram = instaHandle;
      const res = await api.patch<User>('/me', patch);
      return res.data;
    },
    onSuccess: (me) => {
      setUser(me);
      qc.setQueryData(['me'], me);
      qc.invalidateQueries({ queryKey: ['nearby'] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      // mostra o "Salvo ✅" e só então volta
      setSaved(true);
      backTimer.current = setTimeout(() => nav.goBack(), SAVED_FEEDBACK_MS);
    },
    onError: (err) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      Alert.alert('Não salvou', toApiError(err).message);
    },
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
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (err) {
      // permissão negada ≠ falha de upload: explica e oferece os ajustes
      if (err instanceof PhotoPermissionError) explainPhotoPermission(err, Alert.alert, () => Linking.openSettings().catch(() => {}));
      else Alert.alert('Falha no upload', toApiError(err).message);
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
      if (cur.length >= MAX_INTERESTS) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        return cur;
      }
      return [...cur, n];
    });
  };

  // /me falhou sem nada em cache: mostra o erro e deixa tentar de novo (em vez de spinner eterno)
  if (meQuery.isError && !meQuery.data) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{toApiError(meQuery.error).message}</Text>
        <Button title="Tentar de novo" onPress={() => meQuery.refetch()} loading={meQuery.isFetching} />
      </View>
    );
  }

  if (!meQuery.data || !loaded) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  const photos = meQuery.data.photos ?? [];
  const canSave = name.trim().length >= 2 && !saved && !instaInvalid;

  return (
    // edge-to-edge (Android 15+): a janela não encolhe com o teclado — padding nas duas plataformas, descontando o header
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }} keyboardVerticalOffset={headerHeight}>
      <Animated.ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <FadeInView fromY={8}>
          <Text style={styles.label}>
            fotos ({photos.length}/{MAX_PHOTOS})
          </Text>
        </FadeInView>
        <View style={styles.grid}>
          {photos.map((p, idx) => (
            <FadeInView key={p.id} delay={60 + idx * 55} fromScale={0.82} fromY={6} style={styles.tileWrap}>
              <ScaleOnPress
                onPress={() => photoActions(p)}
                style={styles.tile}
                pressedScale={0.94}
                accessibilityRole="imagebutton"
                accessibilityLabel={p.isMain ? 'Foto principal' : `Foto ${idx + 1}`}
                accessibilityHint="Abre opções: usar como principal ou remover"
              >
                <Image source={{ uri: p.url }} style={styles.tileImg} />
                {p.isMain ? (
                  <View style={styles.mainTag}>
                    <Ionicons name="star" size={9} color={colors.black} />
                    <Text style={styles.mainTagText}>principal</Text>
                  </View>
                ) : null}
              </ScaleOnPress>
            </FadeInView>
          ))}
          {photos.length < MAX_PHOTOS ? (
            <FadeInView delay={60 + photos.length * 55} fromScale={0.82} fromY={6} style={styles.tileWrap}>
              <ScaleOnPress
                onPress={addPhoto}
                style={[styles.tile, styles.tileAdd]}
                disabled={uploading}
                pressedScale={0.94}
                glowColor={colors.primary}
                accessibilityRole="button"
                accessibilityLabel="Adicionar foto"
                accessibilityState={{ disabled: uploading, busy: uploading }}
              >
                {uploading ? (
                  <ActivityIndicator color={colors.primary} />
                ) : (
                  <>
                    <Ionicons name="add" size={30} color={colors.gray[500]} />
                    <Text style={styles.tileAddText}>foto</Text>
                  </>
                )}
              </ScaleOnPress>
            </FadeInView>
          ) : null}
        </View>
        <Text style={styles.hint}>Toca numa foto pra torná-la principal ou remover.</Text>

        <FadeInView delay={160} fromY={12}>
          <Text style={styles.label}>nome</Text>
          <FocusInput value={name} onChangeText={setName} maxLength={50} placeholder="Seu nome" autoCapitalize="words" accessibilityLabel="Nome" />
        </FadeInView>

        <FadeInView delay={220} fromY={12}>
          <Text style={styles.label}>bio</Text>
          <FocusInput
            style={styles.multiline}
            value={bio}
            onChangeText={setBio}
            maxLength={500}
            multiline
            placeholder="Conta em uma frase o que você curte fazer por aí."
            accessibilityLabel="Bio"
          />
          <Text style={[styles.counter, bio.length >= 480 && { color: colors.warning }]}>{bio.length}/500</Text>
        </FadeInView>

        <FadeInView delay={280} fromY={12}>
          <Text style={styles.label}>o que você procura</Text>
          <View style={styles.chips}>
            {LOOKING_FOR.map((o) => (
              <Chip key={o.value} label={o.label} on={lookingFor === o.value} onPress={() => setLookingFor(o.value)} radio />
            ))}
          </View>
        </FadeInView>

        <FadeInView delay={300} fromY={12}>
          <Text style={styles.label}>orientação (opcional)</Text>
          <View style={styles.chips} accessibilityRole="radiogroup">
            {ORIENTATIONS.map((o) => (
              <Chip key={o} label={ORIENTATION_LABELS[o]} on={orientation === o} onPress={() => setOrientation(o)} radio />
            ))}
            <Chip label="Prefiro não dizer" on={orientation === null} onPress={() => setOrientation(null)} radio />
          </View>
          <Text style={styles.hint}>
            Dado sensível: só guardamos com o seu consentimento, e "Prefiro não dizer" apaga. Mostrar no perfil e ver primeiro
            quem tem a mesma orientação você escolhe no Perfil.
          </Text>
        </FadeInView>

        <FadeInView delay={320} fromY={12}>
          <Text style={styles.label}>instagram</Text>
          <InstagramInput
            value={instagram}
            onChangeText={setInstagram}
            // colou o link do perfil: vira só o @ ao sair do campo
            onBlur={() => {
              if (instaHandle && !instaInvalid) setInstagram(instaHandle);
            }}
            invalid={instaInvalid}
          />
          {instaInvalid ? (
            <Text style={[styles.hint, { color: colors.danger }]} accessibilityLiveRegion="polite">
              Esse @ não rola no Instagram: só letras, números, ponto e _ (até {INSTAGRAM_HANDLE_MAX}), sem ponto no começo ou no fim.
            </Text>
          ) : (
            <Text style={styles.hint}>Aparece no seu perfil pra todo mundo que abrir. Deixa vazio pra não mostrar.</Text>
          )}
        </FadeInView>

        <FadeInView delay={340} fromY={12}>
          <Text style={styles.label}>
            interesses ({interests.length}/{MAX_INTERESTS})
          </Text>
          {interestsQuery.isLoading ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <View style={styles.chips}>
              {(interestsQuery.data ?? []).map((i) => (
                <Chip key={i.id} label={i.name} on={interests.includes(i.name)} onPress={() => toggleInterest(i.name)} />
              ))}
            </View>
          )}
          {interests.length >= MAX_INTERESTS ? <Text style={styles.hint}>Deu {MAX_INTERESTS} — tira um pra colocar outro 😉</Text> : null}
        </FadeInView>

        <View style={{ height: spacing.xl }} />
        <FadeInView delay={400} fromY={12}>
          <Button title="Salvar" onPress={() => save.mutate()} loading={save.isPending} disabled={!canSave} fullWidth size="lg" />
        </FadeInView>
      </Animated.ScrollView>

      {saved ? (
        <View pointerEvents="none" style={styles.toastWrap}>
          <SlideInView from="up" distance={40} springPreset="snappy" style={styles.toast}>
            <Text style={styles.toastText}>Salvo ✅ Seu perfil já tá na rua</Text>
          </SlideInView>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

/* ---------- Input com foco animado (borda + fundo, UI thread) ---------- */

type FocusInputProps = Omit<TextInputProps, 'style'> & {
  style?: StyleProp<ViewStyle>;
  /** texto fixo antes do campo (o "@" do Instagram) */
  prefix?: string;
  /** borda vermelha (validação ao vivo) */
  invalid?: boolean;
};

function FocusInput({ style, onFocus, onBlur, multiline, prefix, invalid = false, ...rest }: FocusInputProps) {
  const focus = useSharedValue(0);
  const bad = useSharedValue(invalid ? 1 : 0);

  useEffect(() => {
    bad.value = withTiming(invalid ? 1 : 0, { duration: duration.fast });
  }, [bad, invalid]);

  const wrapStyle = useAnimatedStyle(() => ({
    borderColor: interpolateColor(bad.value, [0, 1], [interpolateColor(focus.value, [0, 1], [colors.gray[200], colors.primary]), colors.danger]),
    backgroundColor: interpolateColor(focus.value, [0, 1], [colors.surface, INPUT_FOCUS_BG]),
    transform: [{ scale: 1 + 0.008 * focus.value }],
    shadowOpacity: 0.18 * focus.value,
    elevation: 3 * focus.value,
  }));

  const handleFocus = useCallback(
    (e: Parameters<NonNullable<TextInputProps['onFocus']>>[0]) => {
      focus.value = withTiming(1, { duration: duration.base });
      onFocus?.(e);
    },
    [focus, onFocus],
  );
  const handleBlur = useCallback(
    (e: Parameters<NonNullable<TextInputProps['onBlur']>>[0]) => {
      focus.value = withTiming(0, { duration: duration.fast });
      onBlur?.(e);
    },
    [focus, onBlur],
  );

  return (
    <Animated.View style={[styles.inputWrap, prefix ? styles.inputRow : null, style, wrapStyle]}>
      {prefix ? (
        <Text style={styles.inputPrefix} importantForAccessibility="no" accessibilityElementsHidden>
          {prefix}
        </Text>
      ) : null}
      <TextInput
        {...rest}
        multiline={multiline}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholderTextColor={colors.gray[400]}
        selectionColor={colors.primary}
        style={[styles.input, multiline && styles.inputMultiline, prefix ? styles.inputWithPrefix : null]}
      />
    </Animated.View>
  );
}

/* ---------- @ do Instagram: prefixo fixo, sem maiúscula/corretor (o servidor normaliza e valida de novo) ---------- */

function InstagramInput({
  value,
  onChangeText,
  onBlur,
  invalid,
}: {
  value: string;
  onChangeText: (t: string) => void;
  onBlur: () => void;
  invalid: boolean;
}) {
  return (
    <FocusInput
      value={value}
      onChangeText={onChangeText}
      onBlur={onBlur}
      prefix="@"
      invalid={invalid}
      // cabe o link colado (instagram.com/fulano?...); o @ de verdade tem até 30
      maxLength={100}
      placeholder="seu.perfil"
      autoCapitalize="none"
      autoCorrect={false}
      autoComplete="off"
      spellCheck={false}
      returnKeyType="done"
      accessibilityLabel="Seu @ do Instagram"
      accessibilityHint="Aparece no seu perfil pra todo mundo. Deixa vazio pra não mostrar"
    />
  );
}

/* ---------- Chip com seleção animada (scale bounce + cor) ---------- */

function Chip({ label, on, onPress, radio }: { label: string; on: boolean; onPress: () => void; radio?: boolean }) {
  const sel = useSharedValue(on ? 1 : 0);
  const bump = useSharedValue(1);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    sel.value = withSpring(on ? 1 : 0, spring.snappy);
    bump.value = withSequence(withTiming(on ? 0.9 : 0.96, { duration: 70 }), withSpring(1, spring.bouncy));
    return () => {
      cancelAnimation(sel);
      cancelAnimation(bump);
    };
  }, [on, sel, bump]);

  const chipStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(sel.value, [0, 1], [colors.surface, CHIP_ON_BG]),
    borderColor: interpolateColor(sel.value, [0, 1], [colors.gray[200], colors.primary]),
    transform: [{ scale: bump.value }],
  }));

  const checkStyle = useAnimatedStyle(() => ({
    opacity: sel.value,
    width: 14 * sel.value,
    marginRight: 4 * sel.value,
    transform: [{ scale: 0.5 + 0.5 * sel.value }],
  }));

  const press = () => {
    Haptics.selectionAsync().catch(() => {});
    onPress();
  };

  return (
    <ScaleOnPress
      onPress={press}
      haptic={false}
      pressedScale={0.94}
      accessibilityRole={radio ? 'radio' : 'checkbox'}
      accessibilityLabel={label}
      accessibilityState={{ selected: on, checked: on }}
    >
      <Animated.View style={[styles.chip, chipStyle]}>
        <Animated.View style={[styles.chipCheck, checkStyle]}>
          <Ionicons name="checkmark" size={14} color="#3A7A00" />
        </Animated.View>
        <Text style={[styles.chipText, on && styles.chipTextActive]}>{label}</Text>
      </Animated.View>
    </ScaleOnPress>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background, gap: spacing.md, padding: spacing.lg },
  errorText: { ...typography.bodySmall, color: colors.gray[500], textAlign: 'center' },
  content: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  label: { ...typography.label, color: colors.gray[500], textTransform: 'uppercase', marginTop: spacing.lg, marginBottom: spacing.sm },
  hint: { ...typography.bodySmall, color: colors.gray[500], marginTop: spacing.xs },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tileWrap: { width: '31%', aspectRatio: 4 / 5 },
  tile: { flex: 1, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.white, ...shadows.light },
  tileImg: { width: '100%', height: '100%' },
  tileAdd: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.gray[300], alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceAlt },
  tileAddText: { ...typography.caption, color: colors.gray[500], marginTop: 2 },
  mainTag: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  mainTagText: { ...typography.caption, color: colors.black, fontSize: 10 },

  inputWrap: {
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.gray[200],
    backgroundColor: colors.surface,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 10,
    shadowOpacity: 0,
  },
  input: { ...typography.body, color: colors.black, padding: spacing.md, minHeight: 48 },
  inputMultiline: { minHeight: 96, textAlignVertical: 'top' },
  inputRow: { flexDirection: 'row', alignItems: 'center' },
  inputPrefix: { ...typography.body, color: colors.gray[500], paddingLeft: spacing.md },
  inputWithPrefix: { flex: 1, paddingLeft: 2 },
  multiline: {},
  counter: { ...typography.bodySmall, color: colors.gray[400], textAlign: 'right', marginTop: 4 },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.gray[200],
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    minHeight: 40,
  },
  chipCheck: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  chipText: { ...typography.bodySmall, color: colors.black },
  chipTextActive: { fontFamily: typography.label.fontFamily },

  toastWrap: { position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: spacing.xl, alignItems: 'center' },
  toast: {
    backgroundColor: colors.black,
    borderRadius: radius.full,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: colors.primary,
    ...shadows.medium,
  },
  toastText: { ...typography.label, color: colors.primary },
});
