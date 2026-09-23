import React, { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { colors, fontFamily, radius, spring } from '@cruzei/ui-mobile';

export interface OtpInputProps {
  value: string;
  onChange: (v: string) => void;
  length?: number;
  /** chamado quando completa os N dígitos */
  onComplete?: (v: string) => void;
  autoFocus?: boolean;
  /** true → caixas ficam verdes e o teclado fecha */
  verified?: boolean;
  /** true → caixas tremem em vermelho */
  error?: boolean;
}

/**
 * Código SMS em N caixas: um único TextInput invisível recebe a digitação (funciona com autofill do SMS),
 * cada dígito entra com bounce, caixa ativa ganha borda verde-limão, erro treme, verificado fica verde.
 * Ex.: <OtpInput value={code} onChange={setCode} onComplete={verify} error={!!err} />
 */
export function OtpInput({ value, onChange, length = 6, onComplete, autoFocus = true, verified = false, error = false }: OtpInputProps) {
  const inputRef = useRef<TextInput>(null);
  const shake = useSharedValue(0);

  useEffect(() => {
    if (value.length === length) onComplete?.(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    if (!error) return;
    shake.value = withSequence(
      withTiming(-8, { duration: 50 }),
      withTiming(8, { duration: 50 }),
      withTiming(-6, { duration: 50 }),
      withTiming(6, { duration: 50 }),
      withTiming(0, { duration: 60 }),
    );
  }, [error, shake]);

  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));
  const digits = Array.from({ length }, (_, i) => value[i] ?? '');
  const activeIndex = Math.min(value.length, length - 1);

  return (
    <Pressable onPress={() => inputRef.current?.focus()} accessibilityLabel={`Código de ${length} dígitos`} accessibilityRole="none">
      <Animated.View style={[styles.row, rowStyle]}>
        {digits.map((d, i) => (
          <Box key={i} digit={d} active={!verified && i === activeIndex} verified={verified} error={error} />
        ))}
      </Animated.View>
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={(t) => onChange(t.replace(/\D/g, '').slice(0, length))}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={length}
        autoFocus={autoFocus}
        caretHidden
        style={styles.hidden}
        editable={!verified}
      />
    </Pressable>
  );
}

function Box({ digit, active, verified, error }: { digit: string; active: boolean; verified: boolean; error: boolean }) {
  const pop = useSharedValue(digit ? 1 : 0);
  const prev = useRef(digit);

  useEffect(() => {
    if (digit && !prev.current) {
      pop.value = 0;
      pop.value = withSpring(1, spring.bouncy);
    } else if (!digit) {
      pop.value = withTiming(0, { duration: 120 });
    }
    prev.current = digit;
  }, [digit, pop]);

  const digitStyle = useAnimatedStyle(() => ({
    opacity: pop.value,
    transform: [{ scale: 0.6 + 0.4 * pop.value }],
  }));

  const border = error ? colors.danger : verified ? colors.success : active ? colors.primary : colors.gray[200];

  return (
    <View style={[styles.box, { borderColor: border, borderWidth: active || verified || error ? 2 : 1 }, verified && styles.boxVerified]}>
      <Animated.Text style={[styles.digit, digitStyle]}>{digit}</Animated.Text>
      {active && !digit ? <View style={styles.caret} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  box: {
    flex: 1,
    height: 60,
    borderRadius: radius.md,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxVerified: { backgroundColor: '#EAFFF1' },
  digit: { fontFamily: fontFamily.mono, fontSize: 24, color: colors.black },
  caret: { width: 2, height: 24, backgroundColor: colors.primary, borderRadius: 1 },
  hidden: { position: 'absolute', opacity: 0, height: 1, width: 1 },
});
