// Eventos: fase (rascunho/próximo/acontecendo/passou), formulário ↔ payload e validação.
import type { AdminEvent, EventCategory, EventStatus, UpsertEventPayload } from '@cruzei/shared-types';
import { fromLocalInput, toLocalInput } from './datetime';
import { isValidLatLng } from './geo';

export type EventPhase = 'draft' | 'cancelled' | 'upcoming' | 'live' | 'past';

export function eventPhase(e: Pick<AdminEvent, 'status' | 'startsAt' | 'endsAt'>, now: number = Date.now()): EventPhase {
  if (e.status === 'draft') return 'draft';
  if (e.status === 'cancelled') return 'cancelled';
  const start = Date.parse(e.startsAt);
  const end = Date.parse(e.endsAt);
  if (Number.isFinite(end) && end <= now) return 'past';
  if (Number.isFinite(start) && start <= now) return 'live';
  return 'upcoming';
}

export const EVENT_PHASE_LABEL: Record<EventPhase, string> = {
  draft: 'Rascunho',
  cancelled: 'Cancelado',
  upcoming: 'Em breve',
  live: 'Acontecendo',
  past: 'Terminou',
};

export type EventTabKey = 'upcoming' | 'live' | 'past' | 'drafts' | 'cancelled';

export interface EventTab {
  key: EventTabKey;
  label: string;
  query: { status?: EventStatus; when?: 'upcoming' | 'live' | 'past' };
  empty: string;
}

export const EVENT_TABS: readonly EventTab[] = [
  { key: 'upcoming', label: 'Próximos', query: { status: 'published', when: 'upcoming' }, empty: 'Nenhum evento publicado pela frente.' },
  { key: 'live', label: 'Acontecendo', query: { status: 'published', when: 'live' }, empty: 'Nada rolando agora.' },
  { key: 'past', label: 'Passados', query: { when: 'past' }, empty: 'Nenhum evento terminou ainda.' },
  { key: 'drafts', label: 'Rascunhos', query: { status: 'draft' }, empty: 'Sem rascunhos. Crie um evento novo quando quiser.' },
  { key: 'cancelled', label: 'Cancelados', query: { status: 'cancelled' }, empty: 'Nenhum evento cancelado.' },
];

export interface EventFormValues {
  title: string;
  description: string;
  category: EventCategory;
  /** inputs datetime-local (Brasília) */
  startsAt: string;
  endsAt: string;
  venueName: string;
  lat: number | null;
  lng: number | null;
  address: string;
  city: string;
  coverUrl: string;
  poiId: string | null;
}

export const EMPTY_EVENT_FORM: EventFormValues = {
  title: '',
  description: '',
  category: 'event',
  startsAt: '',
  endsAt: '',
  venueName: '',
  lat: null,
  lng: null,
  address: '',
  city: '',
  coverUrl: '',
  poiId: null,
};

export const EVENT_TITLE_MAX = 120;
export const EVENT_DESCRIPTION_MAX = 2000;

export type EventFormErrors = Partial<Record<keyof EventFormValues | 'where', string>>;

export function validateEventForm(v: EventFormValues, opts: { isNew: boolean; now?: number }): EventFormErrors {
  const errors: EventFormErrors = {};
  const now = opts.now ?? Date.now();
  const title = v.title.trim();
  if (title.length < 3) errors.title = 'Dá um nome pro evento (mínimo 3 letras).';
  else if (title.length > EVENT_TITLE_MAX) errors.title = `No máximo ${EVENT_TITLE_MAX} caracteres.`;
  if (v.description.length > EVENT_DESCRIPTION_MAX) errors.description = `No máximo ${EVENT_DESCRIPTION_MAX} caracteres.`;

  const start = fromLocalInput(v.startsAt);
  const end = fromLocalInput(v.endsAt);
  if (!start) errors.startsAt = 'Quando começa?';
  if (!end) errors.endsAt = 'Quando termina?';
  if (start && end) {
    if (Date.parse(end) <= Date.parse(start)) errors.endsAt = 'Tem que terminar depois de começar.';
    else if (Date.parse(end) - Date.parse(start) > 14 * 86_400_000) errors.endsAt = 'Evento de no máximo 14 dias.';
  }
  // evento novo no passado quase sempre é engano de data
  if (opts.isNew && end && Date.parse(end) < now) errors.endsAt = 'Esse horário já passou.';

  if (!isValidLatLng(v.lat, v.lng)) errors.where = 'Marca o lugar no mapa.';
  if (v.coverUrl.trim() && !isHttpUrl(v.coverUrl.trim())) errors.coverUrl = 'Use um link https:// de imagem.';
  return errors;
}

export function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

const orNull = (s: string): string | null => (s.trim() ? s.trim() : null);

/** só chamar depois de validateEventForm sem erros */
export function eventFormToPayload(v: EventFormValues): UpsertEventPayload {
  return {
    title: v.title.trim(),
    description: orNull(v.description),
    category: v.category,
    startsAt: fromLocalInput(v.startsAt) ?? '',
    endsAt: fromLocalInput(v.endsAt) ?? '',
    venueName: orNull(v.venueName),
    lat: v.lat ?? 0,
    lng: v.lng ?? 0,
    address: orNull(v.address),
    city: orNull(v.city),
    coverUrl: orNull(v.coverUrl),
    poiId: v.poiId,
  };
}

export function eventToForm(e: AdminEvent): EventFormValues {
  return {
    title: e.title,
    description: e.description ?? '',
    category: e.category,
    startsAt: toLocalInput(e.startsAt),
    endsAt: toLocalInput(e.endsAt),
    venueName: e.venueName ?? '',
    lat: e.lat,
    lng: e.lng,
    address: e.address ?? '',
    city: e.city ?? '',
    coverUrl: e.coverUrl ?? '',
    poiId: e.poiId,
  };
}
