// Avisar / suspender / banir / reativar / dispensar denúncias — rota que já existia
// (POST /v1/admin/users/:id/action). Motivo aparece pra pessoa; nota fica só pra equipe.
import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Ban, BellRing, CheckCheck, PauseCircle, RotateCcw } from 'lucide-react';
import type { ModerationActionPayload, ModerationDecision } from '@cruzei/shared-types';
import { adminApi } from '@/api/admin';
import { qk } from '@/api/keys';
import { errorMessage } from '@/api/http';
import { addDays } from '@/lib/datetime';
import { formatDate } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Checkbox, TextAreaField, TextField } from '@/components/ui/Field';
import { Dialog } from '@/components/ui/Dialog';
import { Segmented } from '@/components/ui/Choice';
import { useToast } from '@/components/ui/Toast';

interface Copy {
  title: (name: string) => string;
  description: string;
  confirm: string;
  icon: ReactNode;
  tone: 'danger' | 'accent' | 'neutral';
  reason: 'required' | 'optional' | 'none';
  reasonLabel: string;
  reasonPlaceholder: string;
  done: string;
}

const COPY: Record<ModerationDecision, Copy> = {
  warn: {
    title: (n) => `Avisar ${n}`,
    description: 'A pessoa recebe o aviso no app. A conta continua funcionando normalmente.',
    confirm: 'Mandar aviso',
    icon: <BellRing size={20} />,
    tone: 'accent',
    reason: 'required',
    reasonLabel: 'Aviso que a pessoa vai ler',
    reasonPlaceholder: 'Ex.: Mensagens ofensivas não são permitidas no Metch. Da próxima vez a conta pode ser suspensa.',
    done: 'Aviso enviado',
  },
  suspend: {
    title: (n) => `Suspender ${n}`,
    description: 'A pessoa sai do app na hora e não consegue entrar até a suspensão acabar.',
    confirm: 'Suspender conta',
    icon: <PauseCircle size={20} />,
    tone: 'danger',
    reason: 'required',
    reasonLabel: 'Motivo (a pessoa vê)',
    reasonPlaceholder: 'Ex.: Denúncias de assédio em conversas.',
    done: 'Conta suspensa',
  },
  ban: {
    title: (n) => `Banir ${n}`,
    description: 'Banimento arquiva as conversas, derruba a sessão e impede novo login com esse número.',
    confirm: 'Banir de vez',
    icon: <Ban size={20} />,
    tone: 'danger',
    reason: 'required',
    reasonLabel: 'Motivo (a pessoa vê)',
    reasonPlaceholder: 'Ex.: Golpe confirmado pedindo dinheiro a outras pessoas.',
    done: 'Conta banida',
  },
  reinstate: {
    title: (n) => `Reativar ${n}`,
    description: 'A conta volta a funcionar e sai da revisão.',
    confirm: 'Reativar conta',
    icon: <RotateCcw size={20} />,
    tone: 'accent',
    reason: 'optional',
    reasonLabel: 'Recado pra pessoa (opcional)',
    reasonPlaceholder: 'Ex.: Revisamos o caso e sua conta está liberada.',
    done: 'Conta reativada',
  },
  dismiss: {
    title: (n) => `Dispensar denúncias de ${n}`,
    description: 'As denúncias pendentes são arquivadas sem ação contra a conta.',
    confirm: 'Dispensar',
    icon: <CheckCheck size={20} />,
    tone: 'neutral',
    reason: 'none',
    reasonLabel: '',
    reasonPlaceholder: '',
    done: 'Denúncias dispensadas',
  },
};

type DaysChoice = '1' | '3' | '7' | '30' | 'custom' | 'review';

