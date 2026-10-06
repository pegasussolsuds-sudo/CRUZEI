// Plaquinha de pronomes (React Native, por cima do canvas do palco). Só em telas grandes; nunca no mapa.
// Escolha voluntária (slot `pronouns`); sem escolha, nada aparece. Texto branco sobre o fundo escuro da marca: mesmo
// por cima de um fundo branco o vidro escuro (88%) fica em ~#272734, contraste > 13:1 (mínimo 4,5:1).

import { avatarPronounsLabel } from '@cruzei/shared-utils';
import { colors, fontFamily } from '@cruzei/ui-mobile';
import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

export interface PronounTagProps {
  /** id do catálogo ('ela', 'elu', 'any'…) ou o texto já pronto ('ela/dela') */
  pronouns: string;
  size?: 'sm' | 'md';
}

/** texto da plaquinha: id do catálogo vira o rótulo pt-BR; texto livre passa direto; 'none'/vazio = nada */
export function pronounText(pronouns: string | null | undefined): string | null {
  if (!pronouns || pronouns === 'none') return null;
  return avatarPronounsLabel(pronouns) ?? pronouns;
}

function PronounTagInner({ pronouns, size = 'sm' }: PronounTagProps) {
  const text = pronounText(pronouns);
  if (!text) return null;
  const md = size === 'md';
  return (
    <View style={[styles.pill, md ? styles.pillMd : styles.pillSm]} accessible accessibilityRole="text" accessibilityLabel={`Pronomes: ${text}`}>
      <View style={[styles.dot, md && styles.dotMd]} />
      {/* palco pequeno: "qualquer pronome" encolhe até 80% antes de cortar com reticências */}
      <Text style={[styles.text, md ? styles.textMd : styles.textSm]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} maxFontSizeMultiplier={1.6}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(10,10,26,0.88)',
    borderColor: 'rgba(127,255,0,0.55)',
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: 999,
    maxWidth: '100%',
  },
  pillSm: { paddingHorizontal: 8, paddingVertical: 3, minHeight: 22, gap: 5 },
  pillMd: { paddingHorizontal: 12, paddingVertical: 4, minHeight: 28, gap: 6 },
  // pontinho lima: assinatura da marca, só enfeite (o leitor de tela lê o rótulo da plaquinha)
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.primary },
  dotMd: { width: 6, height: 6 },
  text: { flexShrink: 1, color: '#FFFFFF', fontFamily: fontFamily.bodySemiBold, letterSpacing: 0.2 },
  textSm: { fontSize: 11, lineHeight: 15 },
  textMd: { fontSize: 13, lineHeight: 18 },
});

export const PronounTag = memo(PronounTagInner);
