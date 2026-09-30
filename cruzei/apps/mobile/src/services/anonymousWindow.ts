// Prazo do invisível grátis (users.anonymous_until, vem no /me em settings.anonymousUntil): o servidor decide, o app
// só mostra. Janela de 24 h, dá pra religar quando quiser; Premium não tem prazo (anonymousUntil null).

const pad = (n: number) => String(n).padStart(2, '0');

/** "14h32" / "amanhã, 14h32" / "15/10, 14h32" no fuso do aparelho; null sem prazo (ou prazo inválido/já passado) */
export function anonymousUntilLabel(iso: string | null | undefined, now: Date = new Date()): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime()) || d.getTime() <= now.getTime()) return null;
  const hm = `${pad(d.getHours())}h${pad(d.getMinutes())}`;
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((day(d) - day(now)) / 86_400_000);
  if (diffDays === 0) return hm;
  if (diffDays === 1) return `amanhã, ${hm}`;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}, ${hm}`;
}

/** texto do banner do mapa: "Invisível até 14h32" (grátis) ou o de sempre (Premium, sem prazo) */
export function anonymousBannerText(iso: string | null | undefined, now: Date = new Date()): string {
  const label = anonymousUntilLabel(iso, now);
  return label ? `Invisível até ${label}` : 'Você está oculto do mapa';
}
