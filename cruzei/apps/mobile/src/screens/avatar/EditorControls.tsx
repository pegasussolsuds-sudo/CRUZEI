// Peças pequenas do editor do avatar: barra de categorias, abas de slot, chips, bolinhas de cor, bandeiras e cartão de
// look. Tudo com PressScale (sem Reanimated por item: várias delas vivem em linhas de lista) e alvos de 44 pt.

import type { AvatarConfig, AvatarTier } from '@cruzei/shared-types';
import { avatarUnlockText, type AvatarColorDef, type AvatarLookDef } from '@cruzei/shared-utils';
import { colors, fontFamily, radius, spacing, typography } from '@cruzei/ui-mobile';
import { Ionicons } from '@expo/vector-icons';
import React, { memo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { flagOf, flagShapes } from '../../avatar/parts/flags';
import { PressScale } from '../../components/animated/PressScale';
import { CruzeiAvatar } from '../../components/avatar/CruzeiAvatar';
import { CruzeiPremiumBadge, badgeTierOf } from '../../components/avatar/CruzeiPremiumBadge';

import type { EditorCatKey, EditorCategory } from './editorModel';

export const H_PAD = spacing.lg;

// ---------------------------------------------------------------------------------------------------------------
// categorias (1º nível) e abas (2º nível)
// ---------------------------------------------------------------------------------------------------------------

export const CategoryBar = memo(function CategoryBar({ cats, active, onPick }: { cats: EditorCategory[]; active: EditorCatKey; onPick: (k: EditorCatKey) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.flat} contentContainerStyle={styles.catRow} accessibilityRole="tablist">
      {cats.map((c) => {
        const on = c.key === active;
        return (
          <PressScale
            key={c.key}
            onPress={() => onPick(c.key)}
            haptic={false}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`Categoria ${c.label}`}
            style={[styles.cat, on ? styles.catOn : null]}
          >
            <Ionicons name={c.icon as keyof typeof Ionicons.glyphMap} size={20} color={on ? colors.black : colors.white} />
            <Text style={[styles.catText, on ? styles.textOnLime : null]} numberOfLines={1}>
              {c.label}
            </Text>
          </PressScale>
        );
      })}
    </ScrollView>
  );
});

export interface ChipOpt {
  key: string;
  label: string;
  /** selo de tier quando bloqueado */
  lockTier?: AvatarTier | null;
  a11y?: string;
}

/** linha de chips de texto (abas de slot, filtros, intensidade da aura, posição do pet, pronomes) */
export const ChipRow = memo(function ChipRow({
  opts,
  active,
  onPick,
  role = 'radio',
  label,
  small = false,
}: {
  opts: ChipOpt[];
  active: string | null;
  onPick: (key: string) => void;
  role?: 'tab' | 'radio';
  /** rótulo do grupo (leitor de tela) */
  label: string;
  small?: boolean;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.flat}
      contentContainerStyle={styles.chipRow}
      accessibilityRole={role === 'tab' ? 'tablist' : 'radiogroup'}
      accessibilityLabel={label}
    >
      {opts.map((o) => {
        const on = o.key === active;
        const badge = o.lockTier ? badgeTierOf(o.lockTier) : null;
        return (
          <PressScale
            key={o.key}
            onPress={() => onPick(o.key)}
            haptic={false}
            accessibilityRole={role}
            accessibilityState={role === 'tab' ? { selected: on } : { selected: on, checked: on }}
            accessibilityLabel={o.a11y ?? o.label}
            style={[styles.chip, small ? styles.chipSmall : null, on ? styles.chipOn : null]}
          >
            <Text style={[small ? styles.chipTextSmall : styles.chipText, on ? styles.textOnLime : null]}>{o.label}</Text>
            {badge ? <CruzeiPremiumBadge tier={badge} compact /> : null}
          </PressScale>
        );
      })}
    </ScrollView>
  );
});

// ---------------------------------------------------------------------------------------------------------------
// cores
// ---------------------------------------------------------------------------------------------------------------

function colorA11y(c: AvatarColorDef, selected: boolean, locked: boolean): string {
  const parts = [c.label];
  if (c.desc) parts.push(c.desc);
  if (selected) parts.push(locked ? 'Experimentando na prévia' : 'Selecionada');
  if (locked) parts.push(`Bloqueada. ${avatarUnlockText(c.tier)}`);
  if (c.isNew) parts.push('Nova');
  return parts.join('. ');
}

