import { useRef, useState } from 'react';
import { ChevronDown, LogOut, Moon, Sun, Volume2, VolumeX } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { useDismiss, useTheme } from '@/lib/hooks';
import { ROLE_LABEL } from '@/lib/labels';
import { useSupportLive } from '@/realtime/SupportLive';
import { Avatar } from '@/components/ui/Avatar';
import { RoleBadge } from '@/components/badges';

export function AccountMenu() {
  const { me, logout } = useAuth();
  const { enabled: supportOn, soundOn, setSoundOn } = useSupportLive();
  const [theme, setTheme] = useTheme();
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));

  if (!me) return null;

  const focusItem = (dir: 1 | -1) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    const idx = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(idx + dir + items.length) % items.length]?.focus();
  };

  return (
    <div className="menu-wrap" ref={ref}>
      <button
        type="button"
        className="account-btn"
        aria-label={`Menu da conta, ${me.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
          window.setTimeout(() => menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus(), 0);
        }}
      >
        <Avatar name={me.name} size={32} />
        <span className="account-name small strong">{me.name}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open ? (
        <div
          className="menu"
          role="menu"
          ref={menuRef}
          aria-label="Conta"
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              focusItem(1);
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              focusItem(-1);
            }
          }}
        >
          <div className="menu-head">
            <div className="strong">{me.name}</div>
            <div className="row" style={{ marginTop: 6 }}>
              <RoleBadge role={me.role} />
              <span className="xsmall faint">{ROLE_LABEL[me.role]}</span>
            </div>
          </div>
          <div className="menu-sep" />
          <button type="button" role="menuitem" className="menu-item" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            {theme === 'dark' ? 'Tema claro' : 'Tema escuro'}
          </button>
          {supportOn ? (
            <button type="button" role="menuitem" className="menu-item" onClick={() => setSoundOn(!soundOn)}>
              {soundOn ? <VolumeX size={16} /> : <Volume2 size={16} />}
              {soundOn ? 'Silenciar som do suporte' : 'Ligar som do suporte'}
            </button>
          ) : null}
          <div className="menu-sep" />
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            disabled={leaving}
            onClick={async () => {
              setLeaving(true);
              await logout();
            }}
          >
            <LogOut size={16} />
            {leaving ? 'Saindo…' : 'Sair'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
