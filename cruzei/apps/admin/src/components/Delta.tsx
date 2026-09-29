import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react';
import { formatPercent } from '@/lib/format';

/** variação com seta + texto (nunca só cor); "up" é bom por padrão */
export function Delta({ ratio, label, upIsGood = true }: { ratio: number | null; label: string; upIsGood?: boolean }) {
  if (ratio == null) return null;
  const flat = Math.abs(ratio) < 0.005;
  const up = ratio > 0;
  const cls = flat ? 'delta-flat' : up === upIsGood ? 'delta-up' : 'delta-down';
  const Icon = flat ? ArrowRight : up ? ArrowUpRight : ArrowDownRight;
  const text = `${up && !flat ? '+' : ''}${formatPercent(ratio)}`;
  return (
    <span className={`delta ${cls}`} title={label} aria-label={`${text} (${label})`}>
      <Icon size={12} aria-hidden="true" />
      {text}
    </span>
  );
}
