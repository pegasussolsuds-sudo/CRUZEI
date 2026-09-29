// "Mandar teste pra mim": o mesmo título/texto/destino/canais, só pra quem está logado (público 'user'), na hora.
// Vira uma campanha de 1 pessoa no histórico — dá pra ver no celular como chega antes de mandar pra todo mundo.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FlaskConical } from 'lucide-react';
import type { CampaignChannels, NotificationTarget } from '@cruzei/shared-types';
import { adminApi } from '@/api/admin';
import { qk } from '@/api/keys';
import { errorMessage, isHttpError } from '@/api/http';
import { useMe } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';

export function TestToMeButton({
  title,
  body,
  target,
  channels,
  invalid,
  onInvalid,
}: {
  title: string;
  body: string;
  target: NotificationTarget | null;
  channels: CampaignChannels;
  /** título/texto/canais/destino com erro: não manda, só mostra os erros */
  invalid: boolean;
  onInvalid: () => void;
}) {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const test = useMutation({
    mutationFn: () =>
      adminApi.createCampaign({
        title: title.trim(),
        body: body.trim(),
        target,
        audience: { kind: 'user', userId: me.id },
        channels,
        scheduledAt: null,
      }),
    onSuccess: () => {
      toast.success('Teste enviado pra você. Confere no celular.');
      void qc.invalidateQueries({ queryKey: qk.campaigns });
    },
    onError: (e) =>
      toast.error(
        // 422 empty_audience: a própria conta não recebe (aviso desligado nas preferências do app ou conta não ativa)
        isHttpError(e, 422) ? 'O teste não tem pra quem ir: sua conta não recebe esse tipo de aviso (confira as notificações no app).' : `Teste não foi: ${errorMessage(e)}`,
      ),
  });
  return (
    <Button
      variant="ghost"
      icon={<FlaskConical size={16} />}
      loading={test.isPending}
      onClick={() => {
        if (invalid) onInvalid();
        else test.mutate();
      }}
    >
      Mandar teste pra mim
    </Button>
  );
}
