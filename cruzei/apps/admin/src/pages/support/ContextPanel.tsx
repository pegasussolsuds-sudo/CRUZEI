// Contexto pra atender bem: conta, plano, denúncias, aparelho e atalhos.
import { Link } from 'react-router';
import { ExternalLink, Flag, Sparkles, X } from 'lucide-react';
import type { SupportThreadDetail } from '@cruzei/shared-types';
import { useMe } from '@/auth/AuthProvider';
import { formatDate, formatMinutes, formatRelative } from '@/lib/format';
import { hasPermission } from '@/lib/permissions';
import { AccountStatusBadge, TierBadge } from '@/components/badges';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { CopyId } from '@/components/ui/misc';

export function ContextPanel({ thread: t, open, onClose }: { thread: SupportThreadDetail; open: boolean; onClose: () => void }) {
  const me = useMe();
  const c = t.context;
  return (
    <aside className="support-context" data-open={open} aria-label="Contexto da pessoa">
      <div className="row">
        <span className="eyebrow">Quem é</span>
        <span className="spacer" />
        <button type="button" className="btn btn-ghost btn-sm btn-icon context-close" onClick={onClose} aria-label="Fechar contexto">
          <X size={16} />
        </button>
      </div>
      <div className="context-person">
        <Avatar name={t.user.name} url={t.user.avatarUrl} size={64} premium={t.user.premiumTier !== 'free'} />
        <div className="strong" style={{ fontSize: 'var(--text-lg)' }}>
          {t.user.name}
        </div>
        <div className="row row-wrap" style={{ justifyContent: 'center' }}>
          <AccountStatusBadge status={t.user.accountStatus} />
          <TierBadge tier={t.user.premiumTier} />
        </div>
        <CopyId id={t.user.id} />
      </div>

      <dl className="kv">
        <dt>Conta desde</dt>
        <dd>{formatDate(c.createdAt)}</dd>
        <dt>Visto</dt>
        <dd>{formatRelative(c.lastActiveAt)}</dd>
        <dt>Plano</dt>
        <dd>{t.user.premiumTier === 'free' ? 'Grátis' : c.premiumExpiresAt ? `vence ${formatDate(c.premiumExpiresAt)}` : 'sem vencimento'}</dd>
        <dt>App</dt>
        <dd className="num">{c.appVersion ? `v${c.appVersion}` : '—'}</dd>
        <dt>Denúncias</dt>
        <dd>
          {c.reportsAgainst ? (
            <Badge tone="danger" icon={<Flag />}>
              {c.reportsAgainst} contra
            </Badge>
          ) : (
            'nenhuma'
          )}
        </dd>
        <dt>Atendimentos</dt>
        <dd>{c.pastThreads ? `${c.pastThreads} antes deste` : 'primeiro'}</dd>
        <dt>1ª resposta</dt>
        <dd>{t.firstResponseMinutes == null ? <span className="text-warning">ainda sem resposta</span> : formatMinutes(t.firstResponseMinutes)}</dd>
      </dl>

      <div className="col">
        <Link to={`/usuarios/${t.user.id}`} className="btn btn-secondary btn-sm btn-block">
          <ExternalLink size={14} /> Abrir ficha completa
        </Link>
        {hasPermission(me, 'users.premium') ? (
          <Link to={`/usuarios/${t.user.id}`} className="btn btn-ghost btn-sm btn-block">
            <Sparkles size={14} /> Premium manual na ficha
          </Link>
        ) : null}
        {c.reportsAgainst && hasPermission(me, 'users.moderate') ? (
          <Link to="/moderacao" className="btn btn-ghost btn-sm btn-block">
            <Flag size={14} /> Ver fila de denúncias
          </Link>
        ) : null}
      </div>
    </aside>
  );
}
