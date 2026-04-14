import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, ApiError } from '../../../lib/api'

type Contractor = {
  id: string
  full_name: string
  status: string
  email?: string | null
  phone_e164?: string | null
  company_name?: string | null
  country_code?: string | null
  hourly_rate?: number | null
  currency?: string | null
  owner_name?: string | null
}

type Doc = {
  id: string
  doc_type?: string | null
  created_at: string
  original_filename?: string | null
  mime_type?: string | null
  size_bytes?: number | null
}

type ContractorPatch = {
  fullName?: string
  status?: string
  email?: string | null
  phoneE164?: string | null
  companyName?: string | null
  countryCode?: string | null
  hourlyRate?: number | null
  currency?: string | null
}

async function fetchContractor(id: string) {
  return await apiFetch<{ contractor: Contractor; documents: Doc[] }>(`/api/v1/contractors/${encodeURIComponent(id)}`)
}

async function updateContractor(input: { id: string; patch: ContractorPatch }) {
  return await apiFetch<{ contractor: Contractor }>(`/api/v1/contractors/${encodeURIComponent(input.id)}`, {
    method: 'PATCH',
    json: input.patch,
  })
}

export function ContractorProfilePage() {
  const { id } = useParams()
  const contractorId = id || ''
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['contractor', contractorId], queryFn: () => fetchContractor(contractorId), enabled: !!contractorId })

  const [error, setError] = useState<string | null>(null)

  const m = useMutation({
    mutationFn: updateContractor,
    onSuccess: async () => {
      setError(null)
      await qc.invalidateQueries({ queryKey: ['contractor', contractorId] })
      await qc.invalidateQueries({ queryKey: ['contractors'] })
    },
    onError: (err) => {
      if (err instanceof ApiError) setError(err.message)
      else setError('Update failed.')
    },
  })

  function onSave(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!contractorId) return
    const fd = new FormData(e.currentTarget as HTMLFormElement)
    const fullName = String(fd.get('fullName') || '').trim()
    const status = String(fd.get('status') || '').trim()
    const email = String(fd.get('email') || '').trim()
    const phoneE164 = String(fd.get('phoneE164') || '').trim()
    const companyName = String(fd.get('companyName') || '').trim()
    const countryCode = String(fd.get('countryCode') || '').trim()
    const currency = String(fd.get('currency') || '').trim()
    const hourlyRateRaw = String(fd.get('hourlyRate') || '').trim()
    const hourlyRate = hourlyRateRaw ? Number(hourlyRateRaw) : null

    if (fullName.length < 2) {
      setError('Full name must be at least 2 characters.')
      return
    }
    m.mutate({
      id: contractorId,
      patch: {
        fullName,
        status: status || 'active',
        email: email || null,
        phoneE164: phoneE164 || null,
        companyName: companyName || null,
        countryCode: countryCode || null,
        currency: currency || 'USD',
        hourlyRate: hourlyRate != null && !Number.isNaN(hourlyRate) ? hourlyRate : null,
      },
    })
  }

  const contractor = q.data?.contractor
  const documents = q.data?.documents || []

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
          <div>
            <h2 style={{ margin: 0, letterSpacing: '-0.6px' }}>Contractor profile</h2>
            <div style={{ color: 'var(--text2)', marginTop: 4 }}>Details, status, and documents.</div>
          </div>
          <Link className="btn btnGhost" style={{ height: 40, display: 'grid', placeItems: 'center', padding: '0 12px' }} to="/app/contractors">
            Back to directory
          </Link>
        </div>

        {q.isLoading ? <div style={{ color: 'var(--text2)', marginTop: 12 }}>Loading…</div> : null}
        {q.isError ? <div className="alert alertError" style={{ marginTop: 12 }}>Failed to load contractor.</div> : null}
        {error ? <div className="alert alertError" style={{ marginTop: 12 }}>{error}</div> : null}

        {contractor ? (
          <form onSubmit={onSave} className="form" style={{ marginTop: 12, gridTemplateColumns: '1fr 1fr', alignItems: 'end' }}>
            <label className="label" style={{ gridColumn: '1 / -1' }}>
              Full name
              <input className="input" name="fullName" defaultValue={contractor.full_name || ''} />
            </label>
            <label className="label">
              Status
              <select className="input" name="status" defaultValue={contractor.status || 'active'} style={{ height: 44 }}>
                <option value="active">Active</option>
                <option value="onboarding">Onboarding</option>
                <option value="inactive">Inactive</option>
                <option value="terminated">Terminated</option>
              </select>
            </label>
            <label className="label">
              Email
              <input className="input" name="email" defaultValue={contractor.email || ''} />
            </label>
            <label className="label">
              Phone (E.164)
              <input className="input" name="phoneE164" defaultValue={contractor.phone_e164 || ''} placeholder="+9665…" />
            </label>
            <label className="label">
              Company
              <input className="input" name="companyName" defaultValue={contractor.company_name || ''} />
            </label>
            <label className="label">
              Country code
              <input className="input" name="countryCode" defaultValue={contractor.country_code || ''} placeholder="US, SA, AE…" />
            </label>
            <label className="label">
              Hourly rate
              <input className="input" name="hourlyRate" type="number" min={0} step="0.01" defaultValue={contractor.hourly_rate ?? ''} />
            </label>
            <label className="label">
              Currency
              <input className="input" name="currency" defaultValue={(contractor.currency || 'USD').toUpperCase()} />
            </label>
            <button className="btn btnPrimary" type="submit" disabled={m.isPending}>
              {m.isPending ? 'Saving…' : 'Save changes'}
            </button>
          </form>
        ) : null}
      </div>

      <div className="card">
        <h3 style={{ margin: 0, marginBottom: 12 }}>Documents</h3>
        {documents.length === 0 ? <div style={{ color: 'var(--text2)' }}>No documents yet.</div> : null}
        <div style={{ display: 'grid', gap: 10 }}>
          {documents.map((d) => (
            <div key={d.id} className="miniCard" style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 900, letterSpacing: '-0.2px' }}>{d.original_filename || d.id}</div>
                <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 2 }}>
                  {d.doc_type || 'document'} · {d.mime_type || '—'} · {d.size_bytes ? `${Math.round(d.size_bytes / 1024)} KB` : '—'}
                </div>
              </div>
              <div style={{ color: 'var(--text2)', fontWeight: 800, fontSize: 12, flexShrink: 0 }}>
                {new Date(d.created_at).toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

