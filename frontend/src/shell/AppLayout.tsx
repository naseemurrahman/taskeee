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
  BarChart3,
  BookOpen,
  Calendar,
  ClipboardList,
  CreditCard,
  FolderKanban,
  Gauge,
  LayoutDashboard,
  Link2,
  ListChecks,
  Lock,
  Moon,
  Network,
  ScrollText,
  Settings,
  Shield,
  Sun,
  UserRound,
  Users,
} from 'lucide-react'

const ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  Dashboard: LayoutDashboard,
  Tasks: ListChecks,
  'My tasks': ClipboardList,
  Board: FolderKanban,
  Projects: Network,
  Calendar: Calendar,
  Analytics: BarChart3,
  Billing: CreditCard,
  Contractors: Users,
  Jeczone: Gauge,
  Profile: Settings,
  Directory: Users,
  Reports: ScrollText,
  Audit: Shield,
  Employees: Users,
  'Time off': Calendar,
  Pipeline: Link2,
  Leads: BookOpen,
  Connections: Link2,
  Insights: BarChart3,
  Logs: ScrollText,
}

function labelKey(label: string) {
  if (label === 'Dashboard') return 'nav.dashboard'
  if (label === 'Tasks') return 'nav.tasks'
  if (label === 'My tasks') return 'nav.myTasks'
  if (label === 'Board') return 'nav.board'
  if (label === 'Projects') return 'nav.projects'
  if (label === 'Calendar') return 'nav.calendar'
  if (label === 'Analytics') return 'nav.analytics'
  if (label === 'Billing') return 'nav.billing'
  if (label === 'Contractors') return 'nav.contractors'
  if (label === 'Jeczone') return 'nav.jeczone'
  if (label === 'Profile') return 'nav.profile'
  if (label === 'Directory') return 'nav.directory'
  if (label === 'Reports') return 'nav.reports'
  if (label === 'Audit') return 'nav.audit'
  if (label === 'Employees') return 'nav.employees'
  if (label === 'Time off') return 'nav.timeOff'
  if (label === 'Pipeline') return 'nav.pipeline'
  if (label === 'Leads') return 'nav.leads'
  if (label === 'Connections') return 'nav.connections'
  if (label === 'Insights') return 'nav.insights'
  if (label === 'Logs') return 'nav.logs'
  return label
}

function NavItem(props: { to: string; label: string; collapsed?: boolean; display?: string }) {
  const Icon = ICONS[props.label] || Lock
  const visibleLabel = props.display || props.label
  return (
    <NavLink
      className={({ isActive }) => `navItem ${isActive ? 'navItemActive' : ''}`}
      to={props.to}
      title={props.collapsed ? visibleLabel : undefined}
    >
      <span className="navIcon" aria-hidden="true">
        <Icon size={16} />
      </span>
      <span className="navLabel">{visibleLabel}</span>
    </NavLink>
  )
}

function getTitle(pathname: string) {
  if (pathname.startsWith('/app/hr/')) return 'hr'
  if (pathname.startsWith('/app/crm/')) return 'crm'
  if (pathname.startsWith('/app/billing')) return 'billing'
  if (pathname.startsWith('/app/contractors')) return 'contractors'
  if (pathname.startsWith('/app/jeczone')) return 'jeczone'
  if (pathname.startsWith('/app/analytics')) return 'analytics'
  if (pathname.startsWith('/app/projects')) return 'projects'
  if (pathname.startsWith('/app/board')) return 'board'
  if (pathname.startsWith('/app/my-tasks')) return 'myTasks'
  if (pathname.startsWith('/app/tasks')) return 'tasks'
  if (pathname.startsWith('/app/calendar')) return 'calendar'
  if (pathname.startsWith('/app/team')) return 'team'
  if (pathname.startsWith('/app/reports')) return 'reports'
  if (pathname.startsWith('/app/insights')) return 'insights'
  if (pathname.startsWith('/app/integrations')) return 'integrations'
  if (pathname.startsWith('/app/audit')) return 'audit'
  if (pathname.startsWith('/app/logs')) return 'logs'
  if (pathname.startsWith('/app/hr/employees')) return 'hr'
  if (pathname.startsWith('/app/profile')) return 'profile'
  if (pathname === '/app' || pathname.startsWith('/app/dashboard')) return 'dashboard'
  if (pathname.startsWith('/app/')) return 'dashboard'
  return 'taskflow'
}

