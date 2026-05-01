import { useMemo, useState, type FormEvent } from 'react'
import { useToast } from '../../../components/ui/ToastSystem'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, ApiError } from '../../../lib/api'
import { Select } from '../../../components/ui/Select'

type RequestItem = {
  id: string
  employee_name?: string
  start_date: string
  end_date: string
  status: string
  reason?: string | null
  created_at: string
}

async function fetchRequests(status: string) {
  const qs = new URLSearchParams()
  if (status !== 'all') qs.set('status', status)
  const data = await apiFetch<{ requests: RequestItem[] }>(`/api/v1/hris/time-off/requests?${qs.toString()}`)
  return data.requests || []
}

async function createRequest(input: { startDate: string; endDate: string; reason?: string }) {
  return await apiFetch(`/api/v1/hris/time-off/requests`, { method: 'POST', json: input })
}

async function updateRequest(input: { id: string; status: string }) {
  return await apiFetch(`/api/v1/hris/time-off/requests/${encodeURIComponent(input.id)}`, {
    method: 'PATCH',
    json: { status: input.status },
  })
}

export function TimeOffPage() {
  const qc = useQueryClient()
  const { success: toastSuccess, error: toastError } = useToast()
  const [status, setStatus] = useState<'all' | string>('all')
  const [error, setError] = useState<string | null>(null)

  const q = useQuery({ queryKey: ['hris', 'timeoff', status], queryFn: () => fetchRequests(status) })
  const requests = useMemo(() => q.data || [], [q.data])

  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [reason, setReason] = useState('')

  const createM = useMutation({
    mutationFn: createRequest,
    onSuccess: async () => {
      setStartDate('')
      setEndDate('')
      setReason('')
      setError(null)
      await qc.invalidateQueries({ queryKey: ['hris', 'timeoff'] })
      toastSuccess('Time off requested', 'Your request has been submitted for review.')
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : 'Failed to request time off.'
      setError(msg)
      toastError('Request failed', msg)
    },
  })

  const updateM = useMutation({
    mutationFn: updateRequest,
    onSuccess: async (_data, vars) => {
      setError(null)
      await qc.invalidateQueries({ queryKey: ['hris', 'timeoff'] })
      toastSuccess('Request updated', `Time off request has been ${(vars as any).status}.`)
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : 'Failed to update request.'
      setError(msg)
      toastError('Update failed', msg)
    },
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!startDate || !endDate) {
      setError('Start and end dates are required.')
      return
    }
    createM.mutate({ startDate, endDate, reason: reason.trim() || undefined })
  }

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      {/* Page header card */}
      <div className="pageHeaderCard">
        <div className="pageHeaderCardInner">
          <div className="pageHeaderCardLeft">
            <div className="pageHeaderCardTitle">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              Time Off
            </div>
            <div className="pageHeaderCardSub">Submit and manage leave requests. Managers and HR can approve or reject requests. View the full history of all time-off requests.</div>
            <div className="pageHeaderCardMeta">
              <span className="pageHeaderCardTag"><span style={{ fontSize: 10 }}>📅</span> Leave requests</span>
              <span className="pageHeaderCardTag"><span style={{ fontSize: 10 }}>✅</span> Approve / Reject</span>
              <span className="pageHeaderCardTag"><span style={{ fontSize: 10 }}>📊</span> Full history</span>
            </div>
          </div>
          <div style={{ width: 160 }}>
            <Select
              value={status}
              onChange={setStatus}
              options={[
                { value: 'all', label: 'All' },
                { value: 'pending', label: 'Pending' },
                { value: 'approved', label: 'Approved' },
                { value: 'rejected', label: 'Rejected' },
                { value: 'cancelled', label: 'Cancelled' },
              ]}
            />
          </div>
        </div>
      </div>
      <div className="card">
        {error ? <div className="alert alertError" style={{ marginBottom: 12 }}>{error}</div> : null}
        {q.isError ? <div className="alert alertError" style={{ marginBottom: 12 }}>Failed to load requests.</div> : null}

        <form onSubmit={onSubmit} className="form" style={{ marginTop: 12, gridTemplateColumns: '1fr 1fr', alignItems: 'end' }}>
          <label className="label">
            Start date
            <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          <label className="label">
            End date
            <input className="input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </label>
          <label className="label" style={{ gridColumn: '1 / -1' }}>
            Reason (optional)
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Vacation, medical, etc." />
          </label>
          <div style={{ gridColumn: '1 / -1' }}>
            <button className="btn btnPrimary" type="submit" disabled={createM.isPending} style={{ width: 'fit-content' }}>
              {createM.isPending ? 'Submitting…' : 'Request time off'}
            </button>
          </div>
        </form>
      </div>

      <div className="card">
        <h3 style={{ margin: 0, marginBottom: 12 }}>Requests</h3>
        {q.isLoading ? <div style={{ color: 'var(--text2)' }}>Loading…</div> : null}
        {!q.isLoading && requests.length === 0 ? <div style={{ color: 'var(--text2)' }}>No requests yet.</div> : null}

        <div style={{ display: 'grid', gap: 10 }}>
          {requests.map((r) => (
            <div key={r.id} className="miniCard" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 900, letterSpacing: '-0.2px' }}>{r.employee_name || 'Employee'}</div>
                <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 2 }}>
                  {r.start_date} → {r.end_date}{r.reason ? ` · ${r.reason}` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                <span className="pill pillMuted">{r.status}</span>
                {r.status === 'pending' ? (
                  <>
                    <button className="btn btnGhost" style={{ height: 36 }} disabled={updateM.isPending} onClick={() => updateM.mutate({ id: r.id, status: 'approved' })}>
                      Approve
                    </button>
                    <button className="btn btnGhost" style={{ height: 36 }} disabled={updateM.isPending} onClick={() => updateM.mutate({ id: r.id, status: 'rejected' })}>
                      Reject
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
