import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, ApiError } from '../../../lib/api'

type Contractor = {
  id: string
  full_name: string
  status: string
  email?: string | null
  company_name?: string | null
  country_code?: string | null
  hourly_rate?: number | null
  currency?: string | null
  owner_name?: string | null
}

async function fetchContractors(search: string, status: string) {
  const qs = new URLSearchParams({ page: '1', limit: '50' })
  if (search.trim()) qs.set('search', search.trim())
  if (status !== 'all') qs.set('status', status)
  const data = await apiFetch<{ contractors: Contractor[] }>(`/api/v1/contractors?${qs.toString()}`)
  return data.contractors || []
}

async function createContractor(input: {
  fullName: string
  email?: string
  companyName?: string
  countryCode?: string
  hourlyRate?: number
  currency?: string
}) {
  return await apiFetch(`/api/v1/contractors`, { method: 'POST', json: input })
}

export function ContractorsPage() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'all' | string>('all')
  const [error, setError] = useState<string | null>(null)

  const q = useQuery({ queryKey: ['contractors', search, status], queryFn: () => fetchContractors(search, status) })
  const contractors = useMemo(() => q.data || [], [q.data])

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [countryCode, setCountryCode] = useState('')
  const [hourlyRate, setHourlyRate] = useState<number>(0)
  const [currency, setCurrency] = useState('USD')

  const m = useMutation({
    mutationFn: createContractor,
    onSuccess: async () => {
      setFullName('')
      setEmail('')
      setCompanyName('')
      setCountryCode('')
      setHourlyRate(0)
      setCurrency('USD')
      setError(null)
      await qc.invalidateQueries({ queryKey: ['contractors'] })
    },
    onError: (err) => {
      if (err instanceof ApiError) setError(err.message)
      else setError('Failed to create contractor.')
    },
  })

  function onCreate(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const n = fullName.trim()
    if (n.length < 2) {
      setError('Full name must be at least 2 characters.')
      return
    }
    m.mutate({
      fullName: n,
      email: email.trim() || undefined,
      companyName: companyName.trim() || undefined,
      countryCode: countryCode.trim() || undefined,
      hourlyRate: hourlyRate > 0 ? hourlyRate : undefined,
      currency: currency.trim() || undefined,
    })
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {/* Page header card */}
      <div className="pageHeaderCard">
        <div className="pageHeaderCardInner">
          <div className="pageHeaderCardLeft">
            <div className="pageHeaderCardTitle">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              Contractors
            </div>
            <div className="pageHeaderCardSub">Manage external contractors — add, track, and view profiles for all contracted workers in your organization.</div>
            <div className="pageHeaderCardMeta">
              <span className="pageHeaderCardTag"><span style={{ fontSize: 10 }}>🤝</span> External workers</span>
              <span className="pageHeaderCardTag"><span style={{ fontSize: 10 }}>📄</span> Contract tracking</span>
              <span className="pageHeaderCardTag"><span style={{ fontSize: 10 }}>👤</span> Profiles</span>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ margin: 0, letterSpacing: '-0.6px' }}>Contractors</h2>
            <div style={{ color: 'var(--text2)', marginTop: 4 }}>Manage contractors and engagements.</div>
          </div>
          <div className="contractorsToolbar" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label className="label" style={{ margin: 0 }}>
              Status
              <select className="input" style={{ height: 40 }} value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="onboarding">Onboarding</option>
                <option value="inactive">Inactive</option>
                <option value="terminated">Terminated</option>
              </select>
            </label>
            <label className="label" style={{ margin: 0 }}>
              Search
              <input className="input" style={{ height: 40 }} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, email, company…" />
            </label>
          </div>
        </div>

        {error ? <div className="alert alertError" style={{ marginTop: 12 }}>{error}</div> : null}
        {q.isError ? <div className="alert alertError" style={{ marginTop: 12 }}>Failed to load contractors.</div> : null}

        <form onSubmit={onCreate} className="form" style={{ marginTop: 12, gridTemplateColumns: '1fr 1fr', alignItems: 'end' }}>
          <label className="label">
            Full name
            <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </label>
          <label className="label">
            Email
            <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="label">
            Company
            <input className="input" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
          </label>
          <label className="label">
            Country code
            <input className="input" value={countryCode} onChange={(e) => setCountryCode(e.target.value)} placeholder="US, SA, AE…" />
          </label>
          <label className="label">
            Hourly rate
            <input className="input" type="number" min={0} step="0.01" value={hourlyRate || ''} onChange={(e) => setHourlyRate(parseFloat(e.target.value || '0'))} />
          </label>
          <label className="label">
            Currency
            <input className="input" value={currency} onChange={(e) => setCurrency(e.target.value)} placeholder="USD" />
          </label>
          <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-start' }}>
            <button className="btn btnPrimary" type="submit" disabled={m.isPending} style={{ width: 'fit-content', minWidth: 'auto' }}>
              {m.isPending ? 'Creating…' : 'Add contractor'}
            </button>
          </div>
        </form>
      </div>

      <div className="card">
        <h3 style={{ margin: 0, marginBottom: 12 }}>Directory</h3>
        {q.isLoading ? <div style={{ color: 'var(--text2)' }}>Loading…</div> : null}
        {!q.isLoading && contractors.length === 0 ? <div style={{ color: 'var(--text2)' }}>No contractors found.</div> : null}

        <div className="contractorsTableWrap" style={{ border: '1px solid rgba(255, 255, 255, 0.10)', borderRadius: 16, overflow: 'auto' }}>
          <div className="contractorsTableGrid" style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr 0.7fr 0.6fr', minWidth: 520, padding: '10px 12px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', color: 'var(--text2)', fontWeight: 900, fontSize: 12 }}>
            <div>Contractor</div>
            <div>Company</div>
            <div>Rate</div>
            <div>Status</div>
          </div>
          {contractors.map((c) => (
            <Link
              key={c.id}
              to={`/app/contractors/${c.id}`}
              className="contractorsTableGrid"
              style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr 0.7fr 0.6fr', minWidth: 520, padding: '12px 12px', borderBottom: '1px solid rgba(255, 255, 255, 0.06)', textDecoration: 'none', color: 'inherit' }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 900, letterSpacing: '-0.2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.full_name}</div>
                <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.email || '—'}
                </div>
              </div>
              <div style={{ color: 'var(--text2)', fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.company_name || '—'}</div>
              <div style={{ color: 'var(--text2)', fontWeight: 800 }}>
                {c.hourly_rate != null ? `${(c.currency || 'USD').toUpperCase()} ${c.hourly_rate}/hr` : '—'}
              </div>
              <div style={{ fontWeight: 900 }}>{c.status}</div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}

