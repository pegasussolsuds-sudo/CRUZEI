// Notificações (só admin): compositor com prévia e contagem, confirmação digitada pra público grande
// e histórico com estatísticas.
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Bell, Calendar, Headphones, Map as MapIcon, MapPin, Megaphone, Send, Sparkles, Smartphone } from 'lucide-react';
import type { AdminEvent, AdminPoi, AdminUserRow, CampaignAudience, CampaignChannels, CreateCampaignPayload, NotificationTarget } from '@cruzei/shared-types';
import { adminApi } from '@/api/admin';
import { qk } from '@/api/keys';
import { useCursorQuery } from '@/api/useCursorQuery';
import { errorMessage, isHttpError } from '@/api/http';
import { confirmationMatches, describeAudience, describeChannels, describeTarget, needsTypedConfirmation } from '@/lib/audience';
import { CAMPAIGN_BODY_MAX, CAMPAIGN_TITLE_MAX, confirmCountFromError, hasErrors, validateComposer } from '@/lib/campaign';
import { formatDateTime, formatNumber } from '@/lib/format';
import { AudienceEditor, AudiencePreview, ChannelsEditor, useAudiencePreview } from '@/components/campaign/AudienceEditor';
import { NotificationPreview } from '@/components/campaign/NotificationPreview';
import { SCHEDULE_NOW, ScheduleField, scheduleToIso, type ScheduleValue } from '@/components/campaign/ScheduleField';
import { EventSelect, PoiPicker } from '@/components/pickers';
import { Button } from '@/components/ui/Button';
import { Card, CardHead } from '@/components/ui/Card';
import { OptionCards } from '@/components/ui/Choice';
import { Dialog } from '@/components/ui/Dialog';
import { TextAreaField, TextField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { PageHeader } from '@/components/ui/misc';
import { CampaignHistory } from './CampaignHistory';

type TargetKind = 'none' | 'map' | 'event' | 'place' | 'premium' | 'support';

function buildTarget(kind: TargetKind, event: AdminEvent | null, poi: AdminPoi | null): NotificationTarget | null {
  switch (kind) {
    case 'none':
      return null;
    case 'map':
      return { kind: 'map' };
    case 'premium':
      return { kind: 'premium' };
    case 'support':
      return { kind: 'support' };
    case 'event':
      return { kind: 'event', eventId: event?.id ?? '', poiId: event?.mapPoiId ?? null };
    case 'place':
      return { kind: 'place', poiId: poi?.id ?? '' };
  }
}

export default function NotificationsPage() {
  const qc = useQueryClient();
  const toast = useToast();

  // o histórico traz o pushEnabled (credenciais do Firebase no servidor); com envio em andamento, atualiza sozinho
  const [pollHistory, setPollHistory] = useState(false);
  const history = useCursorQuery(qk.campaigns, (cursor) => adminApi.campaigns(cursor), { refetchInterval: pollHistory ? 15_000 : false });
  const pushEnabled = history.data?.pages[0]?.pushEnabled ?? true;
  useEffect(() => {
    setPollHistory(!!history.data?.pages.some((p) => p.items.some((c) => c.status === 'sending' || c.status === 'scheduled')));
  }, [history.data]);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [targetKind, setTargetKind] = useState<TargetKind>('none');
  const [event, setEvent] = useState<AdminEvent | null>(null);
  const [poi, setPoi] = useState<AdminPoi | null>(null);
  const [audience, setAudience] = useState<CampaignAudience>({ kind: 'user', userId: '' });
  const [user, setUser] = useState<AdminUserRow | null>(null);
  const [channels, setChannels] = useState<CampaignChannels>({ push: true, inbox: true });
  const [schedule, setSchedule] = useState<ScheduleValue>(SCHEDULE_NOW);
  const [showErrors, setShowErrors] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');

  // sem Firebase no servidor, push começa desligado (dá pra ligar, mas não chega)
  useEffect(() => {
    if (history.data && !pushEnabled) setChannels((c) => ({ ...c, push: false }));
  }, [history.data, pushEnabled]);

  const target = useMemo(() => buildTarget(targetKind, event, poi), [targetKind, event, poi]);
  const errors = validateComposer({ title, body, audience, channels, target });
  const sched = scheduleToIso(schedule);
  const preview = useAudiencePreview(audience);
  // o servidor conta de novo na hora de enviar: se mudou, ele devolve 409 com o número certo
  const [serverCount, setServerCount] = useState<number | null>(null);
  const count = serverCount ?? preview.data?.targetCount ?? null;
  const big = count != null && (serverCount != null || needsTypedConfirmation(audience, count));

  const send = useMutation({
    mutationFn: () => {
      const payload: CreateCampaignPayload = { title: title.trim(), body: body.trim(), target, audience, channels, scheduledAt: sched.iso };
      if (big && count != null) payload.confirmCount = count;
      return adminApi.createCampaign(payload);
    },
    onError: (e) => {
      const n = isHttpError(e) ? confirmCountFromError(e.status, e.body) : null;
      if (n != null) {
        setServerCount(n);
        setTyped('');
      }
    },
    onSuccess: (c) => {
      toast.success(c.status === 'scheduled' ? 'Campanha agendada' : 'Campanha enviada');
      void qc.invalidateQueries({ queryKey: qk.campaigns });
      void qc.invalidateQueries({ queryKey: qk.stats });
      setConfirming(false);
      setTitle('');
      setBody('');
      setTargetKind('none');
      setSchedule(SCHEDULE_NOW);
      setShowErrors(false);
    },
  });

  const review = () => {
    setShowErrors(true);
    if (hasErrors(errors) || sched.error || count == null) return;
    setTyped('');
    setServerCount(null);
    send.reset();
    setConfirming(true);
  };

  return (
    <div className="content">
      <PageHeader title="Notificações" sub="Push no celular e avisos na central do app. Use com carinho: aviso demais vira silêncio." />

      {history.data && !pushEnabled ? (
        <div className="banner banner-warning" role="status">
          <AlertTriangle size={18} />
          <div>
            <div className="strong">Push desligado: faltam as credenciais do Firebase no servidor</div>
            <div className="small muted">A central de avisos e o aviso ao vivo (app aberto) continuam funcionando.</div>
          </div>
        </div>
      ) : null}

      <Card>
        <CardHead title="Nova campanha" icon={<Megaphone size={16} />} />
        <form
          className="card-body composer"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            review();
          }}
        >
          <div className="stack-lg">
            <div className="stack">
              <TextField label="Título" required maxLength={CAMPAIGN_TITLE_MAX} showCounter value={title} onChange={(e) => setTitle(e.target.value)} error={showErrors ? errors.title : null} placeholder="Ex.: Sexta tem Metch Night no Sabiá" />
              <TextAreaField
                label="Texto"
                required
                maxLength={CAMPAIGN_BODY_MAX}
                showCounter
                rows={3}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                error={showErrors ? errors.body : null}
                placeholder="Curto e direto. Diga o que é e por que vale abrir."
              />
            </div>

            <div className="field">
              <span className="field-label" id="target-label">
                Ao tocar, abre
              </span>
              <OptionCards<TargetKind>
                labelledBy="target-label"
                value={targetKind}
                onChange={setTargetKind}
                options={[
                  { value: 'none', label: 'O app', icon: <Bell size={16} /> },
                  { value: 'map', label: 'Mapa', icon: <MapIcon size={16} /> },
                  { value: 'event', label: 'Evento', icon: <Calendar size={16} /> },
                  { value: 'place', label: 'Lugar', icon: <MapPin size={16} /> },
                  { value: 'premium', label: 'Premium', icon: <Sparkles size={16} /> },
                  { value: 'support', label: 'Suporte', icon: <Headphones size={16} /> },
                ]}
              />
              {targetKind === 'event' ? <EventSelect value={event?.id ?? null} onChange={setEvent} error={showErrors ? errors.target : null} /> : null}
              {targetKind === 'place' ? <PoiPicker value={poi} onChange={setPoi} error={showErrors ? errors.target : null} /> : null}
            </div>

            <div className="field">
              <span className="field-label">Quem recebe</span>
              <AudienceEditor
                value={audience}
                onChange={setAudience}
                kinds={['user', 'city', 'radius', 'premium', 'free', 'all']}
                selectedUser={user}
                onSelectedUser={setUser}
                showErrors={showErrors}
              />
            </div>

            <div className="field">
              <span className="field-label">Canais</span>
              <ChannelsEditor value={channels} onChange={setChannels} pushEnabled={pushEnabled} />
              {showErrors && errors.channels ? <span className="field-error">{errors.channels}</span> : null}
            </div>

            <ScheduleField value={schedule} onChange={setSchedule} showErrors={showErrors} />

            <div className="form-actions">
              <span className="small faint grow">Você revisa tudo antes de enviar.</span>
              <Button type="submit" variant="primary" icon={<Send size={16} />} disabled={count == null && !preview.isError}>
                Revisar e enviar
              </Button>
            </div>
          </div>

          <aside className="stack composer-side">
            <NotificationPreview title={title} body={body} target={target} />
            <AudiencePreview preview={preview} channels={channels} />
            <div className="small muted">
              <Smartphone size={13} aria-hidden="true" /> Dica: mande primeiro pra “Uma pessoa” (você mesmo) pra ver como chega.
            </div>
          </aside>
        </form>
      </Card>

      <CampaignHistory history={history} />

      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        size="md"
        icon={<Send size={20} />}
        iconTone="accent"
        title={schedule.mode === 'now' ? 'Enviar campanha agora?' : 'Agendar campanha?'}
        description="Depois de enviada não dá pra desfazer."
        busy={send.isPending}
        onSubmit={() => {
          if (!big || (count != null && confirmationMatches(typed, count))) send.mutate();
        }}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)} disabled={send.isPending}>
              Voltar e editar
            </Button>
            <Button type="submit" variant="primary" loading={send.isPending} disabled={big && !(count != null && confirmationMatches(typed, count))}>
              {schedule.mode === 'now' ? `Enviar pra ${formatNumber(count ?? 0)}` : 'Agendar'}
            </Button>
          </>
        }
      >
        <dl className="kv">
          <dt>Título</dt>
          <dd className="strong">{title}</dd>
          <dt>Ao tocar</dt>
          <dd>{describeTarget(target)}</dd>
          <dt>Público</dt>
          <dd>{audience.kind === 'user' && user ? `${user.name} (${user.phone ?? user.id})` : describeAudience(audience)}</dd>
          <dt>Pessoas</dt>
          <dd className="num strong">{formatNumber(count ?? 0)}</dd>
          <dt>Canais</dt>
          <dd>{describeChannels(channels)}</dd>
          <dt>Quando</dt>
          <dd>{schedule.mode === 'now' ? 'Agora' : `${formatDateTime(sched.iso)} (Brasília)`}</dd>
        </dl>
        {channels.push && !pushEnabled ? (
          <div className="banner banner-warning">
            <AlertTriangle size={16} /> Push está desligado no servidor: só a central de avisos vai funcionar.
          </div>
        ) : null}
        {big ? (
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
        {send.isError ? (
          serverCount != null ? (
            <div className="banner banner-warning" role="alert">
              <AlertTriangle size={16} /> O público mudou desde a prévia: agora são <span className="num strong">{formatNumber(serverCount)}</span> pessoas. Confira e digite o número de novo.
            </div>
          ) : (
            <div className="banner banner-danger" role="alert">
              {errorMessage(send.error)}
            </div>
          )
        ) : null}
      </Dialog>
    </div>
  );
}
