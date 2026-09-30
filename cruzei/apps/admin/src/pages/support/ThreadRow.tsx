import { Link } from 'react-router';
import type { SupportThreadSummary } from '@cruzei/shared-types';
import { formatRelative } from '@/lib/format';
import { isUrgentOpen, isWaitingStaff } from '@/lib/support';
import { Avatar } from '@/components/ui/Avatar';
import { Badge, CountPill } from '@/components/ui/Badge';

export function ThreadRow({ thread: t, active, meId }: { thread: SupportThreadSummary; active: boolean; meId: string }) {
  const waiting = isWaitingStaff(t);
  // botão de emergência ainda sem resolver: selo vermelho e topo da fila (o servidor e o sortThreads já põem em cima)
  const urgent = isUrgentOpen(t);
  const last = t.lastMessage;
  const prefix = last?.author === 'staff' ? 'Equipe: ' : '';
  return (
    <Link
      to={`/suporte/${t.id}`}
      className="thread-row"
      data-active={active}
      data-waiting={waiting}
      data-urgent={urgent}
      aria-current={active ? 'true' : undefined}
      aria-label={urgent ? `URGENTE: ${t.user.name}` : undefined}
    >
      <Avatar name={t.user.name} url={t.user.avatarUrl} size={40} premium={t.user.premiumTier !== 'free'} />
      <span className="grow" style={{ minWidth: 0 }}>
        <span className="row">
          {urgent ? (
            <Badge tone="danger" title={t.urgentAt ? `Emergência ${formatRelative(t.urgentAt)}` : 'Emergência'}>
              🆘 URGENTE
            </Badge>
          ) : null}
          <span className="strong truncate">{t.user.name}</span>
          {t.user.accountStatus !== 'active' ? <span className="xsmall text-danger">({t.user.accountStatus === 'banned' ? 'banida' : 'suspensa'})</span> : null}
          <span className="spacer" />
          <span className="xsmall faint nowrap">{formatRelative(t.lastMessageAt)}</span>
        </span>
        <span className="row">
          <span className="small muted truncate grow">{last ? `${prefix}${last.body}` : 'Sem mensagens'}</span>
          <CountPill n={t.staffUnread} tone={urgent ? 'danger' : 'accent'} label={`${t.staffUnread} não lidas`} />
        </span>
        <span className="xsmall faint truncate">
          {t.assignedTo ? (t.assignedTo.id === meId ? 'com você' : `com ${t.assignedTo.name}`) : 'sem atribuição'}
          {urgent && t.urgentAt ? ` · emergência ${formatRelative(t.urgentAt)}` : ''}
          {t.waitingSince ? ` · esperando ${formatRelative(t.waitingSince)}` : waiting && !t.staffUnread ? ' · esperando resposta' : ''}
        </span>
      </span>
    </Link>
  );
}
