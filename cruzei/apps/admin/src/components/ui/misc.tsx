import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, Check, Copy } from 'lucide-react';
import { usePageTitle } from '@/components/layout/title';

/** título da página (h1) + subtítulo + ações; também vira o título da aba */
export function PageHeader({ title, sub, actions, back, tabTitle }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; back?: { to: string; label: string }; tabTitle?: string }) {
  usePageTitle(tabTitle ?? (typeof title === 'string' ? title : ''));
  return (
    <div className="page-head">
      <div className="grow">
        {back ? (
          <Link to={back.to} className="back-link">
            <ArrowLeft size={14} /> {back.label}
          </Link>
        ) : null}
        <h1>{title}</h1>
        {sub ? <p className="sub">{sub}</p> : null}
      </div>
      {actions ? <div className="actions">{actions}</div> : null}
    </div>
  );
}

/** id curto clicável que copia o id inteiro */
export function CopyId({ id, label = 'id' }: { id: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="id-chip"
      title={`Copiar ${label}: ${id}`}
      aria-label={`Copiar ${label}`}
      onClick={() => {
        void navigator.clipboard?.writeText(id).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {id.slice(0, 8)}
    </button>
  );
}
