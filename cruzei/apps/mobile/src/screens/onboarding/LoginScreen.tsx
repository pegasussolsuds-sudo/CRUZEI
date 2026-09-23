import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { Button } from '@cruzei/ui-mobile';
import { colors, radius, spacing, typography } from '@cruzei/ui-mobile';
import { formatPhoneBR, isValidPhoneBR, maskPhoneBR, normalizePhoneBR } from '@cruzei/shared-utils';
import { useAuthStore } from '../../stores/auth';
import { toApiError } from '../../services/api';
import type { RootStackParamList } from '../../navigation/RootNavigator';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Login'>;

export function LoginScreen() {
  const nav = useNavigation<Nav>();
  const { requestCode, verifyCode } = useAuthStore();

  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'phone' | 'code'>('phone');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);

  const onRequestCode = async () => {
    setError(null);
    if (!isValidPhoneBR(phone)) {
      setError('Telefone inválido. Use DDD + número.');
      return;
    }
    setLoading(true);
    try {
      const res = await requestCode(normalizePhoneBR(phone)!);
      setDevCode(res.devCode ?? null);
      setCode('');
      setStage('code');
    } catch (e) {
      const err = toApiError(e);
      setError(err.status === 429 ? err.message : 'Erro ao enviar código. Tenta de novo.');
    } finally {
      setLoading(false);
    }
  };

  const onVerify = async () => {
    setError(null);
    if (code.length !== 6) {
      setError('Código tem 6 dígitos.');
      return;
    }
    setLoading(true);
    try {
      const normalized = normalizePhoneBR(phone)!;
      const result = await verifyCode(normalized, code);
      if (result.isNew) {
        nav.navigate('Register', { phone: normalized });
      }
    } catch (e) {
      const err = toApiError(e);
      setError(err.status === 401 ? 'Código inválido ou expirado.' : err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.kb}>
        <View style={styles.content}>
          <Text style={styles.title}>{stage === 'phone' ? 'seu número' : 'código enviado'}</Text>
          <Text style={styles.subtitle}>
            {stage === 'phone'
              ? 'Vamos te mandar um código por SMS. Só pra confirmar que é você.'
              : `Digita os 6 dígitos que chegaram em ${maskPhoneBR(phone)}.`}
          </Text>

          {stage === 'phone' ? (
            <TextInput
              style={styles.input}
              placeholder="(34) 99999-9999"
              placeholderTextColor={colors.gray[400]}
              value={phone}
              onChangeText={(t) => setPhone(formatPhoneBR(t))}
              keyboardType="phone-pad"
              autoFocus
              maxLength={15}
              returnKeyType="send"
              onSubmitEditing={onRequestCode}
            />
          ) : (
            <>
              <TextInput
                style={[styles.input, styles.codeInput]}
                placeholder="000000"
                placeholderTextColor={colors.gray[400]}
                value={code}
                onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
                keyboardType="number-pad"
                autoFocus
                maxLength={6}
                returnKeyType="done"
                onSubmitEditing={onVerify}
              />
              {devCode ? (
                <Pressable onPress={() => setCode(devCode)} style={styles.devBox}>
                  <Text style={styles.devText}>
                    ambiente de desenvolvimento — código: <Text style={styles.devCode}>{devCode}</Text> (toca pra preencher)
                  </Text>
                </Pressable>
              ) : null}
            </>
          )}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={{ height: spacing.lg }} />
          {loading ? (
            <ActivityIndicator color={colors.primary} />
          ) : stage === 'phone' ? (
            <Button title="Enviar código" onPress={onRequestCode} fullWidth size="lg" disabled={!isValidPhoneBR(phone)} />
          ) : (
            <Button title="Entrar" onPress={onVerify} fullWidth size="lg" disabled={code.length !== 6} />
          )}

          {stage === 'code' ? (
            <Pressable
              onPress={() => {
                setStage('phone');
                setError(null);
              }}
              style={styles.resend}
            >
              <Text style={styles.resendText}>Trocar número ou reenviar código</Text>
            </Pressable>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  kb: { flex: 1 },
  content: { flex: 1, padding: spacing.xl, justifyContent: 'center' },
  title: { ...typography.h1, color: colors.black, marginBottom: spacing.xs },
  subtitle: { ...typography.body, color: colors.gray[600], marginBottom: spacing.xl },
  input: {
    ...typography.h2,
    color: colors.black,
    backgroundColor: colors.white,
    borderRadius: 12,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.gray[200],
  },
  codeInput: { letterSpacing: 8, textAlign: 'center' },
  devBox: { marginTop: spacing.md, backgroundColor: '#FFF6D6', borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: '#FFE08A' },
  devText: { ...typography.bodySmall, color: '#7A5B00' },
  devCode: { fontWeight: '800', fontSize: 16 },
  error: { ...typography.body, color: colors.danger, marginTop: spacing.md },
  resend: { marginTop: spacing.lg, alignItems: 'center' },
  resendText: { ...typography.label, color: colors.info },
});
