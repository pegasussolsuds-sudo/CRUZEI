// Formatação pt-BR. Tudo no fuso de São Paulo: é o fuso dos dados (séries do painel) e da equipe,
// e deixa o painel igual em qualquer computador.
export const TIME_ZONE = 'America/Sao_Paulo';

const numberFmt = new Intl.NumberFormat('pt-BR');
const compactFmt = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
const dateFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: TIME_ZONE, day: '2-digit', month: 'short', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const timeFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit' });
const shortFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: TIME_ZONE, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export const DASH = '—';

function toDate(value: string | number | Date): Date | null {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatNumber(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  return numberFmt.format(n);
}

/** 12.900 → "12,9 mil" (cartões); abaixo de 10 mil mostra o número inteiro */
export function formatCompact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  return Math.abs(n) < 10_000 ? numberFmt.format(n) : compactFmt.format(n);
}

/** 0.4567 → "46%" */
export function formatPercent(ratio: number | null | undefined, digits = 0): string {
  if (ratio == null || !Number.isFinite(ratio)) return DASH;
  return `${(ratio * 100).toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const d = toDate(iso);
  return d ? dateFmt.format(d).replace(/\s?de\s/g, ' ').replace('.', '') : DASH;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const d = toDate(iso);
  return d ? dateTimeFmt.format(d).replace(',', '') : DASH;
}

/** "29 set 14:32" — linhas de lista, onde o ano quase sempre é o atual */
export function formatShortDateTime(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const d = toDate(iso);
  return d ? shortFmt.format(d).replace(/\s?de\s/g, ' ').replace('.', '').replace(',', '') : DASH;
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const d = toDate(iso);
  return d ? timeFmt.format(d) : DASH;
}

/** 'AAAA-MM-DD' (dia do servidor, já em São Paulo) → "29/09" sem passar por Date (evita virar o dia) */
export function formatDay(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return m ? `${m[3]}/${m[2]}` : day;
}

/**
 * Campo que às vezes é só o dia ("2026-09-29", ex.: denúncia de lugar, firstSeenOn) e às vezes ISO completo.
 * Dia puro não passa por Date: meia-noite UTC viraria o dia anterior em São Paulo.
 */
export function formatDayOrDate(value: string | null | undefined): string {
  if (!value) return DASH;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return formatDate(value);
}

/** Premium manual sem vencimento: a assinatura guarda 2099-12-31 (a coluna é obrigatória) */
export function isNoExpiry(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  return !Number.isNaN(d.getTime()) && d.getUTCFullYear() >= 2099;
}

/** "agora", "há 5 min", "há 3 h", "ontem", "há 4 dias", "em 2 h"… e data cheia depois de 30 dias */
export function formatRelative(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return DASH;
  const d = toDate(iso);
  if (!d) return DASH;
  const diffMs = d.getTime() - now;
  const future = diffMs > 0;
  const abs = Math.abs(diffMs);
  const min = Math.round(abs / 60_000);
  if (min < 1) return 'agora';
  const wrap = (s: string) => (future ? `em ${s}` : `há ${s}`);
  if (min < 60) return wrap(`${min} min`);
  const h = Math.round(min / 60);
  if (h < 24) return wrap(`${h} h`);
  const days = Math.round(h / 24);
  if (days === 1) return future ? 'amanhã' : 'ontem';
  if (days <= 30) return wrap(`${days} dias`);
  return formatDate(iso);
}

/** minutos → "12 min", "1 h 5 min", "2 d 3 h" */
export function formatMinutes(min: number | null | undefined): string {
  if (min == null || !Number.isFinite(min)) return DASH;
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h < 24) return rest ? `${h} h ${rest} min` : `${h} h`;
  const d = Math.floor(h / 24);
  const hr = h % 24;
  return hr ? `${d} d ${hr} h` : `${d} d`;
}

/** "1 pessoa" / "1.234 pessoas" */
export function plural(n: number, one: string, many: string): string {
  return `${formatNumber(n)} ${n === 1 ? one : many}`;
}

export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

// ─── telefone (mesmas regras do normalizePhoneBR/formatPhoneBR do @cruzei/shared-utils, que o backend usa) ───

/** E.164 (+55…) ou null */
export function normalizePhoneBR(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) return `+${digits}`;
  return null;
}

export function isValidPhoneBR(raw: string): boolean {
  const norm = normalizePhoneBR(raw);
  if (!norm) return false;
  const local = norm.slice(3);
  if (local.length !== 10 && local.length !== 11) return false;
  const ddd = Number.parseInt(local.slice(0, 2), 10);
  return ddd >= 11 && ddd <= 99;
}

/** máscara enquanto digita: (34) 99999-9999 */
export function formatPhoneInput(raw: string): string {
  const d = raw.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '').slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}
