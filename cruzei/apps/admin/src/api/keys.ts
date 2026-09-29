// Chaves do react-query (um lugar só pra invalidar certo depois de cada ação)
import type { CampaignAudience, CandidateStatus } from '@cruzei/shared-types';
import type { SupportFilter } from '@/lib/support';
import type { AuditParams, UserListParams } from './admin';

export const qk = {
  stats: ['stats'] as const,
  users: (p: Omit<UserListParams, 'cursor'>) => ['users', p] as const,
  usersAll: ['users'] as const,
  userSearch: (q: string) => ['user-search', q] as const,
  user: (id: string) => ['user', id] as const,
  queue: ['queue'] as const,
  candidates: (status: CandidateStatus) => ['places', 'candidates', status] as const,
  poiReports: ['places', 'reports'] as const,
  pois: (q: string, hidden: '' | '0' | '1') => ['places', 'pois', q, hidden] as const,
  placesAll: ['places'] as const,
  events: (tab: string) => ['events', tab] as const,
  eventsAll: ['events'] as const,
  event: (id: string) => ['event', id] as const,
  campaigns: ['campaigns'] as const,
  preview: (audience: CampaignAudience) => ['campaign-preview', audience] as const,
  audit: (p: Omit<AuditParams, 'cursor'>) => ['audit', p] as const,
  /** tudo do suporte (fila, conversas, contagem): reconexão do socket busca de novo */
  supportAll: ['support'] as const,
  supportThreads: (filter: SupportFilter) => ['support', 'threads', filter] as const,
  supportThreadsAll: ['support', 'threads'] as const,
  supportThread: (id: string) => ['support', 'thread', id] as const,
  supportLive: ['support', 'live'] as const,
  staff: ['staff'] as const,
  poi: (id: string) => ['places', 'poi', id] as const,
};
