// Carregando / vazio / erro: toda lista e toda tela passa por aqui (nada de tela em branco).
import type { CSSProperties, ReactNode } from 'react';
import { AlertTriangle, Inbox, Lock, RefreshCw } from 'lucide-react';
import { errorMessage, isHttpError } from '@/api/http';
import { Button } from './Button';

export function Spinner({ label = 'Carregando' }: { label?: string }) {
  return <span className="spinner" role="status" aria-label={label} />;
}

export function Skeleton({ width = '100%', height = 14, radius, style }: { width?: number | string; height?: number | string; radius?: number; style?: CSSProperties }) {
  return <div className="skeleton" aria-hidden="true" style={{ width, height, borderRadius: radius, ...style }} />;
}

export function SkeletonRows({ rows = 6, height = 44 }: { rows?: number; height?: number }) {
  return (
    <div className="col" style={{ padding: 'var(--space-4)', gap: 10 }} role="status" aria-label="Carregando">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={height} style={{ opacity: 1 - i * 0.1 }} />
      ))}
    </div>
  );
}

export function LoadingState({ label = 'Carregando…', compact }: { label?: string; compact?: boolean }) {
  return (
    <div className={`state${compact ? ' state-compact' : ''}`} role="status">
      <Spinner label={label} />
      <span className="small">{label}</span>
    </div>
  );
}

export function EmptyState({ icon, title, text, action, compact }: { icon?: ReactNode; title: string; text?: ReactNode; action?: ReactNode; compact?: boolean }) {
  return (
    <div className={`state${compact ? ' state-compact' : ''}`}>
      <div className="state-icon" aria-hidden="true">
        {icon ?? <Inbox size={22} />}
      </div>
      <div className="state-title">{title}</div>
      {text ? <div className="state-text">{text}</div> : null}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry, title, compact }: { error: unknown; onRetry?: () => void; title?: string; compact?: boolean }) {
  const forbidden = isHttpError(error, 403);
  const missing = isHttpError(error, 404);
  return (
    <div className={`state state-error${compact ? ' state-compact' : ''}`} role="alert">
      <div className="state-icon" aria-hidden="true">
        {forbidden ? <Lock size={22} /> : <AlertTriangle size={22} />}
      </div>
      <div className="state-title">{title ?? (forbidden ? 'Sem permissão' : missing ? 'Não encontrado' : 'Não deu pra carregar')}</div>
      <div className="state-text">{errorMessage(error)}</div>
      {onRetry && !forbidden ? (
        <Button size="sm" icon={<RefreshCw size={14} />} onClick={onRetry}>
          Tentar de novo
        </Button>
      ) : null}
    </div>
  );
}

export function LoadMore({ hasMore, loading, onClick, label = 'Carregar mais' }: { hasMore: boolean; loading: boolean; onClick: () => void; label?: string }) {
  if (!hasMore) return null;
  return (
    <div className="load-more">
      <Button variant="secondary" size="sm" loading={loading} onClick={onClick}>
        {label}
      </Button>
    </div>
  );
}
