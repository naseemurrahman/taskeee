import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { NotificationCenter } from './NotificationCenter'
import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import { avatarDisplaySrc, normalizeAvatarUrl } from '../lib/avatarUrl'
import { getUser } from '../state/auth'
import { useI18n, type Lang } from '../i18n'
import type React from 'react'
import {
  BarChart3, BookOpen, Calendar, ClipboardList, CreditCard, FolderKanban,
  Gauge, LayoutDashboard, Link2, ListChecks, Moon, Network, ScrollText,
  Settings, Shield, Sun, UserRound, Users, ChevronLeft, ChevronRight, Globe,
} from 'lucide-react'

const ICONS: Record<string, React.ComponentType<{ size?: number }>> = {
  Dashboard: LayoutDashboard, Tasks: ListChecks, 'My tasks': ClipboardList,
  Board: FolderKanban, Projects: Network, Calendar: Calendar, Analytics: BarChart3,
  Billing: CreditCard, Contractors: Users, Jeczone: Gauge, Profile: Settings,
  Directory: Users, Reports: ScrollText, Audit: Shield, Employees: Users,
  'Time off': Calendar, Pipeline: Link2, Leads: BookOpen, Connections: Link2,
  Insights: BarChart3, Logs: ScrollText,
}

function labelKey(label: string): string {
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

function NavItem({ to, label, display, badge, collapsed }: {
  to: string; label: string; display: string; badge?: number; collapsed: boolean
}) {
  const Icon = ICONS[label]
  return (
    <NavLink
      to={to}
      data-label={display}
      className={({ isActive }) => `navItemV4 ${isActive ? 'navItemV4Active' : ''}`}
      title={collapsed ? display : undefined}
    >
      {Icon && <Icon size={16} />}
      {!collapsed && <span className="navItemV4Label">{display}</span>}
      {!collapsed && badge && badge > 0 ? (
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

  // Theme — persisted
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const s = typeof window !== 'undefined' ? window.localStorage.getItem('tf_theme') : null
    return s === 'light' ? 'light' : 'dark'
  })
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('tf_theme', theme)
    document.documentElement.dataset.theme = theme
  }, [theme])

  // Sidebar collapse — persisted
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    const s = typeof window !== 'undefined' ? window.localStorage.getItem('tf_sidebar_collapsed') : null
    return s === 'true'
  })
  function toggleSidebar() {
    setCollapsed(v => {
      const next = !v
      window.localStorage.setItem('tf_sidebar_collapsed', String(next))
      return next
    })
  }

  // Mobile sidebar
  const [mobileOpen, setMobileOpen] = useState(false)

  // Global search
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchBusy, setSearchBusy] = useState(false)
  const [searchResults, setSearchResults] = useState<any>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function runSearch(v: string) {
    setSearch(v)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (v.trim().length < 2) { setSearchResults(null); setSearchOpen(false); return }
    setSearchBusy(true); setSearchOpen(true)
    searchTimer.current = setTimeout(async () => {
      try {
        const r = await apiFetch<any>(`/api/v1/search?q=${encodeURIComponent(v.trim())}&limit=5`)
        setSearchResults(r)
      } catch { setSearchResults(null) }
      setSearchBusy(false)
    }, 300)
  }

  // Profile
  const profileQ = useQuery({
    queryKey: ['profile', 'shell'],
    queryFn: () => apiFetch<any>('/api/v1/users/profile'),
    staleTime: 5 * 60 * 1000,
  })
  const displayName = profileQ.data?.user?.full_name?.trim() || me?.fullName?.trim() || me?.email || ''
  const rawAvatarUrl = normalizeAvatarUrl(profileQ.data?.user?.avatar_url)
  const avatarSrc = rawAvatarUrl ? avatarDisplaySrc(rawAvatarUrl, 0) : ''
  const [avatarBroken, setAvatarBroken] = useState(false)
  useEffect(() => setAvatarBroken(false), [avatarSrc])

  const hasResults = searchResults && (
    (searchResults.tasks?.length || 0) + (searchResults.users?.length || 0) + (searchResults.projects?.length || 0) > 0
  )
  const activeLang: Lang = (lang || 'en') as Lang

  return (
    <div className={`appShellV4 ${theme === 'light' ? 'appShellV4Light' : 'appShellV4Dark'} ${collapsed ? 'sidebarCollapsed' : ''} ${mobileOpen ? 'sidebarMobileOpen' : ''}`}>

      {/* Scrim */}
      <div className="sidebarScrim" onClick={() => setMobileOpen(false)} />

      {/* ── Sidebar ── */}
      <aside className="sidebarV4">

        {/* Logo + collapse toggle */}
        <div className="sidebarV4Logo">
          <NavLink to="/" className="sidebarV4LogoLink">
            <div className="sidebarV4LogoMark">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
              </svg>
            </div>
            {!collapsed && (
              <div>
                <span className="sidebarV4BrandName">TaskFlow Pro</span>
                <span className="sidebarV4BrandSub">HR + Workflows + AI</span>
              </div>
            )}
          </NavLink>
          {/* Collapse toggle — desktop only */}
          <button
            type="button"
            onClick={toggleSidebar}
            className="sidebarCollapseBtn"
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
          </button>
        </div>

        {/* Nav */}
        <nav className="sidebarV4Nav">
          {!collapsed && <div className="sidebarV4SectionLabel">{t('nav.general')}</div>}
          <NavItem to="/app/dashboard" label="Dashboard" display={t(labelKey('Dashboard'))} collapsed={collapsed} />
          {canSeeItem(role, 'Tasks') && <NavItem to="/app/tasks" label="Tasks" display={t(labelKey('Tasks'))} collapsed={collapsed} />}
          {<NavItem to="/app/my-tasks" label="My tasks" display={t(labelKey('My tasks'))} collapsed={collapsed} />}
          {canSeeItem(role, 'Board') && <NavItem to="/app/board" label="Board" display={t(labelKey('Board'))} collapsed={collapsed} />}
          {canSeeItem(role, 'Projects') && <NavItem to="/app/projects" label="Projects" display={t(labelKey('Projects'))} collapsed={collapsed} />}
          {canSeeItem(role, 'Calendar') && <NavItem to="/app/calendar" label="Calendar" display={t(labelKey('Calendar'))} collapsed={collapsed} />}

          {canSee(role, 'manager') && (
            <>
              {!collapsed && <div className="sidebarV4SectionLabel" style={{ marginTop: 10 }}>Management</div>}
              {canSeeItem(role, 'Analytics') && <NavItem to="/app/analytics" label="Analytics" display={t(labelKey('Analytics'))} collapsed={collapsed} />}
              {canSeeItem(role, 'Reports') && <NavItem to="/app/reports" label="Reports" display={t(labelKey('Reports'))} collapsed={collapsed} />}
              {canSee(role, 'hr') && <NavItem to="/app/hr/employees" label="Employees" display={t(labelKey('Employees'))} collapsed={collapsed} />}
              {canSee(role, 'hr') && <NavItem to="/app/hr/time-off" label="Time off" display={t(labelKey('Time off'))} collapsed={collapsed} />}
              {canSeeItem(role, 'Billing') && <NavItem to="/app/billing" label="Billing" display={t(labelKey('Billing'))} collapsed={collapsed} />}
            </>
          )}

          {!collapsed && <div className="sidebarV4SectionLabel" style={{ marginTop: 10 }}>Other</div>}
          {canSeeItem(role, 'Contractors') && <NavItem to="/app/contractors" label="Contractors" display={t(labelKey('Contractors'))} collapsed={collapsed} />}
          <NavItem to="/app/jeczone" label="Jeczone" display="JecZone AI" collapsed={collapsed} />
          {canSee(role, 'director') && (
            <>
              <NavItem to="/app/crm/leads" label="Leads" display={t(labelKey('Leads'))} collapsed={collapsed} />
              <NavItem to="/app/crm/pipeline" label="Pipeline" display={t(labelKey('Pipeline'))} collapsed={collapsed} />
              <NavItem to="/app/audit" label="Audit" display={t(labelKey('Audit'))} collapsed={collapsed} />
              <NavItem to="/app/logs" label="Logs" display={t(labelKey('Logs'))} collapsed={collapsed} />
            </>
          )}
        </nav>

        {/* Bottom */}
        <div className="sidebarV4Bottom">
          {!collapsed && (
            <div className="sidebarV4Controls sidebarV4ControlsStack">
              <div className="sidebarThemeToggle" aria-label={t('nav.theme')}>
                <button
                  type="button"
                  className={`sidebarThemeToggleBtn ${theme === 'light' ? 'active' : ''}`}
                  onClick={() => setTheme('light')}
                  title="Light mode"
                >
                  <Sun size={13} />
                </button>
                <button
                  type="button"
                  className={`sidebarThemeToggleBtn ${theme === 'dark' ? 'active' : ''}`}
                  onClick={() => setTheme('dark')}
                  title="Dark mode"
                >
                  <Moon size={13} />
                </button>
              </div>
            </div>
          )}
          {collapsed && (
            <div style={{ padding: '8px 4px', borderBottom: '1px solid var(--border)', display: 'grid', gap: 8, justifyItems: 'center' }}>
              <button
                type="button"
                className="sidebarV4ThemeBtn"
                style={{ width: 34, height: 34, padding: 0, justifyContent: 'center', flex: 'none' }}
                onClick={() => setTheme(prev => prev === 'light' ? 'dark' : 'light')}
                title={theme === 'light' ? 'Dark mode' : 'Light mode'}
              >
                {theme === 'light' ? <Moon size={14} /> : <Sun size={14} />}
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="mainV4">
        {/* Topbar — search + actions only, no page title */}
        <div className="topbarV4">
          {/* Mobile hamburger */}
          <button
            type="button"
            className="topbarV4MenuBtn"
            onClick={() => setMobileOpen(v => !v)}
            aria-label="Menu"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
            </svg>
          </button>

          {/* Global search — centred in topbar */}
          <div className="topbarV4SearchWrap">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="topbarV4SearchIcon">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              className="topbarV4SearchInput"
              value={search}
              onChange={e => runSearch(e.target.value)}
              onFocus={() => { if (search.length >= 2) setSearchOpen(true) }}
              onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
              placeholder="Search tasks, people, projects…"
            />
            {search && (
              <button type="button" className="topbarV4SearchClear"
                onClick={() => { setSearch(''); setSearchResults(null); setSearchOpen(false) }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            )}
            {searchOpen && (
              <div className="topbarV4SearchDropdown">
                {searchBusy && <div className="topbarV4SearchEmpty">Searching…</div>}
                {!searchBusy && !hasResults && search.length >= 2 && <div className="topbarV4SearchEmpty">No results for "{search}"</div>}
                {!searchBusy && search.length < 2 && <div className="topbarV4SearchEmpty">Type at least 2 characters</div>}
                {!searchBusy && hasResults && (
                  <>
                    {searchResults?.tasks?.length > 0 && (
                      <div className="topbarV4SearchGroup">
                        <div className="topbarV4SearchGroupTitle">Tasks</div>
                        {searchResults.tasks.map((t: any) => (
                          <button key={t.id} className="topbarV4SearchItem" onMouseDown={e => e.preventDefault()} onClick={() => { setSearchOpen(false); navigate('/app/tasks') }}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 12l2 2 4-4"/></svg>
                            <div><div className="topbarV4SearchItemTitle">{t.title}</div><div className="topbarV4SearchItemSub">{t.status?.replace(/_/g, ' ')}</div></div>
                          </button>
                        ))}
                      </div>
                    )}
                    {searchResults?.users?.length > 0 && (
                      <div className="topbarV4SearchGroup">
                        <div className="topbarV4SearchGroupTitle">People</div>
                        {searchResults.users.map((u: any) => (
                          <button key={u.id} className="topbarV4SearchItem" onMouseDown={e => e.preventDefault()} onClick={() => { setSearchOpen(false); navigate('/app/hr/employees') }}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                            <div><div className="topbarV4SearchItemTitle">{u.full_name || u.email}</div><div className="topbarV4SearchItemSub">{u.role}</div></div>
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
                            <div><div className="topbarV4SearchItemTitle">{p.name}</div><div className="topbarV4SearchItemSub">Project</div></div>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Right: notifications + profile */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto', flexShrink: 0 }}>
            <NotificationCenter />
            <button
              type="button"
              className="topbarLangBtn"
              onClick={() => setLang(activeLang === 'en' ? 'ar' : 'en')}
              title={t('nav.language')}
            >
              <Globe size={13} />
              <span>{activeLang.toUpperCase()}</span>
            </button>
            <button type="button" className="topbarV4ProfileBtn" onClick={() => navigate('/app/profile')} title={displayName}>
              {avatarSrc && !avatarBroken ? (
                <img src={avatarSrc} alt="" onError={() => setAvatarBroken(true)} className="topbarV4AvatarImg" />
              ) : <UserRound size={15} />}
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
