import { create } from 'zustand';
import { ACCOUNT_BLOCKED_ERRORS, type AccountBlockedError } from '@cruzei/shared-types';

interface AccountBlockState {
  /** conta suspensa/banida: o app inteiro vira a tela de aviso (vem do 403 da API ou do socket) */
  blocked: AccountBlockedError | null;
  setBlocked: (b: AccountBlockedError | null) => void;
}

export const useAccountBlockStore = create<AccountBlockState>((set) => ({
  blocked: null,
  setBlocked: (blocked) => set({ blocked }),
}));

/** corpo de erro da API/socket é um bloqueio de conta? */
export function asAccountBlocked(data: unknown): AccountBlockedError | null {
  const d = data as Partial<AccountBlockedError> | null | undefined;
  if (!d || typeof d !== 'object' || !d.error || !(ACCOUNT_BLOCKED_ERRORS as readonly string[]).includes(d.error)) return null;
  return { error: d.error, message: d.message ?? 'Sua conta não pode usar o Metch agora.', reason: d.reason ?? null, until: d.until ?? null };
}
