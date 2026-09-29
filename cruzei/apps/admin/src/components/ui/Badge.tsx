import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'success' | 'danger' | 'warning' | 'info' | 'premium' | 'gold' | 'outline';

export function Badge({ tone = 'neutral', dot, icon, children, title }: { tone?: BadgeTone; dot?: boolean; icon?: ReactNode; children: ReactNode; title?: string }) {
  const cls = ['badge', tone !== 'neutral' ? `badge-${tone}` : '', dot ? 'badge-dot' : ''].filter(Boolean).join(' ');
  return (
    <span className={cls} title={title}>
      {icon}
      {children}
    </span>
  );
}

export function CountPill({ n, tone = 'accent', label }: { n: number; tone?: 'accent' | 'danger'; label?: string }) {
  if (n <= 0) return null;
  return (
    <span className={`count-pill${tone === 'danger' ? ' count-pill-danger' : ''}`} aria-label={label}>
      {n > 99 ? '99+' : n}
    </span>
  );
}
