// Ficha completa: perfil e fotos (da ficha de moderação), situação, plano, assinaturas, aparelhos,
// números, denúncias, histórico e suporte — com as ações que o papel de quem está logado permite.
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  Ban,
  BellRing,
  CheckCheck,
  Flag,
  Headphones,
  Heart,
  MessageCircle,
  PauseCircle,
  PhoneOff,
  RotateCcw,
  ShieldCheck,
  ShieldOff,
  Smartphone,
  Sparkles,
  UserX,
  Zap,
} from 'lucide-react';
import type { AdminUserDetail, ModerationDecision } from '@cruzei/shared-types';
import { adminApi } from '@/api/admin';
import { qk } from '@/api/keys';
import { isHttpError } from '@/api/http';
import { useMe } from '@/auth/AuthProvider';
import { formatDate, formatDateTime, formatNumber, formatRelative, formatShortDateTime, isNoExpiry } from '@/lib/format';
import { GENDER_LABEL, isOpenReport, moderationActionLabel, platformLabel, REPORT_REASON_LABEL, REPORT_SOURCE_LABEL, REPORT_STATUS_LABEL, subscriptionState, TIER_LABEL, URGENT_REASONS } from '@/lib/labels';
import { canChangeRole, canModerateAccount, hasPermission } from '@/lib/permissions';
import { AccountStatusBadge, PhotoStatusBadge, RoleBadge, SupportStatusBadge, TierBadge } from '@/components/badges';
import { ModerationActionDialog } from '@/components/moderation/ModerationActionDialog';
import { PremiumDialog } from '@/components/moderation/PremiumDialog';
import { RoleDialog } from '@/components/moderation/RoleDialog';
import { PhotoDecisionButtons } from '@/components/moderation/PhotoDecision';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHead } from '@/components/ui/Card';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { CopyId, PageHeader } from '@/components/ui/misc';
import { convAnchor, openConversation, reportConversationIds } from '@/lib/report-context';
import { PhoneHistory, ReleasedBadge } from './PhoneHistory';
import { ReleasePhoneDialog } from './ReleasePhoneDialog';

type Dialogs = { kind: 'action'; action: ModerationDecision } | { kind: 'premium' } | { kind: 'role' } | { kind: 'release' } | null;

