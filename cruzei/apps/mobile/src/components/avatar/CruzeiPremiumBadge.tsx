import { colors, fontFamily, radius } from '@cruzei/ui-mobile';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

export type PremiumBadgeTier = 'premium' | 'plus' | 'event';

export interface CruzeiPremiumBadgeProps {
  /** 'premium' (dourado, cadeado), 'plus' (magenta, diamante, "Premium+") ou 'event' (magenta, "Evento") */
  tier?: PremiumBadgeTier;
  /** só o ícone num círculo — pra bolinhas de cor e cantos apertados */
  compact?: boolean;
  /** dentro de um controle cujo rótulo já diz o plano: some do leitor de tela */
  decorative?: boolean;
  style?: StyleProp<ViewStyle>;
}

// texto preto no magenta: contraste 5,4:1 (o branco dava 3,5:1)
const LOOK: Record<PremiumBadgeTier, { bg: string; fg: string; icon: keyof typeof Ionicons.glyphMap; label: string }> = {
  premium: { bg: colors.accent, fg: colors.black, icon: 'lock-closed', label: 'Premium' },
  plus: { bg: colors.secondary, fg: colors.black, icon: 'diamond', label: 'Premium+' },
  event: { bg: colors.secondary, fg: colors.black, icon: 'sparkles', label: 'Evento' },
};

/**
 * Pill pequena que marca item bloqueado no catálogo do avatar.
 * Ex.: <CruzeiPremiumBadge tier="premium" />  → 🔒 Premium (dourado)
 *      <CruzeiPremiumBadge tier="plus" />     → 💎 Premium+ (magenta)
 *      <CruzeiPremiumBadge tier="event" />    → ✦ Evento (magenta)
 */
export function CruzeiPremiumBadge({ tier = 'premium', compact = false, decorative = false, style }: CruzeiPremiumBadgeProps) {
  const { bg, fg, icon, label } = LOOK[tier];
  const a11y = decorative ? ({ accessible: false, importantForAccessibility: 'no-hide-descendants' } as const) : { accessibilityLabel: label, accessible: true };
  if (compact) {
    return (
      <View style={[styles.dot, { backgroundColor: bg }, style]} {...a11y}>
        <Ionicons name={icon} size={9} color={fg} />
      </View>
    );
  }
  return (
    <View style={[styles.pill, { backgroundColor: bg }, style]} {...a11y}>
      <Ionicons name={icon} size={9} color={fg} />
      <Text style={[styles.text, { color: fg }]}>{label}</Text>
    </View>
  );
}

/** tier do catálogo → selo (grátis não tem selo) */
export function badgeTierOf(tier: string): PremiumBadgeTier | null {
  return tier === 'premium' || tier === 'plus' || tier === 'event' ? tier : null;
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
