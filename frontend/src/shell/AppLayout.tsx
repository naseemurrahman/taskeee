import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { NotificationCenter } from './NotificationCenter'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import { avatarDisplaySrc, normalizeAvatarUrl } from '../lib/avatarUrl'
import { getUser } from '../state/auth'
import { useI18n, type Lang } from '../i18n'
import type React from 'react'
import {
  BarChart3, BookOpen, Calendar, ClipboardList, CreditCard, FolderKanban,
  Gauge, LayoutDashboard, Link2, ListChecks, Moon, Network, ScrollText,
  Settings, Shield, Sun, UserRound, Users, LogOut,
} from 'lucide-react'

const ICONS: Record<string, React.ComponentType<{ size?: number }>> = {
  Dashboard: LayoutDashboard, Tasks: ListChecks, 'My tasks': ClipboardList,
  Board: FolderKanban, Projects: Network, Calendar: Calendar, Analytics: BarChart3,
  Billing: CreditCard, Contractors: Users, Jeczone: Gauge, Profile: Settings,
  Directory: Users, Reports: ScrollText, Audit: Shield, Employees: Users,
  'Time off': Calendar, Pipeline: Link2, Leads: BookOpen, Connections: Link2,
  Insights: BarChart3, Logs: ScrollText,
}

function labelKey(label: string) {
  const map: Record<string, string> = {
    Dashboard: 'nav.dashboard', Tasks: 'nav.tasks', 'My tasks': 'nav.myTasks',
    Board: 'nav.board', Projects: 'nav.projects', Calendar: 'nav.calendar',
    Analytics: 'nav.analytics', Billing: 'nav.billing', Contractors: 'nav.contractors',
    Jeczone: 'nav.jeczone', Profile: 'nav.profile', Directory: 'nav.directory',
    Reports: 'nav.reports', Audit: 'nav.audit', Employees: 'nav.employees',
    'Time off': 'nav.timeOff', Pipeline: 'nav.pipeline', Leads: 'nav.leads',
    Connections: 'nav.connections', Insights: 'nav.insights', Logs: 'nav.logs',
  }
  return map[label] || label
}

function canSeeItem(role: string, item: string) {
  const adminOnly = ['Billing', 'Audit', 'Logs']
  const managerUp = ['Analytics', 'Reports']
  if (adminOnly.includes(item)) return ['admin', 'director'].includes(role)
  if (managerUp.includes(item)) return ['admin', 'director', 'hr', 'manager'].includes(role)
  return true
}
function canSee(role: string, min: string) {
  const order = ['employee', 'supervisor', 'manager', 'hr', 'director', 'admin']
  return order.indexOf(role) >= order.indexOf(min)
}
function canSeeMyTasksPage(role: string) {
  return ['employee', 'supervisor', 'manager', 'hr', 'director', 'admin'].includes(role)
}

function NavItem({ to, label, display, badge }: { to: string; label: string; display: string; badge?: number }) {
  const Icon = ICONS[label]
  return (
    <NavLink to={to} className={({ isActive }) => `navItemV4 ${isActive ? 'navItemV4Active' : ''}`}>
      {Icon && <Icon size={16} />}
      <span className="navItemV4Label">{display}</span>
      {badge && badge > 0 ? (
        <span className="navItemV4Badge">{badge > 99 ? '99+' : badge}</span>
      ) : null}
    </NavLink>
  )
}

