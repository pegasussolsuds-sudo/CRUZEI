// Premium manual (só admin): dar, estender ou tirar. Sempre com motivo; avisar a pessoa é opcional.
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import type { GrantPremiumPayload, PremiumTier } from '@cruzei/shared-types';
import { adminApi } from '@/api/admin';
import { qk } from '@/api/keys';
import { errorMessage } from '@/api/http';
import { addDays } from '@/lib/datetime';
import { formatDate } from '@/lib/format';
import { TIER_LABEL } from '@/lib/labels';
import { Button } from '@/components/ui/Button';
import { Checkbox, TextAreaField, TextField } from '@/components/ui/Field';
import { Dialog } from '@/components/ui/Dialog';
import { OptionCards, Segmented } from '@/components/ui/Choice';
import { useToast } from '@/components/ui/Toast';

type Duration = '7' | '30' | '90' | '365' | 'custom' | 'forever';

export function PremiumDialog({
  open,
  onClose,
  user,
}: {
  open: boolean;
  onClose: () => void;
  user: { id: string; name: string; premiumTier: PremiumTier; premiumExpiresAt: string | null };
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [tier, setTier] = useState<PremiumTier>('premium');
  const [duration, setDuration] = useState<Duration>('30');
  const [customDays, setCustomDays] = useState('60');
  const [reason, setReason] = useState('');
  const [notify, setNotify] = useState(true);

  useEffect(() => {
    if (open) {
      setTier(user.premiumTier === 'free' ? 'premium' : user.premiumTier);
      setDuration('30');
      setCustomDays('60');
      setReason('');
      setNotify(true);
    }
  }, [open, user.premiumTier]);

  const days = duration === 'forever' ? null : duration === 'custom' ? Number.parseInt(customDays, 10) : Number(duration);
  const daysOk = tier === 'free' || days === null || (Number.isInteger(days) && days >= 1 && days <= 3650);
  const canSubmit = daysOk && reason.trim().length >= 3;

  const mutation = useMutation({
    mutationFn: () => {
      const body: GrantPremiumPayload = { tier, days: tier === 'free' ? null : days, reason: reason.trim(), notify };
      return adminApi.grantPremium(user.id, body);
    },
    onSuccess: () => {
      toast.success(tier === 'free' ? 'Premium retirado' : `${TIER_LABEL[tier]} liberado pra ${user.name}`);
      void qc.invalidateQueries({ queryKey: qk.user(user.id) });
      void qc.invalidateQueries({ queryKey: qk.usersAll });
      void qc.invalidateQueries({ queryKey: qk.stats });
      onClose();
    },
  });
  const { reset } = mutation;
  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  const summary =
    tier === 'free'
      ? `${user.name} volta pro plano grátis agora.`
      : days === null
        ? `${TIER_LABEL[tier]} sem vencimento.`
        : daysOk && days
          ? `${TIER_LABEL[tier]} até ${formatDate(addDays(days))}.`
          : '';

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Premium manual"
      description={`Plano atual de ${user.name}: ${TIER_LABEL[user.premiumTier]}${user.premiumExpiresAt ? `, vence ${formatDate(user.premiumExpiresAt)}` : ''}.`}
      icon={<Sparkles size={20} />}
      iconTone="premium"
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
          <Button type="submit" variant={tier === 'free' ? 'danger' : 'premium'} loading={mutation.isPending} disabled={!canSubmit}>
            {tier === 'free' ? 'Tirar Premium' : 'Liberar'}
          </Button>
        </>
      }
    >
      <div className="field">
        <span className="field-label" id="premium-tier">
          Plano
        </span>
        <OptionCards<PremiumTier>
          labelledBy="premium-tier"
          value={tier}
          onChange={setTier}
          options={[
            { value: 'premium', label: 'Premium', description: 'Recursos Premium' },
            { value: 'premium_plus', label: 'Premium+', description: 'Tudo do Premium e mais' },
            { value: 'free', label: 'Grátis', description: 'Tira o Premium agora' },
          ]}
        />
      </div>

      {tier !== 'free' ? (
        <div className="field">
          <span className="field-label">Duração</span>
          <Segmented<Duration>
            label="Duração"
            value={duration}
            onChange={setDuration}
            options={[
              { value: '7', label: '7 dias' },
              { value: '30', label: '30 dias' },
              { value: '90', label: '90 dias' },
              { value: '365', label: '1 ano' },
              { value: 'custom', label: 'Outro' },
              { value: 'forever', label: 'Sem vencimento' },
            ]}
          />
          {duration === 'custom' ? (
            <TextField label="Dias" type="number" min={1} max={3650} value={customDays} onChange={(e) => setCustomDays(e.target.value)} error={daysOk ? null : 'Entre 1 e 3650 dias.'} />
          ) : null}
        </div>
      ) : null}

      {summary ? (
        <div className="banner banner-info">
          <Sparkles size={16} />
          <span>{summary}</span>
        </div>
      ) : null}

      <TextAreaField
        label="Motivo"
        required
        maxLength={255}
        showCounter
        rows={2}
        placeholder="Ex.: Compensação pela falha no pagamento de 25/09 (atendimento #123)."
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        hint="Fica no histórico de assinaturas e na auditoria."
      />
      <Checkbox label="Avisar a pessoa (notificação no app e push)" checked={notify} onChange={setNotify} />

      {mutation.isError ? (
        <div className="banner banner-danger" role="alert">
          {errorMessage(mutation.error)}
        </div>
      ) : null}
    </Dialog>
  );
}
