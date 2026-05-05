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
  BarChart3, BookOpen, Building2, Calendar, ClipboardList, CreditCard, FolderKanban,
  Gauge, LayoutDashboard, Link2, ListChecks, Network, ScrollText,
  Settings, Shield, UserRound, Users, ChevronLeft, ChevronRight, Globe,
  UserCheck, Briefcase, Clock, TrendingUp, FileText, Zap,
} from 'lucide-react'

const ICONS: Record<string, React.ComponentType<{ size?: number }>> = {
  Dashboard: LayoutDashboard,
  Tasks: ListChecks,
  'My tasks': ClipboardList,
  Board: FolderKanban,
  Projects: Network,
  Calendar: Calendar,
  Analytics: BarChart3,
  Billing: CreditCard,
  Contractors: Briefcase,
  Jeczone: Gauge,
  Profile: UserRound,
  Settings: Settings,
  Directory: Users,
  Reports: ScrollText,
  Audit: Shield,
  Employees: UserCheck,
  'Time off': Clock,
  Pipeline: TrendingUp,
  Leads: BookOpen,
  Connections: Link2,
  Insights: Zap,
  'Org Settings': Building2,
  Logs: FileText,
}

function labelKey(label: string): string {
  const map: Record<string, string> = {
    Dashboard: 'nav.dashboard', Tasks: 'nav.tasks', 'My tasks': 'nav.myTasks',
    Board: 'nav.board', Projects: 'nav.projects', Calendar: 'nav.calendar',
    Analytics: 'nav.analytics', Billing: 'nav.billing', Contractors: 'nav.contractors',
    Jeczone: 'nav.jeczone', Profile: 'nav.profile', Directory: 'nav.directory',
    Reports: 'nav.reports', Audit: 'nav.audit', Employees: 'nav.employees',
    'Time off': 'nav.timeOff', Pipeline: 'nav.pipeline', Leads: 'nav.leads',
    Connections: 'nav.connections', Insights: 'nav.insights', 'Org Settings': 'nav.settings', Logs: 'nav.logs',
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

function NavItem({ to, label, display, badge, collapsed, onNavigate }: {
  to: string; label: string; display: string; badge?: number; collapsed: boolean; onNavigate?: () => void
}) {
  const Icon = ICONS[label]
  return (
    <NavLink
      to={to}
      data-label={display}
      onClick={onNavigate}
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

  // RTL support — set document direction when language changes
  useEffect(() => {
    const dir = lang === 'ar' ? 'rtl' : 'ltr'
    document.documentElement.dir = dir
    document.documentElement.lang = lang || 'en'
  }, [lang])

  // Sidebar collapse — persisted
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    const s = typeof window !== 'undefined' ? window.localStorage.getItem('tf_sidebar_collapsed') : null
    return s === 'true'
  })
  function toggleSidebar() {
    // On mobile (width <= 900px), toggle the mobile overlay; on desktop collapse sidebar
    if (typeof window !== 'undefined' && window.innerWidth <= 900) {
      setMobileOpen(v => !v)
    } else {
      setCollapsed(v => {
        const next = !v
        window.localStorage.setItem('tf_sidebar_collapsed', String(next))
        return next
      })
    }
  }

  // Mobile sidebar
  const [mobileOpen, setMobileOpen] = useState(false)
  const closeMobileNav = () => setMobileOpen(false)
  const sidebarRef = useRef<HTMLElement>(null)
  const mobileMenuBtnRef = useRef<HTMLButtonElement>(null)

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
        const r = await apiFetch<any>(`/api/v1/search?q=${encodeURIComponent(v.trim())}&limit=8`)
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
  const statsQ = useQuery({
    queryKey: ['shell', 'topbar', 'stats'],
    queryFn: () => apiFetch<{
      tasks?: {
        due_today?: number
        overdue?: number
        completion_rate?: number
      }
    }>('/api/v1/stats/dashboard'),
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: false,
  })
  const dueToday = statsQ.data?.tasks?.due_today ?? 0
  const overdueCount = statsQ.data?.tasks?.overdue ?? 0
  const completionRate = statsQ.data?.tasks?.completion_rate ?? 0
  const displayName = profileQ.data?.user?.full_name?.trim() || me?.fullName?.trim() || me?.email || ''
  const rawAvatarUrl = normalizeAvatarUrl(profileQ.data?.user?.avatar_url)
  const avatarSrc = rawAvatarUrl ? avatarDisplaySrc(rawAvatarUrl, 0) : ''
  const [profileOpen, setProfileOpen] = useState(false)
  const profileRef = useRef<HTMLDivElement>(null)

  // Close profile dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Close mobile sidebar when clicking outside of sidebar/menu button
  useEffect(() => {
    if (!mobileOpen) return
    function handleOutsideClick(e: MouseEvent) {
      const target = e.target as Node
      if (sidebarRef.current?.contains(target)) return
      if (mobileMenuBtnRef.current?.contains(target)) return
      setMobileOpen(false)
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [mobileOpen])

  // Global keyboard shortcuts
  const searchInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // '/' opens search (unless already in an input)
      if (e.key === '/' && !['INPUT','TEXTAREA','SELECT'].includes((e.target as HTMLElement)?.tagName)) {
        e.preventDefault()
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
      }
      // Escape clears search
      if (e.key === 'Escape' && document.activeElement === searchInputRef.current) {
        setSearch(''); setSearchResults(null); setSearchOpen(false)
        searchInputRef.current?.blur()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const [failedAvatarSrc, setFailedAvatarSrc] = useState<string | null>(null)
  const avatarBroken = !!avatarSrc && failedAvatarSrc === avatarSrc

  const hasResults = searchResults && (
    (searchResults.tasks?.length || 0) + (searchResults.users?.length || 0) + (searchResults.projects?.length || 0) > 0
  )
  const activeLang: Lang = (lang || 'en') as Lang

  return (
    <div className={`appShellV4 ${theme === 'light' ? 'appShellV4Light' : 'appShellV4Dark'} ${collapsed ? 'sidebarCollapsed' : ''} ${mobileOpen ? 'sidebarMobileOpen' : ''}`}>

      {/* Scrim */}
      <div className="sidebarScrim" onClick={() => setMobileOpen(false)} />

      {/* ── Sidebar ── */}
      <aside className="sidebarV4" ref={sidebarRef}>

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
                <span className="sidebarV4BrandSub">Task Management by AI</span>
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
          <NavItem to="/app/dashboard" label="Dashboard" display={t(labelKey('Dashboard'))} collapsed={collapsed} onNavigate={closeMobileNav} />
          {canSee(role, 'supervisor') ? (
            <>
              <NavItem to="/app/tasks" label="Tasks" display={t(labelKey('Tasks'))} collapsed={collapsed} onNavigate={closeMobileNav} />
              <NavItem to="/app/my-tasks" label="My tasks" display={t(labelKey('My tasks'))} collapsed={collapsed} onNavigate={closeMobileNav} />
            </>
          ) : (
            <NavItem to="/app/my-tasks" label="My tasks" display={t(labelKey('My tasks'))} collapsed={collapsed} onNavigate={closeMobileNav} />
          )}
          {canSeeItem(role, 'Board') && <NavItem to="/app/board" label="Board" display={t(labelKey('Board'))} collapsed={collapsed} onNavigate={closeMobileNav} />}
          {canSeeItem(role, 'Projects') && <NavItem to="/app/projects" label="Projects" display={t(labelKey('Projects'))} collapsed={collapsed} onNavigate={closeMobileNav} />}
          {canSeeItem(role, 'Calendar') && <NavItem to="/app/calendar" label="Calendar" display={t(labelKey('Calendar'))} collapsed={collapsed} onNavigate={closeMobileNav} />}

          {canSee(role, 'manager') && (
            <>
              {!collapsed && <div className="sidebarV4SectionLabel" style={{ marginTop: 10 }}>Management</div>}
              {canSeeItem(role, 'Analytics') && <NavItem to="/app/analytics" label="Analytics" display={t(labelKey('Analytics'))} collapsed={collapsed} onNavigate={closeMobileNav} />}
              {canSeeItem(role, 'Reports') && <NavItem to="/app/reports" label="Reports" display={t(labelKey('Reports'))} collapsed={collapsed} onNavigate={closeMobileNav} />}
              {canSee(role, 'hr') && <NavItem to="/app/hr/employees" label="Employees" display={t(labelKey('Employees'))} collapsed={collapsed} onNavigate={closeMobileNav} />}
              {canSee(role, 'hr') && <NavItem to="/app/hr/time-off" label="Time off" display={t(labelKey('Time off'))} collapsed={collapsed} onNavigate={closeMobileNav} />}
              {canSeeItem(role, 'Billing') && <NavItem to="/app/billing" label="Billing" display={t(labelKey('Billing'))} collapsed={collapsed} onNavigate={closeMobileNav} />}
            </>
          )}

          {!collapsed && <div className="sidebarV4SectionLabel" style={{ marginTop: 10 }}>Other</div>}
          {canSeeItem(role, 'Contractors') && <NavItem to="/app/contractors" label="Contractors" display={t(labelKey('Contractors'))} collapsed={collapsed} onNavigate={closeMobileNav} />}
          {canSee(role, 'manager') && <NavItem to="/app/insights" label="Insights" display={t(labelKey('Insights'))} collapsed={collapsed} onNavigate={closeMobileNav} />}
          {canSee(role, 'admin') && <NavItem to="/app/settings" label="Org Settings" display={t(labelKey('Org Settings'))} collapsed={collapsed} onNavigate={closeMobileNav} />}
          <NavItem to="/app/jeczone" label="Jeczone" display="JecZone AI" collapsed={collapsed} onNavigate={closeMobileNav} />
          {canSee(role, 'director') && (
            <>
              <NavItem to="/app/crm/leads" label="Leads" display={t(labelKey('Leads'))} collapsed={collapsed} onNavigate={closeMobileNav} />
              <NavItem to="/app/crm/pipeline" label="Pipeline" display={t(labelKey('Pipeline'))} collapsed={collapsed} onNavigate={closeMobileNav} />
              <NavItem to="/app/audit" label="Audit" display={t(labelKey('Audit'))} collapsed={collapsed} onNavigate={closeMobileNav} />
              <NavItem to="/app/logs" label="Logs" display={t(labelKey('Logs'))} collapsed={collapsed} onNavigate={closeMobileNav} />
            </>
          )}

        </nav>

        {/* Bottom — theme toggle padding only */}
        <div className="sidebarV4Bottom" style={{ padding: '8px 10px' }}>
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
            ref={mobileMenuBtnRef}
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
              ref={searchInputRef}
              className="topbarV4SearchInput"
              value={search}
              onChange={e => runSearch(e.target.value)}
              onFocus={() => { if (search.length >= 2) setSearchOpen(true) }}
              onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
              placeholder="Search tasks, people, projects…"
            />
            {!search && (
              <kbd style={{
                position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                fontSize: 10, color: 'var(--muted)', background: 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(255,255,255,0.12)', borderRadius: 5,
                padding: '1px 5px', fontFamily: 'inherit', pointerEvents: 'none',
                lineHeight: 1.6, zIndex: 1,
              }}>/</kbd>
            )}
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
                {!searchBusy && search.length < 2 && <div className="topbarV4SearchEmpty">Type at least 2 characters to search</div>}
                {!searchBusy && hasResults && (
                  <>
                    {searchResults?.tasks?.length > 0 && (
                      <div className="topbarV4SearchGroup">
                        <div className="topbarV4SearchGroupTitle">
                          Tasks
                          <span className="topbarV4SearchGroupCount">{searchResults.tasks.length}</span>
                        </div>
                        {searchResults.tasks.slice(0, 5).map((t: any) => (
                          <button key={t.id} className="topbarV4SearchItem" onMouseDown={e => e.preventDefault()} onClick={() => { setSearch(''); setSearchResults(null); setSearchOpen(false); navigate('/app/tasks', { state: { openTaskId: t.id } }) }}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 12l2 2 4-4"/></svg>
                            <div style={{ minWidth: 0 }}>
                              <div className="topbarV4SearchItemTitle">{t.title}</div>
                              <div className="topbarV4SearchItemSub">{t.status?.replace(/_/g, ' ')} {t.priority ? `· ${t.priority}` : ''}</div>
                            </div>
                          </button>
                        ))}
                        {searchResults.tasks.length > 5 && (
                          <button className="topbarV4SearchSeeAll" onMouseDown={e => e.preventDefault()} onClick={() => { setSearchOpen(false); navigate(`/app/tasks?q=${encodeURIComponent(search)}`) }}>
                            See all {searchResults.tasks.length} tasks →
                          </button>
                        )}
                      </div>
                    )}
                    {searchResults?.users?.length > 0 && (
                      <div className="topbarV4SearchGroup">
                        <div className="topbarV4SearchGroupTitle">
                          People
                          <span className="topbarV4SearchGroupCount">{searchResults.users.length}</span>
                        </div>
                        {searchResults.users.slice(0, 3).map((u: any) => (
                          <button key={u.id} className="topbarV4SearchItem" onMouseDown={e => e.preventDefault()} onClick={() => { setSearch(''); setSearchResults(null); setSearchOpen(false); navigate('/app/hr/employees') }}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                            <div><div className="topbarV4SearchItemTitle">{u.full_name || u.email}</div><div className="topbarV4SearchItemSub">{u.role} {u.department ? `· ${u.department}` : ''}</div></div>
                          </button>
                        ))}
                        {searchResults.users.length > 3 && (
                          <button className="topbarV4SearchSeeAll" onMouseDown={e => e.preventDefault()} onClick={() => { setSearchOpen(false); navigate('/app/hr/employees') }}>
                            See all {searchResults.users.length} people →
                          </button>
                        )}
                      </div>
                    )}
                    {searchResults?.projects?.length > 0 && (
                      <div className="topbarV4SearchGroup">
                        <div className="topbarV4SearchGroupTitle">
                          Projects
                          <span className="topbarV4SearchGroupCount">{searchResults.projects.length}</span>
                        </div>
                        {searchResults.projects.slice(0, 3).map((p: any) => (
                          <button key={p.id} className="topbarV4SearchItem" onMouseDown={e => e.preventDefault()} onClick={() => { setSearch(''); setSearchResults(null); setSearchOpen(false); navigate('/app/projects') }}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                            <div><div className="topbarV4SearchItemTitle">{p.name}</div><div className="topbarV4SearchItemSub">Project{p.task_count != null ? ` · ${p.task_count} tasks` : ''}</div></div>
                          </button>
                        ))}
                        {searchResults.projects.length > 3 && (
                          <button className="topbarV4SearchSeeAll" onMouseDown={e => e.preventDefault()} onClick={() => { setSearchOpen(false); navigate('/app/projects') }}>
                            See all {searchResults.projects.length} projects →
                          </button>
                        )}
                      </div>
                    )}
                    {/* Keyboard hint */}
                    <div className="topbarV4SearchFooter">
                      <span>↑↓ navigate</span><span>Enter to open</span><span>Esc to close</span>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="topbarV4Meta" aria-label="workspace quick metrics">
            <button type="button" className="topbarMetricChip" onClick={() => navigate('/app/tasks')}>
              <span className="topbarMetricDot" />
              Due today <strong>{dueToday}</strong>
            </button>
            <button type="button" className="topbarMetricChip" onClick={() => navigate('/app/tasks?status=overdue')}>
              <span className="topbarMetricDot topbarMetricDotWarn" />
              Overdue <strong>{overdueCount}</strong>
            </button>
            <button type="button" className="topbarMetricChip" onClick={() => navigate('/app/analytics')}>
              <span className="topbarMetricDot topbarMetricDotSuccess" />
              Completion <strong>{completionRate}%</strong>
            </button>
          </div>

          {/* Right: notifications + profile */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto', flexShrink: 0 }}>
            <NotificationCenter />
            <button
              type="button"
              className="topbarThemeBtn"
              onClick={() => setTheme(prev => prev === 'light' ? 'dark' : 'light')}
              title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
              aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
            >
              {theme === 'light' ? '🌙' : '☀️'}
            </button>
            <button
              type="button"
              className="topbarLangBtn"
              onClick={() => setLang(activeLang === 'en' ? 'ar' : 'en')}
              title={`${t('nav.language')}: ${activeLang.toUpperCase()}`}
              aria-label={`Language toggle. Current language ${activeLang.toUpperCase()}`}
            >
              <Globe size={13} />
              <span>{activeLang.toUpperCase()}</span>
            </button>
            <div className="topbarProfileWrap" ref={profileRef}>
              <button type="button" className="topbarV4ProfileBtn"
                onClick={() => setProfileOpen(v => !v)}
                title={displayName}
              >
                {avatarSrc && !avatarBroken ? (
                  <img src={avatarSrc} alt="" onError={() => setFailedAvatarSrc(avatarSrc)} className="topbarV4AvatarImg" />
                ) : <UserRound size={15} />}
              </button>

              {profileOpen && (
                <div className="profileDropdown">
                  <div className="profileDropdownHead">
                    <div className="profileDropdownAvatar">
                      {avatarSrc && !avatarBroken
                        ? <img src={avatarSrc} alt="" onError={() => setFailedAvatarSrc(avatarSrc)} />
                        : (displayName.charAt(0) || '?').toUpperCase()}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div className="profileDropdownName">{displayName || 'My Account'}</div>
                      <div className="profileDropdownEmail">{me?.email || ''}</div>
                      <div className="profileDropdownRole">{me?.role || 'user'}</div>
                    </div>
                  </div>
                  <div className="profileDropdownList">
                    <button className="profileDropdownItem" onClick={() => { setProfileOpen(false); navigate('/app/profile') }}>
                      <UserRound size={14} />
                      My Profile
                    </button>
                    <button className="profileDropdownItem" onClick={() => { setProfileOpen(false); navigate('/app/dashboard') }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
                      Dashboard
                    </button>
                    <div className="profileDropdownDivider" />
                    <button className="profileDropdownItem" onClick={() => { setProfileOpen(false); setTheme(theme === 'light' ? 'dark' : 'light') }}>
                      <span style={{ fontSize: 14 }}>{theme === 'light' ? '🌙' : '☀️'}</span>
                      {theme === 'light' ? 'Switch to Dark' : 'Switch to Light'}
                    </button>
                    <div className="profileDropdownDivider" />
                    <button className="profileDropdownItem profileDropdownItemDanger" onClick={() => {
                      setProfileOpen(false)
                      localStorage.clear()
                      window.location.href = '/signin'
                    }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                      Sign Out
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="contentV4">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