export const Swatch = memo(function Swatch({ color, selected, locked, big = false, onPick }: { color: AvatarColorDef; selected: boolean; locked: boolean; big?: boolean; onPick: (id: string) => void }) {
  const badge = locked ? badgeTierOf(color.tier) : null;
  return (
    <PressScale
      onPress={() => onPick(color.id)}
      haptic={false}
      pressedScale={0.9}
      accessibilityRole="radio"
      accessibilityState={{ selected, checked: selected }}
      accessibilityLabel={colorA11y(color, selected, locked)}
      style={big ? styles.swatchHitBig : styles.swatchHit}
    >
      <View style={[big ? styles.ringBig : styles.ring, selected ? styles.ringOn : null]}>
        <View style={[big ? styles.dotBig : styles.dot, { backgroundColor: color.hex }, locked ? styles.dim : null]} />
      </View>
      {badge ? <CruzeiPremiumBadge tier={badge} compact style={styles.swatchBadge} /> : null}
      {color.isNew && !badge ? <View style={styles.newDot} /> : null}
    </PressScale>
  );
});

/** faixa horizontal de bolinhas (cor do item da aba) */
export function ColorRow({ title, items, value, allowed, onPick }: { title: string; items: AvatarColorDef[]; value: string; allowed: ReadonlySet<AvatarTier>; onPick: (id: string) => void }) {
  return (
    <View style={styles.block}>
      <Text style={styles.blockTitle}>{title}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.flat} contentContainerStyle={styles.swatchRow} accessibilityRole="radiogroup" accessibilityLabel={title}>
        {items.map((c) => (
          <Swatch key={c.id} color={c} selected={c.id === value} locked={!allowed.has(c.tier)} onPick={onPick} />
        ))}
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// bandeiras
// ---------------------------------------------------------------------------------------------------------------

const FLAG_W = 30;
const FLAG_H = 20;
const flagCache = new Map<string, { d: string; f: string; r?: 'evenodd' }[]>();

function flagPieces(id: string) {
  let p = flagCache.get(id);
  if (!p) {
    p = flagShapes(flagOf(id), { x: 0, y: 0, w: FLAG_W, h: FLAG_H });
    flagCache.set(id, p);
  }
  return p;
}

/** bandeira desenhada com as listras oficiais e o desenho extra (chevron, anel…) */
export const FlagSwatch = memo(function FlagSwatch({ id, width }: { id: string; width: number }) {
  const pieces = flagPieces(id);
  return (
    <View style={[styles.flagBox, { width, height: (width * FLAG_H) / FLAG_W }]}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${FLAG_W} ${FLAG_H}`} preserveAspectRatio="none">
        {pieces.map((p, i) => (
          <Path key={i} d={p.d} fill={p.f} fillRule={p.r} />
        ))}
      </Svg>
    </View>
  );
});

export interface FlagOpt {
  id: string;
  label: string;
  desc?: string;
}

/** bandeira como opção (linha compacta ou tile da grade) */
export const FlagChoice = memo(function FlagChoice({ flag, selected, onPick, tile = false, width }: { flag: FlagOpt; selected: boolean; onPick: (id: string) => void; tile?: boolean; width?: number }) {
  return (
    <PressScale
      onPress={() => onPick(flag.id)}
      haptic={false}
      accessibilityRole="radio"
      accessibilityState={{ selected, checked: selected }}
      accessibilityLabel={`Bandeira ${flag.label}${selected ? '. Selecionada' : ''}${flag.desc ? `. ${flag.desc}` : ''}`}
      style={[tile ? styles.flagTile : styles.flagChip, tile && width ? { width } : null, selected ? styles.flagOn : null]}
    >
      <FlagSwatch id={flag.id} width={tile ? 54 : 30} />
      <Text style={[tile ? styles.flagTileText : styles.flagChipText, selected ? styles.limeText : null]} numberOfLines={tile ? 2 : 1}>
        {flag.label}
      </Text>
    </PressScale>
  );
});

export function FlagRow({ flags, value, onPick }: { flags: FlagOpt[]; value: string; onPick: (id: string) => void }) {
  return (
    <View style={styles.block}>
      <Text style={styles.blockTitle}>Cores da bandeira</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.flat} contentContainerStyle={styles.chipRow} accessibilityRole="radiogroup" accessibilityLabel="Bandeira dos itens de orgulho">
        {flags.map((f) => (
          <FlagChoice key={f.id} flag={f} selected={f.id === value} onPick={onPick} />
        ))}
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// looks prontos
// ---------------------------------------------------------------------------------------------------------------

export const LOOK_CARD_H = 176;

export const LookCard = memo(function LookCard({
  look,
  preview,
  tier,
  locked,
  equipped,
  width,
  onPick,
}: {
  look: AvatarLookDef;
  preview: AvatarConfig;
  tier: AvatarTier;
  locked: boolean;
  equipped: boolean;
  width: number;
  onPick: (id: string) => void;
}) {
  const badge = locked ? badgeTierOf(tier) : null;
  const state = equipped ? (locked ? 'Experimentando na prévia' : 'Equipado') : locked ? `Bloqueado. ${avatarUnlockText(tier)}` : 'Liberado';
  return (
    <PressScale
      onPress={() => onPick(look.id)}
      haptic={false}
      pressedScale={0.96}
      accessibilityRole="radio"
      accessibilityState={{ selected: equipped, checked: equipped }}
      accessibilityLabel={`Look ${look.label}. ${look.desc} ${state}`}
      accessibilityHint="Toque pra experimentar o look na prévia"
      style={[styles.look, { width }, equipped ? styles.lookOn : null]}
    >
      <View style={[styles.lookArt, locked ? styles.dim : null]}>
        <CruzeiAvatar config={preview} mode="full" size={96} accessibilityLabel={look.label} />
      </View>
      <View style={styles.lookText}>
        <Text style={[styles.lookTitle, equipped ? styles.limeText : null]} numberOfLines={1}>
          {look.label}
        </Text>
        <Text style={styles.lookDesc} numberOfLines={2}>
          {look.desc}
        </Text>
      </View>
      {badge ? <CruzeiPremiumBadge tier={badge} style={styles.lookBadge} /> : null}
      {equipped ? (
        <View style={styles.lookCheck}>
          <Ionicons name="checkmark" size={12} color={colors.black} />
        </View>
      ) : null}
    </PressScale>
  );
});

/** número de colunas pra caber `min` px por célula */
export function colsFor(width: number, min: number, gap: number): number {
  return Math.max(2, Math.floor((width + gap) / (min + gap)));
}

/** largura de célula numa grade */
export function cellWidth(width: number, cols: number, gap: number): number {
  return Math.floor((width - gap * (cols - 1)) / cols);
}

const styles = StyleSheet.create({
  flat: { flexGrow: 0 },
  dim: { opacity: 0.5 },
  textOnLime: { color: colors.black },
  limeText: { color: colors.primary },

  catRow: { paddingHorizontal: H_PAD, gap: spacing.xs, paddingVertical: spacing.xs },
  cat: {
    minWidth: 64,
    minHeight: 52,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    backgroundColor: 'rgba(250,250,250,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(250,250,250,0.12)',
  },
  catOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  catText: { fontFamily: fontFamily.bodySemiBold, fontSize: 11, lineHeight: 14, color: colors.white },

  chipRow: { paddingHorizontal: H_PAD, gap: spacing.xs, paddingVertical: 2, alignItems: 'center' },
  chip: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(250,250,250,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(250,250,250,0.14)',
  },
  chipSmall: { paddingHorizontal: spacing.sm + 2 },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.label, color: colors.white },
  chipTextSmall: { fontFamily: fontFamily.bodySemiBold, fontSize: 12, lineHeight: 16, color: colors.white },

  block: { marginBottom: spacing.sm },
  blockTitle: {
    ...typography.caption,
    color: 'rgba(250,250,250,0.62)',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 2,
    paddingHorizontal: H_PAD,
  },
  swatchRow: { paddingHorizontal: H_PAD - 4, gap: 2 },
  swatchHit: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center' },
  swatchHitBig: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
  ring: { width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  ringBig: { width: 52, height: 52, borderRadius: 26, borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  ringOn: { borderColor: colors.primary },
  dot: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: 'rgba(250,250,250,0.25)' },
  dotBig: { width: 42, height: 42, borderRadius: 21, borderWidth: 1, borderColor: 'rgba(250,250,250,0.25)' },
  swatchBadge: { position: 'absolute', top: 1, right: 1 },
  newDot: { position: 'absolute', top: 5, right: 5, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary, borderWidth: 1, borderColor: colors.black },

  flagBox: { borderRadius: 3, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(250,250,250,0.35)' },
  flagChip: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: 'rgba(250,250,250,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(250,250,250,0.14)',
  },
  flagChipText: { fontFamily: fontFamily.bodySemiBold, fontSize: 12, lineHeight: 16, color: colors.white },
  flagTile: {
    height: 104,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: 'rgba(250,250,250,0.05)',
    borderWidth: 1.5,
    borderColor: 'rgba(250,250,250,0.12)',
  },
  flagTileText: { ...typography.caption, color: 'rgba(250,250,250,0.85)', textAlign: 'center' },
  flagOn: { borderColor: colors.primary, backgroundColor: 'rgba(127,255,0,0.1)' },

  look: {
    height: LOOK_CARD_H,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    gap: spacing.xs,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(250,250,250,0.05)',
    borderWidth: 1.5,
    borderColor: 'rgba(250,250,250,0.12)',
  },
  lookOn: { borderColor: colors.primary, backgroundColor: 'rgba(127,255,0,0.08)' },
  lookArt: { height: 98, alignItems: 'center', justifyContent: 'center' },
  lookText: { alignSelf: 'stretch', gap: 2 },
  lookTitle: { fontFamily: fontFamily.bodyBold, fontSize: 13, lineHeight: 17, color: colors.white, textAlign: 'center' },
  lookDesc: { fontFamily: fontFamily.body, fontSize: 11, lineHeight: 14, color: 'rgba(250,250,250,0.72)', textAlign: 'center' },
  lookBadge: { position: 'absolute', top: spacing.xs, right: spacing.xs },
  lookCheck: {
    position: 'absolute',
    bottom: spacing.xs,
    right: spacing.xs,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
