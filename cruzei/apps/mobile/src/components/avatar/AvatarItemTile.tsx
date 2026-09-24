import React, { memo, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { AvatarConfig, AvatarItemSlot, AvatarTier } from '@cruzei/shared-types';
import { colors, radius, spacing, typography } from '@cruzei/ui-mobile';
import { ScaleOnPress } from '../animated/ScaleOnPress';
import { CruzeiAvatar, type AvatarMode } from './CruzeiAvatar';
import { CruzeiPremiumBadge } from './CruzeiPremiumBadge';

export interface AvatarItemTileProps {
  /** config atual — o tile desenha ela com `slot` trocado por `itemId` (prévia "e se eu usar isso?") */
  config: AvatarConfig;
  slot: AvatarItemSlot;
  itemId: string;
  label: string;
  tier: AvatarTier;
  selected: boolean;
  /** tier fora do permitido pro usuário → badge + opacidade; o toque continua chegando em `onPress` */
  locked: boolean;
  /** 'bust' (default) pra cabeça/ombros; 'full' pra itens que só aparecem no corpo inteiro */
  mode?: AvatarMode;
  /** largura do tile em px (a grade decide) */
  width: number;
  onPress: (itemId: string, tier: AvatarTier, locked: boolean) => void;
}

const BUST_SIZE = 56;
const FULL_SIZE = 68;

/**
 * Tile da grade do customizador: prévia do avatar com o item aplicado, rótulo curto embaixo,
 * borda lima quando selecionado e badge Premium/Evento quando bloqueado.
 */
function AvatarItemTileInner({ config, slot, itemId, label, tier, selected, locked, mode = 'bust', width, onPress }: AvatarItemTileProps) {
  // só recalcula quando a config base ou o item mudam
  // na prévia de cabelo/rosto/barba o chapéu e os óculos saem, senão as opções ficam todas iguais por baixo do gorro
  const preview = useMemo<AvatarConfig>(() => {
    const next: AvatarConfig = { ...config, [slot]: itemId };
    if (slot === 'hair' || slot === 'face' || slot === 'facialHair') {
      next.hat = 'none';
      if (slot !== 'hair') next.glasses = 'none';
    }
    return next;
  }, [config, slot, itemId]);
  const a11y = `${label}${selected ? ', selecionado' : ''}${locked ? `, bloqueado, ${tier === 'event' ? 'item de evento' : 'exclusivo Premium'}` : ''}`;

  return (
    <ScaleOnPress
      onPress={() => onPress(itemId, tier, locked)}
      pressedScale={0.94}
      haptic={false}
      accessibilityRole="radio"
      accessibilityState={{ selected, checked: selected }}
      accessibilityLabel={a11y}
      style={selected ? [styles.tile, { width }, styles.tileSelected] : [styles.tile, { width }]}
    >
      <View style={locked ? [styles.previewBox, styles.previewLocked] : styles.previewBox}>
        <CruzeiAvatar config={preview} mode={mode} size={mode === 'full' ? FULL_SIZE : BUST_SIZE} accessibilityLabel={label} />
      </View>
      <Text style={[styles.label, selected ? styles.labelSelected : null]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
        {label}
      </Text>
      {locked ? <CruzeiPremiumBadge tier={tier === 'event' ? 'event' : 'premium'} style={styles.badge} /> : null}
    </ScaleOnPress>
  );
}

export const AvatarItemTile = memo(AvatarItemTileInner);

const styles = StyleSheet.create({
  tile: {
    minHeight: 96,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs + 2,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: 'rgba(250,250,250,0.1)',
    backgroundColor: 'rgba(250,250,250,0.05)',
    alignItems: 'center',
    gap: spacing.xs,
  },
  tileSelected: { borderColor: colors.primary, backgroundColor: 'rgba(127,255,0,0.1)' },
  previewBox: { height: FULL_SIZE, alignItems: 'center', justifyContent: 'center' },
  previewLocked: { opacity: 0.5 },
  label: { ...typography.caption, color: 'rgba(250,250,250,0.7)', textAlign: 'center', maxWidth: '100%' },
  labelSelected: { color: colors.primary },
  badge: { position: 'absolute', top: 4, right: 4 },
});
