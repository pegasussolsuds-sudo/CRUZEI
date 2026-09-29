// Selos de domínio: sempre texto + cor (nunca só cor)
import type { AccountStatus, CampaignStatus, CandidateStatus, PhotoStatus, PremiumTier, SupportThreadStatus, UserRole } from '@cruzei/shared-types';
import { Crown, Shield, ShieldCheck, Sparkles } from 'lucide-react';
import {
  ACCOUNT_STATUS_LABEL,
  CAMPAIGN_STATUS_LABEL,
  CANDIDATE_STATUS_LABEL,
  PHOTO_STATUS_LABEL,
  ROLE_LABEL,
  SUPPORT_STATUS_LABEL,
  TIER_LABEL,
} from '@/lib/labels';
import { EVENT_PHASE_LABEL, type EventPhase } from '@/lib/events';
import { formatDate } from '@/lib/format';
import { Badge, type BadgeTone } from './ui/Badge';

export function AccountStatusBadge({ status, until }: { status: AccountStatus; until?: string | null }) {
  const tone: BadgeTone = status === 'active' ? 'success' : status === 'suspended' ? 'warning' : 'danger';
  const text = status === 'suspended' && until ? `${ACCOUNT_STATUS_LABEL[status]} até ${formatDate(until)}` : ACCOUNT_STATUS_LABEL[status];
  return (
    <Badge tone={tone} dot>
      {text}
    </Badge>
  );
}

export function TierBadge({ tier }: { tier: PremiumTier }) {
  if (tier === 'free') return <Badge>{TIER_LABEL.free}</Badge>;
  return (
    <Badge tone="premium" icon={tier === 'premium_plus' ? <Crown /> : <Sparkles />}>
      {TIER_LABEL[tier]}
    </Badge>
  );
}

export function RoleBadge({ role }: { role: UserRole }) {
  if (role === 'user') return null;
  return (
    <Badge tone={role === 'admin' ? 'gold' : 'info'} icon={role === 'admin' ? <ShieldCheck /> : <Shield />}>
      {ROLE_LABEL[role]}
    </Badge>
  );
}

export function PhotoStatusBadge({ status }: { status: PhotoStatus }) {
  const tone: BadgeTone = status === 'approved' ? 'success' : status === 'pending' ? 'warning' : 'danger';
  return <Badge tone={tone}>{PHOTO_STATUS_LABEL[status]}</Badge>;
}

export function CandidateStatusBadge({ status }: { status: CandidateStatus }) {
  const tone: BadgeTone = status === 'promoted' ? 'success' : status === 'pending' ? 'warning' : status === 'rejected' ? 'danger' : 'neutral';
  return <Badge tone={tone}>{CANDIDATE_STATUS_LABEL[status]}</Badge>;
}

export function EventPhaseBadge({ phase }: { phase: EventPhase }) {
  const tone: BadgeTone = phase === 'live' ? 'success' : phase === 'upcoming' ? 'info' : phase === 'cancelled' ? 'danger' : phase === 'draft' ? 'warning' : 'neutral';
  return (
    <Badge tone={tone} dot={phase === 'live'}>
      {EVENT_PHASE_LABEL[phase]}
    </Badge>
  );
}

export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  const tone: BadgeTone =
    status === 'sent' ? 'success' : status === 'scheduled' ? 'info' : status === 'sending' ? 'gold' : status === 'failed' ? 'danger' : 'neutral';
  return (
    <Badge tone={tone} dot={status === 'sending'}>
      {CAMPAIGN_STATUS_LABEL[status]}
    </Badge>
  );
}

export function SupportStatusBadge({ status }: { status: SupportThreadStatus }) {
  const tone: BadgeTone = status === 'open' ? 'success' : status === 'pending' ? 'warning' : 'neutral';
  return <Badge tone={tone}>{SUPPORT_STATUS_LABEL[status]}</Badge>;
}
