import type { AvatarConfig, AvatarItemSlot, AvatarRarity } from '@cruzei/shared-types';
import { RARITY_LABEL, type AvatarItemDef } from '@cruzei/shared-utils';
import { colors, fontFamily, radius, spacing, typography } from '@cruzei/ui-mobile';
import { Ionicons } from '@expo/vector-icons';
import React, { memo, useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View, type AccessibilityActionEvent } from 'react-native';

import { keyOf } from '../../avatar';
import { emoteHands } from '../../avatar/emotes';
import type { Pose } from '../../avatar/pose';
import { emoteStillPose, tileA11yLabel, tilePreviewConfig, type TileFrame } from '../../screens/avatar/editorModel';
import { PressScale } from '../animated/PressScale';

import { CruzeiAvatar } from './CruzeiAvatar';
import { CruzeiPremiumBadge, badgeTierOf } from './CruzeiPremiumBadge';

export interface AvatarItemTileProps {
  /** config da prévia — o tile desenha ela com `slot` trocado pelo item (miniatura "e se eu usar isso?") */
  config: AvatarConfig;
  slot: AvatarItemSlot;
  item: AvatarItemDef;
  /** rótulo da categoria (vai no rótulo acessível) */
  category: string;
  /** está na prévia agora */
  equipped: boolean;
  /** tier fora do plano da pessoa → selo do tier + miniatura apagada; o toque continua experimentando */
  locked: boolean;
  /** 'bust' pra cabeça/ombros; 'full' corpo inteiro; 'upper' corpo inteiro maior cortado no joelho (tronco e mão) */
  mode: TileFrame;
  /** largura do tile em px (a grade decide) */
  width: number;
  /** pose parada (as animações calculam a delas: melhor quadro a partir do braço solto, com a mão aberta) */
  pose?: Pose | null;
  /** fundo parado atrás (aba Fundo) */
  showBackdrop?: boolean;
  onPress: (slot: AvatarItemSlot, item: AvatarItemDef) => void;
  /** ficha do item (toque longo, botão "i" ou ação do leitor de tela) */
  onInfo: (slot: AvatarItemSlot, item: AvatarItemDef) => void;
}

/** altura fixa do tile (a grade usa no getItemLayout) */
export const AVATAR_TILE_HEIGHT = 124;
const BUST_SIZE = 56;
const FULL_SIZE = 76;
/** 'upper': 100 px ainda é nível leve; a caixa de 80 mostra até y≈112 do viewBox (abaixo do joelho) */
const UPPER_SIZE = 100;
const BOX_H = 80;
/** disco claro atrás do busto: cabelo escuro e pele escura não somem no fundo escuro do app */
const BUST_BG = 'rgba(250,250,250,0.11)';

/** cor da borda/selo por raridade (comum não tem selo) */
export const RARITY_COLOR: Record<AvatarRarity, string> = {
  common: 'rgba(250,250,250,0.12)',
  rare: '#38BDF8',
  epic: '#FF1493',
  legendary: '#FFD700',
};

const A11Y_ACTIONS = [{ name: 'longpress', label: 'Ver detalhes do item' }];

/**
 * Tile da grade do editor: miniatura SVG estática do avatar com o item aplicado (nível leve: ≤100 px), nome, raridade
 * (borda + selo Raro/Épico/Lendário), estado (✓ equipado, selo do tier quando bloqueado), "Novo" e "Animado".
 * Toque = experimentar; toque longo ou "i" = ficha. Sem Reanimated (PressScale): é linha de lista.
 */
