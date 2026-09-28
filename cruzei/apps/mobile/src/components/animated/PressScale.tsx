import React, { useCallback } from 'react';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';

export interface PressScaleProps extends Omit<PressableProps, 'style'> {
  /** escala enquanto pressionado (default 0.97) */
  pressedScale?: number;
  /** vibração leve ao tocar (default true) */
  haptic?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Toque com leve encolhida SEM Reanimated: pra linhas de lista, chips e botões que montam e desmontam a cada letra
 * digitada. O ScaleOnPress cria um "mapper" do Reanimated por instância; na busca isso virava centenas de montagens por
 * minuto e derrubou o app no Moto g54 (crash nativo em worklets::ShareableArray::toJSValue).
 */
export function PressScale({ pressedScale = 0.97, haptic = true, style, onPress, children, ...rest }: PressScaleProps) {
  const handlePress = useCallback<NonNullable<PressableProps['onPress']>>(
    (e) => {
      if (haptic) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      onPress?.(e);
    },
    [haptic, onPress],
  );
  return (
    <Pressable
      {...rest}
      onPress={handlePress}
      style={({ pressed }) => [style, pressed ? { transform: [{ scale: pressedScale }], opacity: 0.88 } : null]}
    >
      {children}
    </Pressable>
  );
}
