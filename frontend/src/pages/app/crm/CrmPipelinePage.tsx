import { useMemo, useState, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../../../lib/api'

type Pipeline = { id: string; name: string; is_default: boolean }
type Stage   = { id: string; pipeline_id: string; name: string; position: number; color?: string | null }
type Deal    = {
  id: string; title: string; stage_id: string
  value_amount?: number | null; value_currency?: string | null
  owner_name?: string | null; company?: string | null; email?: string | null
  created_at?: string
}

const API = {
  ensureDefault: () => apiFetch<{ pipeline: Pipeline; stages: Stage[] }>(`/api/v1/crm/pipelines/default`, { method: 'POST' }),
  pipelines:     () => apiFetch<{ pipelines: Pipeline[]; stages: Stage[] }>(`/api/v1/crm/pipelines`),
  deals:         (pid: string) => apiFetch<{ deals: Deal[] }>(`/api/v1/crm/deals?pipelineId=${pid}`),
  move:          (id: string, stageId: string) => apiFetch(`/api/v1/crm/deals/${encodeURIComponent(id)}/stage`, { method: 'PATCH', json: { stageId } }),
  create:        (body: Record<string, unknown>) => apiFetch(`/api/v1/crm/deals`, { method: 'POST', json: body as any }),
}

function fmt(amount: number | null | undefined, currency?: string | null) {
  if (amount == null) return null
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0 }).format(amount)
}