type Role = 'admin' | 'director' | 'hr' | 'manager' | 'supervisor' | 'employee'
function roleRank(role: string): number {
  const r = role as Role
  if (r === 'admin') return 100
  if (r === 'director') return 90
  if (r === 'hr') return 80
  if (r === 'manager') return 70
  if (r === 'supervisor') return 60
  return 50
}

function canSee(role: string | undefined, min: Role) {
  return roleRank(role || 'employee') >= roleRank(min)
}

/** Assignee-focused work queue — not for org-wide HR/Admin roles. */
function canSeeMyTasksPage(role: string | undefined) {
  return ['employee', 'supervisor', 'manager', 'director'].includes(role || 'employee')
}

function canSeeItem(role: string | undefined, item: string) {
  const r = (role || 'employee') as Role
  if (r === 'employee') {
    return ['Dashboard', 'Tasks', 'Projects', 'Analytics'].includes(item)
  }
  if (r === 'supervisor' || r === 'manager') {
    return [
      'Dashboard',
      'Tasks',
      'Board',
      'Projects',
      'Calendar',
      'Analytics',
      'Jeczone',
      'Directory',
      'Reports',
      'Audit',
      'Pipeline',
      'Leads',
    ].includes(item)
  }
  if (r === 'hr') {
    return [
      'Dashboard',
      'Tasks',
      'Projects',
      'Calendar',
      'Analytics',
      'Directory',
      'Reports',
      'Audit',
      'Employees',
      'Time off',
      'Connections',
      'Insights',
      'Logs',
    ].includes(item)
  }
  // director/admin: everything
  return true
}

type SearchResult = {
  tasks: Array<{ id: string; title: string; status: string }>
  users: Array<{ id: string; full_name?: string; fullName?: string; email: string; role: string }>
  reports: Array<{ id: string; report_type?: string; scope_type?: string; created_at: string }>
  notifications: Array<{ id: string; title?: string; body?: string; created_at: string; is_read?: boolean }>
  projects?: Array<{ id: string; name: string; description?: string | null }>
}

const GLOBAL_SEARCH_Q = 'tf_global_search_q'

function readStoredSearch() {
  try {
    return sessionStorage.getItem(GLOBAL_SEARCH_Q) || ''
  } catch {
    return ''
  }
}

function writeStoredSearch(value: string) {
  try {
    if (value.trim()) sessionStorage.setItem(GLOBAL_SEARCH_Q, value)
    else sessionStorage.removeItem(GLOBAL_SEARCH_Q)
  } catch {
    /* ignore quota / private mode */
  }
}

async function fetchSearch(q: string) {
  const qs = new URLSearchParams({ q })
  return await apiFetch<SearchResult>(`/api/v1/search?${qs.toString()}`)
}

type ShellUser = { avatar_url?: string | null; full_name?: string | null }
async function fetchShellProfile(userId: string) {
  return await apiFetch<{ user: ShellUser }>(`/api/v1/users/${encodeURIComponent(userId)}`)
}

