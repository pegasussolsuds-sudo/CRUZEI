// Escolher um item buscando na API (pessoa, lugar, evento): combobox com teclado.
import { useId, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, X } from 'lucide-react';
import { errorMessage } from '@/api/http';
import { useDebouncedValue, useDismiss } from '@/lib/hooks';
import { Spinner } from '@/components/ui/States';

export interface AsyncPickerProps<T> {
  label: string;
  placeholder: string;
  /** prefixo da chave de cache */
  cacheKey: string;
  search: (q: string, signal: AbortSignal) => Promise<T[]>;
  getId: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  value: T | null;
  onChange: (item: T | null) => void;
  minChars?: number;
  error?: string | null;
  hint?: ReactNode;
}

export function AsyncPicker<T>({ label, placeholder, cacheKey, search, getId, renderItem, value, onChange, minChars = 2, error, hint }: AsyncPickerProps<T>) {
  const id = useId();
  const listId = `${id}-list`;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const q = useDebouncedValue(text.trim(), 250);
  useDismiss(wrapRef, open, () => setOpen(false));

  const results = useQuery({
    queryKey: ['picker', cacheKey, q],
    queryFn: ({ signal }) => search(q, signal),
    enabled: open && q.length >= minChars,
    staleTime: 30_000,
  });
  const items = results.data ?? [];
  const showList = open && q.length >= minChars;

  const pick = (item: T) => {
    onChange(item);
    setText('');
    setOpen(false);
  };

  return (
    <div className="field" ref={wrapRef}>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {value ? (
        <div className="picked">
          <div className="grow" style={{ minWidth: 0 }}>
            {renderItem(value)}
          </div>
          <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => onChange(null)} aria-label={`Trocar ${label.toLowerCase()}`}>
            <X size={14} />
          </button>
        </div>
      ) : (
        <div className="picker">
          <div className="input-with-icon">
            <Search size={16} aria-hidden="true" />
            <input
              id={id}
              className="input"
              role="combobox"
              aria-expanded={showList}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
              aria-activedescendant={showList && items[active] ? `${listId}-${active}` : undefined}
              placeholder={placeholder}
              value={text}
              autoComplete="off"
              onFocus={() => setOpen(true)}
              onChange={(e) => {
                setText(e.target.value);
                setOpen(true);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setActive((a) => Math.min(a + 1, Math.max(items.length - 1, 0)));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActive((a) => Math.max(a - 1, 0));
                } else if (e.key === 'Enter') {
                  const it = items[active];
                  if (showList && it) {
                    e.preventDefault();
                    pick(it);
                  }
                } else if (e.key === 'Escape') {
                  setOpen(false);
                }
              }}
            />
          </div>
          {showList ? (
            <div className="search-results" role="listbox" id={listId} aria-label={label}>
              {results.isPending ? (
                <div className="row small muted" style={{ padding: 12 }}>
                  <Spinner /> Buscando…
                </div>
              ) : results.isError ? (
                <div className="small text-danger" style={{ padding: 12 }}>
                  {errorMessage(results.error)}
                </div>
              ) : !items.length ? (
                <div className="small muted" style={{ padding: 12 }}>
                  Nada com “{q}”.
                </div>
              ) : (
                items.map((it, i) => (
                  <div
                    key={getId(it)}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === active}
                    className="menu-item"
                    data-active={i === active}
                    style={{ cursor: 'pointer' }}
                    onPointerDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(it)}
                  >
                    {renderItem(it)}
                  </div>
                ))
              )}
            </div>
          ) : null}
        </div>
      )}
      {error ? (
        <span className="field-error" id={`${id}-error`} role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="field-hint" id={`${id}-hint`}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}
