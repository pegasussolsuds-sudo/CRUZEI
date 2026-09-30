// "Liberar número" (só admin, caso de suporte): o telefone sai da conta pra outra pessoa poder usar. Mesma liberação
// do app ("não é minha"): histórico em phone_releases, conta pausada sem prazo, push apagado e todas as sessões caem.
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PhoneOff } from 'lucide-react';
import { adminApi } from '@/api/admin';
import { qk } from '@/api/keys';
import { errorMessage } from '@/api/http';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Checkbox, TextAreaField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';

export function ReleasePhoneDialog({
  open,
  onClose,
  user,
}: {
  open: boolean;
  onClose: () => void;
  user: { id: string; name: string; phone: string | null };
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [sure, setSure] = useState(false);

  useEffect(() => {
    if (open) {
      setReason('');
      setSure(false);
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => adminApi.releasePhone(user.id, { reason: reason.trim() }),
    onSuccess: () => {
      toast.success(`Número liberado da conta de ${user.name}`);
      void qc.invalidateQueries({ queryKey: qk.user(user.id) });
      void qc.invalidateQueries({ queryKey: qk.usersAll });
      onClose();
    },
  });
  const { reset } = mutation;
  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  const canSubmit = reason.trim().length >= 3 && sure;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Liberar número"
      description={user.phone ? `Hoje: ${user.phone}` : undefined}
      icon={<PhoneOff size={20} />}
      iconTone="danger"
      size="md"
      busy={mutation.isPending}
      onSubmit={() => {
        if (canSubmit) mutation.mutate();
      }}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>
            Voltar
          </Button>
          <Button type="submit" variant="danger" loading={mutation.isPending} disabled={!canSubmit}>
            Liberar número
          </Button>
        </>
      }
    >
      <div className="banner banner-info">
        <PhoneOff size={16} />
        <span>
          A conta perde o número, fica pausada (some do mapa e da descoberta) e sai de todos os aparelhos. Quem tem o número
          agora consegue criar uma conta nova com ele. Não dá pra desfazer por aqui.
        </span>
      </div>
      <TextAreaField
        label="Motivo"
        required
        maxLength={500}
        showCounter
        rows={2}
        placeholder="Ex.: a pessoa trocou de linha e a operadora passou o número pra outra (atendimento #123)."
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        hint="Fica na auditoria e no histórico do número."
      />
      <Checkbox label={`Confirmo: ${user.name} perde o vínculo com esse número.`} checked={sure} onChange={setSure} />
      {mutation.isError ? (
        <div className="banner banner-danger" role="alert">
          {errorMessage(mutation.error)}
        </div>
      ) : null}
    </Dialog>
  );
}