export function AppLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const titleId = getTitle(location.pathname)
  const me = getUser()
  const role = me?.role
  const { lang, setLang, t } = useI18n()

  const profileQ = useQuery({
    queryKey: ['me', me?.id],
    queryFn: () => fetchShellProfile(me!.id!),
    enabled: !!me?.id,
    staleTime: 20_000,
  })
  const avatarUrl = profileQ.data?.user?.avatar_url
  const avatarOk = !!normalizeAvatarUrl(avatarUrl)
  const avatarSrc = avatarDisplaySrc(avatarUrl, profileQ.dataUpdatedAt)
  const [shellAvatarBroken, setShellAvatarBroken] = useState(false)
  useEffect(() => {
    setShellAvatarBroken(false)
  }, [avatarUrl])
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem('tf_theme') : null
    return stored === 'light' ? 'light' : 'dark'
  })
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('tf_theme', theme)
    document.documentElement.dataset.theme = theme
  }, [theme])
  const displayName = useMemo(() => {
    const fromApi = profileQ.data?.user?.full_name?.trim()
    if (fromApi) return fromApi
    const fromMe = me?.fullName?.trim()
    if (fromMe) return fromMe
    return me?.email || ''
  }, [profileQ.data?.user?.full_name, me?.fullName, me?.email])
  const [sidebarOpenMobile, setSidebarOpenMobile] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(280)
  const [shellNarrow, setShellNarrow] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 860px)').matches : false,
  )
  const resizeDragRef = useRef<{ startX: number; startW: number } | null>(null)
  const [search, setSearch] = useState(readStoredSearch)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<SearchResult | null>(null)

  const trimmed = search.trim()
  const hasQuery = trimmed.length >= 2

  const flatCount = useMemo(() => {
    if (!results) return 0
    return (
      (results.tasks?.length || 0) +
      (results.users?.length || 0) +
      (results.reports?.length || 0) +
      (results.notifications?.length || 0) +
      (results.projects?.length || 0)
    )
  }, [results])

  async function runSearch(value: string) {
    const q = value.trim()
    setSearch(value)
    writeStoredSearch(value)
    if (q.length < 2) {
      setResults(null)
      setOpen(false)
      return
    }
    setOpen(true)
    setBusy(true)
    try {
      const data = await fetchSearch(q)
      setResults(data)
    } finally {
      setBusy(false)
    }
  }

  const searchRestoreDone = useRef(false)
  useEffect(() => {
    if (searchRestoreDone.current) return
    searchRestoreDone.current = true
    const s = readStoredSearch().trim()
    if (s.length >= 2) void runSearch(readStoredSearch())
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot restore
  }, [])

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 860px)')
    function sync() {
      setShellNarrow(mq.matches)
    }
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    function onMove(e: MouseEvent) {
      const d = resizeDragRef.current
      if (!d) return
      const dx = e.clientX - d.startX
      const next = Math.max(220, Math.min(360, d.startW + dx))
      setSidebarWidth(next)
    }
    function onUp() {
      resizeDragRef.current = null
      document.body.style.cursor = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  return (
    <div
      className={`appShell ${theme === 'light' ? 'appShellLight' : ''} ${sidebarOpenMobile ? 'appShellMobileSidebarOpen' : ''}`}
      style={
        shellNarrow
          ? { gridTemplateColumns: 'minmax(0, 1fr)' }
          : { gridTemplateColumns: `${sidebarWidth}px minmax(0, 1fr)` }
      }
    >
      <div
        className="sidebarScrim"
        role="button"
        tabIndex={0}
        aria-label="Close sidebar"
        onClick={() => setSidebarOpenMobile(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') setSidebarOpenMobile(false)
        }}
      />
      <aside className="sidebar" aria-label="Primary sidebar">
        <div
          className="sidebarResizeHandle"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          onMouseDown={(e) => {
            resizeDragRef.current = { startX: e.clientX, startW: sidebarWidth }
            document.body.style.cursor = 'col-resize'
          }}
        />
        <div className="sidebarBrandBar">
          <NavLink
            to="/"
            className={({ isActive }) => `brandNameLink ${isActive ? 'brandNameLinkActive' : ''}`}
            title="TaskFlow Pro"
            style={{ display: 'flex', alignItems: 'center', gap: 10 }}
          >
            <div style={{
              width: 32, height: 32, borderRadius: 10, flexShrink: 0,
              background: 'linear-gradient(135deg, #f4ca57, #d4a030)',
              display: 'grid', placeItems: 'center', color: '#0b0d12',
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                <path d="M2 17l10 5 10-5"/>
                <path d="M2 12l10 5 10-5"/>
              </svg>
            </div>
            <div>
              <span className="brandNameFull" style={{ display: 'block', fontWeight: 950, letterSpacing: '-0.3px' }}>TaskFlow Pro</span>
              <span className="brandNameFull" style={{ display: 'block', fontSize: 10, color: 'var(--muted)', fontWeight: 700 }}>HR + Workflows + AI</span>
            </div>
            <span className="brandNameShort" aria-hidden>TF</span>
          </NavLink>
        </div>

        <div
          className="sidebarNavScroll"
          onClick={(e) => {
            if (!shellNarrow) return
            const el = e.target as HTMLElement
            if (el.closest('a.navItem')) setSidebarOpenMobile(false)
          }}
        >
          <div style={{ display: 'grid', gap: 4 }}>
            <div className="sidebarSectionLabel">{t('nav.general')}</div>
            {canSeeItem(role, 'Dashboard') ? <NavItem to="/app/dashboard" label="Dashboard" display={t(labelKey('Dashboard'))} collapsed={false} /> : null}
            {canSeeItem(role, 'Tasks') ? <NavItem to="/app/tasks" label="Tasks" display={t(labelKey('Tasks'))} collapsed={false} /> : null}
            {canSeeMyTasksPage(role) ? <NavItem to="/app/my-tasks" label="My tasks" display={t(labelKey('My tasks'))} collapsed={false} /> : null}
            {canSeeItem(role, 'Board') ? <NavItem to="/app/board" label="Board" display={t(labelKey('Board'))} collapsed={false} /> : null}
            {canSeeItem(role, 'Projects') ? <NavItem to="/app/projects" label="Projects" display={t(labelKey('Projects'))} collapsed={false} /> : null}
            {canSeeItem(role, 'Calendar') ? <NavItem to="/app/calendar" label="Calendar" display={t(labelKey('Calendar'))} collapsed={false} /> : null}
            {canSeeItem(role, 'Analytics') ? <NavItem to="/app/analytics" label="Analytics" display={t(labelKey('Analytics'))} collapsed={false} /> : null}
            {canSeeItem(role, 'Billing') ? <NavItem to="/app/billing" label="Billing" display={t(labelKey('Billing'))} collapsed={false} /> : null}
            {canSeeItem(role, 'Contractors') ? <NavItem to="/app/contractors" label="Contractors" display={t(labelKey('Contractors'))} collapsed={false} /> : null}
            {canSeeItem(role, 'Jeczone') ? <NavItem to="/app/jeczone" label="Jeczone" display={t(labelKey('Jeczone'))} collapsed={false} /> : null}

            {canSee(role, 'manager') ? (
              <>
                <div className="sidebarSectionLabel" style={{ marginTop: 6 }}>{t('nav.team')}</div>
                {canSeeItem(role, 'Directory') ? <NavItem to="/app/team" label="Directory" display={t(labelKey('Directory'))} collapsed={false} /> : null}
                {canSeeItem(role, 'Reports') ? <NavItem to="/app/reports" label="Reports" display={t(labelKey('Reports'))} collapsed={false} /> : null}
                {canSeeItem(role, 'Audit') ? <NavItem to="/app/audit" label="Audit" display={t(labelKey('Audit'))} collapsed={false} /> : null}
              </>
            ) : null}

            {canSee(role, 'hr') ? (
              <>
                <div className="sidebarSectionLabel" style={{ marginTop: 6 }}>{t('nav.peopleOps')}</div>
                {canSeeItem(role, 'Employees') ? <NavItem to="/app/hr/employees" label="Employees" display={t(labelKey('Employees'))} collapsed={false} /> : null}
                {canSeeItem(role, 'Time off') ? <NavItem to="/app/hr/time-off" label="Time off" display={t(labelKey('Time off'))} collapsed={false} /> : null}
              </>
            ) : null}

            {canSee(role, 'manager') ? (
              <>
                <div className="sidebarSectionLabel" style={{ marginTop: 6 }}>{t('nav.sales')}</div>
                {canSeeItem(role, 'Pipeline') ? <NavItem to="/app/crm/pipeline" label="Pipeline" display={t(labelKey('Pipeline'))} collapsed={false} /> : null}
                {canSeeItem(role, 'Leads') ? <NavItem to="/app/crm/leads" label="Leads" display={t(labelKey('Leads'))} collapsed={false} /> : null}
              </>
            ) : null}

            {canSee(role, 'hr') ? (
              <>
                <div className="sidebarSectionLabel" style={{ marginTop: 6 }}>{t('nav.integrations')}</div>
                {canSeeItem(role, 'Connections') ? <NavItem to="/app/integrations" label="Connections" display={t(labelKey('Connections'))} collapsed={false} /> : null}
                {canSeeItem(role, 'Insights') ? <NavItem to="/app/insights" label="Insights" display={t(labelKey('Insights'))} collapsed={false} /> : null}
              </>
            ) : null}

            {canSee(role, 'admin') ? (
              <>
                <div className="sidebarSectionLabel" style={{ marginTop: 6 }}>{t('nav.admin')}</div>
                <NavItem to="/app/logs" label="Logs" display={t(labelKey('Logs'))} collapsed={false} />
                <div style={{ color: 'var(--muted)', fontSize: 11, fontWeight: 700, padding: '4px 2px', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ padding: '2px 8px', borderRadius: 6, background: 'rgba(244,202,87,0.10)', border: '1px solid rgba(244,202,87,0.18)', color: '#f4ca57', fontSize: 10, fontWeight: 800 }}>Soon</span>
                  Admin tools
                </div>
              </>
            ) : null}

            {/* User chip */}
            <NavLink
              to="/app/profile"
              className="sidebarUserChip"
              style={{ marginTop: 14 }}
            >
              <div className="sidebarUserAvatar">
                {displayName ? displayName.charAt(0).toUpperCase() : '?'}
              </div>
              <div style={{ minWidth: 0 }}>
                <div className="sidebarUserName" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {displayName || me?.email || 'Profile'}
                </div>
                <div className="sidebarUserRole">{role || 'user'}</div>
              </div>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--muted)', flexShrink: 0, marginLeft: 'auto' }}>
                <path d="M9 18l6-6-6-6"/>
              </svg>
            </NavLink>

            <div className="sidebarLangBlock" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select
                className="input sidebarLangSelect"
                style={{ flex: 1 }}
                value={lang}
                onChange={(e) => setLang(e.target.value as Lang)}
                aria-label={t('nav.language')}
              >
                <option value="en">{t('lang.en')}</option>
                <option value="ar">{t('lang.ar')}</option>
              </select>
              <button
                type="button"
                className="themeToggleV3"
                aria-label={theme === 'light' ? t('theme.dark') : t('theme.light')}
                title={theme === 'light' ? t('theme.dark') : t('theme.light')}
                onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
              >
                {theme === 'light' ? <Moon size={14} /> : <Sun size={14} />}
                <span style={{ fontSize: 11 }}>{theme === 'light' ? 'Dark' : 'Light'}</span>
              </button>
            </div>
          </div>
        </div>
      </aside>

      <main className="main">
        <div className="topbar topbarApp">
          <button className="topbarMenuBtn" type="button" aria-label="Open sidebar" onClick={() => setSidebarOpenMobile(true)}>
            <LayoutDashboard size={16} />
          </button>
          <div className="topbarTitle">
            {titleId === 'dashboard' ? t('title.dashboard')
              : titleId === 'tasks' ? t('title.tasks')
              : titleId === 'myTasks' ? t('title.myTasks')
              : titleId === 'analytics' ? t('title.analytics')
              : titleId === 'profile' ? t('title.profile')
              : titleId === 'logs' ? t('title.logs')
              : titleId === 'hr' ? t('nav.employees')
              : 'TaskFlow Pro'}
          </div>
          <div className="topbarSearch">
            <input
              className="input"
              style={{ height: 40, width: '100%' }}
              value={search}
              onChange={(e) => void runSearch(e.target.value)}
              onFocus={() => setOpen(hasQuery)}
              onBlur={() => setTimeout(() => setOpen(false), 120)}
              placeholder={t('common.searchPlaceholder')}
              aria-label="Global search"
            />
            {open ? (
              <div className="searchPopover" role="dialog" aria-label="Search results">
                {!hasQuery ? <div className="searchEmpty">{t('search.typeAtLeastTwo')}</div> : null}
                {busy ? <div className="searchEmpty">{t('search.searching')}</div> : null}
                {!busy && hasQuery && flatCount === 0 ? <div className="searchEmpty">{t('search.noResults')}</div> : null}

                {!busy && results?.tasks?.length ? (
                  <div className="searchGroup">
                    <div className="searchGroupTitle">{t('search.group.tasks')}</div>
                    {results.tasks.map((t) => (
                      <button
                        key={t.id}
                        className="searchItem"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setOpen(false)
                          navigate('/app/tasks')
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div className="searchItemStrong">{t.title}</div>
                          <div className="searchItemSub">{t.status}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : null}

                {!busy && results?.users?.length ? (
                  <div className="searchGroup">
                    <div className="searchGroupTitle">{t('search.group.people')}</div>
                    {results.users.map((u) => (
                      <button
                        key={u.id}
                        className="searchItem"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setOpen(false)
                          navigate('/app/team')
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div className="searchItemStrong">{u.full_name || u.fullName || u.email}</div>
                          <div className="searchItemSub">{u.email} · {u.role}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : null}

                {!busy && results?.reports?.length ? (
                  <div className="searchGroup">
                    <div className="searchGroupTitle">{t('search.group.reports')}</div>
                    {results.reports.map((r) => (
                      <button
                        key={r.id}
                        className="searchItem"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setOpen(false)
                          navigate(`/app/reports/${r.id}`)
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div className="searchItemStrong">{r.report_type || t('search.report')}</div>
                          <div className="searchItemSub">{new Date(r.created_at).toLocaleString()}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : null}

                {!busy && results?.notifications?.length ? (
                  <div className="searchGroup">
                    <div className="searchGroupTitle">{t('search.group.notifications')}</div>
                    {results.notifications.map((n) => (
                      <button
                        key={n.id}
                        className="searchItem"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setOpen(false)
                          navigate('/app/dashboard')
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div className="searchItemStrong">{n.title || t('search.notification')}</div>
                          <div className="searchItemSub">{n.body || new Date(n.created_at).toLocaleString()}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : null}

                {!busy && results?.projects?.length ? (
                  <div className="searchGroup">
                    <div className="searchGroupTitle">{t('search.group.projects')}</div>
                    {results.projects.map((p) => (
                      <button
                        key={p.id}
                        className="searchItem"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setOpen(false)
                          navigate('/app/projects')
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div className="searchItemStrong">{p.name}</div>
                          <div className="searchItemSub">{p.description || t('search.openProjects')}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          <NotificationCenter />
          <div className="topbarEnd">
            <span className="topbarUserName" title={displayName}>
              {displayName}
            </span>
            <button
              type="button"
              className="topbarProfileBtn"
              onClick={() => navigate('/app/profile')}
              title={t('nav.profile')}
              aria-label={t('nav.profile')}
            >
              {avatarOk && !shellAvatarBroken ? (
                <img src={avatarSrc} alt="" onError={() => setShellAvatarBroken(true)} />
              ) : (
                <UserRound size={18} />
              )}
            </button>
          </div>
        </div>
        <div className="content">
          <Outlet />
        </div>
      </main>
    </div>
  )
}

