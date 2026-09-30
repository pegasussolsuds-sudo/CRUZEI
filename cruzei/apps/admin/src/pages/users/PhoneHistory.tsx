// Número reciclado na ficha: badge "Número liberado em dd/mm" e o card "Histórico do número" — as vezes em que o
// número saiu desta conta e, na conta nova, de qual conta ele veio. Telefone inteiro e links só pra admin.
import { Link } from 'react-router';
import { ArrowDownLeft, ArrowUpRight, PhoneOff } from 'lucide-react';
import type { AdminPhoneRelease, AdminUserDetail, PhoneReleaseReason } from '@cruzei/shared-types';
import { formatDate, formatDateTime } from '@/lib/format';
import { AccountStatusBadge } from '@/components/badges';
import { Badge } from '@/components/ui/Badge';
import { Card, CardHead } from '@/components/ui/Card';

const REASON_LABEL: Record<PhoneReleaseReason, string> = {
  not_mine: '"Não é minha" no login',
  birthdate_mismatch: 'Errou a data de nascimento',
  account_deleted: 'Conta excluída',
  admin: 'Liberado pelo painel',
};

/** badge do topo da ficha e da lista */
export function ReleasedBadge({ at, short = false }: { at: string | null | undefined; short?: boolean }) {
  if (!at) return null;
  return (
    <Badge tone="warning" icon={<PhoneOff />} title={`Número liberado em ${formatDateTime(at)}`}>
      {short ? 'liberado' : `Número liberado em ${formatDate(at)}`}
    </Badge>
  );
}

export function PhoneHistory({ u, isAdmin }: { u: AdminUserDetail; isAdmin: boolean }) {
  const items = u.phoneReleases ?? [];
  if (!items.length) return null;
  return (
    <Card>
      <CardHead title="Histórico do número" icon={<PhoneOff size={16} />} />
      <ul className="list">
        {items.map((r, i) => (
          <Item key={`${r.releasedAt}-${i}`} r={r} isAdmin={isAdmin} />
        ))}
      </ul>
    </Card>
  );
}

function Item({ r, isAdmin }: { r: AdminPhoneRelease; isAdmin: boolean }) {
  const incoming = !!r.incoming;
  return (
    <li className="sub-item">
      <div className="row row-wrap">
        {incoming ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}
        <span className="strong">{incoming ? 'Número veio de outra conta' : 'Número saiu desta conta'}</span>
        <span className="spacer" />
        <span className="xsmall faint">{formatDateTime(r.releasedAt)}</span>
      </div>
      <div className="row row-wrap small">
        <span className="num">{r.phone ?? '—'}</span>
        <Badge tone="outline">{REASON_LABEL[r.reason] ?? r.reason}</Badge>
        <span className="xsmall faint">conta antiga:</span>
        <AccountStatusBadge status={r.accountStatus} />
      </div>
      <div className="xsmall faint row row-wrap">
        {r.releasedBy ? (
          isAdmin ? (
            <Link to={`/usuarios/${r.releasedBy.id}`}>por {r.releasedBy.name}</Link>
          ) : (
            <span>por {r.releasedBy.name}</span>
          )
        ) : (
          <span>pelo app</span>
        )}
        {incoming ? (
          isAdmin && r.oldUserId ? <Link to={`/usuarios/${r.oldUserId}`}>ver a conta antiga</Link> : null
        ) : r.newUserId ? (
          <Link to={`/usuarios/${r.newUserId}`}>ver a conta nova</Link>
        ) : isAdmin ? (
          <span>ninguém criou conta com ele ainda</span>
        ) : null}
      </div>
    </li>
  );
}
