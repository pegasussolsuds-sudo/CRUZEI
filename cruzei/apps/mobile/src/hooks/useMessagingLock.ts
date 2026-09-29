import { useLocationStore } from '../stores/location';
import { useAuthStore } from '../stores/auth';
import { toApiError } from '../services/api';

// Mandar e receber mensagens no modo invisível é do Premium. Quem garante é o servidor (403 anonymous_requires_premium
// e nenhum evento de mensagem por socket); aqui o app só troca as telas de mensagem pelo convite.
// premiumTier do /me já vem como 'free' quando a assinatura venceu.

/** invisível sem Premium: Mensagens e chat viram o convite (ficar visível ou assinar) */
export function useMessagingLocked(): boolean {
  const isAnonymous = useLocationStore((s) => s.isAnonymous);
  const tier = useAuthStore((s) => s.user?.premiumTier ?? 'free');
  return isAnonymous && tier === 'free';
}

/** o servidor recusou porque a pessoa está invisível sem Premium (o estado local estava velho) */
export function isMessagingLockedError(err: unknown): boolean {
  return toApiError(err).error === 'anonymous_requires_premium';
}
