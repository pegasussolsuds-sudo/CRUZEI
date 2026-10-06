// Painéis por cima do editor (sem Alert e sem Modal): ficha do item e "itens bloqueados na hora de salvar".
// Um só painel de baixo pra cima com fundo escurecido; voltar do Android fecha (quem monta cuida do BackHandler).

import type { AvatarConfig, AvatarItemSlot } from '@cruzei/shared-types';
import { RARITY_LABEL, TIER_LABEL, avatarSlotDef, avatarUnlockText, type AvatarItemDef } from '@cruzei/shared-utils';
import { colors, fontFamily, radius, spacing, typography } from '@cruzei/ui-mobile';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { emoteDef, emoteHands } from '../../avatar/emotes';
import { PressScale } from '../../components/animated/PressScale';
import { RARITY_COLOR } from '../../components/avatar/AvatarItemTile';
import { CruzeiAvatar } from '../../components/avatar/CruzeiAvatar';
import { CruzeiPremiumBadge, badgeTierOf } from '../../components/avatar/CruzeiPremiumBadge';

import { categoryLabelOf, emoteStillPose, tileMode, tilePreviewConfig, type LockedEntry } from './editorModel';

function Sheet({ onClose, label, reduceMotion, children }: { onClose: () => void; label: string; reduceMotion: boolean; children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={StyleSheet.absoluteFill} accessibilityViewIsModal>
      <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(160)} exiting={reduceMotion ? undefined : FadeOut.duration(140)} style={[StyleSheet.absoluteFill, styles.scrim]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Fechar" />
      </Animated.View>
      <Animated.View
        entering={reduceMotion ? undefined : SlideInDown.duration(220)}
        exiting={reduceMotion ? undefined : SlideOutDown.duration(180)}
        style={[styles.sheet, { paddingBottom: insets.bottom }]}
        accessibilityLabel={label}
      >
        <View style={styles.grabber} />
        <PressScale onPress={onClose} haptic={false} accessibilityRole="button" accessibilityLabel="Fechar" style={styles.close}>
          <Ionicons name="close" size={22} color={colors.white} />
        </PressScale>
        <ScrollView bounces={false} contentContainerStyle={styles.sheetBody}>
          {children}
        </ScrollView>
      </Animated.View>
    </View>
  );
}

