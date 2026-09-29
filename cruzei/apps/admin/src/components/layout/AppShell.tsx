import { Suspense } from 'react';
import { Link, Outlet } from 'react-router';
import { Headphones } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { hasPermission } from '@/lib/permissions';
import { useCollapsedSidebar } from '@/lib/hooks';
import { useSupportLive } from '@/realtime/SupportLive';
import { LoadingState } from '@/components/ui/States';
import { Sidebar } from './Sidebar';
import { UserSearch } from './UserSearch';
import { AccountMenu } from './AccountMenu';

function SupportCounter() {
  const { enabled, waiting } = useSupportLive();
  if (!enabled) return null;
  return (
    <Link
      to="/suporte"
      className="support-live"
      data-waiting={waiting > 0}
      aria-label={waiting ? `Suporte: ${waiting} ${waiting === 1 ? 'pessoa esperando' : 'pessoas esperando'}` : 'Suporte: ninguém esperando'}
    >
      <Headphones size={16} aria-hidden="true" />
      <span className="support-live-label">{waiting ? 'Esperando' : 'Suporte em dia'}</span>
      {waiting ? <span className="count-pill">{waiting > 99 ? '99+' : waiting}</span> : null}
    </Link>
  );
}

export function AppShell() {
  const { me } = useAuth();
  const [collapsed, setCollapsed] = useCollapsedSidebar();

  return (
    <div className="shell" data-collapsed={collapsed}>
      <a href="#conteudo" className="skip-link">
        Pular pro conteúdo
      </a>
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />
      <div className="main-col">
        <header className="topbar">
          {hasPermission(me, 'users.read') ? <UserSearch /> : <div />}
          <div className="spacer" />
          <SupportCounter />
          <AccountMenu />
        </header>
        <main id="conteudo" tabIndex={-1} style={{ outline: 'none' }}>
          <Suspense fallback={<LoadingState />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
