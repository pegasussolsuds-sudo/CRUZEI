import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamily, radius, shadows, spacing, typography } from '@cruzei/ui-mobile';
import { Pulse } from '../animated/Pulse';
import { ScaleOnPress } from '../animated/ScaleOnPress';

export interface VibeSearchBarProps {
  onPress: () => void;
  /** lugares em alta no recorte atual — vira o selo à direita */
  hotCount?: number;
  /** pausa a troca de sugestões (tela fora de foco) */
  paused?: boolean;
}

// sugestões que se revezam no placeholder — contam o que dá pra buscar sem ocupar espaço
const HINTS = ['Onde tá a vibe hoje?', 'bares no Centro', 'eventos rolando agora', 'onde tem mais gente', 'um bairro, uma rua, um lugar'];
const HINT_MS = 3800;

/**
 * Barra de busca no topo do mapa: abre o overlay "Onde tá a vibe".
 * Vidro escuro com borda lima, sugestão que se reveza e selo ao vivo (🔥 N em alta / ponto pulsando).
 */
export function VibeSearchBar({ onPress, hotCount = 0, paused = false }: VibeSearchBarProps) {
  const [hint, setHint] = useState(0);
  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => setHint((h) => (h + 1) % HINTS.length), HINT_MS);
    return () => clearInterval(id);
  }, [paused]);

  return (
    <ScaleOnPress
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={
        hotCount > 0
          ? `Buscar onde está a vibe, ${hotCount} ${hotCount === 1 ? 'lugar em alta' : 'lugares em alta'} agora`
          : 'Buscar onde está a vibe: lugares em alta, eventos e onde tem mais gente'
      }
      accessibilityHint="Abre a busca de lugares"
      glowColor={colors.primary}
      style={styles.bar}
    >
      <View style={styles.iconWrap}>
        <Ionicons name="search" size={18} color={colors.primary} />
      </View>
      <View style={styles.hintWrap} pointerEvents="none">
        {/* troca seca de propósito: nada de Reanimated montando no header logo após a splash (boot já é o momento frágil) */}
        <View key={hint} style={styles.hintInner}>
          <Text style={styles.hint} numberOfLines={1}>
            {HINTS[hint]}
          </Text>
        </View>
      </View>
      {hotCount > 0 ? (
        <View style={[styles.badge, styles.badgeHot]} accessible={false}>
          <Text style={styles.badgeHotText}>🔥 {hotCount} em alta</Text>
        </View>
      ) : (
        <View style={styles.badge} accessible={false}>
          <Pulse maxScale={1.5} cycleMs={1600}>
            <View style={styles.liveDot} />
          </Pulse>
          <Text style={styles.badgeText}>ao vivo</Text>
        </View>
      )}
    </ScaleOnPress>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: 48,
    borderRadius: radius.full,
    backgroundColor: 'rgba(10,10,26,0.88)',
    borderWidth: 1,
    borderColor: 'rgba(127,255,0,0.28)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: spacing.xs,
    paddingRight: spacing.xs,
    gap: spacing.sm,
    ...shadows.medium,
  },
  iconWrap: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(127,255,0,0.12)', alignItems: 'center', justifyContent: 'center' },
  hintWrap: { flex: 1, minWidth: 0, height: 24, justifyContent: 'center', overflow: 'hidden' },
  hintInner: { justifyContent: 'center' },
  hint: { fontFamily: fontFamily.displayMedium, fontSize: 15, color: colors.gray[300] },
  badge: { height: 30, paddingHorizontal: spacing.md, borderRadius: radius.full, backgroundColor: 'rgba(250,250,250,0.08)', flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  badgeHot: { backgroundColor: 'rgba(255,20,147,0.9)' },
  badgeText: { ...typography.caption, color: colors.gray[300], letterSpacing: 0.6, textTransform: 'uppercase' },
  badgeHotText: { ...typography.caption, color: colors.white },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primary },
});