function Pill({ text, bg, fg = colors.black }: { text: string; bg: string; fg?: string }) {
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={[styles.pillText, { color: fg }]}>{text}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// ficha do item
// ---------------------------------------------------------------------------------------------------------------

export interface ItemSheetProps {
  slot: AvatarItemSlot;
  item: AvatarItemDef;
  config: AvatarConfig;
  equipped: boolean;
  locked: boolean;
  fromOnboarding: boolean;
  reduceMotion: boolean;
  onTry: () => void;
  onPremium: () => void;
  onClose: () => void;
}

export function ItemSheet({ slot, item, config, equipped, locked, fromOnboarding, reduceMotion, onTry, onPremium, onClose }: ItemSheetProps) {
  const rarity = item.rarity ?? 'common';
  const preview = tilePreviewConfig(config, slot, item.id);
  const mode = tileMode(slot);
  const pose = slot === 'emote' ? emoteStillPose(item.id, preview) : null;
  const needsPet = slot === 'emote' && emoteDef(item.id)?.needsPet && config.pet === 'none';
  const buyable = locked && (item.tier === 'premium' || item.tier === 'plus');
  const badge = badgeTierOf(item.tier);
  const where = `${categoryLabelOf(slot)} · ${avatarSlotDef(slot).label}`;

  return (
    <Sheet onClose={onClose} label={`Detalhes de ${item.label}`} reduceMotion={reduceMotion}>
      <View style={styles.itemTop}>
        <View style={[styles.itemArt, { borderColor: rarity === 'common' ? 'rgba(250,250,250,0.12)' : RARITY_COLOR[rarity] }]}>
          <CruzeiAvatar config={preview} mode={mode === 'bust' ? 'bust' : 'full'} size={mode === 'bust' ? 112 : 150} pose={pose} hands={slot === 'emote' ? emoteHands(item.id) : null} showBackdrop={slot === 'backdrop'} accessibilityLabel={`Prévia: ${item.label}`} />
        </View>
        <View style={styles.itemHead}>
          <Text style={styles.itemName} accessibilityRole="header">
            {item.emoji ? `${item.emoji} ` : ''}
            {item.label}
          </Text>
          <Text style={styles.itemWhere}>{where}</Text>
          <View style={styles.pills}>
            <Pill text={RARITY_LABEL[rarity]} bg={rarity === 'common' ? 'rgba(250,250,250,0.85)' : RARITY_COLOR[rarity]} />
            {badge ? <CruzeiPremiumBadge tier={badge} /> : <Pill text={TIER_LABEL[item.tier]} bg={colors.primary} />}
            {item.isNew ? <Pill text="Novo" bg={colors.primary} /> : null}
            {item.animated ? <Pill text="Animado" bg="#C9B8FF" /> : null}
          </View>
        </View>
      </View>

      {item.desc ? <Text style={styles.desc}>{item.desc}</Text> : null}
      {needsPet ? <Text style={styles.note}>🐾 Fica completa com um pet: escolhe um na aba Pets.</Text> : null}

      <View style={styles.unlock}>
        <Ionicons name={locked ? 'lock-closed' : 'checkmark-circle'} size={18} color={locked ? colors.accent : colors.primary} />
        <View style={styles.unlockText}>
          <Text style={styles.unlockTitle}>{locked ? 'Como liberar' : 'Já é seu'}</Text>
          <Text style={styles.unlockBody}>
            {avatarUnlockText(item.tier)}
            {locked && fromOnboarding && buyable ? '. Termina o cadastro e libera pelo Perfil ✨' : ''}
          </Text>
        </View>
      </View>

      <View style={styles.actions}>
        <PressScale
          onPress={onTry}
          disabled={equipped}
          accessibilityRole="button"
          accessibilityState={{ disabled: equipped }}
          accessibilityLabel={equipped ? 'Já está na prévia' : locked ? 'Experimentar na prévia' : 'Usar este item'}
          style={[styles.btn, equipped ? styles.btnGhost : styles.btnLime]}
        >
          <Text style={[styles.btnText, equipped ? styles.btnTextLight : null]}>{equipped ? 'Na prévia ✓' : locked ? 'Experimentar' : 'Usar'}</Text>
        </PressScale>
        {buyable && !fromOnboarding ? (
          <PressScale onPress={onPremium} accessibilityRole="button" accessibilityLabel="Ver Premium" accessibilityHint="Guarda o rascunho do avatar e abre os planos" style={[styles.btn, styles.btnGold]}>
            <Ionicons name="diamond" size={16} color={colors.black} />
            <Text style={styles.btnText}>Ver Premium</Text>
          </PressScale>
        ) : null}
      </View>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// salvar com itens bloqueados
// ---------------------------------------------------------------------------------------------------------------

export interface SavePanelProps {
  entries: LockedEntry[];
  canBuy: boolean;
  fromOnboarding: boolean;
  reduceMotion: boolean;
  onPremium: () => void;
  onSaveWithout: () => void;
  onClose: () => void;
}

export function SavePanel({ entries, canBuy, fromOnboarding, reduceMotion, onPremium, onSaveWithout, onClose }: SavePanelProps) {
  const many = entries.length > 1;
  return (
    <Sheet onClose={onClose} label="Itens que seu plano ainda não libera" reduceMotion={reduceMotion}>
      <Text style={styles.saveTitle} accessibilityRole="header">
        {many ? `${entries.length} itens são de outro plano` : 'Um item é de outro plano'}
      </Text>
      <Text style={styles.desc}>
        {canBuy && !fromOnboarding
          ? 'Você experimentou e ficou ótimo 😍 Libera com o Premium ou salva sem eles: o resto do visual fica do jeito que está.'
          : fromOnboarding
            ? 'Dá pra liberar depois pelo Perfil ✨ Por agora, salva sem eles: o resto do visual fica do jeito que está.'
            : 'Itens de evento chegam em breve. Por agora, salva sem eles: o resto do visual fica do jeito que está.'}
      </Text>
      <View style={styles.lockedList} accessibilityRole="list">
        {entries.map((e) => {
          const b = badgeTierOf(e.tier);
          return (
            <View key={e.slot} style={styles.lockedItem} accessible accessibilityLabel={`${e.label}, ${TIER_LABEL[e.tier]}`}>
              <Text style={styles.lockedName} numberOfLines={1}>
                {e.label}
              </Text>
              {b ? <CruzeiPremiumBadge tier={b} /> : null}
            </View>
          );
        })}
      </View>
      <View style={styles.actions}>
        {canBuy && !fromOnboarding ? (
          <PressScale onPress={onPremium} accessibilityRole="button" accessibilityLabel="Ver Premium" accessibilityHint="Guarda o rascunho do avatar e abre os planos" style={[styles.btn, styles.btnGold]}>
            <Ionicons name="diamond" size={16} color={colors.black} />
            <Text style={styles.btnText}>Ver Premium</Text>
          </PressScale>
        ) : null}
        <PressScale
          onPress={onSaveWithout}
          accessibilityRole="button"
          accessibilityLabel={many ? 'Salvar sem eles' : 'Salvar sem ele'}
          style={[styles.btn, canBuy && !fromOnboarding ? styles.btnGhost : styles.btnLime]}
        >
          <Text style={[styles.btnText, canBuy && !fromOnboarding ? styles.btnTextLight : null]}>{many ? 'Salvar sem eles' : 'Salvar sem ele'}</Text>
        </PressScale>
      </View>
      <PressScale onPress={onClose} haptic={false} accessibilityRole="button" accessibilityLabel="Continuar editando" style={styles.link}>
        <Text style={styles.linkText}>Continuar editando</Text>
      </PressScale>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '86%',
    backgroundColor: '#14142A',
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1,
    borderColor: 'rgba(250,250,250,0.1)',
    paddingTop: spacing.sm,
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(250,250,250,0.25)' },
  close: { position: 'absolute', top: spacing.xs, right: spacing.xs, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  sheetBody: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xl, gap: spacing.md },

  itemTop: { flexDirection: 'row', gap: spacing.md, alignItems: 'center', paddingRight: spacing.xl },
  itemArt: { borderRadius: radius.lg, borderWidth: 1.5, padding: spacing.xs, backgroundColor: 'rgba(250,250,250,0.04)', alignItems: 'center', justifyContent: 'center', minWidth: 120, minHeight: 120 },
  itemHead: { flex: 1, gap: spacing.xs },
  itemName: { ...typography.h3, color: colors.white },
  itemWhere: { ...typography.bodySmall, color: 'rgba(250,250,250,0.7)' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: 2 },
  pill: { height: 18, paddingHorizontal: 6, borderRadius: radius.full, justifyContent: 'center' },
  pillText: { fontFamily: fontFamily.bodyBold, fontSize: 9, lineHeight: 12, letterSpacing: 0.4, textTransform: 'uppercase' },

  desc: { ...typography.body, color: 'rgba(250,250,250,0.88)' },
  note: { ...typography.bodySmall, color: colors.accent },
  unlock: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: 'rgba(250,250,250,0.06)' },
  unlockText: { flex: 1, gap: 2 },
  unlockTitle: { ...typography.label, color: colors.white },
  unlockBody: { ...typography.bodySmall, color: 'rgba(250,250,250,0.78)' },

  actions: { gap: spacing.sm },
  btn: { minHeight: 52, borderRadius: radius.full, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingHorizontal: spacing.lg },
  btnLime: { backgroundColor: colors.primary },
  btnGold: { backgroundColor: colors.accent },
  btnGhost: { backgroundColor: 'rgba(250,250,250,0.08)', borderWidth: 1, borderColor: 'rgba(250,250,250,0.2)' },
  btnText: { ...typography.h4, fontFamily: fontFamily.display, color: colors.black },
  btnTextLight: { color: colors.white },
  link: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  linkText: { ...typography.label, color: colors.gray[400] },

  saveTitle: { ...typography.h3, color: colors.white, paddingRight: spacing.xl },
  lockedList: { gap: spacing.xs },
  lockedItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    minHeight: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: 'rgba(250,250,250,0.05)',
  },
  lockedName: { ...typography.body, color: colors.white, flex: 1 },
});
