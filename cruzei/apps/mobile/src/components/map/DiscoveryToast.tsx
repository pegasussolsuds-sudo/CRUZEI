import React, { useEffect } from 'react';
import { StyleSheet, Text } from 'react-native';
import { colors, radius, shadows, spacing, typography } from '@cruzei/ui-mobile';
import { SlideInView } from '../animated/SlideInView';
import { ScaleOnPress } from '../animated/ScaleOnPress';

export type DiscoveryTone = 'hot' | 'info' | 'event';

export interface DiscoveryHint {
  /** chave estável (dedupe na sessão e key do componente) */
  key: string;
  text: string;
  tone: DiscoveryTone;
  /** tocar leva a câmera até o POI */
  poiId?: number;
}

export interface DiscoveryToastProps {
  hint: DiscoveryHint | null;
  onPress: (poiId: number) => void;
  onHide: () => void;
  hideAfterMs?: number;
}

/**
 * Dica de descoberta discreta (doc §11): "🔥 Bar do Léo tá bombando", "✨ 12 pessoas novas perto de você".
 * Sobe com spring, some sozinha. Uma por vez — quem decide QUANDO mostrar é o useDiscoveryHints.
 */
export function DiscoveryToast({ hint, onPress, onHide, hideAfterMs = 3400 }: DiscoveryToastProps) {
  useEffect(() => {
    if (!hint) return;
    const t = setTimeout(onHide, hideAfterMs);
    return () => clearTimeout(t);
  }, [hint, hideAfterMs, onHide]);

  if (!hint) return null;
  const tappable = hint.poiId != null;

  return (
    <SlideInView key={hint.key} from="up" distance={32} springPreset="snappy" style={styles.wrap} accessibilityLiveRegion="polite">
      <ScaleOnPress
        onPress={() => {
          if (hint.poiId != null) onPress(hint.poiId);
          onHide();
        }}
        disabled={!tappable}
        accessibilityRole={tappable ? 'button' : 'text'}
        accessibilityLabel={tappable ? `${hint.text}. Tocar pra ver no mapa` : hint.text}
        style={[styles.toast, ...(hint.tone === 'hot' ? [styles.hot] : hint.tone === 'event' ? [styles.event] : [])]}
        glowColor={hint.tone === 'hot' ? colors.secondary : undefined}
      >
        <Text style={styles.text} numberOfLines={1}>
          {hint.text}
        </Text>
      </ScaleOnPress>
    </SlideInView>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  toast: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: '#12122A',
    borderWidth: 1,
    borderColor: 'rgba(127,255,0,0.45)',
    justifyContent: 'center',
    ...shadows.strong,
  },
  hot: { backgroundColor: colors.secondary, borderColor: colors.secondary },
  event: { backgroundColor: '#5A1E8A', borderColor: '#9B5CFF' },
  text: { ...typography.label, color: colors.white },
});
