import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, ApiError } from '../../../lib/api'

type Lead = {
  id: string
  full_name?: string | null
  email?: string | null
  phone_e164?: string | null
  source?: string | null
  status: string
  owner_name?: string | null
  created_at: string
}

async function fetchLeads(status: string, search: string) {
  const qs = new URLSearchParams({ page: '1', limit: '50' })
  if (status !== 'all') qs.set('status', status)
  if (search.trim()) qs.set('search', search.trim())
  const data = await apiFetch<{ leads: Lead[] }>(`/api/v1/crm/leads?${qs.toString()}`)
  return data.leads || []
}

async function createLead(input: { fullName?: string; email?: string; phoneE164?: string; source?: string }) {
  return await apiFetch(`/api/v1/crm/leads`, { method: 'POST', json: input })
}

export function CrmLeadsPage() {
  const qc = useQueryClient()
  const [status, setStatus] = useState<'all' | string>('all')
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)

  const q = useQuery({ queryKey: ['crm', 'leads', status, search], queryFn: () => fetchLeads(status, search) })
  const leads = useMemo(() => q.data || [], [q.data])

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phoneE164, setPhoneE164] = useState('')
  const [source, setSource] = useState('')

  const m = useMutation({
    mutationFn: createLead,
    onSuccess: async () => {
      setFullName('')
      setEmail('')
      setPhoneE164('')
      setSource('')
      setError(null)
      await qc.invalidateQueries({ queryKey: ['crm', 'leads'] })
    },
    onError: (err) => {
      if (err instanceof ApiError) setError(err.message)
      else setError('Failed to create lead.')
    },
  })

  function onCreate(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const fn = fullName.trim()
    const em = email.trim()
    if (!fn && !em) {
      setError('Add at least a name or email.')
      return
    }
    m.mutate({ fullName: fn || undefined, email: em || undefined, phoneE164: phoneE164.trim() || undefined, source: source.trim() || undefined })
  }

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      {/* Page header card */}
      <div className="pageHeaderCard">
        <div className="pageHeaderCardInner">
          <div className="pageHeaderCardLeft">
            <div className="pageHeaderCardTitle">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
              CRM Leads
            </div>
            <div className="pageHeaderCardSub">Track and manage potential customers and business leads. Add notes, update status, and move leads through your sales pipeline.</div>
            <div className="pageHeaderCardMeta">
              <span className="pageHeaderCardTag"><span style={{ fontSize: 10 }}>📞</span> Lead tracking</span>
              <span className="pageHeaderCardTag"><span style={{ fontSize: 10 }}>💼</span> Sales pipeline</span>
              <span className="pageHeaderCardTag"><span style={{ fontSize: 10 }}>📝</span> Notes & status</span>
            </div>
          </div>
        </div>
      </div>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
          <div>
            <h2 style={{ margin: 0, letterSpacing: '-0.6px' }}>Leads</h2>
            <div style={{ color: 'var(--text2)', marginTop: 4 }}>Capture and qualify incoming leads.</div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <label className="label" style={{ margin: 0 }}>
              Status
              <select className="input" style={{ height: 40 }} value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="all">All</option>
                <option value="open">Open</option>
                <option value="qualified">Qualified</option>
                <option value="disqualified">Disqualified</option>
                <option value="converted">Converted</option>
              </select>
            </label>
            <label className="label" style={{ margin: 0 }}>
              Search
              <input className="input" style={{ height: 40 }} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, email, source…" />
            </label>
          </div>
        </div>

        {error ? <div className="alert alertError" style={{ marginTop: 12 }}>{error}</div> : null}
        {q.isError ? <div className="alert alertError" style={{ marginTop: 12 }}>Failed to load leads.</div> : null}

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
            Phone (E.164)
            <input className="input" value={phoneE164} onChange={(e) => setPhoneE164(e.target.value)} placeholder="+9665…" />
          </label>
          <label className="label">
            Source
            <input className="input" value={source} onChange={(e) => setSource(e.target.value)} placeholder="Website, referral, ad…" />
          </label>
          <button className="btn btnPrimary" type="submit" disabled={m.isPending}>
            {m.isPending ? 'Creating…' : 'Add lead'}
          </button>
        </form>
      </div>

      <div className="card">
        <h3 style={{ margin: 0, marginBottom: 12 }}>Leads list</h3>
        {q.isLoading ? <div style={{ color: 'var(--text2)' }}>Loading…</div> : null}
        {!q.isLoading && leads.length === 0 ? <div style={{ color: 'var(--text2)' }}>No leads found.</div> : null}

        <div style={{ border: '1px solid rgba(255, 255, 255, 0.10)', borderRadius: 16, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 0.7fr 0.7fr', padding: '10px 12px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', color: 'var(--text2)', fontWeight: 900, fontSize: 12 }}>
            <div>Lead</div>
            <div>Contact</div>
            <div>Status</div>
            <div>Source</div>
          </div>
          {leads.map((l) => (
            <div key={l.id} style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 0.7fr 0.7fr', padding: '12px 12px', borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 900, letterSpacing: '-0.2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.full_name || '—'}</div>
                <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 2 }}>{l.owner_name || '—'}</div>
              </div>
              <div style={{ color: 'var(--text2)', fontWeight: 800, minWidth: 0 }}>
                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.email || '—'}</div>
                <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 2 }}>{l.phone_e164 || ''}</div>
              </div>
              <div style={{ fontWeight: 900 }}>{l.status}</div>
              <div style={{ color: 'var(--text2)', fontWeight: 800 }}>{l.source || '—'}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

