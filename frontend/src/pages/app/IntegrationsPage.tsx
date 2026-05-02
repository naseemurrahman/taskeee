import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { apiFetch, ApiError } from '../../lib/api'
import { useToast } from '../../components/ui/ToastSystem'

type AvailableIntegration = {
  type: string; provider: string; name: string; description: string
  features: string[]; icon: string; category: string
}
type ConnectedIntegration = {
  id: string; integration_type: string; provider: string; is_active: boolean
  created_at: string; last_sync_at?: string | null; created_by_name?: string | null
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
async function disconnectIntegration(id: string) {
  return await apiFetch(`/api/v1/integrations/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function IntegrationsPage() {
  const qc = useQueryClient()
  const { success: toastSuccess, error: toastError } = useToast()
  const q = useQuery({ queryKey: ['integrations'], queryFn: fetchIntegrations })
  const [connectingProvider, setConnectingProvider] = useState<string | null>(null)

  const connectedProviders = useMemo(() => new Set((q.data?.connected_integrations || []).map((x) => x.provider)), [q.data])
  const connectedById = useMemo(() => new Map((q.data?.connected_integrations || []).map(x => [x.provider, x])), [q.data])

  const connectM = useMutation({
    mutationFn: connectIntegration,
    onMutate: (vars) => setConnectingProvider(vars.provider),
    onSuccess: async (data: any) => {
      setConnectingProvider(null)
      if (data?.auth_url) {
        window.location.href = data.auth_url as string
        return
      }
      await qc.invalidateQueries({ queryKey: ['integrations'] })
      toastSuccess('Integration connected', 'The integration has been connected successfully.')
    },
    onError: (err) => {
      setConnectingProvider(null)
      toastError('Connection failed', err instanceof ApiError ? err.message : 'Failed to connect integration.')
    },
  })

  const disconnectM = useMutation({
    mutationFn: disconnectIntegration,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['integrations'] })
      toastSuccess('Disconnected', 'Integration has been removed.')
    },
    onError: (err) => toastError('Disconnect failed', err instanceof ApiError ? err.message : 'Failed to disconnect.'),
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
      </div>

      {q.isError && <div className="alert alertError">Failed to load integrations. Check your connection and try again.</div>}

      {/* Connected integrations */}
      {(q.data?.connected_integrations || []).length > 0 && (
        <div className="card">
          <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 800 }}>Connected</h3>
          <div style={{ display: 'grid', gap: 10 }}>
            {(q.data?.connected_integrations || []).map((conn) => (
              <div key={conn.id} className="miniCard" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: conn.is_active ? '#22c55e' : '#9ca3af', flexShrink: 0 }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: 13 }}>{conn.provider}</div>
                    <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 2 }}>
                      {conn.integration_type} · {conn.last_sync_at ? `synced ${new Date(conn.last_sync_at).toLocaleDateString()}` : 'not synced'} · by {conn.created_by_name || 'Admin'}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 9px', borderRadius: 999, background: conn.is_active ? 'rgba(34,197,94,0.12)' : 'rgba(156,163,175,0.12)', color: conn.is_active ? '#22c55e' : '#9ca3af' }}>
                    {conn.is_active ? 'Active' : 'Disabled'}
                  </span>
                  <button className="btn btnGhost" style={{ height: 30, padding: '0 10px', fontSize: 12, color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)' }}
                    disabled={disconnectM.isPending}
                    onClick={() => { if (confirm(`Disconnect ${conn.provider}?`)) disconnectM.mutate(conn.id) }}>
                    Disconnect
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Available integrations */}
      <div className="card">
        <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 800 }}>Available Integrations</h3>
        {q.isLoading && <div style={{ color: 'var(--text2)', padding: '20px 0' }}>Loading…</div>}
        <div className="projectGrid">
          {(q.data?.available_integrations || []).map((intg) => {
            const isConnected = connectedProviders.has(intg.provider)
            const isConnecting = connectingProvider === intg.provider
            return (
              <div key={intg.provider} className="projectCard">
                <div className="projectDot" style={{ background: isConnected ? '#22c55e' : 'rgba(244,202,87,0.5)' }} />
                <div style={{ minWidth: 0 }}>
                  <div className="projectName">{intg.icon} {intg.name}</div>
                  <div className="projectDesc">{intg.description}</div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                    {intg.features.slice(0, 3).map((f) => (
                      <span key={f} className="pill pillMuted" style={{ fontSize: 10 }}>{f}</span>
                    ))}
                  </div>
                  <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button
                      className={`btn ${isConnected ? 'btnGhost' : 'btnPrimary'}`}
                      style={{ height: 36 }}
                      disabled={isConnecting || connectM.isPending || isConnected}
                      onClick={() => !isConnected && connectM.mutate({ provider: intg.provider, integration_type: intg.type })}
                    >
                      {isConnected ? '✓ Connected' : isConnecting ? 'Connecting…' : 'Connect'}
                    </button>
                    {isConnected && connectedById.get(intg.provider) && (
                      <button className="btn btnGhost" style={{ height: 36, color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)', fontSize: 12 }}
                        disabled={disconnectM.isPending}
                        onClick={() => { const conn = connectedById.get(intg.provider); if (conn && confirm(`Disconnect ${intg.name}?`)) disconnectM.mutate(conn.id) }}>
                        Disconnect
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
          {!q.isLoading && (q.data?.available_integrations || []).length === 0 && (
            <div style={{ color: 'var(--text2)', gridColumn: '1/-1', padding: '20px 0' }}>No integrations available.</div>
          )}
        </div>
      </div>
    </div>
  )
}

