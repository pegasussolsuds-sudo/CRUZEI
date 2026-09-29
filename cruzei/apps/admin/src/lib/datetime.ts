// Campos <input type="datetime-local"> em horário de Brasília, independente do fuso do computador.
// São Paulo não tem horário de verão desde 2019: o deslocamento é fixo em -03:00.
import { TIME_ZONE } from './format';

const OFFSET = '-03:00';

const partsFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** ISO → "AAAA-MM-DDTHH:mm" (valor do input) em Brasília; '' se inválido */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = Object.fromEntries(partsFmt.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** "AAAA-MM-DDTHH:mm" (Brasília) → ISO UTC; null se vazio/inválido */
export function fromLocalInput(value: string | null | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const d = new Date(`${value}:00${OFFSET}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** valor do input daqui a N minutos, arredondado pra baixo nos 5 min (padrão dos formulários) */
export function localInputFromNow(minutes: number, now: number = Date.now()): string {
  const t = now + minutes * 60_000;
  const rounded = Math.floor(t / 300_000) * 300_000;
  return toLocalInput(new Date(rounded).toISOString());
}

/** data ISO daqui a N dias (Premium manual) */
export function addDays(days: number, now: number = Date.now()): string {
  return new Date(now + days * 86_400_000).toISOString();
}