export default function UserDetailPage() {
  const { id = '' } = useParams();
  const me = useMe();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<Dialogs>(null);
  const user = useQuery({ queryKey: qk.user(id), queryFn: () => adminApi.user(id), enabled: !!id });

  if (user.isPending) {
    return (
      <div className="content">
        <PageHeader title="Carregando ficha…" tabTitle="Usuário" back={{ to: '/usuarios', label: 'Usuários' }} />
        <Skeleton height={160} radius={16} />
        <div className="detail-grid">
          <Skeleton height={320} radius={16} />
          <Skeleton height={320} radius={16} />
        </div>
      </div>
    );
  }
  if (user.isError) {
    return (
      <div className="content">
        <PageHeader title={isHttpError(user.error, 404) ? 'Conta não encontrada' : 'Ficha'} tabTitle="Usuário" back={{ to: '/usuarios', label: 'Usuários' }} />
        <div className="card">
          <ErrorState error={user.error} onRetry={() => void user.refetch()} />
        </div>
      </div>
    );
  }

  const u = user.data;
  const mod = u.moderation;
  const canModerate = canModerateAccount(me, u);
  // o número do servidor (só as pendentes): a lista da ficha é o histórico, com as já decididas
  const pendingReports = u.reportsPending;
  const openThread = u.supportThreads.find((t) => t.status !== 'resolved') ?? u.supportThreads[0] ?? null;

  const open = (action: ModerationDecision) => setDialog({ kind: 'action', action });

  return (
    <div className="content">
      <PageHeader title={u.name} tabTitle={`${u.name} · Usuários`} back={{ to: '/usuarios', label: 'Usuários' }} />

      <Card className="profile-hero">
        <div className="profile-hero-main">
          <Avatar name={u.name} url={mod.user.mainPhotoUrl ?? u.avatarUrl} size={88} premium={u.premiumTier !== 'free'} />
          <div className="grow stack" style={{ gap: 10 }}>
            <div className="row row-wrap">
              <h2 className="profile-name">
                {u.name}
                {u.age ? <span className="faint">, {u.age}</span> : null}
              </h2>
              <CopyId id={u.id} />
            </div>
            <div className="row row-wrap">
              <AccountStatusBadge status={u.accountStatus} until={u.suspendedUntil} />
              <TierBadge tier={u.premiumTier} />
              <RoleBadge role={u.role} />
              {u.visibilityMode === 'anonymous' ? <Badge tone="outline">Modo anônimo</Badge> : null}
              {mod.user.reviewHoldAt ? <Badge tone="warning">Em revisão desde {formatDate(mod.user.reviewHoldAt)}</Badge> : null}
              <ReleasedBadge at={u.phoneReleasedAt} />
              {pendingReports ? (
                <Badge tone="danger" icon={<Flag />}>
                  {pendingReports} {pendingReports === 1 ? 'denúncia pendente' : 'denúncias pendentes'}
                </Badge>
              ) : null}
            </div>
            <div className="profile-meta small muted">
              <span className="num">{u.phone ?? mod.user.phoneMasked ?? (u.phoneReleasedAt ? 'sem telefone (liberado)' : 'sem telefone')}</span>
              <span>{u.city ?? 'cidade não informada'}</span>
              <span>entrou {formatDate(u.createdAt)}</span>
              <span>visto {formatRelative(u.lastActiveAt)}</span>
            </div>
          </div>
        </div>
        <div className="profile-actions">
          {canModerate ? (
            <>
              {pendingReports ? (
                <Button size="sm" icon={<CheckCheck size={14} />} onClick={() => open('dismiss')}>
                  Dispensar denúncias
                </Button>
              ) : null}
              <Button size="sm" icon={<BellRing size={14} />} onClick={() => open('warn')}>
                Avisar
              </Button>
              {u.accountStatus === 'active' ? (
                <Button size="sm" variant="danger-soft" icon={<PauseCircle size={14} />} onClick={() => open('suspend')}>
                  Suspender
                </Button>
              ) : null}
              {u.accountStatus !== 'banned' ? (
                <Button size="sm" variant="danger-soft" icon={<Ban size={14} />} onClick={() => open('ban')}>
                  Banir
                </Button>
              ) : null}
              {u.accountStatus !== 'active' || mod.user.reviewHoldAt ? (
                <Button size="sm" variant="primary" icon={<RotateCcw size={14} />} onClick={() => open('reinstate')}>
                  Reativar
                </Button>
              ) : null}
            </>
          ) : hasPermission(me, 'users.moderate') ? (
            <span className="small faint row">
              <ShieldOff size={14} /> {me.id === u.id ? 'Essa é a sua conta.' : 'Só admin modera contas da equipe.'}
            </span>
          ) : null}
          {hasPermission(me, 'users.premium') ? (
            <Button size="sm" variant="premium" icon={<Sparkles size={14} />} onClick={() => setDialog({ kind: 'premium' })}>
              Premium
            </Button>
          ) : null}
          {canChangeRole(me, u.id) ? (
            <Button size="sm" icon={<ShieldCheck size={14} />} onClick={() => setDialog({ kind: 'role' })}>
              Papel
            </Button>
          ) : null}
          {/* número reciclado (caso de suporte): só admin, nunca a própria conta, só com número */}
          {me.role === 'admin' && me.id !== u.id && u.phone ? (
            <Button size="sm" variant="danger-soft" icon={<PhoneOff size={14} />} onClick={() => setDialog({ kind: 'release' })}>
              Liberar número
            </Button>
          ) : null}
          {hasPermission(me, 'support') ? (
            <Button
              size="sm"
              icon={<Headphones size={14} />}
              disabled={!openThread}
              title={openThread ? undefined : 'Essa pessoa ainda não abriu atendimento'}
              onClick={() => openThread && navigate(`/suporte/${openThread.id}`)}
            >
              Suporte
            </Button>
          ) : null}
        </div>
      </Card>

      <div className="detail-grid">
        <div className="stack-lg">
          <Photos u={u} canModerate={hasPermission(me, 'users.moderate')} />
          <Reports u={u} />
          <Conversations u={u} />
          <History u={u} />
        </div>
        <div className="stack-lg">
          <Profile u={u} />
          <PhoneHistory u={u} isAdmin={me.role === 'admin'} />
          <Counts u={u} />
          <Plan u={u} />
          <Devices u={u} />
          {hasPermission(me, 'support') ? <SupportThreads u={u} /> : null}
        </div>
      </div>

      {dialog?.kind === 'action' ? <ModerationActionDialog open onClose={() => setDialog(null)} action={dialog.action} user={u} /> : null}
      {dialog?.kind === 'premium' ? <PremiumDialog open onClose={() => setDialog(null)} user={u} /> : null}
      {dialog?.kind === 'role' ? <RoleDialog open onClose={() => setDialog(null)} user={u} /> : null}
      {dialog?.kind === 'release' ? <ReleasePhoneDialog open onClose={() => setDialog(null)} user={u} /> : null}
    </div>
  );
}

