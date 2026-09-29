// Campanhas: limites de texto, taxas e validação do compositor.
import type { AdminCampaign, CampaignAudience, CampaignChannels, CampaignConfirmError, NotificationTarget } from '@cruzei/shared-types';
import { audienceError, channelsError, targetError } from './audience';

/** mesmos limites do CreateCampaignDto/AnnounceDto do backend */
export const CAMPAIGN_TITLE_MAX = 80;
export const CAMPAIGN_BODY_MAX = 240;

export type CampaignStats = AdminCampaign['stats'];

/** abertos / notificados (null sem base) */
export function openRate(s: CampaignStats): number | null {
  return s.notified > 0 ? s.opened / s.notified : null;
}

/** push entregues / tentados (null sem push) */
export function pushSuccessRate(s: CampaignStats): number | null {
  const tried = s.pushSent + s.pushFailed;
  return tried > 0 ? s.pushSent / tried : null;
}

export interface ComposerErrors {
  title?: string;
  body?: string;
  audience?: string;
  channels?: string;
  target?: string;
}

export function validateComposer(v: { title: string; body: string; audience: CampaignAudience; channels: CampaignChannels; target: NotificationTarget | null }): ComposerErrors {
  const e: ComposerErrors = {};
  const title = v.title.trim();
  const body = v.body.trim();
  if (title.length < 3) e.title = 'Escreve um título (mínimo 3 letras).';
  else if (title.length > CAMPAIGN_TITLE_MAX) e.title = `No máximo ${CAMPAIGN_TITLE_MAX} caracteres.`;
  if (body.length < 3) e.body = 'Escreve o texto do aviso.';
  else if (body.length > CAMPAIGN_BODY_MAX) e.body = `No máximo ${CAMPAIGN_BODY_MAX} caracteres.`;
  const a = audienceError(v.audience);
  if (a) e.audience = a;
  const c = channelsError(v.channels);
  if (c) e.channels = c;
  const t = targetError(v.target);
  if (t) e.target = t;
  return e;
}

/**
 * 409 confirm_required (CampaignConfirmError): o público mudou entre a prévia e o envio, ou faltou confirmar.
 * Devolve o número que o servidor quer ver digitado; null pra qualquer outro erro.
 */
export function confirmCountFromError(status: number, body: unknown): number | null {
  if (status !== 409 || !body || typeof body !== 'object') return null;
  const b = body as Partial<CampaignConfirmError>;
  return b.error === 'confirm_required' && typeof b.targetCount === 'number' ? b.targetCount : null;
}

export function hasErrors(e: object): boolean {
  return Object.values(e).some(Boolean);
}
