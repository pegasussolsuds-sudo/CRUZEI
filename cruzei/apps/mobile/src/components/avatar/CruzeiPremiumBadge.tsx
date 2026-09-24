import React from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamily, radius } from '@cruzei/ui-mobile';

export interface CruzeiPremiumBadgeProps {
  /** 'premium' (dourado, cadeado) ou 'event' (magenta, "Evento") */
  tier?: 'premium' | 'event';
  /** só o ícone num círculo — pra bolinhas de cor e cantos apertados */
  compact?: boolean;
  style?: ViewStyle;
}

/**
 * Pill pequena que marca item bloqueado no catálogo do avatar.
 * Ex.: <CruzeiPremiumBadge tier="premium" />  → 🔒 Premium (dourado)
 *      <CruzeiPremiumBadge tier="event" />    → ✦ Evento (magenta)
 */
export function CruzeiPremiumBadge({ tier = 'premium', compact = false, style }: CruzeiPremiumBadgeProps) {
  const isEvent = tier === 'event';
  const bg = isEvent ? colors.secondary : colors.accent;
  const fg = isEvent ? colors.white : colors.black;
  const icon = isEvent ? 'sparkles' : 'lock-closed';
  const label = isEvent ? 'Evento' : 'Premium';

  if (compact) {
    return (
      <View style={[styles.dot, { backgroundColor: bg }, style]} accessibilityLabel={label} accessible>
        <Ionicons name={icon} size={9} color={fg} />
      </View>
    );
  }

  return (
    <View style={[styles.pill, { backgroundColor: bg }, style]} accessibilityLabel={label} accessible>
      <Ionicons name={icon} size={9} color={fg} />
      <Text style={[styles.text, { color: fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    height: 18,
    paddingHorizontal: 6,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: 'rgba(10,10,26,0.35)',
  },
  text: { fontFamily: fontFamily.bodyBold, fontSize: 9, lineHeight: 12, letterSpacing: 0.4, textTransform: 'uppercase' },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(10,10,26,0.35)',
  },
});
