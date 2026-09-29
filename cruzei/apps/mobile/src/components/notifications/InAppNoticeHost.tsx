import React, { useCallback, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { spacing } from '@cruzei/ui-mobile';
import { DiscoveryToast, type DiscoveryHint } from '../map/DiscoveryToast';
import { useInAppNoticeStore } from '../../stores/inAppNotice';
import { markNotificationRead } from '../../hooks/useNotifications';
import { openTargetRoute } from '../../navigation/openTarget';

/**
 * Aviso rápido no topo do app quando chega notificação com ele aberto (socket 'notification:new' ou push em primeiro
 * plano). Reusa a pílula das dicas do mapa (DiscoveryToast): uma por vez, some sozinha, o toque abre o destino.
 */
export function InAppNoticeHost() {
  const notice = useInAppNoticeStore((s) => s.current);
  const hide = useInAppNoticeStore((s) => s.hide);
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();

  const open = useCallback(() => {
    if (!notice) return;
    void markNotificationRead(qc, notice.notificationId);
    if (notice.route) openTargetRoute(notice.route, qc);
    else openTargetRoute({ screen: 'Notifications' }, qc);
  }, [notice, qc]);

  const hint = useMemo<DiscoveryHint | null>(
    () => (notice ? { key: notice.key, text: notice.text, tone: notice.tone, onPress: open } : null),
    [notice, open],
  );

  if (!hint) return null;
  return (
    <View style={[styles.wrap, { top: insets.top + spacing.sm }]} pointerEvents="box-none">
      <DiscoveryToast hint={hint} onHide={hide} hideAfterMs={4500} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: spacing.lg, right: spacing.lg },
});
