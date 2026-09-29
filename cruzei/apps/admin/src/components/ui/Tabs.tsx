// Abas acessíveis (tablist): setas trocam de aba; o conteúdo fica num tabpanel ligado por id.
import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface TabItem<K extends string> {
  key: K;
  label: ReactNode;
  count?: number | null;
  icon?: ReactNode;
}

export function Tabs<K extends string>({
  items,
  value,
  onChange,
  label,
  children,
}: {
  items: readonly TabItem<K>[];
  value: K;
  onChange: (k: K) => void;
  label: string;
  children: ReactNode;
}) {
  const base = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, idx: number) => {
    let next = -1;
    if (e.key === 'ArrowRight') next = (idx + 1) % items.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const item = items[next];
    if (item) {
      onChange(item.key);
      refs.current[next]?.focus();
    }
  };
  return (
    <div className="stack">
      <div className="tabs" role="tablist" aria-label={label}>
        {items.map((t, i) => (
          <button
            key={t.key}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${base}-tab-${t.key}`}
            aria-selected={t.key === value}
            aria-controls={`${base}-panel`}
            tabIndex={t.key === value ? 0 : -1}
            className="tab"
            onClick={() => onChange(t.key)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {t.icon}
            {t.label}
            {t.count != null ? <span className="count">{t.count}</span> : null}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-tab-${value}`}>
        {children}
      </div>
    </div>
  );
}
