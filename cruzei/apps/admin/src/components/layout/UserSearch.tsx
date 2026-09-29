// Busca rápida de usuário no topo (combobox): nome, telefone ou id. Atalho "/" foca.
import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { adminApi } from '@/api/admin';
import { qk } from '@/api/keys';
import { errorMessage } from '@/api/http';
import { useDebouncedValue, useDismiss } from '@/lib/hooks';
import { Avatar } from '@/components/ui/Avatar';
import { AccountStatusBadge, TierBadge } from '@/components/badges';
import { Spinner } from '@/components/ui/States';

export function UserSearch() {
  const navigate = useNavigate();
  const listId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const q = useDebouncedValue(text.trim(), 250);

  const search = useQuery({
    queryKey: qk.userSearch(q),
    queryFn: ({ signal }) => adminApi.users({ q, limit: 6 }, signal),
    enabled: q.length >= 2,
    staleTime: 15_000,
  });
  const items = search.data?.items ?? [];

  useDismiss(wrapRef, open, () => setOpen(false));

  useEffect(() => setActive(0), [q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const go = (id: string) => {
    setOpen(false);
    setText('');
    inputRef.current?.blur();
    navigate(`/usuarios/${id}`);
  };

  const showList = open && q.length >= 2;

  return (
    <div className="topbar-search" ref={wrapRef}>
      <div className="input-with-icon">
        <Search size={16} aria-hidden="true" />
        <input
          ref={inputRef}
          className="input"
          type="search"
          placeholder="Buscar pessoa por nome, telefone ou id"
          aria-label="Buscar pessoa"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && items[active] ? `${listId}-${items[active].id}` : undefined}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, Math.max(items.length - 1, 0)));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter') {
              const pick = items[active];
              if (pick) {
                e.preventDefault();
                go(pick.id);
              } else if (text.trim()) {
                setOpen(false);
                navigate(`/usuarios?q=${encodeURIComponent(text.trim())}`);
              }
            } else if (e.key === 'Escape') {
              setOpen(false);
            }
          }}
        />
      </div>
      {!text ? (
        <span className="kbd" aria-hidden="true">
          /
        </span>
      ) : null}
      {showList ? (
        <div className="search-results" role="listbox" id={listId} aria-label="Pessoas encontradas">
          {search.isPending ? (
            <div className="row small muted" style={{ padding: 12 }}>
              <Spinner /> Buscando…
            </div>
          ) : search.isError ? (
            <div className="small text-danger" style={{ padding: 12 }}>
              {errorMessage(search.error)}
            </div>
          ) : !items.length ? (
            <div className="small muted" style={{ padding: 12 }}>
              Ninguém com “{q}”.
            </div>
          ) : (
            items.map((u, i) => (
              <div
                key={u.id}
                id={`${listId}-${u.id}`}
                role="option"
                aria-selected={i === active}
                className="menu-item"
                data-active={i === active}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => go(u.id)}
                onMouseEnter={() => setActive(i)}
                style={{ cursor: 'pointer' }}
              >
                <Avatar name={u.name} url={u.avatarUrl} size={32} premium={u.premiumTier !== 'free'} />
                <div className="grow">
                  <div className="strong truncate">
                    {u.name}
                    {u.age ? <span className="faint"> · {u.age}</span> : null}
                  </div>
                  <div className="xsmall faint num truncate">{u.phone ?? u.id}</div>
                </div>
                {u.accountStatus !== 'active' ? <AccountStatusBadge status={u.accountStatus} /> : <TierBadge tier={u.premiumTier} />}
              </div>
            ))
          )}
          {search.data && search.data.total > items.length ? (
            <button type="button" className="menu-item small muted" onPointerDown={(e) => e.preventDefault()} onClick={() => navigate(`/usuarios?q=${encodeURIComponent(q)}`)}>
              Ver todos os {search.data.total} resultados
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
