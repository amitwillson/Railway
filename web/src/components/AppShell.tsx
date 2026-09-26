import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import Icon, { type IconName } from './Icon';
import { useAuth } from '../state/AuthContext';
import { useOffline } from '../state/OfflineContext';
import { titleCase } from '../lib/format';

const THEME_KEY = 'ri.theme';

function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>(() => {
    try {
      return (localStorage.getItem(THEME_KEY) as 'light' | 'dark' | 'system') ?? 'system';
    } catch {
      return 'system';
    }
  });
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);
  return { theme, setTheme };
}

interface NavItem { to: string; label: string; icon: IconName; count?: number; alert?: boolean; end?: boolean }

export function AppShell({ children }: { children: ReactNode }) {
  const { user, counters, unread, signOut } = useAuth();
  const { online, queue, syncing, sync } = useOffline();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [justSynced, setJustSynced] = useState(false);

  useEffect(() => setMenuOpen(false), [location.pathname]);

  useEffect(() => {
    if (queue.length === 0 && justSynced) {
      const timer = window.setTimeout(() => setJustSynced(false), 4000);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [queue.length, justSynced]);

  useEffect(() => {
    if (syncing) setJustSynced(true);
  }, [syncing]);

  const isSupervisor = user?.role === 'supervisor';

  const primary: NavItem[] = [
    { to: '/', label: 'Home', icon: 'home', end: true },
    { to: '/inspections/new', label: 'New Inspection', icon: 'plus' },
    {
      to: isSupervisor ? '/compliance' : '/observations?open=1',
      label: isSupervisor ? 'Compliance' : 'Pending',
      icon: 'list',
      count: isSupervisor ? counters?.assigned_to_me : counters?.pending,
    },
    { to: '/dashboard', label: 'Dashboard', icon: 'chart' },
  ];

  const groups: { label: string; items: NavItem[] }[] = [
    {
      label: 'Inspection modules',
      items: [
        { to: '/modules/PA', label: 'Passenger Amenities', icon: 'water' },
        { to: '/modules/CI', label: 'Commercial Inspection', icon: 'clipboard' },
        { to: '/modules/SR', label: 'Safe Running - Commercial', icon: 'shield' },
      ],
    },
    {
      label: 'Work',
      items: [
        { to: '/inspections/new', label: 'New Inspection', icon: 'plus' },
        { to: '/inspections', label: 'My Inspections', icon: 'clipboard', end: true },
        { to: '/observations?open=1', label: 'Pending Observations', icon: 'list', count: counters?.pending },
        { to: '/compliance', label: 'Compliance', icon: 'check', count: counters?.awaiting_verification },
        { to: '/observations?overdue=1', label: 'Overdue', icon: 'alert', count: counters?.overdue, alert: true },
      ],
    },
    {
      label: 'Records',
      items: [
        { to: '/stations', label: 'Station History', icon: 'station' },
        { to: '/trains', label: 'Train Inspection', icon: 'train' },
        { to: '/reports', label: 'Reports', icon: 'file' },
        { to: '/dashboard', label: 'Dashboard', icon: 'chart' },
      ],
    },
  ];

  if (user?.role === 'admin' || user?.role === 'divisional_officer') {
    groups.push({
      label: 'Administration',
      items: [
        { to: '/admin', label: 'Admin Panel', icon: 'settings' },
        { to: '/admin/audit', label: 'Audit Trail', icon: 'shield' },
      ],
    });
  }

  return (
    <div className="app">
      <header className="topbar">
        <button
          className="topbar__btn"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Menu"
          style={{ display: 'grid' }}
        >
          <Icon name={menuOpen ? 'close' : 'menu'} size={19} />
        </button>
        <Link to="/" className="topbar__brand" style={{ color: 'inherit', textDecoration: 'none' }}>
          <span className="topbar__mark"><Icon name="train" size={18} /></span>
          <span style={{ minWidth: 0 }}>
            <span className="topbar__title">Railway Inspection</span>
            <span className="topbar__sub" style={{ display: 'block' }}>
              {user ? `${user.name} · ${titleCase(user.role)}` : 'Commercial Department'}
            </span>
          </span>
        </Link>
        <span className="topbar__spacer" />
        <button className="topbar__btn" onClick={() => navigate('/search')} aria-label="Search">
          <Icon name="search" size={18} />
        </button>
        <button
          className="topbar__btn"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18} />
        </button>
        <button className="topbar__btn" onClick={() => navigate('/notifications')} aria-label="Notifications">
          <Icon name="bell" size={18} />
          {unread > 0 && <span className="topbar__badge">{unread > 99 ? '99+' : unread}</span>}
        </button>
      </header>

      {!online && (
        <div className="offline-bar">
          <Icon name="offline" size={14} /> Offline - saved locally on this device
          {queue.length > 0 && <strong>· {queue.length} waiting</strong>}
        </div>
      )}
      {online && queue.length > 0 && (
        <div className="offline-bar offline-bar--sync">
          <Icon name="cloud-up" size={14} />
          {syncing ? 'Syncing...' : `${queue.length} item${queue.length === 1 ? '' : 's'} waiting to sync`}
          {!syncing && (
            <button className="chart__toggle" onClick={() => void sync()}>Sync now</button>
          )}
        </div>
      )}
      {online && queue.length === 0 && justSynced && (
        <div className="offline-bar offline-bar--ok">
          <Icon name="check" size={14} /> Successfully synced
        </div>
      )}

      <div className="shell">
        <nav className="sidenav" aria-label="Main navigation">
          {groups.map((group) => (
            <div className="sidenav__group" key={group.label}>
              <div className="sidenav__label">{group.label}</div>
              {group.items.map((item) => (
                <NavLink
                  key={item.to + item.label}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => (isActive ? 'active' : '')}
                >
                  <Icon name={item.icon} size={17} />
                  <span className="truncate">{item.label}</span>
                  {!!item.count && (
                    <span className={`sidenav__pill${item.alert ? ' sidenav__pill--alert' : ''}`}>{item.count}</span>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
          <div className="sidenav__group">
            <div className="sidenav__label">Account</div>
            <NavLink to="/profile" className={({ isActive }) => (isActive ? 'active' : '')}>
              <Icon name="user" size={17} /> <span>Profile & sessions</span>
            </NavLink>
            {queue.length > 0 && (
              <NavLink to="/sync" className={({ isActive }) => (isActive ? 'active' : '')}>
                <Icon name="cloud-up" size={17} /> <span>Pending sync</span>
                <span className="sidenav__pill">{queue.length}</span>
              </NavLink>
            )}
            <a
              href="#logout"
              onClick={(e) => {
                e.preventDefault();
                void signOut();
              }}
            >
              <Icon name="logout" size={17} /> <span>Sign out</span>
            </a>
          </div>
        </nav>

        <main className="content">{children}</main>
      </div>

      {menuOpen && (
        <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setMenuOpen(false)}>
          <div className="sheet">
            <header className="sheet__head">
              <h2 style={{ fontSize: '1rem' }}>Menu</h2>
              <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={() => setMenuOpen(false)} aria-label="Close menu">
                <Icon name="close" size={17} />
              </button>
            </header>
            <div className="sheet__body">
              {groups.map((group) => (
                <div key={group.label} style={{ marginBottom: 14 }}>
                  <div className="section-label">{group.label}</div>
                  <div className="stack" style={{ '--gap': '4px' } as React.CSSProperties}>
                    {group.items.map((item) => (
                      <Link
                        key={item.to + item.label}
                        to={item.to}
                        className="login__demo-row"
                        style={{ marginBottom: 0 }}
                      >
                        <Icon name={item.icon} size={17} />
                        <span style={{ flex: 1 }}>{item.label}</span>
                        {!!item.count && <span className="badge">{item.count}</span>}
                        <Icon name="chevron-right" size={15} />
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
              <div className="section-label">Account</div>
              <Link to="/profile" className="login__demo-row"><Icon name="user" size={17} /> Profile & sessions</Link>
              {queue.length > 0 && (
                <Link to="/sync" className="login__demo-row">
                  <Icon name="cloud-up" size={17} /> Pending sync <span className="badge">{queue.length}</span>
                </Link>
              )}
              <button className="login__demo-row" onClick={() => void signOut()} style={{ width: '100%' }}>
                <Icon name="logout" size={17} /> Sign out
              </button>
            </div>
          </div>
        </div>
      )}

      <nav className="bottomnav" aria-label="Quick navigation">
        {primary.map((item) => (
          <NavLink key={item.label} to={item.to} end={item.end} className={({ isActive }) => (isActive ? 'active' : '')}>
            <Icon name={item.icon} size={20} />
            {item.label}
            {!!item.count && <span className="bottomnav__count">{item.count > 99 ? '99+' : item.count}</span>}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

export default AppShell;
