import { useMutation, useQuery } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api'

type MigrationCheck = {
  key: string
  label: string
  count: number
  severity: 'critical' | 'high' | 'medium' | string
  ok: boolean
}

type MigrationHealth = {
  ok: boolean
  orgId: string
  checks: MigrationCheck[]
  samples?: Record<string, unknown[]>
  timestamp?: string
}

type MigrationRepair = {
  ok: boolean
  orgId: string
  repair: {
    legacyCategoriesFound: number
    createdProjects: Array<{ legacyCategoryId: string; projectId: string; name: string }>
    existingProjects: Array<{ legacyCategoryId: string; projectId: string; name: string }>
    backfilledTasks: { rows: number; tasks: Array<Record<string, unknown>> }
  }
  timestamp?: string
}

function Pill({ ok, text }: { ok: boolean; text?: string }) {
  return (
    <span style={{
      padding: '4px 9px',
      borderRadius: 999,
      fontSize: 11,
      fontWeight: 900,
      background: ok ? 'rgba(34,197,94,.10)' : 'rgba(239,68,68,.10)',
      color: ok ? '#22c55e' : '#ef4444',
      whiteSpace: 'nowrap',
    }}>
      {text || (ok ? 'OK' : 'Issue')}
    </span>
  )
}

function severityColor(severity: string) {
  if (severity === 'critical') return '#ef4444'
  if (severity === 'high') return '#f59e0b'
  if (severity === 'medium') return '#eab308'
  return 'var(--muted)'
}

export function ProjectMigrationHealthPanel() {
  const healthQ = useQuery({
    queryKey: ['admin-project-migration-health'],
    queryFn: () => apiFetch<MigrationHealth>('/api/v1/admin/project-migration-health'),
    refetchInterval: 120_000,
  })

  const repairM = useMutation({
    mutationFn: () => apiFetch<MigrationRepair>('/api/v1/admin/project-migration-repair', { method: 'POST', json: {} }),
    onSuccess: () => healthQ.refetch(),
  })

  const health = healthQ.data
  const failedChecks = health?.checks?.filter((check) => !check.ok) || []
  const canRepair = failedChecks.some((check) => [
    'categorized_tasks_missing_project_id',
    'legacy_categories_without_canonical_match',
  ].includes(check.key))

  return (
    <div className="opsPanel">
      <div className="opsPanelHead">
        <div>
          <div className="opsPanelTitle">Project migration health</div>
          <div className="opsPanelSub">Validate canonical project/task mappings and repair migration drift.</div>
        </div>
        <Pill ok={Boolean(health?.ok)} text={healthQ.isLoading ? 'Checking' : health?.ok ? 'Healthy' : 'Needs repair'} />
      </div>
      <div className="opsPanelBody" style={{ display: 'grid', gap: 12 }}>
        {healthQ.isLoading ? (
          <div className="skeletonBlock" style={{ height: 96 }} />
        ) : healthQ.isError ? (
          <div className="alertV4 alertV4Error">Failed to load project migration health.</div>
        ) : health ? (
          <>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button className="btn btnGhost" type="button" disabled={healthQ.isFetching} onClick={() => healthQ.refetch()}>
                {healthQ.isFetching ? 'Refreshing…' : 'Refresh health'}
              </button>
              <button
                className="btn btnPrimary"
                type="button"
                disabled={!canRepair || repairM.isPending}
                onClick={() => repairM.mutate()}
                title={canRepair ? 'Create missing canonical projects and backfill missing task project_id values.' : 'No repairable project migration issues detected.'}
              >
                {repairM.isPending ? 'Repairing…' : 'Repair migration drift'}
              </button>
            </div>

            <div style={{ display: 'grid', gap: 8 }}>
              {health.checks.map((check) => (
                <div key={check.key} style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto auto',
                  gap: 10,
                  alignItems: 'center',
                  padding: '10px 12px',
                  borderRadius: 12,
                  border: '1px solid var(--border)',
                  background: 'var(--bg2)',
                }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ color: 'var(--text)', fontSize: 13, fontWeight: 900 }}>{check.label}</div>
                    <div style={{ color: severityColor(check.severity), fontSize: 11, fontWeight: 800, marginTop: 2 }}>{check.severity}</div>
                  </div>
                  <div style={{ color: 'var(--text)', fontSize: 13, fontWeight: 900 }}>{check.count}</div>
                  <Pill ok={check.ok} />
                </div>
              ))}
            </div>

            {failedChecks.length > 0 && (
              <div style={{ padding: 12, borderRadius: 12, border: '1px solid rgba(245,158,11,.25)', background: 'rgba(245,158,11,.08)', color: 'var(--text2)', fontSize: 13, lineHeight: 1.5 }}>
                {canRepair
                  ? 'Repairable migration drift detected. Run repair, then refresh health to verify all checks pass.'
                  : 'Non-repairable checks require manual review before changing production data.'}
              </div>
            )}

            {repairM.data && (
              <pre style={{ margin: 0, overflowX: 'auto', fontSize: 11, color: 'var(--text2)', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12, padding: 12 }}>
                {JSON.stringify(repairM.data, null, 2)}
              </pre>
            )}

            {repairM.isError && (
              <div className="alertV4 alertV4Error">
                {repairM.error instanceof Error ? repairM.error.message : 'Project migration repair failed.'}
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  )
}
