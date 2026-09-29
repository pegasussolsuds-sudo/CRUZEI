// Mandar agora ou agendar (horário de Brasília)
import { useId } from 'react';
import { fromLocalInput, localInputFromNow } from '@/lib/datetime';
import { formatDateTime, formatRelative } from '@/lib/format';
import { Segmented } from '@/components/ui/Choice';

export interface ScheduleValue {
  mode: 'now' | 'later';
  /** datetime-local em Brasília */
  at: string;
}

export const SCHEDULE_NOW: ScheduleValue = { mode: 'now', at: '' };

/** ISO pro payload (null = agora) ou erro de validação */
export function scheduleToIso(v: ScheduleValue, now: number = Date.now()): { iso: string | null; error: string | null } {
  if (v.mode === 'now') return { iso: null, error: null };
  const iso = fromLocalInput(v.at);
  if (!iso) return { iso: null, error: 'Escolhe dia e hora.' };
  if (Date.parse(iso) < now + 60_000) return { iso: null, error: 'Agendamento precisa ser no futuro.' };
  if (Date.parse(iso) > now + 60 * 86_400_000) return { iso: null, error: 'No máximo 60 dias pra frente.' };
  return { iso, error: null };
}

export function ScheduleField({ value, onChange, showErrors }: { value: ScheduleValue; onChange: (v: ScheduleValue) => void; showErrors?: boolean }) {
  const id = useId();
  const { iso, error } = scheduleToIso(value);
  return (
    <div className="field">
      <span className="field-label">Quando</span>
      <Segmented<'now' | 'later'>
        label="Quando enviar"
        value={value.mode}
        onChange={(mode) => onChange({ mode, at: mode === 'later' && !value.at ? localInputFromNow(60) : value.at })}
        options={[
          { value: 'now', label: 'Agora' },
          { value: 'later', label: 'Agendar' },
        ]}
      />
      {value.mode === 'later' ? (
        <div className="row row-wrap" style={{ marginTop: 6 }}>
          <label className="sr-only" htmlFor={id}>
            Dia e hora do envio (horário de Brasília)
          </label>
          <input
            id={id}
            type="datetime-local"
            className="input"
            style={{ width: 'auto' }}
            value={value.at}
            onChange={(e) => onChange({ mode: 'later', at: e.target.value })}
            aria-invalid={showErrors && error ? true : undefined}
          />
          <span className="xsmall faint">horário de Brasília{iso ? ` · ${formatRelative(iso)} (${formatDateTime(iso)})` : ''}</span>
        </div>
      ) : null}
      {value.mode === 'later' && showErrors && error ? (
        <span className="field-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
