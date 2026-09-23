import React, { useMemo } from 'react';
import { StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';
import { FadeInView } from './FadeInView';

export interface StaggerTextProps {
  text: string;
  /** anima por letra (headline) ou por palavra (parágrafos longos) */
  by?: 'letter' | 'word';
  /** atraso entre unidades em ms */
  stagger?: number;
  /** atraso inicial */
  delay?: number;
  /** deslocamento vertical inicial de cada unidade */
  fromY?: number;
  style?: TextStyle | TextStyle[];
  containerStyle?: ViewStyle;
  accessibilityLabel?: string;
}

/**
 * Texto que entra letra por letra (ou palavra por palavra) com fade + leve subida.
 * Mantém quebra de linha natural: cada palavra é um bloco inline com as letras dentro.
 * Ex.: <StaggerText text="Quem você quase conheceu hoje" by="letter" stagger={28} style={typography.display} />
 */
export function StaggerText({
  text,
  by = 'letter',
  stagger = 30,
  delay = 0,
  fromY = 10,
  style,
  containerStyle,
  accessibilityLabel,
}: StaggerTextProps) {
  const words = useMemo(() => text.split(' '), [text]);
  let index = 0;

  return (
    <View style={[styles.row, containerStyle]} accessible accessibilityRole="header" accessibilityLabel={accessibilityLabel ?? text}>
      {words.map((word, wi) => {
        const units = by === 'letter' ? Array.from(word) : [word];
        const wordEl = (
          <View key={`w-${wi}`} style={styles.word}>
            {units.map((u, ui) => {
              const d = delay + index++ * stagger;
              return (
                <FadeInView key={`u-${wi}-${ui}`} delay={d} fromY={fromY} durationMs={260}>
                  <Text style={style}>{u}</Text>
                </FadeInView>
              );
            })}
            {wi < words.length - 1 ? <Text style={style}> </Text> : null}
          </View>
        );
        return wordEl;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap' },
  word: { flexDirection: 'row' },
});
