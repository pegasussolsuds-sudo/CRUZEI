// Público de campanha/aviso + contagem prévia (quantas pessoas recebem antes de mandar).
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Globe2, MapPinned, Smartphone, Sparkles, User, Users, Building2 } from 'lucide-react';
import type { AdminUserRow, CampaignAudience, CampaignChannels, CampaignPreview } from '@cruzei/shared-types';
import { adminApi } from '@/api/admin';
import { qk } from '@/api/keys';
import { errorMessage } from '@/api/http';
import { audienceError, AUDIENCE_KIND_LABEL, formatAudienceCount, previewCount, RADIUS_MAX_M, RADIUS_MIN_M, type AudienceKind } from '@/lib/audience';
import { formatNumber } from '@/lib/format';
import { DEFAULT_CENTER, formatRadius, type LatLng } from '@/lib/geo';
import { useDebouncedValue } from '@/lib/hooks';
import { MapPointField, UserPicker } from '@/components/pickers';
import { OptionCards, ToggleCards } from '@/components/ui/Choice';
import { TextField } from '@/components/ui/Field';
import { Spinner } from '@/components/ui/States';

const KIND_ICON: Record<AudienceKind, ReactNode> = {
  all: <Globe2 size={16} />,
  premium: <Sparkles size={16} />,
  free: <Users size={16} />,
  city: <Building2 size={16} />,
  radius: <MapPinned size={16} />,
  user: <User size={16} />,
};

const KIND_DESC: Record<AudienceKind, string> = {
  all: 'Toda a base',
  premium: 'Premium e Premium+ vigentes',
  free: 'Quem não tem Premium',
  city: 'Pela cidade onde a pessoa está (última posição)',
  radius: 'Última posição conhecida',
  user: 'Teste ou caso específico',
};

/** troca de tipo de público mantendo o que dá pra aproveitar */
export function audienceForKind(kind: AudienceKind, prev: CampaignAudience, fallbackCenter: LatLng = DEFAULT_CENTER, fallbackCity = ''): CampaignAudience {
  switch (kind) {
    case 'all':
    case 'premium':
    case 'free':
      return { kind };
    case 'city':
      return { kind, city: prev.kind === 'city' ? prev.city : fallbackCity };
    case 'radius':
      return prev.kind === 'radius' ? prev : { kind, lat: fallbackCenter.lat, lng: fallbackCenter.lng, radiusM: 3000 };
    case 'user':
      return { kind, userId: prev.kind === 'user' ? prev.userId : '' };
  }
}

export function AudienceEditor({
  value,
  onChange,
  kinds,
  selectedUser,
  onSelectedUser,
  fixedCenter,
  fallbackCity,
  showErrors,
}: {
  value: CampaignAudience;
  onChange: (a: CampaignAudience) => void;
  kinds: readonly AudienceKind[];
  /** pessoa escolhida (público 'user') — guardada fora pra mostrar nome */
  selectedUser?: AdminUserRow | null;
  onSelectedUser?: (u: AdminUserRow | null) => void;
  /** raio em volta de um ponto fixo (evento): esconde o seletor de centro */
  fixedCenter?: LatLng;
  fallbackCity?: string;
  showErrors?: boolean;
}) {
  const err = showErrors ? audienceError(value) : null;
  return (
    <div className="stack">
      <OptionCards<AudienceKind>
        label="Público"
        value={value.kind}
        onChange={(k) => onChange(audienceForKind(k, value, fixedCenter, fallbackCity))}
        options={kinds.map((k) => ({ value: k, label: AUDIENCE_KIND_LABEL[k], description: KIND_DESC[k], icon: KIND_ICON[k] }))}
      />
      {value.kind === 'city' ? (
        <TextField label="Cidade" required value={value.city} onChange={(e) => onChange({ kind: 'city', city: e.target.value })} placeholder="Uberlândia" error={err} maxLength={80} />
      ) : null}
      {value.kind === 'radius' ? (
        <div className="stack">
          <div className="field">
            <label className="field-label" htmlFor="aud-radius">
              Raio: <span className="num strong">{formatRadius(value.radiusM)}</span>
            </label>
            <input
              id="aud-radius"
              type="range"
              className="range"
              min={RADIUS_MIN_M}
              max={RADIUS_MAX_M}
              step={value.radiusM < 5000 ? 100 : 1000}
              value={value.radiusM}
              onChange={(e) => onChange({ ...value, radiusM: Number(e.target.value) })}
              aria-valuetext={formatRadius(value.radiusM)}
            />
          </div>
          {fixedCenter ? (
            <MapPointField label="Em volta do evento" readOnly value={{ lat: value.lat, lng: value.lng }} circleRadiusM={value.radiusM} height={260} />
          ) : (
            <MapPointField label="Centro" value={{ lat: value.lat, lng: value.lng }} onChange={(p) => onChange({ ...value, lat: p.lat, lng: p.lng })} circleRadiusM={value.radiusM} height={280} error={err} />
          )}
        </div>
      ) : null}
      {value.kind === 'user' && onSelectedUser ? (
        <UserPicker
          label="Quem recebe"
          value={selectedUser ?? null}
          onChange={(u) => {
            onSelectedUser(u);
            onChange({ kind: 'user', userId: u?.id ?? '' });
          }}
          error={err}
        />
      ) : null}
    </div>
  );
}

