import { NavLink } from 'react-router';
import {
  CalendarDays,
  ChevronsLeft,
  ChevronsRight,
  Headphones,
  ChartLine,
  LayoutDashboard,
  MapPin,
  Megaphone,
  ScrollText,
  ShieldAlert,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { visibleNav, type NavKey } from '@/lib/permissions';
import { useSupportLive } from '@/realtime/SupportLive';
import { useSocket } from '@/realtime/SocketProvider';
import { CountPill } from '@/components/ui/Badge';

const ICONS: Record<NavKey, LucideIcon> = {
  dashboard: LayoutDashboard,
  metrics: ChartLine,
  users: Users,
  moderation: ShieldAlert,
  places: MapPin,
  events: CalendarDays,
  campaigns: Megaphone,
  support: Headphones,
  audit: ScrollText,
};

const GROUPS: { title: string; keys: NavKey[] }[] = [
  { title: 'Visão geral', keys: ['dashboard', 'metrics'] },
  { title: 'Pessoas', keys: ['users', 'moderation', 'support'] },
  { title: 'Cidade', keys: ['places', 'events'] },
  { title: 'Comunicação', keys: ['campaigns'] },
  { title: 'Controle', keys: ['audit'] },
];

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { me } = useAuth();
  const { waiting } = useSupportLive();
  const { socket, connected } = useSocket();
  const items = visibleNav(me?.permissions ?? []);

  return (
    <aside className="sidebar" aria-label="Menu principal">
      <NavLink to="/" className="brand" aria-label="metch admin, início">
        <span className="brand-mark" aria-hidden="true">
          m
        </span>
        <span className="brand-name">
          metch<span className="dot">.</span>
        </span>
        <span className="brand-tag">admin</span>
      </NavLink>

      <nav className="nav">
        {GROUPS.map((g) => {
          const groupItems = items.filter((i) => g.keys.includes(i.key));
          if (!groupItems.length) return null;
          return (
            <div key={g.title} className="nav">
              <div className="nav-section">{g.title}</div>
              {groupItems.map((item) => {
                const Icon = ICONS[item.key];
                return (
                  <NavLink
                    key={item.key}
                    to={item.path}
                    end={item.path === '/'}
                    className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
                    title={collapsed ? item.label : undefined}
                  >
                    <Icon size={18} aria-hidden="true" />
                    <span className="nav-label">{item.label}</span>
                    {item.key === 'support' ? <CountPill n={waiting} label={`${waiting} esperando resposta`} /> : null}
                  </NavLink>
                );
              })}
            </div>
          );
        })}
      </nav>

      <div className="sidebar-foot">
        {socket ? (
          <div className="collapse-btn" style={{ cursor: 'default' }} title={connected ? 'Tempo real conectado' : 'Tempo real desconectado'}>
            <span className="live-dot" data-on={connected} aria-hidden="true" />
            <span className="collapse-label">{connected ? 'Ao vivo' : 'Reconectando…'}</span>
          </div>
        ) : null}
        <button type="button" className="collapse-btn" onClick={onToggle} aria-label={collapsed ? 'Abrir menu' : 'Recolher menu'} aria-expanded={!collapsed}>
          {collapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
          <span className="collapse-label">Recolher</span>
        </button>
      </div>
    </aside>
  );
}
