import type { ReactNode } from 'react';

export function Card({ children, className, pad, as: Tag = 'section', ...aria }: { children: ReactNode; className?: string; pad?: boolean; as?: 'section' | 'div' | 'article'; 'aria-label'?: string; 'aria-labelledby'?: string }) {
  return (
    <Tag className={['card', pad ? 'card-pad' : '', className ?? ''].filter(Boolean).join(' ')} {...aria}>
      {children}
    </Tag>
  );
}

export function CardHead({ title, icon, children, id }: { title: ReactNode; icon?: ReactNode; children?: ReactNode; id?: string }) {
  return (
    <header className="card-head">
      <h2 className="section-title" id={id}>
        {icon}
        {title}
      </h2>
      {children ? <div className="row" style={{ marginLeft: 'auto' }}>{children}</div> : null}
    </header>
  );
}
