import { create } from 'zustand';
import type { TargetRoute } from '../services/notificationTarget';

/**
 * Toque num push esperando a navegação: no app frio o toque chega antes do login hidratar e do navegador montar.
 * O RootNavigator abre o destino quando os dois estiverem prontos (e marca a notificação como lida).
 */
interface PushRouteState {
  pending: { route: TargetRoute; notificationId: string | null } | null;
  set: (route: TargetRoute, notificationId: string | null) => void;
  clear: () => void;
}

export const usePushRouteStore = create<PushRouteState>((set) => ({
  pending: null,
  set: (route, notificationId) => set({ pending: { route, notificationId } }),
  clear: () => set({ pending: null }),
}));
