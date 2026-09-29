// "Avisar" sobre um evento (só admin): cria uma campanha ligada ao evento.
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Megaphone } from 'lucide-react';
import type { AdminEvent, AnnouncePayload, CampaignAudience, CampaignChannels } from '@cruzei/shared-types';
import { adminApi } from '@/api/admin';
import { qk } from '@/api/keys';
import { errorMessage, isHttpError } from '@/api/http';
import { confirmationMatches, describeAudience, describeChannels, needsTypedConfirmation } from '@/lib/audience';
import { CAMPAIGN_BODY_MAX, CAMPAIGN_TITLE_MAX, confirmCountFromError, hasErrors, validateComposer } from '@/lib/campaign';
import { formatDateTime, formatNumber, formatTime } from '@/lib/format';
import { AudienceEditor, AudiencePreview, ChannelsEditor, useAudiencePreview } from '@/components/campaign/AudienceEditor';
import { NotificationPreview } from '@/components/campaign/NotificationPreview';
import { SCHEDULE_NOW, ScheduleField, scheduleToIso, type ScheduleValue } from '@/components/campaign/ScheduleField';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { TextAreaField, TextField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';

function defaultBody(e: AdminEvent): string {
  const when = new Date(e.startsAt).getTime() - Date.now() < 86_400_000 ? `Hoje às ${formatTime(e.startsAt)}` : `Dia ${new Date(e.startsAt).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' })} às ${formatTime(e.startsAt)}`;
  const where = e.venueName ?? e.address ?? e.city ?? '';
  return `${when}${where ? ` no ${where}` : ''}. Bora?`.slice(0, CAMPAIGN_BODY_MAX);
}

export function AnnounceDialog({ event, open, onClose }: { event: AdminEvent; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<CampaignAudience>({ kind: 'radius', lat: event.lat, lng: event.lng, radiusM: 5000 });
  const [channels, setChannels] = useState<CampaignChannels>({ push: true, inbox: true });
  const [schedule, setSchedule] = useState<ScheduleValue>(SCHEDULE_NOW);
  const [step, setStep] = useState<'edit' | 'confirm'>('edit');
  const [typed, setTyped] = useState('');
  const [showErrors, setShowErrors] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(`⚡ ${event.title}`.slice(0, CAMPAIGN_TITLE_MAX));
    setBody(defaultBody(event));
    setAudience({ kind: 'radius', lat: event.lat, lng: event.lng, radiusM: 5000 });
    setChannels({ push: true, inbox: true });
    setSchedule(SCHEDULE_NOW);
    setStep('edit');
    setTyped('');
    setShowErrors(false);
  }, [open, event]);

  const target = useMemo(() => ({ kind: 'event' as const, eventId: event.id, poiId: event.mapPoiId }), [event.id, event.mapPoiId]);
  const errors = validateComposer({ title, body, audience, channels, target });
  const sched = scheduleToIso(schedule);
  const preview = useAudiencePreview(audience, open, event.id);
  // o servidor conta de novo na hora: se mudou desde a prévia, devolve 409 com o número certo
  const [serverCount, setServerCount] = useState<number | null>(null);
  const count = serverCount ?? preview.data?.targetCount ?? null;
  const bigAudience = count != null && (serverCount != null || needsTypedConfirmation(audience, count));

  const mutation = useMutation({
    mutationFn: () => {
      const payload: AnnouncePayload = { title: title.trim(), body: body.trim(), audience, channels, scheduledAt: sched.iso };
      if (bigAudience && count != null) payload.confirmCount = count;
      return adminApi.announceEvent(event.id, payload);
    },
    onError: (e) => {
      const n = isHttpError(e) ? confirmCountFromError(e.status, e.body) : null;
      if (n != null) {
        setServerCount(n);
        setTyped('');
      }
    },
    onSuccess: () => {
      toast.success(schedule.mode === 'now' ? 'Aviso a caminho!' : 'Aviso agendado');
      void qc.invalidateQueries({ queryKey: qk.eventsAll });
      void qc.invalidateQueries({ queryKey: qk.event(event.id) });
      void qc.invalidateQueries({ queryKey: qk.campaigns });
      onClose();
    },
  });
  const { reset } = mutation;
  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  const goConfirm = () => {
    setShowErrors(true);
    if (hasErrors(errors) || sched.error || count == null) return;
    setServerCount(null);
    setTyped('');
    setStep('confirm');
  };

  const canSend = !bigAudience || (count != null && confirmationMatches(typed, count));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      icon={<Megaphone size={20} />}
      iconTone="accent"
      title={`Avisar sobre “${event.title}”`}
      description="Manda push e/ou aviso na central do app. O toque abre o evento."
      busy={mutation.isPending}
      onSubmit={() => (step === 'edit' ? goConfirm() : canSend && mutation.mutate())}
      footer={
        step === 'edit' ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={count == null && !preview.isError}>
              Revisar envio
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setStep('edit')} disabled={mutation.isPending}>
              Voltar e editar
            </Button>
            <Button type="submit" variant="primary" loading={mutation.isPending} disabled={!canSend}>
              {schedule.mode === 'now' ? `Enviar pra ${formatNumber(count ?? 0)}` : 'Agendar aviso'}
            </Button>
          </>
        )
      }
    >
      {step === 'edit' ? (
        <div className="composer">
          <div className="stack">
            <TextField label="Título" required maxLength={CAMPAIGN_TITLE_MAX} showCounter value={title} onChange={(e) => setTitle(e.target.value)} error={showErrors ? errors.title : null} />
            <TextAreaField label="Texto" required maxLength={CAMPAIGN_BODY_MAX} showCounter rows={3} value={body} onChange={(e) => setBody(e.target.value)} error={showErrors ? errors.body : null} />
            <div className="field">
              <span className="field-label">Quem recebe</span>
              <AudienceEditor
                value={audience}
                onChange={setAudience}
                kinds={event.city ? ['radius', 'city', 'all', 'premium'] : ['radius', 'all', 'premium']}
                fixedCenter={{ lat: event.lat, lng: event.lng }}
                fallbackCity={event.city ?? ''}
                showErrors={showErrors}
              />
            </div>
            <div className="field">
              <span className="field-label">Canais</span>
              <ChannelsEditor value={channels} onChange={setChannels} />
              {showErrors && errors.channels ? <span className="field-error">{errors.channels}</span> : null}
            </div>
            <ScheduleField value={schedule} onChange={setSchedule} showErrors={showErrors} />
          </div>
          <aside className="stack composer-side">
            <NotificationPreview title={title} body={body} target={target} />
            <AudiencePreview preview={preview} channels={channels} />
          </aside>
        </div>
      ) : (
        <div className="stack">
          <dl className="kv">
            <dt>Público</dt>
            <dd>{describeAudience(audience)}</dd>
            <dt>Pessoas</dt>
            <dd className="num strong">{formatNumber(count ?? 0)}</dd>
            <dt>Canais</dt>
            <dd>{describeChannels(channels)}</dd>
            <dt>Quando</dt>
            <dd>{schedule.mode === 'now' ? 'Agora' : `${formatDateTime(sched.iso)} (Brasília)`}</dd>
          </dl>
          <NotificationPreview title={title} body={body} target={target} />
          {bigAudience ? (
            <TextField
              label={
                <>
                  Público grande: digite <span className="num strong">{formatNumber(count ?? 0)}</span> pra confirmar
                </>
              }
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              inputMode="numeric"
              className="num"
              autoComplete="off"
              autoFocus
            />
          ) : null}
          {mutation.isError ? (
            <div className={`banner ${serverCount != null ? 'banner-warning' : 'banner-danger'}`} role="alert">
              {serverCount != null
                ? `O público mudou desde a prévia: agora são ${formatNumber(serverCount)} pessoas. Digite o número de novo.`
                : errorMessage(mutation.error)}
            </div>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}
