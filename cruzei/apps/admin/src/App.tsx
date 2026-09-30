import { lazy, type ReactNode } from 'react';
import { createBrowserRouter, Navigate, RouterProvider, useLocation } from 'react-router';
import { Lock, WifiOff } from 'lucide-react';
import type { AdminPermission } from '@cruzei/shared-types';
import { useAuth } from '@/auth/AuthProvider';
import { hasPermission } from '@/lib/permissions';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { EmptyState, LoadingState } from '@/components/ui/States';
import { PageHeader } from '@/components/ui/misc';
import { LoginPage } from '@/pages/LoginPage';

// telas pesadas (mapa, gráficos) em arquivos próprios: o login abre rápido
const DashboardPage = lazy(() => import('@/pages/DashboardPage'));
const MetricsPage = lazy(() => import('@/pages/MetricsPage'));
const UsersPage = lazy(() => import('@/pages/users/UsersPage'));
const UserDetailPage = lazy(() => import('@/pages/users/UserDetailPage'));
const ModerationPage = lazy(() => import('@/pages/ModerationPage'));
const PlacesPage = lazy(() => import('@/pages/places/PlacesPage'));
const EventsPage = lazy(() => import('@/pages/events/EventsPage'));
const EventFormPage = lazy(() => import('@/pages/events/EventFormPage'));
const NotificationsPage = lazy(() => import('@/pages/notifications/NotificationsPage'));
const SupportPage = lazy(() => import('@/pages/support/SupportPage'));
const AuditPage = lazy(() => import('@/pages/AuditPage'));

/** sessão salva, mas o servidor não respondeu: nada de mandar pro login (a sessão continua valendo) */
function OfflineScreen() {
  const { notice, retry, logout } = useAuth();
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <EmptyState
        icon={<WifiOff size={22} />}
        title="Sem conexão com o servidor"
        text={notice ?? 'A API não respondeu. Sua sessão continua salva nesta aba.'}
        action={
          <div className="row row-wrap" style={{ justifyContent: 'center' }}>
            <Button variant="primary" onClick={retry}>
              Tentar de novo
            </Button>
            <Button variant="ghost" onClick={() => void logout()}>
              Sair
            </Button>
          </div>
        }
      />
    </div>
  );
}

function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'offline') return <OfflineScreen />;
  if (status === 'loading') {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <LoadingState label="Abrindo o painel…" />
      </div>
    );
  }
  if (status === 'anonymous') return <Navigate to="/entrar" replace state={{ from: location.pathname + location.search }} />;
  return <AppShell />;
}

function Guard({ perm, children }: { perm: AdminPermission; children: ReactNode }) {
  const { me } = useAuth();
  if (hasPermission(me, perm)) return <>{children}</>;
  return (
    <div className="content">
      <PageHeader title="Sem acesso" />
      <div className="card">
        <EmptyState icon={<Lock size={22} />} title="Essa área não é pro seu papel" text="Se precisar, fala com alguém admin da equipe." />
      </div>
    </div>
  );
}

function Home() {
  const { me } = useAuth();
  if (hasPermission(me, 'dashboard')) return <DashboardPage />;
  if (hasPermission(me, 'support')) return <Navigate to="/suporte" replace />;
  if (hasPermission(me, 'users.read')) return <Navigate to="/usuarios" replace />;
  return <Guard perm="dashboard">{null}</Guard>;
}

function NotFound() {
  return (
    <div className="content">
      <PageHeader title="Página não encontrada" />
      <div className="card">
        <EmptyState title="Esse endereço não existe no painel" text="Confere o link ou volta pelo menu." />
      </div>
    </div>
  );
}

function LoginRoute() {
  const { status } = useAuth();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  if (status === 'authenticated') return <Navigate to={from && from !== '/entrar' ? from : '/'} replace />;
  if (status === 'offline') return <OfflineScreen />;
  return <LoginPage />;
}

const router = createBrowserRouter([
  { path: '/entrar', element: <LoginRoute /> },
  {
    path: '/',
    element: <RequireAuth />,
    children: [
      { index: true, element: <Home /> },
      { path: 'metricas', element: <Guard perm="metrics"><MetricsPage /></Guard> },
      { path: 'usuarios', element: <Guard perm="users.read"><UsersPage /></Guard> },
      { path: 'usuarios/:id', element: <Guard perm="users.read"><UserDetailPage /></Guard> },
      { path: 'moderacao', element: <Guard perm="users.moderate"><ModerationPage /></Guard> },
      { path: 'lugares', element: <Guard perm="places"><PlacesPage /></Guard> },
      { path: 'eventos', element: <Guard perm="events"><EventsPage /></Guard> },
      { path: 'eventos/novo', element: <Guard perm="events"><EventFormPage /></Guard> },
      { path: 'eventos/:id', element: <Guard perm="events"><EventFormPage /></Guard> },
      { path: 'notificacoes', element: <Guard perm="campaigns"><NotificationsPage /></Guard> },
      { path: 'suporte', element: <Guard perm="support"><SupportPage /></Guard> },
      { path: 'suporte/:threadId', element: <Guard perm="support"><SupportPage /></Guard> },
      { path: 'auditoria', element: <Guard perm="audit"><AuditPage /></Guard> },
      { path: '*', element: <NotFound /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
