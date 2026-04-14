import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { apiFetch, ApiError } from '../../lib/api'

type AvailableIntegration = {
  type: string
  provider: string
  name: string
  description: string
  features: string[]
  icon: string
  category: string
}

type ConnectedIntegration = {
  id: string
  integration_type: string
  provider: string
  is_active: boolean
  created_at: string
  last_sync_at?: string | null
  created_by_name?: string | null
}

type IntegrationsResponse = {
  available_integrations: AvailableIntegration[]
  connected_integrations: ConnectedIntegration[]
  categories: string[]
}

async function fetchIntegrations() {
  return await apiFetch<IntegrationsResponse>(`/api/v1/integrations`)
}

async function connectIntegration(input: { provider: string; integration_type: string }) {
  return await apiFetch(`/api/v1/integrations/connect`, { method: 'POST', json: { ...input, redirect_url: window.location.href } })
}

export function IntegrationsPage() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['integrations'], queryFn: fetchIntegrations })
  const [error, setError] = useState<string | null>(null)

  const connectedProviders = useMemo(() => new Set((q.data?.connected_integrations || []).map((x) => x.provider)), [q.data])

  const m = useMutation({
    mutationFn: connectIntegration,
    onSuccess: async (data: any) => {
      setError(null)
      if (data?.auth_url) window.location.href = data.auth_url as string
      await qc.invalidateQueries({ queryKey: ['integrations'] })
    },
    onError: (err) => {
      if (err instanceof ApiError) setError(err.message)
      else setError('Failed to connect integration.')
    },
  })

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
          <div>
            <h2 style={{ margin: 0, letterSpacing: '-0.6px' }}>Integrations</h2>
            <div style={{ color: 'var(--text2)', marginTop: 4 }}>Connect third-party tools (OAuth where configured).</div>
          </div>
        </div>
        {error ? <div className="alert alertError" style={{ marginTop: 12 }}>{error}</div> : null}
      </div>

      <div className="card">
        <h3 style={{ margin: 0, marginBottom: 12 }}>Connected</h3>
        {q.isLoading ? <div style={{ color: 'var(--text2)' }}>Loading…</div> : null}
        {q.isError ? <div className="alert alertError">Failed to load integrations.</div> : null}
        <div style={{ display: 'grid', gap: 10 }}>
          {(q.data?.connected_integrations || []).map((c) => (
            <div key={c.id} className="miniCard" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 900, letterSpacing: '-0.2px' }}>{c.provider}</div>
                <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 2 }}>
                  {c.integration_type} · {c.last_sync_at ? `last sync ${new Date(c.last_sync_at).toLocaleString()}` : 'not synced yet'}
                </div>
              </div>
              <span className="pill pillMuted">{c.is_active ? 'Active' : 'Disabled'}</span>
            </div>
          ))}
          {!q.isLoading && (q.data?.connected_integrations || []).length === 0 ? (
            <div style={{ color: 'var(--text2)' }}>No integrations connected yet.</div>
          ) : null}
        </div>
      </div>

      <div className="card">
        <h3 style={{ margin: 0, marginBottom: 12 }}>Available</h3>
        <div className="projectGrid">
          {(q.data?.available_integrations || []).map((i) => (
            <div key={i.provider} className="projectCard">
              <div className="projectDot" style={{ background: 'rgba(244,202,87,0.5)' }} />
              <div style={{ minWidth: 0 }}>
                <div className="projectName">{i.icon} {i.name}</div>
                <div className="projectDesc">{i.description}</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  {i.features.slice(0, 3).map((f) => (
                    <span key={f} className="pill pillMuted">{f}</span>
                  ))}
                </div>
                <div style={{ marginTop: 12 }}>
                  <button
                    className={`btn ${connectedProviders.has(i.provider) ? 'btnGhost' : 'btnPrimary'}`}
                    style={{ height: 40, padding: '0 12px' }}
                    disabled={m.isPending || connectedProviders.has(i.provider)}
                    onClick={() => m.mutate({ provider: i.provider, integration_type: i.type })}
                  >
                    {connectedProviders.has(i.provider) ? 'Connected' : (m.isPending ? 'Connecting…' : 'Connect')}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

