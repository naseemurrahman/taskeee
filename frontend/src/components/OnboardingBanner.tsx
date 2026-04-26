import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import { getUser } from '../state/auth'

async function fetchSetupStatus() {
  const [tasks, employees, projects] = await Promise.all([
    apiFetch<{ tasks?: unknown[] }>('/api/v1/tasks?limit=1&page=1').then(d => (d.tasks || []).length).catch(() => 0),
    apiFetch<{ users?: unknown[] }>('/api/v1/users?limit=2&page=1').then(d => (d.users || []).length).catch(() => 0),
    apiFetch<{ projects?: unknown[] }>('/api/v1/projects').then(d => (d.projects || []).length).catch(() => 0),
  ])
  return { tasks, employees, projects }
}

const STEPS = [
  { id: 'team', label: 'Add your first team member', icon: '👥', href: '/app/hr/employees', done: (s: any) => s.employees > 1 },
  { id: 'project', label: 'Create a project', icon: '📁', href: '/app/projects', done: (s: any) => s.projects > 0 },
  { id: 'task', label: 'Assign your first task', icon: '✅', href: '/app/tasks', done: (s: any) => s.tasks > 0 },
]

export function OnboardingBanner() {
  const me = getUser()
  const [dismissed, setDismissed] = useState(() => localStorage.getItem('tf_onboard_dismissed') === '1')

  const { data: status } = useQuery({
    queryKey: ['onboarding', 'status'],
    queryFn: fetchSetupStatus,
    staleTime: 60_000,
    enabled: !dismissed && (me?.role === 'admin' || me?.role === 'hr'),
  })

  if (dismissed || !status || !me || !['admin', 'hr'].includes(me.role)) return null

  const completedSteps = STEPS.filter(s => s.done(status))
  if (completedSteps.length === STEPS.length) return null // All done

  const progress = Math.round((completedSteps.length / STEPS.length) * 100)

  return (
    <div style={{ background: 'linear-gradient(135deg, var(--brandDim) 0%, rgba(139,92,246,0.08) 100%)', border: '1.5px solid var(--brandBorder)', borderRadius: 18, padding: '20px 24px', position: 'relative', overflow: 'hidden' }}>
      {/* Background decoration */}
      <div style={{ position: 'absolute', right: -20, top: -20, width: 120, height: 120, borderRadius: '50%', background: 'rgba(226,171,65,0.06)', pointerEvents: 'none' }} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <span style={{ fontSize: 20 }}>🚀</span>
            <div>
              <div style={{ fontWeight: 900, fontSize: 15, color: 'var(--text)', letterSpacing: '-0.2px' }}>
                Set up TaskFlow Pro — {completedSteps.length}/{STEPS.length} steps complete
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                Complete setup to unlock the full power of AI task management
              </div>
            </div>
          </div>

          {/* Progress bar */}
          <div style={{ height: 4, borderRadius: 999, background: 'var(--border)', marginBottom: 14, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${progress}%`, background: 'var(--brand)', borderRadius: 999, transition: 'width 0.6s ease' }} />
          </div>

          {/* Steps */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {STEPS.map(step => {
              const done = step.done(status)
              return (
                <Link key={step.id} to={step.href} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 999,
                  background: done ? 'rgba(34,197,94,0.12)' : 'var(--bg2)',
                  border: `1.5px solid ${done ? 'rgba(34,197,94,0.3)' : 'var(--border)'}`,
                  textDecoration: 'none', fontSize: 12, fontWeight: 700,
                  color: done ? '#22c55e' : 'var(--text2)', transition: 'all 0.15s',
                }}>
                  {done ? '✓' : step.icon} {step.label}
                </Link>
              )
            })}
          </div>
        </div>

        <button type="button" onClick={() => { setDismissed(true); localStorage.setItem('tf_onboard_dismissed', '1') }}
          style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 4, flexShrink: 0 }}>
          ×
        </button>
      </div>
    </div>
  )
}
