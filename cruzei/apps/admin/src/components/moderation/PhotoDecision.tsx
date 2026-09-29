// Aprovar/recusar foto em análise (POST /v1/admin/photos/:id — rota que já existia)
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, ImageOff, X } from 'lucide-react';
import { adminApi } from '@/api/admin';
import { qk } from '@/api/keys';
import { errorMessage } from '@/api/http';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';

/** motivos curtos (o backend aceita até 100 caracteres) */
export const PHOTO_REJECT_REASONS = ['Nudez ou conteúdo sexual', 'Parece menor de idade', 'Não mostra a pessoa', 'Foto de outra pessoa', 'Violência ou ódio'];

export function PhotoDecisionButtons({ photoId, userId, compact }: { photoId: string; userId?: string; compact?: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [rejecting, setRejecting] = useState(false);

  const done = () => {
    void qc.invalidateQueries({ queryKey: qk.queue });
    void qc.invalidateQueries({ queryKey: qk.stats });
    if (userId) void qc.invalidateQueries({ queryKey: qk.user(userId) });
  };

  const approve = useMutation({
    mutationFn: () => adminApi.photoDecision(photoId, { decision: 'approve' }),
    onSuccess: () => {
      toast.success('Foto aprovada');
      done();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <>
      <div className="row">
        <Button size="sm" variant="primary" icon={<Check size={14} />} loading={approve.isPending} onClick={() => approve.mutate()}>
          {compact ? 'Aprovar' : 'Aprovar foto'}
        </Button>
        <Button size="sm" variant="danger-soft" icon={<X size={14} />} onClick={() => setRejecting(true)} disabled={approve.isPending}>
          Recusar
        </Button>
      </div>
      <ConfirmDialog
        open={rejecting}
        onClose={() => setRejecting(false)}
        title="Recusar foto"
        description="A foto some do perfil e a pessoa vê o motivo."
        icon={<ImageOff size={20} />}
        confirmLabel="Recusar foto"
        reason={{ label: 'Motivo (a pessoa vê)', required: true, maxLength: 100, placeholder: 'Ex.: Nudez ou conteúdo sexual', hint: `Sugestões: ${PHOTO_REJECT_REASONS.join(' · ')}` }}
        onConfirm={async (reason) => {
          await adminApi.photoDecision(photoId, { decision: 'reject', reason });
          toast.success('Foto recusada');
          done();
        }}
      />
    </>
  );
}
