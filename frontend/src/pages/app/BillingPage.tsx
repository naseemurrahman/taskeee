import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Select } from '../../components/ui/Select'
import { apiFetch, ApiError } from '../../lib/api'

type BillingSummary = {
  subscription: null | {
    status: string
    plan: string | null
    seats: number | null
    currentPeriodEnd?: string | null
    cancelAtPeriodEnd?: boolean
  }
  usage: { usersUsed: number }
}

type Invoice = {
  id: string
  number?: string | null
  status?: string | null
  amountDue: number
  currency: string
  created?: string | null
  hostedInvoiceUrl?: string | null
}

async function fetchSummary() {
  return await apiFetch<BillingSummary>(`/api/v1/billing/summary`)
}

async function fetchInvoices() {
  const data = await apiFetch<{ invoices: Invoice[] }>(`/api/v1/billing/invoices`)
  return data.invoices || []
}

async function startCheckout(input: { plan: string; seats: number }) {
  return await apiFetch<{ url: string }>(`/api/v1/payment/checkout-session`, { method: 'POST', json: input })
}

async function openPortal() {
  return await apiFetch<{ url: string }>(`/api/v1/payment/portal`, { method: 'POST' })
}

export function BillingPage() {
  const summaryQ = useQuery({ queryKey: ['billing', 'summary'], queryFn: fetchSummary })
  const invoicesQ = useQuery({ queryKey: ['billing', 'invoices'], queryFn: fetchInvoices })

  const [error, setError] = useState<string | null>(null)
  const sub = summaryQ.data?.subscription || null
  const usersUsed = summaryQ.data?.usage.usersUsed ?? 0

  const [plan, setPlan] = useState('pro')
  const [seats, setSeats] = useState(1)

  const checkoutM = useMutation({
    mutationFn: startCheckout,
    onSuccess: (d) => {
      setError(null)
      window.location.href = d.url
    },
    onError: (err) => {
      if (err instanceof ApiError) setError(err.message)
      else setError('Failed to start checkout.')
    },
  })

  const portalM = useMutation({
    mutationFn: openPortal,
    onSuccess: (d) => {
      setError(null)
      window.location.href = d.url
    },
    onError: (err) => {
      if (err instanceof ApiError) setError(err.message)
      else setError('Failed to open portal.')
    },
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const s = Math.max(1, Math.floor(seats || 1))
    checkoutM.mutate({ plan, seats: s })
  }

  const invoices = useMemo(() => invoicesQ.data || [], [invoicesQ.data])

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      {/* Page header card */}
      <div className="pageHeaderCard">
        <div className="pageHeaderCardInner">
          <div className="pageHeaderCardLeft">
            <div className="pageHeaderCardTitle">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
              Billing
            </div>
            <div className="pageHeaderCardSub">Manage your subscription plan, view seat usage, update payment details, and track billing history.</div>
            <div className="pageHeaderCardMeta">
              <span className="pageHeaderCardTag"><span style={{ fontSize: 10 }}>💳</span> Subscription plan</span>
              <span className="pageHeaderCardTag"><span style={{ fontSize: 10 }}>👥</span> Seat usage</span>
              <span className="pageHeaderCardTag"><span style={{ fontSize: 10 }}>📈</span> Billing history</span>
            </div>
          </div>
          <button className="btn btnGhost" style={{ height: 40, padding: '0 12px' }} onClick={() => portalM.mutate()} disabled={portalM.isPending}>
            {portalM.isPending ? 'Opening…' : 'Manage billing'}
          </button>
        </div>
      </div>
      {error ? <div className="alertV4 alertV4Error">{error}</div> : null}
      {summaryQ.isError ? <div className="alertV4 alertV4Error">Failed to load billing summary.</div> : null}

      <div className="grid4">
        <div className="miniCard">
          <div className="miniLabel">Plan</div>
          <div className="miniValue">{sub?.plan || '—'}</div>
        </div>
        <div className="miniCard">
          <div className="miniLabel">Status</div>
          <div className="miniValue">{sub?.status || '—'}</div>
        </div>
        <div className="miniCard">
          <div className="miniLabel">Seats</div>
          <div className="miniValue">{sub?.seats ?? '—'}</div>
        </div>
        <div className="miniCard">
          <div className="miniLabel">Active users</div>
          <div className="miniValue">{usersUsed}</div>
        </div>
      </div>

      <div className="card">
        <h3 style={{ margin: 0, marginBottom: 12 }}>Upgrade / change plan</h3>
        <form onSubmit={onSubmit} className="form" style={{ gridTemplateColumns: '1fr 1fr', alignItems: 'end' }}>
          <label className="label">
            Plan
<div style={{ minWidth: 200 }}>
              <Select value={plan} onChange={setPlan}
                options={[
                  { value: 'basic', label: 'Basic' },
                  { value: 'pro', label: 'Pro' },
                  { value: 'enterprise', label: 'Enterprise' },
                ]}
              />
            </div>
          </label>
          <label className="label">
            Seats
            <input className="input" type="number" min={1} step={1} value={seats} onChange={(e) => setSeats(parseInt(e.target.value || '1', 10))} />
          </label>
          <button className="btn btnPrimary" type="submit" disabled={checkoutM.isPending}>
            {checkoutM.isPending ? 'Redirecting…' : 'Continue to Stripe'}
          </button>
        </form>
      </div>

      <div className="card">
        <h3 style={{ margin: 0, marginBottom: 12 }}>Invoices</h3>
        {invoicesQ.isLoading ? <div style={{ color: 'var(--text2)' }}>Loading…</div> : null}
        {invoicesQ.isError ? <div className="alert alertError">Failed to load invoices.</div> : null}
        {!invoicesQ.isLoading && invoices.length === 0 ? <div style={{ color: 'var(--text2)' }}>No invoices yet.</div> : null}

        <div style={{ display: 'grid', gap: 10 }}>
          {invoices.map((inv) => (
            <div key={inv.id} className="miniCard" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 900, letterSpacing: '-0.2px' }}>{inv.number || inv.id}</div>
                <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 2 }}>
                  {inv.created ? new Date(inv.created).toLocaleDateString() : '—'} · {inv.status || '—'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span className="pill">{inv.currency.toUpperCase()} {inv.amountDue.toFixed(2)}</span>
                {inv.hostedInvoiceUrl ? (
                  <a className="btn btnGhost" style={{ height: 36, display: 'grid', placeItems: 'center', padding: '0 12px' }} href={inv.hostedInvoiceUrl} target="_blank" rel="noreferrer">
                    View
                  </a>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
