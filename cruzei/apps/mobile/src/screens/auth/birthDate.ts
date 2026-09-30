// Data de nascimento digitada DD/MM/AAAA: cadastro (ProfileSetupScreen) e "Essa conta é sua?" (ClaimAccountScreen).

/** auto-insere as barras enquanto digita */
export function formatDate(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

/** DD/MM/AAAA válida e no passado → Date (meia-noite local); senão null */
export function parseDate(s: string): Date | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  const valid = d.getFullYear() === Number(yyyy) && d.getMonth() === Number(mm) - 1 && d.getDate() === Number(dd);
  if (!valid || d.getTime() > Date.now()) return null;
  return d;
}

/** YYYY-MM-DD no fuso local (evita o "dia anterior" do toISOString em UTC-3) */
export function toIsoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
