// Criar/editar/duplicar evento: dados, datas (Brasília), capa, lugar (ligado a um lugar existente ou ponto no mapa).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker, useNavigate, useParams, useSearchParams, type BlockerFunction } from 'react-router';
import { useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { ImageOff, LogOut, Save, Unlink } from 'lucide-react';
import type { AdminEvent, AdminEventList, AdminPoi, EventCategory } from '@cruzei/shared-types';
import { adminApi } from '@/api/admin';
import { qk } from '@/api/keys';
import { errorMessage, isHttpError } from '@/api/http';
import { localInputFromNow } from '@/lib/datetime';
import {
  duplicateEventForm,
  EMPTY_EVENT_FORM,
  EVENT_DESCRIPTION_MAX,
  EVENT_TITLE_MAX,
  eventFormToPayload,
  eventPhase,
  eventToForm,
  isHttpUrl,
  validateEventForm,
  type EventFormValues,
} from '@/lib/events';
import { formatDateTime } from '@/lib/format';
import { EVENT_CATEGORIES, EVENT_CATEGORY_LABEL, EVENT_STATUS_LABEL } from '@/lib/labels';
import { EventPhaseBadge } from '@/components/badges';
import { MapPointField, PoiPicker } from '@/components/pickers';
import { Button } from '@/components/ui/Button';
import { Card, CardHead } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field';
import { ErrorState, Skeleton } from '@/components/ui/States';
import { PageHeader } from '@/components/ui/misc';
import { useToast } from '@/components/ui/Toast';
import { EventActions } from './EventActions';

/** evento já visto (numa lista ou aberto antes) aparece na hora; o GET confirma em seguida */
function useCachedEvent(id: string | null): AdminEvent | undefined {
  const qc = useQueryClient();
  return useMemo(() => {
    if (!id) return undefined;
    const one = qc.getQueryData<AdminEvent>(qk.event(id));
    if (one) return one;
    for (const [, data] of qc.getQueriesData<InfiniteData<AdminEventList>>({ queryKey: qk.eventsAll })) {
      const hit = data?.pages.flatMap((p) => p.items).find((e) => e.id === id);
      if (hit) return hit;
    }
    return undefined;
  }, [id, qc]);
}

export default function EventFormPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  // /eventos/novo?duplicar=<id>: formulário novo preenchido a partir de outro evento
  const duplicateOf = id ? null : params.get('duplicar');
  const loadId = id ?? duplicateOf ?? null;
  const cached = useCachedEvent(loadId);

  const event = useQuery({
    queryKey: qk.event(loadId ?? ''),
    queryFn: () => adminApi.event(loadId ?? ''),
    enabled: !!loadId,
    initialData: cached,
    initialDataUpdatedAt: 0,
  });

  if (loadId && !event.data) {
    return (
      <div className="content">
        <PageHeader title={duplicateOf ? 'Duplicar evento' : 'Evento'} back={{ to: '/eventos', label: 'Eventos' }} />
        {event.isError ? (
          <div className="card">
            <ErrorState error={event.error} title={isHttpError(event.error, 404) ? 'Evento não encontrado' : undefined} onRetry={() => void event.refetch()} />
          </div>
        ) : (
          <div className="event-form">
            <Skeleton height={520} radius={16} />
            <Skeleton height={520} radius={16} />
          </div>
        )}
      </div>
    );
  }

  if (duplicateOf) return <EventForm key={`copia-${duplicateOf}`} event={null} copyFrom={event.data ?? null} />;
  return <EventForm key={event.data?.id ?? 'novo'} event={event.data ?? null} copyFrom={null} />;
}

