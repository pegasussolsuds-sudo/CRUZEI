import { useCallback } from 'react';
import { Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery, type QueryClient } from '@tanstack/react-query';
import type { LikeResult, SuperLikeLimitError, SuperLikeQuota } from '@cruzei/shared-types';

import { api } from '../services/api';
import { quotaAfterSuperLike, quotaFromLimit, quotaRemaining, superLikeLimitCopy } from '../services/superLikes';
import { useAuthStore } from '../stores/auth';
import type { RootStackParamList } from '../navigation/RootNavigator';

// Contador de super curtidas do dia (GET /likes/super/quota) + o aviso quando acaba (no grátis, convite pro Premium).
// O servidor é quem barra (403 super_like_limit); o app só mostra quantas restam e explica.

/** prefixo da cota no cache (a chave completa leva o id da conta) */
export const SUPER_QUOTA_KEY = ['likes', 'super-quota'] as const;

/** cota de hoje + quantas restam agora (null = ainda não sabe; o servidor antigo não tem a rota) */
export function useSuperLikeQuota() {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const tier = useAuthStore((s) => s.user?.premiumTier ?? 'free');
  const query = useQuery({
    // o plano entra na chave: assinou/venceu → busca de novo (o limite muda)
    queryKey: [...SUPER_QUOTA_KEY, userId, tier],
    enabled: Boolean(userId),
    staleTime: 60_000,
    retry: false,
    queryFn: async () => (await api.get<SuperLikeQuota>('/likes/super/quota')).data,
  });
  return { quota: query.data ?? null, remaining: quotaRemaining(query.data), refetch: query.refetch };
}

/** depois de uma super curtida que deu certo: atualiza o contador na hora (ou pede de novo se não der pra saber) */
export function noteSuperLikeSent(qc: QueryClient, res: Pick<LikeResult, 'superLikesRemainingToday'> | null | undefined) {
  let unknown = false;
  qc.setQueriesData<SuperLikeQuota>({ queryKey: SUPER_QUOTA_KEY }, (old) => {
    const next = quotaAfterSuperLike(old, res);
    if (!next) unknown = true;
    return next ?? old;
  });
  if (unknown || typeof res?.superLikesRemainingToday !== 'number') qc.invalidateQueries({ queryKey: SUPER_QUOTA_KEY });
}

/** o servidor recusou (403 super_like_limit): zera o contador com o que veio */
export function noteSuperLikeLimit(qc: QueryClient, e: SuperLikeLimitError) {
  qc.setQueriesData<SuperLikeQuota>({ queryKey: SUPER_QUOTA_KEY }, (old) => quotaFromLimit(old, e) ?? old);
}

/** aviso de "acabou": no grátis, convite pro Premium; no Premium, só quando volta */
export function useSuperLikeLimitPrompt(): (info: { canUpgrade: boolean; limit?: number; resetsAt?: string | null }) => void {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return useCallback(
    (info) => {
      const { title, body } = superLikeLimitCopy(info);
      Alert.alert(
        title,
        body,
        info.canUpgrade
          ? [
              { text: 'Agora não', style: 'cancel' },
              { text: 'Ver Premium', onPress: () => nav.navigate('Main', { screen: 'Paywall' }) },
            ]
          : [{ text: 'Beleza' }],
      );
    },
    [nav],
  );
}
