import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Button } from '@cruzei/ui-mobile';
import { colors, radius, spacing, typography } from '@cruzei/ui-mobile';
import { isAtLeast18 } from '@cruzei/shared-utils';
import { useAuthStore } from '../../stores/auth';
import { toApiError } from '../../services/api';
import type { RootStackParamList } from '../../navigation/RootNavigator';

const GENDERS = [
  { value: 'female', label: 'Mulher' },
  { value: 'male', label: 'Homem' },
  { value: 'non_binary', label: 'Não-binário' },
  { value: 'other', label: 'Outro' },
];

const LOOKING_FOR = [
  { value: 'relationship', label: 'Namorar' },
  { value: 'casual', label: 'Algo casual' },
  { value: 'friendship', label: 'Amizade' },
  { value: 'network', label: 'Networking' },
];

const STEP_TITLES = ['Qual seu nome?', 'Quando você nasceu?', 'Como você se identifica?', 'O que você procura?'];
const STEP_HINTS = [
  'É assim que as pessoas vão te ver no mapa.',
  'Só pra garantir que você tem 18+. A idade aparece no perfil, a data não.',
  'Isso ajuda a mostrar seu perfil pra quem faz sentido.',
  'Dá pra mudar depois, sem drama.',
];

type Props = NativeStackScreenProps<RootStackParamList, 'Register'>;

export function RegisterScreen({ route }: Props) {
  const { phone } = route.params;
  const { register } = useAuthStore();

  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [birthDate, setBirthDate] = useState(''); // DD/MM/AAAA
  const [gender, setGender] = useState<string | null>(null);
  const [lookingFor, setLookingFor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedDate = parseDate(birthDate);
  const dateValid = Boolean(parsedDate && isAtLeast18(parsedDate));

  const canNext = () => {
    if (step === 0) return name.trim().length >= 2;
    if (step === 1) return dateValid;
    if (step === 2) return Boolean(gender);
    if (step === 3) return Boolean(lookingFor);
    return true;
  };

  const onFinish = async () => {
    if (!parsedDate || !gender || !lookingFor) return;
    setError(null);
    setLoading(true);
    try {
      await register({
        phone,
        name: name.trim(),
        birthDate: toIsoDate(parsedDate),
        gender,
        lookingFor,
      });
      // sucesso → RootNavigator troca pra Main automaticamente (isAuthenticated)
    } catch (e) {
      const err = toApiError(e);
      setError(err.status === 401 ? 'Esse telefone já tem conta. Volta e faz login.' : `Erro ao criar conta: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.progress}>
            {[0, 1, 2, 3].map((i) => (
              <View key={i} style={[styles.dot, { backgroundColor: i <= step ? colors.primary : colors.gray[200] }]} />
            ))}
          </View>

          <Text style={styles.stepCount}>etapa {step + 1} de 4</Text>
          <Text style={styles.stepTitle}>{STEP_TITLES[step]}</Text>
          <Text style={styles.stepHint}>{STEP_HINTS[step]}</Text>

          {step === 0 ? (
            <TextInput
              style={styles.input}
              placeholder="Como você quer ser chamado(a)?"
              placeholderTextColor={colors.gray[400]}
              value={name}
              onChangeText={setName}
              autoFocus
              maxLength={50}
              returnKeyType="next"
              onSubmitEditing={() => canNext() && setStep(1)}
            />
          ) : null}

          {step === 1 ? (
            <>
              <TextInput
                style={styles.input}
                placeholder="DD/MM/AAAA"
                placeholderTextColor={colors.gray[400]}
                value={birthDate}
                onChangeText={(t) => setBirthDate(formatDate(t))}
                keyboardType="number-pad"
                maxLength={10}
                autoFocus
              />
              {birthDate.length === 10 && !parsedDate ? <Text style={styles.error}>Data inválida.</Text> : null}
              {birthDate.length === 10 && parsedDate && !dateValid ? (
                <Text style={styles.error}>Você precisa ter 18 anos ou mais.</Text>
              ) : null}
            </>
          ) : null}

          {step === 2 ? (
            <View style={styles.optionList}>
              {GENDERS.map((g) => (
                <Pressable key={g.value} onPress={() => setGender(g.value)} style={[styles.option, gender === g.value && styles.optionActive]}>
                  <Text style={styles.optionText}>{g.label}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {step === 3 ? (
            <View style={styles.optionList}>
              {LOOKING_FOR.map((o) => (
                <Pressable key={o.value} onPress={() => setLookingFor(o.value)} style={[styles.option, lookingFor === o.value && styles.optionActive]}>
                  <Text style={styles.optionText}>{o.label}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>

        <View style={styles.footer}>
          {step > 0 && !loading ? (
            <Pressable onPress={() => setStep(step - 1)} style={styles.back}>
              <Text style={styles.backText}>Voltar</Text>
            </Pressable>
          ) : null}
          <View style={{ flex: 1 }}>
            {loading ? (
              <ActivityIndicator color={colors.primary} />
            ) : step < 3 ? (
              <Button title="Continuar" onPress={() => setStep(step + 1)} disabled={!canNext()} fullWidth size="lg" />
            ) : (
              <Button title="Começar" onPress={onFinish} disabled={!canNext()} fullWidth size="lg" />
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// Auto-insere as barras enquanto digita
function formatDate(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

function parseDate(s: string): Date | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  const valid = d.getFullYear() === Number(yyyy) && d.getMonth() === Number(mm) - 1 && d.getDate() === Number(dd);
  if (!valid || d.getTime() > Date.now()) return null;
  return d;
}

// YYYY-MM-DD no fuso local (evita o "dia anterior" do toISOString em UTC-3)
function toIsoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xl, paddingTop: spacing.lg, flexGrow: 1 },
  progress: { flexDirection: 'row', marginBottom: spacing.xl, gap: 8 },
  dot: { flex: 1, height: 4, borderRadius: radius.full },
  stepCount: { ...typography.label, color: colors.gray[500], textTransform: 'uppercase', marginBottom: spacing.xs },
  stepTitle: { ...typography.h1, color: colors.black, marginBottom: spacing.xs },
  stepHint: { ...typography.body, color: colors.gray[600], marginBottom: spacing.lg },
  input: { ...typography.h3, color: colors.black, backgroundColor: colors.white, borderRadius: radius.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.gray[200] },
  optionList: { gap: spacing.sm },
  option: { padding: spacing.lg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.gray[200], backgroundColor: colors.white },
  optionActive: { borderColor: colors.primary, backgroundColor: '#F5FFE0' },
  optionText: { ...typography.h4, color: colors.black },
  error: { ...typography.body, color: colors.danger, marginTop: spacing.md },
  footer: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.xl, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.gray[100] },
  back: { paddingHorizontal: spacing.md, height: 56, justifyContent: 'center' },
  backText: { ...typography.label, color: colors.gray[600] },
});
