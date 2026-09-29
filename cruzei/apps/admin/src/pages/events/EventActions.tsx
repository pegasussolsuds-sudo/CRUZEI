// Ações de evento (publicar, cancelar, apagar rascunho, avisar) com confirmação — na lista e no formulário.
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Ban, Megaphone, Rocket, Trash2 } from 'lucide-react';
import type { AdminEvent } from '@cruzei/shared-types';
import { adminApi } from '@/api/admin';
import { qk } from '@/api/keys';
import { useMe } from '@/auth/AuthProvider';
import { eventPhase } from '@/lib/events';
import { hasPermission } from '@/lib/permissions';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { AnnounceDialog } from './AnnounceDialog';

type Pending = 'publish' | 'cancel' | 'delete' | 'announce' | null;

export function EventActions({ event, size = 'sm', afterDelete, beforePublish }: { event: AdminEvent; size?: 'sm' | 'md'; afterDelete?: () => void; beforePublish?: () => Promise<boolean> }) {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [pending, setPending] = useState<Pending>(null);
  const phase = eventPhase(event);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.eventsAll });
    void qc.invalidateQueries({ queryKey: qk.event(event.id) });
    void qc.invalidateQueries({ queryKey: qk.stats });
    void qc.invalidateQueries({ queryKey: ['event-select'] });
  };

  const canAnnounce = hasPermission(me, 'events.push') && event.status === 'published' && (phase === 'upcoming' || phase === 'live');

  return (
    <>
      {event.status === 'draft' ? (
        <Button size={size} variant="primary" icon={<Rocket size={14} />} onClick={() => setPending('publish')}>
          Publicar
        </Button>
      ) : null}
      {canAnnounce ? (
        <Button size={size} icon={<Megaphone size={14} />} onClick={() => setPending('announce')}>
          Avisar
        </Button>
      ) : null}
      {event.status === 'published' && phase !== 'past' ? (
        <Button size={size} variant="danger-soft" icon={<Ban size={14} />} onClick={() => setPending('cancel')}>
          Cancelar evento
        </Button>
      ) : null}
      {event.status === 'draft' ? (
        <Button size={size} variant="ghost" icon={<Trash2 size={14} />} onClick={() => setPending('delete')}>
          Apagar
        </Button>
      ) : null}

      <ConfirmDialog
        open={pending === 'publish'}
        onClose={() => setPending(null)}
        tone="primary"
        icon={<Rocket size={20} />}
        title={`Publicar “${event.title}”?`}
        description="O evento entra no mapa do app como lugar de evento até terminar."
        confirmLabel="Publicar agora"
        onConfirm={async () => {
          if (beforePublish && !(await beforePublish())) throw new Error('Corrija o formulário antes de publicar.');
          await adminApi.publishEvent(event.id);
          toast.success('Evento publicado');
          refresh();
        }}
      />
      <ConfirmDialog
        open={pending === 'cancel'}
        onClose={() => setPending(null)}
        icon={<Ban size={20} />}
        title={`Cancelar “${event.title}”?`}
        description="Some do mapa na hora. Quem recebeu aviso não é avisado do cancelamento automaticamente."
        confirmLabel="Cancelar evento"
        onConfirm={async () => {
          await adminApi.cancelEvent(event.id);
          toast.success('Evento cancelado');
          refresh();
        }}
      />
      <ConfirmDialog
        open={pending === 'delete'}
        onClose={() => setPending(null)}
        icon={<Trash2 size={20} />}
        title={`Apagar o rascunho “${event.title}”?`}
        description="Não dá pra desfazer."
        confirmLabel="Apagar rascunho"
        onConfirm={async () => {
          await adminApi.deleteEvent(event.id);
          toast.success('Rascunho apagado');
          refresh();
          if (afterDelete) afterDelete();
          else navigate('/eventos?aba=drafts');
        }}
      />
      {pending === 'announce' ? <AnnounceDialog event={event} open onClose={() => setPending(null)} /> : null}
    </>
  );
}