export function ModerationActionDialog({
  open,
  onClose,
  action,
  user,
}: {
  open: boolean;
  onClose: () => void;
  action: ModerationDecision;
  user: { id: string; name: string };
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const copy = COPY[action];
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [daysChoice, setDaysChoice] = useState<DaysChoice>('7');
  const [customDays, setCustomDays] = useState('14');
  const [sure, setSure] = useState(false);

  useEffect(() => {
    if (open) {
      setReason('');
      setNote('');
      setDaysChoice('7');
      setCustomDays('14');
      setSure(false);
    }
  }, [open]);

  const days = daysChoice === 'review' ? undefined : daysChoice === 'custom' ? Number.parseInt(customDays, 10) : Number(daysChoice);
  const daysOk = action !== 'suspend' || days === undefined || (Number.isInteger(days) && days >= 1 && days <= 365);
  const reasonOk = copy.reason !== 'required' || reason.trim().length >= 5;
  const canSubmit = daysOk && reasonOk && (action !== 'ban' || sure);

  const mutation = useMutation({
    mutationFn: () => {
      const body: ModerationActionPayload = { action };
      if (reason.trim()) body.reason = reason.trim();
      if (note.trim()) body.note = note.trim();
      if (action === 'suspend' && days !== undefined) body.days = days;
      return adminApi.userAction(user.id, body);
    },
    onSuccess: () => {
      toast.success(copy.done);
      void qc.invalidateQueries({ queryKey: qk.user(user.id) });
      void qc.invalidateQueries({ queryKey: qk.queue });
      void qc.invalidateQueries({ queryKey: qk.usersAll });
      void qc.invalidateQueries({ queryKey: qk.stats });
      onClose();
    },
  });

  // erro da tentativa anterior não aparece quando reabre
  const { reset } = mutation;
  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={copy.title(user.name)}
      description={copy.description}
      icon={copy.icon}
      iconTone={copy.tone}
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
          <Button type="submit" variant={copy.tone === 'danger' ? 'danger' : 'primary'} loading={mutation.isPending} disabled={!canSubmit}>
            {copy.confirm}
          </Button>
        </>
      }
    >
      {action === 'suspend' ? (
        <div className="field">
          <span className="field-label" id="susp-days">
            Por quanto tempo
          </span>
          <Segmented<DaysChoice>
            label="Duração da suspensão"
            value={daysChoice}
            onChange={setDaysChoice}
            options={[
              { value: '1', label: '1 dia' },
              { value: '3', label: '3 dias' },
              { value: '7', label: '7 dias' },
              { value: '30', label: '30 dias' },
              { value: 'custom', label: 'Outro' },
              { value: 'review', label: 'Até revisão' },
            ]}
          />
          {daysChoice === 'custom' ? (
            <TextField
              label="Dias (1 a 365)"
              type="number"
              min={1}
              max={365}
              value={customDays}
              onChange={(e) => setCustomDays(e.target.value)}
              error={daysOk ? null : 'Entre 1 e 365 dias.'}
              fieldClassName="suspend-days"
            />
          ) : null}
          <span className="field-hint">
            {days !== undefined && daysOk ? `Volta em ${formatDate(addDays(days))}.` : 'Fica suspensa até alguém da equipe reativar.'}
          </span>
        </div>
      ) : null}

      {copy.reason !== 'none' ? (
        <TextAreaField
          label={copy.reasonLabel}
          placeholder={copy.reasonPlaceholder}
          required={copy.reason === 'required'}
          maxLength={255}
          showCounter
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          hint={copy.reason === 'required' ? 'Seja claro e respeitoso: é isso que aparece no app.' : undefined}
          autoFocus
        />
      ) : null}

      <TextAreaField
        label="Nota interna (só a equipe vê)"
        placeholder="Contexto pra quem olhar depois: prints, denúncias relacionadas…"
        maxLength={2000}
        rows={2}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        autoFocus={copy.reason === 'none'}
      />

      {action === 'ban' ? <Checkbox label="Confirmo: é pra banir essa conta." checked={sure} onChange={setSure} /> : null}

      {mutation.isError ? (
        <div className="banner banner-danger" role="alert">
          {errorMessage(mutation.error)}
        </div>
      ) : null}
    </Dialog>
  );
}