export function ChannelsEditor({ value, onChange, pushEnabled = true }: { value: CampaignChannels; onChange: (c: CampaignChannels) => void; pushEnabled?: boolean }) {
  return (
    <ToggleCards<'push' | 'inbox'>
      label="Canais"
      value={value}
      onChange={onChange}
      options={[
        { key: 'push', label: 'Push no celular', description: pushEnabled ? 'Chega mesmo com o app fechado' : 'Desligado no servidor agora', icon: <Smartphone size={16} /> },
        { key: 'inbox', label: 'Central de avisos', description: 'Fica no app (e aparece na hora se estiver aberto)', icon: <Globe2 size={16} /> },
      ]}
    />
  );
}

/** contagem da prévia: `count` só quando bate com o público de AGORA (senão null e o botão de enviar espera) */
export interface AudiencePreviewState {
  /** última prévia recebida — pode ser de um público anterior enquanto a nova assenta (a tela mostra esmaecida) */
  data: CampaignPreview | undefined;
  count: number | null;
  /** o público mudou e a contagem nova ainda não chegou (debounce ou pedido em andamento) */
  settling: boolean;
  isFetching: boolean;
  isError: boolean;
  error: Error | null;
}

/**
 * Quantas pessoas recebem (debounce pra não martelar a API enquanto arrasta o raio).
 * eventId: aviso de evento conta quem não desligou avisos de evento (campanha comum usa a preferência de campanhas).
 */
export function useAudiencePreview(audience: CampaignAudience, enabled = true, eventId: string | null = null): AudiencePreviewState {
  const settled = useDebouncedValue(audience, 400);
  const valid = !audienceError(settled);
  const q = useQuery({
    queryKey: [...qk.preview(settled), eventId],
    queryFn: ({ signal }) => adminApi.previewCampaign(eventId ? { audience: settled, eventId } : { audience: settled }, signal),
    enabled: enabled && valid,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
  const count = previewCount(audience, settled, q.data, q.isPlaceholderData);
  return {
    data: q.data,
    count,
    settling: count == null && valid && !q.isError,
    isFetching: q.isFetching,
    isError: q.isError,
    error: q.error,
  };
}

export function AudiencePreview({ preview, channels }: { preview: AudiencePreviewState; channels: CampaignChannels }) {
  if (preview.isError) {
    return (
      <div className="preview-count" role="status">
        <span className="small text-danger">Não deu pra contar: {errorMessage(preview.error)}</span>
      </div>
    );
  }
  if (!preview.data) {
    return (
      <div className="preview-count" role="status">
        {preview.isFetching ? <Spinner /> : null}
        <span className="small muted">{preview.isFetching ? 'Contando pessoas…' : 'Complete o público pra ver quantas pessoas recebem.'}</span>
      </div>
    );
  }
  const d = preview.data;
  return (
    <div className="preview-count" role="status" aria-live="polite" aria-busy={preview.count == null || undefined} style={{ opacity: preview.count == null || preview.isFetching ? 0.6 : 1 }}>
      <div>
        <div className="preview-number num">{formatNumber(d.targetCount)}</div>
        <div className="small muted">{d.targetCount === 1 ? 'pessoa recebe' : 'pessoas recebem'}</div>
      </div>
      {channels.push ? (
        <div className="small muted">
          <span className="num strong">{formatNumber(d.withPushDevice)}</span> com celular pronto pro push
          {d.targetCount > 0 ? ` (${Math.round((d.withPushDevice / d.targetCount) * 100)}%)` : ''}
        </div>
      ) : null}
      <span className="sr-only">{formatAudienceCount(d.targetCount)}</span>
    </div>
  );
}
