// "há 5 min", "ontem às 22h", "12/03"...

const MS_MIN = 60_000;
const MS_HOUR = 3_600_000;
const MS_DAY = 86_400_000;

export function timeAgo(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const diff = Date.now() - d.getTime();
  if (diff < MS_MIN) return 'agora';
  if (diff < MS_HOUR) return `há ${Math.floor(diff / MS_MIN)} min`;
  if (diff < MS_DAY) return `há ${Math.floor(diff / MS_HOUR)} h`;
  if (diff < MS_DAY * 2) return 'ontem';
  if (diff < MS_DAY * 7) return `há ${Math.floor(diff / MS_DAY)} dias`;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}