export function AppLayout() {
  const { t, lang, setLang } = useI18n()
  const me = getUser()
  const role = me?.role || 'employee'
  const navigate = useNavigate()
  const location = useLocation()

  // Theme
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const s = typeof window !== 'undefined' ? window.localStorage.getItem('tf_theme') : null
    return s === 'light' ? 'light' : 'dark'
  })
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('tf_theme', theme)
    document.documentElement.dataset.theme = theme
  }, [theme])

  // Search
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchBusy, setSearchBusy] = useState(false)
  const [searchResults, setSearchResults] = useState<any>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function runSearch(v: string) {
    setSearch(v)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (v.trim().length < 2) { setSearchResults(null); return }
    setSearchBusy(true)
    setSearchOpen(true)
    searchTimer.current = setTimeout(async () => {
      try {
        const r = await apiFetch<any>(`/api/v1/search?q=${encodeURIComponent(v.trim())}&limit=5`)
        setSearchResults(r)
      } catch { setSearchResults(null) }
      setSearchBusy(false)
    }, 300)
  }

  // Sidebar mobile
  const [sidebarOpenMobile, setSidebarOpenMobile] = useState(false)

  // Profile
  const profileQ = useQuery({
    queryKey: ['profile', 'shell'],
    queryFn: () => apiFetch<any>('/api/v1/users/profile'),
    staleTime: 5 * 60 * 1000,
  })
  const displayName = useMemo(() => {
    return profileQ.data?.user?.full_name?.trim() || me?.fullName?.trim() || me?.email || ''
  }, [profileQ.data, me])

  const rawAvatarUrl = normalizeAvatarUrl(profileQ.data?.user?.avatar_url)
  const avatarSrc = rawAvatarUrl ? avatarDisplaySrc(rawAvatarUrl, 0) : ''
  const [avatarBroken, setAvatarBroken] = useState(false)
  useEffect(() => setAvatarBroken(false), [avatarSrc])

  function signOut() {
    apiFetch('/api/v1/auth/logout', { method: 'POST' }).catch(() => {})
    localStorage.removeItem('tf_auth')
    navigate('/signin')
  }

  // Count uncompleted tasks for badge
  const tasksQ = useQuery({
    queryKey: ['shell', 'myTaskCount'],
    queryFn: () => apiFetch<any>('/api/v1/tasks?limit=1&page=1'),
    staleTime: 60_000,
  })
  const overdueCount = tasksQ.data?.meta?.overdue || 0

  const titleMap: Record<string, string> = {
    '/app/dashboard': 'Dashboard', '/app/tasks': 'Tasks', '/app/my-tasks': 'My Tasks',
    '/app/board': 'Board', '/app/projects': 'Projects', '/app/calendar': 'Calendar',
    '/app/analytics': 'Analytics', '/app/billing': 'Billing',
  }
  const pageTitle = useMemo(() => {
    for (const [path, title] of Object.entries(titleMap)) {
      if (location.pathname.startsWith(path)) return title
    }
    if (location.pathname.startsWith('/app/hr/employees')) return 'Employees'
    if (location.pathname.startsWith('/app/hr')) return 'HR'
    if (location.pathname.startsWith('/app/team')) return 'Team'
    if (location.pathname.startsWith('/app/profile')) return 'Profile'
    if (location.pathname.startsWith('/app/reports')) return 'Reports'
    if (location.pathname.startsWith('/app/jeczone')) return 'JecZone AI'
    return 'TaskFlow Pro'
  }, [location.pathname])

  const hasResults = searchResults && (
    (searchResults.tasks?.length || 0) +
    (searchResults.users?.length || 0) +
    (searchResults.projects?.length || 0) > 0
  )

  return (
    <div className={`appShellV4 ${theme === 'light' ? 'appShellV4Light' : 'appShellV4Dark'} ${sidebarOpenMobile ? 'sidebarMobileOpen' : ''}`}>
      {/* Sidebar scrim */}
      <div className="sidebarScrim" onClick={() => setSidebarOpenMobile(false)} />

      {/* ── Sidebar ── */}
      <aside className="sidebarV4">
        {/* Logo */}
        <div className="sidebarV4Logo">
          <NavLink to="/" className="sidebarV4LogoLink">
            <div className="sidebarV4LogoMark">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
              </svg>
            </div>
            <div className="sidebarV4LogoText">
              <span className="sidebarV4BrandName">TaskFlow Pro</span>
              <span className="sidebarV4BrandSub">HR + Workflows + AI</span>
            </div>
          </NavLink>
        </div>

        {/* Nav */}
        <nav className="sidebarV4Nav">
          <div className="sidebarV4Section">
            <div className="sidebarV4SectionLabel">{t('nav.general')}</div>
            {canSeeItem(role, 'Dashboard') && <NavItem to="/app/dashboard" label="Dashboard" display={t(labelKey('Dashboard'))} />}
            {canSeeItem(role, 'Tasks') && <NavItem to="/app/tasks" label="Tasks" display={t(labelKey('Tasks'))} badge={overdueCount} />}
            {canSeeMyTasksPage(role) && <NavItem to="/app/my-tasks" label="My tasks" display={t(labelKey('My tasks'))} />}
            {canSeeItem(role, 'Board') && <NavItem to="/app/board" label="Board" display={t(labelKey('Board'))} />}
            {canSeeItem(role, 'Projects') && <NavItem to="/app/projects" label="Projects" display={t(labelKey('Projects'))} />}
            {canSeeItem(role, 'Calendar') && <NavItem to="/app/calendar" label="Calendar" display={t(labelKey('Calendar'))} />}
          </div>

          {canSee(role, 'manager') && (
            <div className="sidebarV4Section">
              <div className="sidebarV4SectionLabel">Management</div>
              {canSeeItem(role, 'Analytics') && <NavItem to="/app/analytics" label="Analytics" display={t(labelKey('Analytics'))} />}
              {canSeeItem(role, 'Reports') && <NavItem to="/app/reports" label="Reports" display={t(labelKey('Reports'))} />}
              {canSee(role, 'hr') && <NavItem to="/app/hr/employees" label="Employees" display={t(labelKey('Employees'))} />}
              {canSee(role, 'hr') && <NavItem to="/app/hr/time-off" label="Time off" display={t(labelKey('Time off'))} />}
              {canSeeItem(role, 'Billing') && <NavItem to="/app/billing" label="Billing" display={t(labelKey('Billing'))} />}
            </div>
          )}

          <div className="sidebarV4Section">
            <div className="sidebarV4SectionLabel">Other</div>
            {canSeeItem(role, 'Contractors') && <NavItem to="/app/contractors" label="Contractors" display={t(labelKey('Contractors'))} />}
            {canSeeItem(role, 'Jeczone') && <NavItem to="/app/jeczone" label="Jeczone" display="JecZone AI" />}
            {canSee(role, 'director') && (
              <>
                <NavItem to="/app/crm/leads" label="Leads" display={t(labelKey('Leads'))} />
                <NavItem to="/app/crm/pipeline" label="Pipeline" display={t(labelKey('Pipeline'))} />
                <NavItem to="/app/audit" label="Audit" display={t(labelKey('Audit'))} />
                <NavItem to="/app/logs" label="Logs" display={t(labelKey('Logs'))} />
              </>
            )}
          </div>
        </nav>

        {/* Bottom user section */}
        <div className="sidebarV4Bottom">
          {/* Theme + Lang row */}
          <div className="sidebarV4Controls">
            <button
              type="button"
              className="sidebarV4ThemeBtn"
              onClick={() => setTheme(prev => prev === 'light' ? 'dark' : 'light')}
              title={theme === 'light' ? 'Switch to dark' : 'Switch to light'}
            >
              {theme === 'light' ? <Moon size={14} /> : <Sun size={14} />}
              <span>{theme === 'light' ? 'Dark' : 'Light'}</span>
            </button>
            <select
              value={lang || 'en'}
              onChange={e => setLang(e.target.value as Lang)}
              className="sidebarV4LangSelect"
            >
              <option value="en">EN</option>
              <option value="ar">AR</option>
            </select>
          </div>

          {/* User chip */}
          <div className="sidebarV4UserChip">
            <button
              type="button"
              className="sidebarV4UserBtn"
              onClick={() => navigate('/app/profile')}
            >
              <div className="sidebarV4Avatar">
                {avatarSrc && !avatarBroken ? (
                  <img src={avatarSrc} alt="" onError={() => setAvatarBroken(true)} />
                ) : (
                  <UserRound size={16} />
                )}
              </div>
              <div className="sidebarV4UserInfo">
                <span className="sidebarV4UserName">{displayName || 'My profile'}</span>
                <span className="sidebarV4UserRole">{role}</span>
              </div>
            </button>
            <button type="button" className="sidebarV4LogoutBtn" onClick={signOut} title="Sign out">
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main area ── */}
      <main className="mainV4">
        {/* Topbar — search only + notifications + mobile menu */}
        <div className="topbarV4">
          <button
            type="button"
            className="topbarV4MenuBtn"
            onClick={() => setSidebarOpenMobile(v => !v)}
            aria-label="Menu"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
            </svg>
          </button>

          <span className="topbarV4PageTitle">{pageTitle}</span>

          {/* Global search */}
          <div className="topbarV4SearchWrap">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="topbarV4SearchIcon">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              className="topbarV4SearchInput"
              value={search}
              onChange={e => runSearch(e.target.value)}
              onFocus={() => { if (search.length >= 2) setSearchOpen(true) }}
              onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
              placeholder="Search tasks, people, projects…"
              aria-label="Global search"
            />
            {search && (
              <button
                type="button"
                className="topbarV4SearchClear"
                onClick={() => { setSearch(''); setSearchResults(null); setSearchOpen(false) }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            )}
            {/* Search results dropdown */}
            {searchOpen && (
              <div className="topbarV4SearchDropdown">
                {searchBusy && (
                  <div className="topbarV4SearchEmpty">Searching…</div>
                )}
                {!searchBusy && !hasResults && search.length >= 2 && (
                  <div className="topbarV4SearchEmpty">No results for "{search}"</div>
                )}
                {!searchBusy && search.length < 2 && (
                  <div className="topbarV4SearchEmpty">Type at least 2 characters</div>
                )}
                {!searchBusy && hasResults && (
                  <>
                    {searchResults?.tasks?.length > 0 && (
                      <div className="topbarV4SearchGroup">
                        <div className="topbarV4SearchGroupTitle">Tasks</div>
                        {searchResults.tasks.map((t: any) => (
                          <button key={t.id} className="topbarV4SearchItem" onMouseDown={e => e.preventDefault()} onClick={() => { setSearchOpen(false); navigate('/app/tasks') }}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 12l2 2 4-4"/></svg>
                            <div>
                              <div className="topbarV4SearchItemTitle">{t.title}</div>
                              <div className="topbarV4SearchItemSub">{t.status?.replace(/_/g, ' ')}</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                    {searchResults?.users?.length > 0 && (
                      <div className="topbarV4SearchGroup">
                        <div className="topbarV4SearchGroupTitle">People</div>
                        {searchResults.users.map((u: any) => (
                          <button key={u.id} className="topbarV4SearchItem" onMouseDown={e => e.preventDefault()} onClick={() => { setSearchOpen(false); navigate('/app/team') }}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                            <div>
                              <div className="topbarV4SearchItemTitle">{u.full_name || u.fullName || u.email}</div>
                              <div className="topbarV4SearchItemSub">{u.role} · {u.email}</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                    {searchResults?.projects?.length > 0 && (
                      <div className="topbarV4SearchGroup">
                        <div className="topbarV4SearchGroupTitle">Projects</div>
                        {searchResults.projects.map((p: any) => (
                          <button key={p.id} className="topbarV4SearchItem" onMouseDown={e => e.preventDefault()} onClick={() => { setSearchOpen(false); navigate('/app/projects') }}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                            <div>
                              <div className="topbarV4SearchItemTitle">{p.name}</div>
                              <div className="topbarV4SearchItemSub">{p.description || 'Project'}</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
            <NotificationCenter />
            <button
              type="button"
              className="topbarV4ProfileBtn"
              onClick={() => navigate('/app/profile')}
              title={displayName}
            >
              {avatarSrc && !avatarBroken ? (
                <img src={avatarSrc} alt="" onError={() => setAvatarBroken(true)} className="topbarV4AvatarImg" />
              ) : (
                <UserRound size={16} />
              )}
            </button>
          </div>
        </div>

        <div className="contentV4">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
