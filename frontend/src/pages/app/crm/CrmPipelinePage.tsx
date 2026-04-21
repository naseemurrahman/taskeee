import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, ApiError } from '../../../lib/api'

type Pipeline = { id: string; name: string; is_default: boolean }
type Stage = { id: string; pipeline_id: string; name: string; position: number; color?: string | null }
type Deal = { id: string; title: string; stage_id: string; value_amount?: number | null; value_currency?: string | null; owner_name?: string | null }

async function ensureDefaultPipeline() {
  return await apiFetch<{ pipeline: Pipeline; stages: Stage[] }>(`/api/v1/crm/pipelines/default`, { method: 'POST' })
}

async function fetchPipelines() {
  return await apiFetch<{ pipelines: Pipeline[]; stages: Stage[] }>(`/api/v1/crm/pipelines`)
}

async function fetchDeals(pipelineId: string) {
  const qs = new URLSearchParams({ pipelineId })
  return await apiFetch<{ deals: Deal[] }>(`/api/v1/crm/deals?${qs.toString()}`)
}

async function moveDealStage(input: { id: string; stageId: string }) {
  return await apiFetch(`/api/v1/crm/deals/${encodeURIComponent(input.id)}/stage`, {
    method: 'PATCH',
    json: { stageId: input.stageId },
  })
}

async function createDeal(input: { pipelineId: string; stageId: string; title: string; valueAmount?: number }) {
  return await apiFetch(`/api/v1/crm/deals`, { method: 'POST', json: input })
}

export function CrmPipelinePage() {
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)

  const pipelinesQ = useQuery({ queryKey: ['crm', 'pipelines'], queryFn: fetchPipelines })
  const defaultPipeline = useMemo(() => (pipelinesQ.data?.pipelines || []).find((p) => p.is_default), [pipelinesQ.data])
  const stages = useMemo(() => {
    const all = pipelinesQ.data?.stages || []
    if (!defaultPipeline) return []
    return all.filter((s) => s.pipeline_id === defaultPipeline.id).sort((a, b) => a.position - b.position)
  }, [pipelinesQ.data, defaultPipeline])

  const dealsQ = useQuery({
    queryKey: ['crm', 'deals', defaultPipeline?.id],
    queryFn: () => fetchDeals(defaultPipeline!.id),
    enabled: !!defaultPipeline?.id,
  })
  const deals = useMemo(() => dealsQ.data?.deals || [], [dealsQ.data])

  const ensureM = useMutation({
    mutationFn: ensureDefaultPipeline,
    onSuccess: async () => {
      setError(null)
      await qc.invalidateQueries({ queryKey: ['crm', 'pipelines'] })
    },
    onError: (err) => {
      if (err instanceof ApiError) setError(err.message)
      else setError('Failed to create default pipeline.')
    },
  })

  const moveM = useMutation({
    mutationFn: moveDealStage,
    onSuccess: async () => {
      setError(null)
      await qc.invalidateQueries({ queryKey: ['crm', 'deals'] })
    },
    onError: (err) => {
      if (err instanceof ApiError) setError(err.message)
      else setError('Failed to move deal.')
    },
  })

  const createM = useMutation({
    mutationFn: createDeal,
    onSuccess: async () => {
      setError(null)
      await qc.invalidateQueries({ queryKey: ['crm', 'deals'] })
    },
    onError: (err) => {
      if (err instanceof ApiError) setError(err.message)
      else setError('Failed to create deal.')
    },
  })

  const grouped = useMemo(() => {
    const map: Record<string, Deal[]> = {}
    for (const s of stages) map[s.id] = []
    for (const d of deals) (map[d.stage_id] ||= []).push(d)
    return map
  }, [deals, stages])

  if (pipelinesQ.isLoading) return <div className="card">Loading…</div>
  if (pipelinesQ.isError) return <div className="card"><div className="alert alertError">Failed to load CRM pipelines.</div></div>

  if (!defaultPipeline) {
    return (
      <>
      {/* Page header card */}
      <div className="pageHeaderCard">
        <div className="pageHeaderCardInner">
          <div className="pageHeaderCardLeft">
            <div className="pageHeaderCardTitle">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
              CRM Pipeline
            </div>
            <div className="pageHeaderCardSub">Manage your sales pipeline stages. Create custom pipelines with named stages to track deals from prospect to close.</div>
            <div className="pageHeaderCardMeta">
              <span className="pageHeaderCardTag"><span style={{ fontSize: 10 }}>🔄</span> Pipeline stages</span>
              <span className="pageHeaderCardTag"><span style={{ fontSize: 10 }}>📊</span> Deal tracking</span>
              <span className="pageHeaderCardTag"><span style={{ fontSize: 10 }}>⚙️</span> Custom stages</span>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <h2 style={{ margin: 0 }}>CRM pipeline</h2>
        <div style={{ color: 'var(--text2)', marginTop: 4 }}>Create the default sales pipeline to start managing deals.</div>
        {error ? <div className="alert alertError" style={{ marginTop: 12 }}>{error}</div> : null}
        <button className="btn btnPrimary" style={{ marginTop: 12 }} onClick={() => ensureM.mutate()} disabled={ensureM.isPending}>
          {ensureM.isPending ? 'Creating…' : 'Create default pipeline'}
        </button>
      </div>
      </>
    )
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
          <div>
            <h2 style={{ margin: 0, letterSpacing: '-0.6px' }}>CRM pipeline</h2>
            <div style={{ color: 'var(--text2)', marginTop: 4 }}>{defaultPipeline.name} · Move deals between stages.</div>
          </div>
          {error ? <div className="alert alertError">{error}</div> : null}
        </div>
      </div>

      <div className="boardGrid">
        {stages.map((s) => (
          <div key={s.id} className="boardCol">
            <div className="boardColHead">
              <div className="boardColTitle" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ width: 10, height: 10, borderRadius: 999, background: s.color || 'rgba(244,202,87,0.9)' }} />
                {s.name}
              </div>
              <div className="boardColCount">{grouped[s.id]?.length || 0}</div>
            </div>
            <div className="boardColBody">
              <button
                className="btn btnGhost"
                style={{ height: 36 }}
                onClick={() => {
                  const title = window.prompt('Deal title?')
                  if (!title) return
                  createM.mutate({ pipelineId: defaultPipeline.id, stageId: s.id, title })
                }}
                disabled={createM.isPending}
              >
                + New deal
              </button>
              {(grouped[s.id] || []).map((d) => (
                <div key={d.id} className="boardCard">
                  <div className="boardCardTitle">{d.title}</div>
                  <div className="boardCardMeta">
                    <span className="pill pillMuted">{d.owner_name || 'Owner'}</span>
                    {d.value_amount != null ? <span className="pill">{d.value_currency || 'USD'} {d.value_amount}</span> : null}
                  </div>
                  <div className="boardCardActions">
                    {stages.filter((x) => x.id !== s.id).slice(0, 2).map((x) => (
                      <button
                        key={x.id}
                        className="btn btnGhost"
                        style={{ height: 36 }}
                        disabled={moveM.isPending}
                        onClick={() => moveM.mutate({ id: d.id, stageId: x.id })}
                      >
                        Move to {x.name}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {!dealsQ.isLoading && (grouped[s.id] || []).length === 0 ? <div className="boardEmpty">No deals.</div> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