function timeAgo(iso?: string) {
  if (!iso) return ''
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export function CrmPipelinePage() {
  const qc = useQueryClient()
  const [dragging, setDragging] = useState<{ id: string; fromStage: string } | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const [addingTo, setAddingTo] = useState<string | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [newValue, setNewValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const dragRef = useRef<Deal | null>(null)

  const pQ = useQuery({ queryKey: ['crm', 'pipelines'], queryFn: API.pipelines, staleTime: 60_000 })
  const defaultPipeline = useMemo(() => (pQ.data?.pipelines || []).find(p => p.is_default), [pQ.data])
  const stages = useMemo(() => {
    const all = pQ.data?.stages || []
    if (!defaultPipeline) return []
    return all.filter(s => s.pipeline_id === defaultPipeline.id).sort((a, b) => a.position - b.position)
  }, [pQ.data, defaultPipeline])

  const dQ = useQuery({
    queryKey: ['crm', 'deals', defaultPipeline?.id],
    queryFn: () => API.deals(defaultPipeline!.id),
    enabled: !!defaultPipeline?.id,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
  const deals = useMemo(() => dQ.data?.deals || [], [dQ.data])
  const grouped = useMemo(() => {
    const map: Record<string, Deal[]> = {}
    for (const s of stages) map[s.id] = []
    for (const d of deals) (map[d.stage_id] ||= []).push(d)
    return map
  }, [deals, stages])

  const totalValue = deals.reduce((sum, d) => sum + (d.value_amount || 0), 0)

  const ensureM = useMutation({ mutationFn: API.ensureDefault, onSuccess: () => qc.invalidateQueries({ queryKey: ['crm', 'pipelines'] }), onError: (e: any) => setError(e?.message || 'Failed') })
  const moveM = useMutation({ mutationFn: ({ id, stageId }: { id: string; stageId: string }) => API.move(id, stageId), onSuccess: () => qc.invalidateQueries({ queryKey: ['crm', 'deals'] }) })
  const createM = useMutation({
    mutationFn: (body: Record<string, unknown>) => API.create(body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['crm', 'deals'] }); setAddingTo(null); setNewTitle(''); setNewValue('') },
    onError: (e: any) => setError(e?.message || 'Failed to create deal'),
  })

  function onDragStart(e: React.DragEvent, deal: Deal, stageId: string) {
    dragRef.current = deal
    setDragging({ id: deal.id, fromStage: stageId })
    e.dataTransfer.effectAllowed = 'move'
  }
  function onDrop(e: React.DragEvent, toStageId: string) {
    e.preventDefault(); setDragOver(null)
    if (!dragRef.current || dragging?.fromStage === toStageId) { setDragging(null); return }
    moveM.mutate({ id: dragRef.current.id, stageId: toStageId })
    dragRef.current = null; setDragging(null)
  }

  function submitAdd(stageId: string) {
    if (!newTitle.trim() || !defaultPipeline) return
    const val = parseFloat(newValue)
    createM.mutate({ pipelineId: defaultPipeline.id, stageId, title: newTitle.trim(), valueAmount: isNaN(val) ? undefined : val } as unknown as Record<string, unknown>)
  }

  if (pQ.isLoading) return (
    <div style={{ display: 'grid', placeItems: 'center', height: '40vh', color: 'var(--muted)' }}>
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth="3" style={{ animation: 'spin 1s linear infinite' }}><circle cx="12" cy="12" r="10" strokeDasharray="31" strokeDashoffset="10" opacity="0.3"/><path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round"/></svg>
    </div>
  )

  if (!defaultPipeline) return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div className="pageHeaderCard">
        <div className="pageHeaderCardInner">
          <div className="pageHeaderCardLeft">
            <div className="pageHeaderCardTitle">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
              CRM Pipeline
            </div>
            <div className="pageHeaderCardSub">Visual kanban board for your sales pipeline — drag deals between stages</div>
          </div>
        </div>
      </div>
      <div style={{ background: 'var(--bg1)', border: '1px solid var(--border)', borderRadius: 18, padding: '40px 32px', textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🚀</div>
        <div style={{ fontWeight: 900, fontSize: 20, color: 'var(--text)', marginBottom: 8 }}>Set up your pipeline</div>
        <div style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 24, maxWidth: 360, margin: '0 auto 24px' }}>Create your default sales pipeline with pre-built stages to start tracking deals from prospect to close.</div>
        {error && <div style={{ padding: '10px 14px', borderRadius: 10, marginBottom: 16, background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.25)', color: '#ef4444', fontSize: 13, fontWeight: 700 }}>{error}</div>}
        <button className="btn btnPrimary" onClick={() => ensureM.mutate()} disabled={ensureM.isPending}>
          {ensureM.isPending ? 'Creating…' : '+ Create Default Pipeline'}
        </button>
      </div>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, height: '100%' }}>
      {/* Header */}
      <div className="pageHeaderCard">
        <div className="pageHeaderCardInner">
          <div className="pageHeaderCardLeft">
            <div className="pageHeaderCardTitle">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
              CRM Pipeline
            </div>
            <div className="pageHeaderCardSub">Drag deals between stages to move them through the pipeline</div>
            <div className="pageHeaderCardMeta">
              <span className="pageHeaderCardTag">{deals.length} deals</span>
              <span className="pageHeaderCardTag">{stages.length} stages</span>
              {totalValue > 0 && <span className="pageHeaderCardTag" style={{ color: '#22c55e', background: 'rgba(34,197,94,0.10)', borderColor: 'rgba(34,197,94,0.22)' }}>{fmt(totalValue, 'USD')} total value</span>}
            </div>
          </div>
        </div>
      </div>

      {error && <div style={{ padding: '10px 16px', borderRadius: 12, background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.25)', color: '#ef4444', fontSize: 13, fontWeight: 700 }}>{error}</div>}

      {/* Single adaptive kanban — scrolls horizontally, works on all screens */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${stages.length}, minmax(200px, 1fr))`, gap: 12, overflowX: 'auto', overflowY: 'visible', WebkitOverflowScrolling: 'touch', paddingBottom: 8, flex: 1, alignItems: 'start' }}>
        {stages.map(stage => {
          const stageDeals = grouped[stage.id] || []
          const stageValue = stageDeals.reduce((sum, d) => sum + (d.value_amount || 0), 0)
          const isOver = dragOver === stage.id
          const color = stage.color || '#e2ab41'
          return (
            <div key={stage.id}
              onDragOver={e => { e.preventDefault(); setDragOver(stage.id) }}
              onDrop={e => onDrop(e, stage.id)}
              onDragLeave={() => setDragOver(null)}
              style={{ background: isOver ? color + '08' : 'var(--bg2)', border: `2px solid ${isOver ? color + '50' : 'transparent'}`, borderRadius: 16, padding: 12, minHeight: 200, transition: 'all 0.15s' }}
            >
              {/* Column header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0 }} />
                <span style={{ fontWeight: 900, fontSize: 13, color: 'var(--text)', flex: 1 }}>{stage.name}</span>
                <span style={{ fontSize: 10, fontWeight: 900, padding: '1px 7px', borderRadius: 999, background: color + '18', color }}>{stageDeals.length}</span>
              </div>
              {stageValue > 0 && <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 10, paddingLeft: 18 }}>{fmt(stageValue, 'USD')}</div>}

              {/* Deal cards */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
                {stageDeals.map(deal => (
                  <div key={deal.id} draggable
                    onDragStart={e => onDragStart(e, deal, stage.id)}
                    onDragEnd={() => { setDragging(null); setDragOver(null); dragRef.current = null }}
                    style={{ background: 'var(--bg1)', border: '1px solid var(--border)', borderRadius: 12, padding: '10px 12px', cursor: 'grab', opacity: dragging?.id === deal.id ? 0.4 : 1, transition: 'all 0.12s', position: 'relative', overflow: 'hidden' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = color + '60'; (e.currentTarget as HTMLDivElement).style.boxShadow = `0 4px 12px ${color}18` }}
                    onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLDivElement).style.boxShadow = '' }}
                  >
                    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2.5, background: color }} />
                    <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--text)', marginTop: 4, marginBottom: 6, lineHeight: 1.3 }}>{deal.title}</div>
                    {deal.company && <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>🏢 {deal.company}</div>}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                      {deal.value_amount != null && <span style={{ fontSize: 11, fontWeight: 800, color: '#22c55e', background: 'rgba(34,197,94,0.12)', padding: '1px 7px', borderRadius: 999 }}>{fmt(deal.value_amount, deal.value_currency)}</span>}
                      {deal.owner_name && <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600 }}>{deal.owner_name}</span>}
                      {deal.created_at && <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 'auto' }}>{timeAgo(deal.created_at)}</span>}
                    </div>
                  </div>
                ))}

                {stageDeals.length === 0 && !addingTo && (
                  <div style={{ padding: '20px 12px', textAlign: 'center', border: `2px dashed ${color}28`, borderRadius: 12, color: 'var(--muted)', fontSize: 11 }}>
                    Drop here
                  </div>
                )}

                {/* Add deal inline form */}
                {addingTo === stage.id ? (
                  <div style={{ background: 'var(--bg1)', border: '1.5px solid var(--brandBorder)', borderRadius: 12, padding: 12, display: 'grid', gap: 8 }}>
                    <input autoFocus value={newTitle} onChange={e => setNewTitle(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') submitAdd(stage.id); if (e.key === 'Escape') { setAddingTo(null); setNewTitle(''); setNewValue('') } }}
                      placeholder="Deal title…"
                      style={{ padding: '8px 10px', borderRadius: 9, border: '1.5px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box' }}
                    />
                    <input value={newValue} onChange={e => setNewValue(e.target.value)} placeholder="Value (optional, e.g. 5000)"
                      type="number" min="0"
                      style={{ padding: '8px 10px', borderRadius: 9, border: '1.5px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box' }}
                    />
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => submitAdd(stage.id)} disabled={!newTitle.trim() || createM.isPending}
                        style={{ flex: 1, padding: '7px', borderRadius: 8, border: 'none', background: 'var(--brand)', color: '#000', fontWeight: 800, fontSize: 12, cursor: 'pointer' }}>
                        {createM.isPending ? '…' : '+ Add'}
                      </button>
                      <button onClick={() => { setAddingTo(null); setNewTitle(''); setNewValue('') }}
                        style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text2)', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => { setAddingTo(stage.id); setNewTitle(''); setNewValue('') }}
                    style={{ padding: '8px', borderRadius: 9, border: '1.5px dashed var(--border)', background: 'transparent', color: 'var(--muted)', fontSize: 12, fontWeight: 700, cursor: 'pointer', width: '100%', transition: 'all 0.15s' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = color; (e.currentTarget as HTMLButtonElement).style.color = color }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--muted)' }}>
                    + Add deal
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

    </div>
  )
}