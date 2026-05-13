import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api'

type SearchResponse = {
  tasks?: any[]
  users?: any[]
  projects?: any[]
  reports?: any[]
  notifications?: any[]
  results?: any[]
  meta?: { query?: string; total?: number; took_ms?: number; type?: string }
}

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'users', label: 'People' },
  { key: 'projects', label: 'Projects' },
  { key: 'reports', label: 'Reports' },
  { key: 'notifications', label: 'Notifications' },
]

function pickTitle(type: string, item: any) {
  if (type === 'tasks') return item.title || 'Untitled task'
  if (type === 'users') return item.full_name || item.email || 'Unnamed user'
  if (type === 'projects') return item.name || 'Untitled project'
  if (type === 'reports') return item.report_type || 'Report'
  if (type === 'notifications') return item.title || 'Notification'
  return item.title || item.label || item.name || 'Result'
}

function pickSubtitle(type: string, item: any) {
  if (type === 'tasks') return [item.status?.replace?.(/_/g, ' '), item.priority, item.project_name].filter(Boolean).join(' · ')
  if (type === 'users') return [item.role, item.department, item.email].filter(Boolean).join(' · ')
  if (type === 'projects') return item.description || 'Project'
  if (type === 'reports') return [item.scope_type, item.created_at ? new Date(item.created_at).toLocaleDateString() : null].filter(Boolean).join(' · ')
  if (type === 'notifications') return item.body || item.type || ''
  return item.subtitle || ''
}

function typeLabel(type: string) {
  if (type === 'users') return 'person'
  if (type === 'tasks') return 'task'
  if (type === 'projects') return 'project'
  if (type === 'reports') return 'report'
  if (type === 'notifications') return 'notification'
  return type
}

function ResultCard({ type, item, search }: { type: string; item: any; search: string }) {
  const navigate = useNavigate()
  const title = pickTitle(type, item)
  const subtitle = pickSubtitle(type, item)

  function open() {
    if (type === 'tasks') navigate('/app/tasks', { state: { openTaskId: item.id } })
    else if (type === 'users') navigate(`/app/hr/employees?search=${encodeURIComponent(item.email || item.full_name || search)}`)
    else if (type === 'projects') navigate('/app/projects')
    else if (type === 'reports') navigate(item.id ? `/app/reports/${item.id}` : '/app/reports')
    else navigate('/app/dashboard')
  }

  return (
    <button type="button" onClick={open} className="searchResultCard">
      <div className="searchResultType">{typeLabel(type)}</div>
      <div style={{ minWidth: 0 }}>
        <div className="searchResultTitle">{title}</div>
        {subtitle ? <div className="searchResultSub">{subtitle}</div> : null}
      </div>
    </button>
  )
}

function SearchGroup({ type, items, search }: { type: string; items: any[]; search: string }) {
  if (!items.length) return null
  const tab = TABS.find(t => t.key === type)
  return (
    <section className="searchGroupCard">
      <div className="searchGroupHead">
        <h3>{tab?.label || type}</h3>
        <span>{items.length}</span>
      </div>
      <div className="searchResultsGrid">
        {items.map((item) => <ResultCard key={`${type}-${item.id}`} type={type} item={item} search={search} />)}
      </div>
    </section>
  )
}

export function SearchPage() {
  const [params, setParams] = useSearchParams()
  const initialQ = params.get('q') || ''
  const initialType = params.get('type') || 'all'
  const activeType = TABS.some(t => t.key === initialType) ? initialType : 'all'
  const [input, setInput] = useState(initialQ)
  const [debounced, setDebounced] = useState(initialQ)

  // Sync input from URL on navigation.
  useEffect(() => {
    setInput(initialQ)
    setDebounced(initialQ.trim())
  }, [initialQ])

  // Debounce: update search after 300ms of inactivity.
  useEffect(() => {
    const t = setTimeout(() => {
      const trimmed = input.trim()
      setDebounced(trimmed)
      const current = params.get('q') || ''
      if (trimmed !== current) {
        const next: Record<string, string> = {}
        if (trimmed) next.q = trimmed
        if (activeType !== 'all') next.type = activeType
        setParams(next, { replace: true })
      }
    }, 300)
    return () => clearTimeout(t)
  }, [input, activeType, params, setParams])

  const q = debounced
  const apiType = activeType === 'all' ? '' : `&type=${encodeURIComponent(activeType)}`

  const searchQ = useQuery({
    queryKey: ['full-search', q, activeType],
    queryFn: () => apiFetch<SearchResponse>(`/api/v1/search?q=${encodeURIComponent(q)}&limit=20${apiType}`),
    enabled: q.length >= 2,
    staleTime: 15_000,
    retry: false,
  })

  const grouped = useMemo(() => ({
    tasks: searchQ.data?.tasks || [],
    users: searchQ.data?.users || [],
    projects: searchQ.data?.projects || [],
    reports: searchQ.data?.reports || [],
    notifications: searchQ.data?.notifications || [],
  }), [searchQ.data])

  const total = Object.values(grouped).reduce((sum, arr) => sum + arr.length, 0)
  const visibleGroups = activeType === 'all'
    ? grouped
    : { tasks: [], users: [], projects: [], reports: [], notifications: [], [activeType]: grouped[activeType as keyof typeof grouped] } as typeof grouped

  function setType(type: string) {
    const nextParams: Record<string, string> = {}
    if (q) nextParams.q = q
    if (type !== 'all') nextParams.type = type
    setParams(nextParams)
  }

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div className="pageHeaderCard">
        <div className="pageHeaderCardInner">
          <div className="pageHeaderCardLeft">
            <div className="pageHeaderCardTitle">Global Search</div>
            <div className="pageHeaderCardSub">Search tasks, people, projects, reports, and notifications across your workspace.</div>
          </div>
        </div>
      </div>

      <div className="searchPageForm">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Search your workspace… (results appear as you type)"
          autoFocus
        />
        {searchQ.isFetching && q.length >= 2 && (
          <span style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: 'var(--muted)' }}>Searching…</span>
        )}
      </div>

      <div className="searchTabs">
        {TABS.map(tab => (
          <button key={tab.key} type="button" className={activeType === tab.key ? 'searchTabActive' : ''} onClick={() => setType(tab.key)}>
            {tab.label}
          </button>
        ))}
      </div>

      {q.length < 2 ? (
        <div className="searchEmptyState">Type at least 2 characters to search.</div>
      ) : searchQ.isLoading ? (
        <div className="searchEmptyState">Searching...</div>
      ) : searchQ.isError ? (
        <div className="searchEmptyState">Search failed. Try again.</div>
      ) : total === 0 ? (
        <div className="searchEmptyState">No results for “{q}”. Try another keyword.</div>
      ) : (
        <>
          <div className="searchMeta">{total} result{total === 1 ? '' : 's'} for “{q}”{searchQ.data?.meta?.took_ms != null ? ` · ${searchQ.data.meta.took_ms}ms` : ''}</div>
          <SearchGroup type="tasks" items={visibleGroups.tasks} search={q} />
          <SearchGroup type="users" items={visibleGroups.users} search={q} />
          <SearchGroup type="projects" items={visibleGroups.projects} search={q} />
          <SearchGroup type="reports" items={visibleGroups.reports} search={q} />
          <SearchGroup type="notifications" items={visibleGroups.notifications} search={q} />
        </>
      )}
    </div>
  )
}
