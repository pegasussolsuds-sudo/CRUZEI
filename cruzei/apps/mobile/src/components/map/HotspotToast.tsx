import React, { useEffect } from 'react';
import { StyleSheet, Text } from 'react-native';
import { colors, radius, shadows, spacing, typography } from '@cruzei/ui-mobile';
import { SlideInView } from '../animated/SlideInView';
import { ScaleOnPress } from '../animated/ScaleOnPress';

export interface HotspotBorn {
  poiId: number;
  name: string;
  userCount: number;
}

export interface HotspotToastProps {
  hotspot: HotspotBorn | null;
  /** tocar → câmera no POI (cruzei.focusPoi) */
  onPress: (poiId: number) => void;
  onHide: () => void;
  hideAfterMs?: number;
}

/** '🔥 47 pessoas no Bar do Léo' — sobe com spring, some sozinho em 3s. */
export function HotspotToast({ hotspot, onPress, onHide, hideAfterMs = 3000 }: HotspotToastProps) {
  useEffect(() => {
    if (!hotspot) return;
    const t = setTimeout(onHide, hideAfterMs);
    return () => clearTimeout(t);
  }, [hotspot, hideAfterMs, onHide]);

  if (!hotspot) return null;
  const label = `🔥 ${hotspot.userCount} pessoas no ${hotspot.name}`;

  return (
    <SlideInView
      key={`${hotspot.poiId}-${hotspot.userCount}`}
      from="up"
      distance={32}
      springPreset="snappy"
      style={styles.wrap}
      accessibilityLiveRegion="polite"
    >
      <ScaleOnPress
        onPress={() => {
          onPress(hotspot.poiId);
          onHide();
        }}
        accessibilityRole="button"
        accessibilityLabel={`${label}. Tocar pra ver no mapa`}
        style={styles.toast}
        glowColor={colors.secondary}
      >
        <Text style={styles.text} numberOfLines={1}>
          {label}
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
    backgroundColor: colors.secondary,
    justifyContent: 'center',
    ...shadows.strong,
  },
  text: { ...typography.label, color: colors.white },
});
