import { create } from 'zustand';
import type { AppNotification } from '@cruzei/shared-types';
import { navigationRef } from '../navigation/navigationRef';
import { noticeTextOf, routeForNotification, shouldShowNotice, type TargetRoute } from '../services/notificationTarget';

/** aviso rápido no topo do app (notificação nova com o app aberto): um por vez, o mais novo substitui */
export interface InAppNotice {
  key: string;
  notificationId: string;
  text: string;
  tone: 'info' | 'event';
  route: TargetRoute | null;
}

interface InAppNoticeState {
  current: InAppNotice | null;
  show: (n: InAppNotice) => void;
  hide: () => void;
}

export const useInAppNoticeStore = create<InAppNoticeState>((set) => ({
  current: null,
  show: (current) => set({ current }),
  hide: () => set({ current: null }),
}));

// a mesma notificação chega pelo socket e pelo push (app aberto): um aviso só
const shown = new Set<string>();

/** notificação nova com o app aberto (socket 'notification:new' ou push em primeiro plano) */
export function showNotificationNotice(n: AppNotification): void {
  if (shown.has(n.id)) return;
  shown.add(n.id);
  if (shown.size > 200) shown.delete(shown.values().next().value as string);
  const routeName = navigationRef.isReady() ? navigationRef.getCurrentRoute()?.name : undefined;
  if (!shouldShowNotice(n, routeName)) return;
  useInAppNoticeStore.getState().show({
    key: `n-${n.id}`,
    notificationId: n.id,
    text: noticeTextOf(n),
    tone: n.type === 'event' ? 'event' : 'info',
    route: routeForNotification(n),
  });
}