function Photos({ u, canModerate }: { u: AdminUserDetail; canModerate: boolean }) {
  const photos = u.moderation.photos;
  return (
    <Card>
      <CardHead title="Fotos" />
      {!photos.length ? (
        <EmptyState compact title="Sem fotos" text="A pessoa ainda não subiu nenhuma foto." />
      ) : (
        <div className="photo-grid card-body">
          {photos.map((p) => (
            <figure key={p.id} className="photo-item">
              <a className="thumb photo-thumb" href={p.url} target="_blank" rel="noreferrer noopener" aria-label="Abrir foto em tamanho real">
                <img src={p.url} alt={`Foto de ${u.name}${p.isMain ? ' (principal)' : ''}`} loading="lazy" />
                {p.isMain ? <span className="photo-main">Principal</span> : null}
              </a>
              <figcaption className="col" style={{ gap: 6 }}>
                <PhotoStatusBadge status={p.status} />
                {p.rejectReason ? <span className="xsmall faint">{p.rejectReason}</span> : null}
                {p.status === 'pending' && canModerate ? <PhotoDecisionButtons photoId={p.id} userId={u.id} compact /> : null}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </Card>
  );
}

function Reports({ u }: { u: AdminUserDetail }) {
  // histórico (até 50): pendentes e já decididas, cada uma com a situação
  const reports = u.moderation.reports;
  // conversas que a ficha trouxe (só as da pessoa): cada denúncia abre as dela
  const loaded = new Set(u.moderation.conversations.map((c) => c.conversationId));
  return (
    <Card>
      <CardHead title="Denúncias recebidas" icon={<Flag size={16} />}>
        <span className="small faint num">{u.reportsPending ? `${u.reportsPending} pendente${u.reportsPending === 1 ? '' : 's'} · ${reports.length} no total` : reports.length}</span>
      </CardHead>
      {!reports.length ? (
        <EmptyState compact icon={<CheckCheck size={22} />} title="Nenhuma denúncia contra essa conta" />
      ) : (
        <ul className="list">
          {reports.map((r) => (
            <li key={r.id} className="report-item" data-open={isOpenReport(r.status)}>
              <div className="row row-wrap">
                <Badge tone={URGENT_REASONS.has(r.reason) ? 'danger' : 'warning'}>{REPORT_REASON_LABEL[r.reason]}</Badge>
                <Badge tone={isOpenReport(r.status) ? 'outline' : 'neutral'}>{REPORT_STATUS_LABEL[r.status]}</Badge>
                {r.context?.source ? <span className="xsmall faint">pelo {REPORT_SOURCE_LABEL[r.context.source]}</span> : null}
                <span className="spacer" />
                <span className="xsmall faint">{formatShortDateTime(r.createdAt)}</span>
              </div>
              {r.description ? <p className="pre-wrap small">{r.description}</p> : <p className="small faint">Sem descrição.</p>}
              <ReportConversations ids={reportConversationIds(r.context).filter((cid) => loaded.has(cid))} />
              {r.reporterId ? (
                <Link to={`/usuarios/${r.reporterId}`} className="xsmall">
                  Ver quem denunciou
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** conversas citadas numa denúncia (a automática de golpe lista várias): cada botão abre o bloco dela na ficha */
function ReportConversations({ ids }: { ids: string[] }) {
  if (!ids.length) return null;
  return (
    <div className="row row-wrap xsmall">
      <span className="faint">{ids.length === 1 ? 'Conversa citada:' : `Em ${ids.length} conversas:`}</span>
      {ids.map((cid, i) => (
        <Button key={cid} variant="ghost" size="sm" onClick={() => openConversation(cid)} aria-label={`Abrir a conversa ${i + 1} citada`}>
          {ids.length === 1 ? 'abrir' : `abrir ${i + 1}`}
        </Button>
      ))}
    </div>
  );
}

function Conversations({ u }: { u: AdminUserDetail }) {
  const convs = u.moderation.conversations;
  if (!convs.length) return null;
  return (
    <Card>
      <CardHead title="Conversas citadas nas denúncias" icon={<MessageCircle size={16} />}>
        {convs.length > 1 ? <span className="small faint num">{convs.length}</span> : null}
      </CardHead>
      <div className="card-body stack">
        {convs.map((c, i) => (
          // fechadas (menos a 1ª): a denúncia automática pode citar até 10; o botão da denúncia abre a certa
          <details key={c.conversationId} id={convAnchor(c.conversationId)} className="conv-block conv-details" open={i === 0}>
            <summary className="row small">
              <span className="strong">Conversa {i + 1}</span>
              <span className="faint">com</span>
              <Link to={`/usuarios/${c.otherUserId}`}>a outra pessoa</Link>
              <span className="faint">
                · {c.messages.length} {c.messages.length === 1 ? 'mensagem' : 'mensagens'}
              </span>
              <CopyId id={c.conversationId} label="id da conversa" />
            </summary>
            <ol className="conv-messages">
              {c.messages.map((m) => {
                const mine = m.senderId === u.id;
                return (
                  <li key={m.id} className={`conv-msg${mine ? ' conv-msg-target' : ''}`}>
                    <span className="xsmall faint">
                      {mine ? u.name : 'Outra pessoa'} · {formatShortDateTime(m.createdAt)}
                    </span>
                    <span className="pre-wrap">{m.content ?? `[${m.messageType}]`}</span>
                  </li>
                );
              })}
            </ol>
          </details>
        ))}
      </div>
    </Card>
  );
}

function History({ u }: { u: AdminUserDetail }) {
  const actions = u.moderation.actions;
  return (
    <Card>
      <CardHead title="Histórico de moderação" />
      {!actions.length ? (
        <EmptyState compact title="Nada por aqui" text="Nenhuma decisão de moderação sobre essa conta." />
      ) : (
        <ol className="timeline card-body">
          {actions.map((a, i) => (
            <li key={`${a.createdAt}-${i}`}>
              <div>
                <div className="row">
                  <span className="strong">{moderationActionLabel(a.action)}</span>
                  <span className="xsmall faint">{formatDateTime(a.createdAt)}</span>
                </div>
                {a.note ? <p className="small muted pre-wrap">{a.note}</p> : null}
                <div className="xsmall faint">
                  {a.moderatorId ? <Link to={`/usuarios/${a.moderatorId}`}>por {a.moderatorName ?? 'alguém da equipe'}</Link> : 'automático'}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function Profile({ u }: { u: AdminUserDetail }) {
  return (
    <Card>
      <CardHead title="Perfil" />
      <div className="card-body stack">
        {u.bio ? <p className="pre-wrap">{u.bio}</p> : <p className="faint small">Sem bio.</p>}
        <dl className="kv">
          <dt>Telefone</dt>
          <dd className="num">
            {u.phone ?? '—'}
            {!u.phone && u.phoneReleasedAt ? <span className="small muted"> · liberado em {formatDate(u.phoneReleasedAt)}</span> : null}
          </dd>
          <dt>Cidade</dt>
          <dd>{u.city ?? '—'}</dd>
          <dt>Gênero</dt>
          <dd>{u.gender ? GENDER_LABEL[u.gender] : '—'}</dd>
          {/* @ público do cartão (spam, venda, perfil de outra pessoa). A orientação não entra no painel */}
          <dt>Instagram</dt>
          <dd>
            {u.instagram ? (
              <a href={`https://instagram.com/${encodeURIComponent(u.instagram)}`} target="_blank" rel="noreferrer noopener">
                @{u.instagram}
              </a>
            ) : (
              '—'
            )}
          </dd>
          <dt>Visibilidade</dt>
          <dd>
            {u.visibilityMode === 'anonymous' ? 'Modo anônimo' : 'Visível no mapa'}
            {/* invisível grátis: janela de 24 h (volta ao mapa sozinho); Premium vigente não tem prazo */}
            {u.visibilityMode === 'anonymous' && u.anonymousUntil ? (
              <span className="small muted"> · até {formatDateTime(u.anonymousUntil)}</span>
            ) : null}
          </dd>
          <dt>Situação</dt>
          <dd>
            <AccountStatusBadge status={u.accountStatus} until={u.suspendedUntil} />
          </dd>
          <dt>Conta criada</dt>
          <dd>{formatDateTime(u.createdAt)}</dd>
          <dt>Última atividade</dt>
          <dd>{formatDateTime(u.lastActiveAt)}</dd>
        </dl>
      </div>
    </Card>
  );
}

function Counts({ u }: { u: AdminUserDetail }) {
  const items: { label: string; value: number; icon: ReactNode }[] = [
    { label: 'Curtidas dadas', value: u.counts.likesSent, icon: <Heart size={14} /> },
    { label: 'Curtidas recebidas', value: u.counts.likesReceived, icon: <Heart size={14} /> },
    { label: 'Curtidas mútuas', value: u.counts.mutualLikes, icon: <Zap size={14} /> },
    { label: 'Conversas', value: u.counts.conversations, icon: <MessageCircle size={14} /> },
    { label: 'Mensagens enviadas', value: u.counts.messagesSent, icon: <MessageCircle size={14} /> },
    { label: 'Bloqueada por', value: u.counts.blocksReceived, icon: <UserX size={14} /> },
  ];
  return (
    <Card>
      <CardHead title="Números" />
      <div className="count-grid card-body">
        {items.map((i) => (
          <div key={i.label} className="count-cell">
            <span className="xsmall faint row">
              {i.icon}
              {i.label}
            </span>
            <span className="num strong count-value">{formatNumber(i.value)}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Plan({ u }: { u: AdminUserDetail }) {
  return (
    <Card>
      <CardHead title="Plano e assinaturas" icon={<Sparkles size={16} className="text-premium" />} />
      <div className="card-body stack">
        <div className="row">
          <TierBadge tier={u.premiumTier} />
          <span className="small muted">{u.premiumTier === 'free' ? 'Plano grátis' : u.premiumExpiresAt ? `vence ${formatDate(u.premiumExpiresAt)}` : 'sem vencimento'}</span>
        </div>
        {/* teste grátis: uma vez por conta e por número; a 1ª assinatura paga (qualquer plano) consome */}
        <p className="small muted">
          {u.trialUsedAt ? `Teste grátis já usado (1ª assinatura em ${formatDate(u.trialUsedAt)})` : 'Teste grátis ainda não usado nesta conta'}
        </p>
        {!u.subscriptions.length ? (
          <p className="small faint">Nenhuma assinatura registrada.</p>
        ) : (
          <ul className="list">
            {u.subscriptions.map((s) => {
              const st = subscriptionState(s);
              return (
                <li key={s.id} className="sub-item">
                  <div className="row">
                    <span className="strong">{TIER_LABEL[s.tier]}</span>
                    <Badge tone={s.platform === 'manual' ? 'gold' : 'outline'}>{platformLabel(s.platform)}</Badge>
                    <Badge tone={st.state === 'active' ? 'success' : st.state === 'cancelled' ? 'danger' : 'neutral'}>{st.label}</Badge>
                  </div>
                  <div className="xsmall faint">
                    {formatDate(s.startsAt)} → {isNoExpiry(s.expiresAt) ? 'sem vencimento' : formatDate(s.expiresAt)}
                    {s.grantedBy ? ` · por ${s.grantedBy.name}` : ''}
                  </div>
                  {s.note ? <div className="small muted">{s.note}</div> : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}

function Devices({ u }: { u: AdminUserDetail }) {
  return (
    <Card>
      <CardHead title="Aparelhos" icon={<Smartphone size={16} />} />
      {!u.devices.length ? (
        <EmptyState compact title="Nenhum aparelho com push" text="O app ainda não registrou este celular pra notificação." />
      ) : (
        <ul className="list">
          {u.devices.map((d, i) => (
            <li key={i} className="sub-item row">
              <span className="strong">{platformLabel(d.platform)}</span>
              <span className="small faint num">{d.appVersion ? `v${d.appVersion}` : 'versão ?'}</span>
              <span className="spacer" />
              <span className="xsmall faint">usado {formatRelative(d.lastUsedAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function SupportThreads({ u }: { u: AdminUserDetail }) {
  return (
    <Card>
      <CardHead title="Suporte" icon={<Headphones size={16} />} />
      {!u.supportThreads.length ? (
        <EmptyState compact title="Nunca chamou o suporte" />
      ) : (
        <ul className="list">
          {u.supportThreads.map((t) => (
            <li key={t.id} className="sub-item row">
              <SupportStatusBadge status={t.status} />
              <span className="small muted">aberto {formatDate(t.createdAt)}</span>
              <span className="spacer" />
              <Link to={`/suporte/${t.id}`} className="small">
                Abrir conversa
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