function AvatarItemTileInner({ config, slot, item, category, equipped, locked, mode, width, pose, showBackdrop, onPress, onInfo }: AvatarItemTileProps) {
  // a chave do desenho segura a identidade da config: trocar o item do mesmo slot não refaz a miniatura dos outros tiles
  const next = tilePreviewConfig(config, slot, item.id);
  const previewKey = keyOf(next);
  const preview = useMemo(() => next, [previewKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // pose e mãos da animação calculadas uma vez por visual (não a cada render da grade)
  const isEmote = slot === 'emote';
  const tilePose = useMemo(() => (isEmote ? emoteStillPose(item.id, preview) : pose), [isEmote, item.id, preview, pose]);
  const tileHands = useMemo(() => (isEmote ? emoteHands(item.id) : null), [isEmote, item.id]);

  const rarity: AvatarRarity = item.rarity ?? 'common';
  const badge = locked ? badgeTierOf(item.tier) : null;
  const label = tileA11yLabel({ label: item.label, category, rarity, tier: item.tier, equipped, locked, isNew: item.isNew, animated: item.animated });

  const press = useCallback(() => onPress(slot, item), [onPress, slot, item]);
  const info = useCallback(() => onInfo(slot, item), [onInfo, slot, item]);
  const action = useCallback((e: AccessibilityActionEvent) => {
    if (e.nativeEvent.actionName === 'longpress') onInfo(slot, item);
  }, [onInfo, slot, item]);

  const border = equipped ? colors.primary : rarity === 'common' ? RARITY_COLOR.common : RARITY_COLOR[rarity] + '8C';

  return (
    <PressScale
      onPress={press}
      onLongPress={info}
      delayLongPress={350}
      haptic={false}
      pressedScale={0.95}
      accessibilityRole="radio"
      accessibilityState={{ selected: equipped, checked: equipped }}
      accessibilityLabel={label}
      accessibilityHint="Toque pra experimentar na prévia"
      accessibilityActions={A11Y_ACTIONS}
      onAccessibilityAction={action}
      style={[styles.tile, { width, borderColor: border }, equipped ? styles.tileEquipped : null]}
    >
      <View style={styles.box}>
        <View style={[mode === 'upper' ? styles.upper : null, locked ? styles.dim : null]}>
          <CruzeiAvatar
            config={preview}
            mode={mode === 'bust' ? 'bust' : 'full'}
            size={mode === 'bust' ? BUST_SIZE : mode === 'upper' ? UPPER_SIZE : FULL_SIZE}
            pose={tilePose}
            hands={tileHands}
            showBackdrop={showBackdrop}
            backgroundColor={mode === 'bust' ? BUST_BG : undefined}
            decorative
          />
        </View>
        {rarity !== 'common' ? (
          <View style={[styles.rarity, { backgroundColor: RARITY_COLOR[rarity] }]}>
            <Text style={styles.pillText}>{RARITY_LABEL[rarity]}</Text>
          </View>
        ) : null}
        {badge ? <CruzeiPremiumBadge tier={badge} compact decorative style={styles.lock} /> : null}
        <View style={styles.bottomLeft}>
          {item.isNew ? (
            <View style={[styles.pill, styles.pillNew]}>
              <Text style={styles.pillText}>Novo</Text>
            </View>
          ) : null}
          {item.animated ? (
            <View style={[styles.pill, styles.pillAnim]}>
              <Ionicons name="sparkles" size={8} color={colors.black} />
              <Text style={styles.pillText}>Animado</Text>
            </View>
          ) : null}
        </View>
        {equipped ? (
          <View style={styles.check}>
            <Ionicons name="checkmark" size={12} color={colors.black} />
          </View>
        ) : null}
      </View>
      <View style={styles.nameRow}>
        <Text style={[styles.name, equipped ? styles.nameEquipped : null]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
          {item.label}
        </Text>
        <Pressable onPress={info} hitSlop={12} style={styles.info} accessible={false} importantForAccessibility="no-hide-descendants">
          <Ionicons name="information-circle-outline" size={16} color="rgba(250,250,250,0.6)" />
        </Pressable>
      </View>
    </PressScale>
  );
}

export const AvatarItemTile = memo(AvatarItemTileInner);

const styles = StyleSheet.create({
  tile: {
    height: AVATAR_TILE_HEIGHT,
    paddingTop: spacing.xs,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.md,
    borderWidth: 1.5,
    backgroundColor: 'rgba(250,250,250,0.05)',
    alignItems: 'center',
    overflow: 'hidden',
  },
  tileEquipped: { borderWidth: 2, backgroundColor: 'rgba(127,255,0,0.1)' },
  box: { height: BOX_H, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
  dim: { opacity: 0.6 },
  upper: { height: BOX_H, overflow: 'hidden', justifyContent: 'flex-start' },
  rarity: { position: 'absolute', top: 0, left: 0, paddingHorizontal: 4, height: 14, borderRadius: 7, justifyContent: 'center' },
  lock: { position: 'absolute', top: 0, right: 0 },
  bottomLeft: { position: 'absolute', left: 0, bottom: 0, gap: 2, alignItems: 'flex-start' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 2, height: 14, paddingHorizontal: 4, borderRadius: 7 },
  pillNew: { backgroundColor: colors.primary },
  pillAnim: { backgroundColor: '#C9B8FF' },
  pillText: { fontFamily: fontFamily.bodyBold, fontSize: 8, lineHeight: 11, letterSpacing: 0.3, textTransform: 'uppercase', color: colors.black },
  check: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', marginTop: spacing.xs, gap: 2 },
  name: { ...typography.caption, flex: 1, color: 'rgba(250,250,250,0.85)', textAlign: 'center' },
  nameEquipped: { color: colors.primary },
  info: { width: 18, height: 18, alignItems: 'center', justifyContent: 'center' },
});