function EventForm({ event, copyFrom }: { event: AdminEvent | null; copyFrom: AdminEvent | null }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<EventFormValues>(() =>
    event
      ? eventToForm(event)
      : copyFrom
        ? duplicateEventForm(copyFrom)
        : { ...EMPTY_EVENT_FORM, startsAt: localInputFromNow(24 * 60), endsAt: localInputFromNow(28 * 60) },
  );
  const [poi, setPoi] = useState<AdminPoi | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [coverBroken, setCoverBroken] = useState(false);
  // cópia já nasce com conteúdo não salvo
  const [dirty, setDirty] = useState(!!copyFrom);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  useEffect(() => setCoverBroken(false), [form.coverUrl]);

  // sair com alteração sem salvar: o navegador pergunta (fechar/recarregar a aba)…
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  // …e a navegação dentro do painel também (menu, voltar, links). Lê a ref: logo depois de salvar/apagar, o navigate
  // da mesma hora já passa (o estado "dirty" só muda na próxima renderização)
  const shouldBlock = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) =>
      dirtyRef.current && (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search),
    [],
  );
  const blocker = useBlocker(shouldBlock);
  const leaving = useRef(false);
  /** navegar sem perguntar (acabou de salvar ou apagar) */
  const navigateClean = (to: string, replace = false) => {
    dirtyRef.current = false;
    navigate(to, { replace });
  };

  // lugar ligado: carrega pelo poiId (ao editar um evento ligado, o lugar aparece e dá pra desligar)
  const linkedId = form.poiId;
  const linked = useQuery({
    queryKey: qk.poi(linkedId ?? ''),
    queryFn: async () => (await adminApi.pois(linkedId ?? '')).items.find((p) => p.id === linkedId) ?? null,
    enabled: !!linkedId && poi?.id !== linkedId,
    staleTime: 60_000,
  });
  const shownPoi = !linkedId ? null : poi?.id === linkedId ? poi : (linked.data ?? null);

  const set = <K extends keyof EventFormValues>(k: K, v: EventFormValues[K]) => {
    setDirty(true);
    setForm((f) => ({ ...f, [k]: v }));
  };

  const errors = validateEventForm(form, { isNew: !event });
  const valid = !Object.values(errors).some(Boolean);
  const readOnly = event?.status === 'cancelled';

  const save = useMutation({
    mutationFn: () => {
      const payload = eventFormToPayload(form);
      return event ? adminApi.updateEvent(event.id, payload) : adminApi.createEvent(payload);
    },
    onSuccess: (saved) => {
      setDirty(false);
      dirtyRef.current = false;
      qc.setQueryData(qk.event(saved.id), saved);
      void qc.invalidateQueries({ queryKey: qk.eventsAll });
      void qc.invalidateQueries({ queryKey: ['event-select'] });
      toast.success(event ? 'Evento salvo' : 'Rascunho criado. Publique quando estiver pronto.');
      if (!event) navigateClean(`/eventos/${saved.id}`, true);
    },
  });

  const submit = () => {
    setShowErrors(true);
    if (valid && !readOnly) save.mutate();
  };

  /** antes de publicar: salva o que mudou (publicar evento com formulário velho seria confuso) */
  const beforePublish = async (): Promise<boolean> => {
    setShowErrors(true);
    if (!valid) return false;
    if (dirty) await save.mutateAsync();
    return true;
  };

  const pickPoi = (p: AdminPoi | null) => {
    setPoi(p);
    if (!p) {
      set('poiId', null);
      return;
    }
    setDirty(true);
    setForm((f) => ({
      ...f,
      poiId: p.id,
      lat: p.lat,
      lng: p.lng,
      venueName: f.venueName || p.name,
      address: f.address || p.address || '',
      city: f.city || p.city || '',
    }));
  };

  const phase = event ? eventPhase(event) : null;
  const poiHint = !linkedId
    ? 'Liga o evento a um lugar que já está no mapa e preenche o endereço.'
    : shownPoi
      ? 'Ligado a esse lugar do Metch. Pra trocar, desligue e busque outro.'
      : linked.isPending
        ? 'Carregando o lugar ligado…'
        : `Ligado a um lugar que não foi encontrado (id ${linkedId}). Desligue ou busque outro.`;

  return (
    <div className="content">
      <PageHeader
        title={event ? event.title : copyFrom ? `Novo evento (cópia de “${copyFrom.title}”)` : 'Novo evento'}
        tabTitle={event ? `${event.title} · Eventos` : 'Novo evento'}
        back={{ to: '/eventos', label: 'Eventos' }}
        sub={
          event ? (
            <span className="row row-wrap">
              {phase ? <EventPhaseBadge phase={phase} /> : null}
              <span>
                {EVENT_STATUS_LABEL[event.status]}
                {event.createdBy ? ` · criado por ${event.createdBy.name}` : ''}
                {event.publishedAt ? ` · publicado ${formatDateTime(event.publishedAt)}` : ''}
              </span>
            </span>
          ) : copyFrom ? (
            'Cópia com as datas uma semana depois. Confere tudo e salve: começa como rascunho.'
          ) : (
            'Começa como rascunho: só aparece no app depois de publicar.'
          )
        }
        actions={event ? <EventActions event={event} size="md" beforePublish={beforePublish} afterDelete={() => navigateClean('/eventos?aba=drafts')} /> : null}
      />

      {readOnly ? <div className="banner banner-warning">Evento cancelado: não dá mais pra editar.</div> : null}

      <form
        className="event-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        noValidate
      >
        <fieldset disabled={readOnly} className="stack-lg" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <Card>
            <CardHead title="Sobre o evento" />
            <div className="card-body form-grid">
              <TextField
                label="Nome do evento"
                required
                fieldClassName="span-2"
                maxLength={EVENT_TITLE_MAX}
                showCounter
                value={form.title}
                onChange={(e) => set('title', e.target.value)}
                error={showErrors ? errors.title : null}
                placeholder="Ex.: Sunset no Parque do Sabiá"
                autoFocus={!event}
              />
              <SelectField label="Categoria" value={form.category} onChange={(e) => set('category', e.target.value as EventCategory)}>
                {EVENT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {EVENT_CATEGORY_LABEL[c]}
                  </option>
                ))}
              </SelectField>
              <div />
              <TextField label="Começa" type="datetime-local" required value={form.startsAt} onChange={(e) => set('startsAt', e.target.value)} error={showErrors ? errors.startsAt : null} hint="Horário de Brasília" />
              <TextField label="Termina" type="datetime-local" required value={form.endsAt} onChange={(e) => set('endsAt', e.target.value)} error={showErrors ? errors.endsAt : null} hint="Horário de Brasília" />
              <TextAreaField
                label="Descrição"
                fieldClassName="span-2"
                rows={5}
                maxLength={EVENT_DESCRIPTION_MAX}
                showCounter
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                error={showErrors ? errors.description : null}
                placeholder="O que vai rolar, atrações, valor da entrada…"
              />
            </div>
          </Card>

          <Card>
            <CardHead title="Capa" />
            <div className="card-body cover-row">
              <TextField
                label="Link da imagem"
                type="url"
                fieldClassName="grow"
                value={form.coverUrl}
                onChange={(e) => set('coverUrl', e.target.value)}
                error={showErrors ? errors.coverUrl : null}
                placeholder="https://…/capa.jpg"
                hint="Imagem horizontal (16:9) fica melhor no app."
              />
              <div className="cover-preview thumb" aria-label="Prévia da capa">
                {form.coverUrl && isHttpUrl(form.coverUrl) && !coverBroken ? (
                  <img src={form.coverUrl} alt="" onError={() => setCoverBroken(true)} />
                ) : (
                  <div className="state state-compact xsmall">
                    <ImageOff size={18} aria-hidden="true" />
                    {coverBroken ? 'Não abriu essa imagem' : 'Sem capa'}
                  </div>
                )}
              </div>
            </div>
          </Card>
        </fieldset>

        <fieldset disabled={readOnly} className="stack-lg" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <Card>
            <CardHead title="Onde" />
            <div className="card-body stack">
              <PoiPicker label="Lugar do Metch (opcional)" value={shownPoi} onChange={pickPoi} hint={poiHint} />
              {linkedId ? (
                <div>
                  <Button size="sm" variant="ghost" icon={<Unlink size={14} />} onClick={() => pickPoi(null)}>
                    Desligar do lugar
                  </Button>
                </div>
              ) : null}
              <TextField label="Nome do local" maxLength={120} value={form.venueName} onChange={(e) => set('venueName', e.target.value)} placeholder="Ex.: Parque do Sabiá" />
              <MapPointField
                label="Ponto no mapa"
                value={form.lat != null && form.lng != null ? { lat: form.lat, lng: form.lng } : null}
                onChange={(p) => {
                  setDirty(true);
                  setForm((f) => ({ ...f, lat: p.lat, lng: p.lng }));
                }}
                error={showErrors ? errors.where : null}
                height={300}
              />
              <div className="form-grid">
                <TextField label="Endereço" maxLength={200} value={form.address} onChange={(e) => set('address', e.target.value)} />
                <TextField label="Cidade" maxLength={80} value={form.city} onChange={(e) => set('city', e.target.value)} hint="Usada no aviso por cidade." />
              </div>
            </div>
          </Card>

          <div className="form-actions">
            {save.isError ? (
              <div className="banner banner-danger grow" role="alert">
                {errorMessage(save.error)}
              </div>
            ) : showErrors && !valid ? (
              <div className="small text-danger grow" role="alert">
                Confere os campos marcados.
              </div>
            ) : (
              <span className="small faint grow">{dirty ? 'Alterações não salvas' : event ? 'Tudo salvo' : ''}</span>
            )}
            <Button variant="ghost" onClick={() => navigate('/eventos')}>
              Voltar
            </Button>
            <Button type="submit" variant={event ? 'primary' : 'secondary'} icon={<Save size={16} />} loading={save.isPending} disabled={readOnly || (!!event && !dirty)}>
              {event ? 'Salvar alterações' : 'Salvar rascunho'}
            </Button>
          </div>
        </fieldset>
      </form>

      <ConfirmDialog
        open={blocker.state === 'blocked'}
        onClose={() => {
          if (!leaving.current) blocker.reset?.();
        }}
        icon={<LogOut size={20} />}
        title="Sair sem salvar?"
        description="As alterações deste evento ainda não foram salvas e vão se perder."
        confirmLabel="Sair sem salvar"
        onConfirm={() => {
          leaving.current = true;
          blocker.proceed?.();
        }}
      />
    </div>
  );
}
