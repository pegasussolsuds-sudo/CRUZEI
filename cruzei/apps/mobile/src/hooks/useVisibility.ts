import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api';
import { useLocationStore } from '../stores/location';
import { useAuthStore } from '../stores/auth';

// Alterna visível/anônimo: atualiza o servidor, o store local e o cache do perfil.
export function useVisibility() {
  const qc = useQueryClient();
  const isAnonymous = useLocationStore((s) => s.isAnonymous);
  const setAnonymous = useLocationStore((s) => s.setAnonymous);
  const refreshMe = useAuthStore((s) => s.refreshMe);

  const mutation = useMutation({
    mutationFn: async (next: boolean) => {
      await api.patch('/me/settings', { visibilityMode: next ? 'anonymous' : 'visible' });
      return next;
    },
    onMutate: (next) => setAnonymous(next),
    onError: (_e, next) => setAnonymous(!next),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['me'] });
      await qc.invalidateQueries({ queryKey: ['nearby'] });
      refreshMe().catch(() => {});
    },
  });

  return {
    isAnonymous,
    toggle: () => mutation.mutate(!isAnonymous),
    isPending: mutation.isPending,
  };
}
