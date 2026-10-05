// Exclusão da conta na ficha: badge do topo ("Exclusão pedida" / "Conta limpa") e o card com os pedidos (prazo,
// motivo, bloqueio da limpeza). Último erro da limpeza só vem pra admin.
import { Trash2 } from 'lucide-react';
import { DELETION_REASON_LABELS, type AdminDeletionRequest, type AdminUserDetail, type DeletionReason } from '@cruzei/shared-types';
import { formatDate, formatDateTime } from '@/lib/format';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Card, CardHead } from '@/components/ui/Card';

const STATUS: Record<AdminDeletionRequest['status'], { label: string; tone: BadgeTone }> = {
  pending: { label: 'No prazo', tone: 'warning' },
  cancelled: { label: 'Cancelado', tone: 'outline' },
  completed: { label: 'Concluído', tone: 'danger' },
};

const SOURCE: Record<AdminDeletionRequest['source'], string> = {
  app: 'pelo app',
  support: 'pelo suporte',
  admin: 'pelo painel',
};

const HOLD: Record<NonNullable<AdminDeletionRequest['holdReason']>, string> = {
  open_reports: 'limpeza esperando a decisão de denúncia em análise',
  review_hold: 'limpeza esperando o fim da revisão da conta',
};

function reasonLabel(r: string | null): string | null {
  if (!r) return null;
  return DELETION_REASON_LABELS[r as DeletionReason] ?? r;
}

/** badge do topo da ficha */
export function DeletionBadge({ u }: { u: AdminUserDetail }) {
  if (u.purgedAt) {
    return (
      <Badge tone="danger" icon={<Trash2 />} title={`Limpeza definitiva em ${formatDateTime(u.purgedAt)}`}>
        Conta limpa em {formatDate(u.purgedAt)}
      </Badge>
    );
  }
  if (!u.deletedAt) return null;
  const pending = u.deletionRequests?.find((d) => d.status === 'pending');
  return (
    <Badge tone="warning" icon={<Trash2 />} title={`Exclusão pedida em ${formatDateTime(u.deletedAt)}`}>
      {pending ? `Exclusão pedida · limpa em ${formatDate(pending.scheduledFor)}` : 'Conta excluída'}
    </Badge>
  );
}

export function DeletionHistory({ u }: { u: AdminUserDetail }) {
  const items = u.deletionRequests ?? [];
  if (!items.length) return null;
  return (
    <Card>
      <CardHead title="Exclusão da conta" icon={<Trash2 size={16} />} />
      <ul className="list">
        {items.map((d) => (
          <Item key={d.requestedAt} d={d} />
        ))}
      </ul>
    </Card>
  );
}

function Item({ d }: { d: AdminDeletionRequest }) {
  const st = STATUS[d.status] ?? { label: d.status, tone: 'outline' as BadgeTone };
  const reason = reasonLabel(d.reason);
  return (
    <li className="sub-item">
      <div className="row row-wrap">
        <span className="strong">Pedido {SOURCE[d.source] ?? d.source}</span>
        <Badge tone={st.tone}>{st.label}</Badge>
        <span className="spacer" />
        <span className="xsmall faint">{formatDateTime(d.requestedAt)}</span>
      </div>
      <div className="row row-wrap small">
        {d.status === 'pending' ? <span>limpeza a partir de {formatDateTime(d.scheduledFor)}</span> : null}
        {d.status === 'cancelled' ? <span>cancelado em {formatDateTime(d.cancelledAt)}</span> : null}
        {d.status === 'completed' ? <span>limpo em {formatDateTime(d.completedAt)}</span> : null}
        {reason ? <Badge tone="outline">{reason}</Badge> : null}
      </div>
      {d.holdReason && d.status === 'pending' ? <div className="xsmall faint">{HOLD[d.holdReason] ?? d.holdReason}</div> : null}
      {d.attempts > 0 && d.status === 'pending' ? (
        <div className="xsmall faint">
          {d.attempts} {d.attempts === 1 ? 'tentativa com erro' : 'tentativas com erro'}
          {d.lastError ? `: ${d.lastError}` : ''}
        </div>
      ) : null}
    </li>
  );
}
