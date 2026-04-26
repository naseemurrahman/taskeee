import { useState, type FormEvent } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api'

type OrgMe = {
  id: string
  name: string
  settings?: {
    onboardingCompleted?: boolean
  } | null
}

async function fetchOrg() {
  const data = await apiFetch<{ organization: OrgMe }>('/api/v1/organizations/me')
  return data.organization
}

export function OnboardingPage() {
  const orgQ = useQuery({ queryKey: ['org', 'onboarding'], queryFn: fetchOrg })
  const [departmentSeed, setDepartmentSeed] = useState('Operations, Engineering, Sales')
  const [defaultRole, setDefaultRole] = useState('manager')
  const [inviteEmails, setInviteEmails] = useState('')

  const saveM = useMutation({
    mutationFn: async () =>
      apiFetch('/api/v1/organizations/onboarding/complete', {
        method: 'POST',
        json: {
          onboarding: {
            departmentSeed: departmentSeed.split(',').map((v) => v.trim()).filter(Boolean),
            defaultRole,
            inviteEmails: inviteEmails.split(',').map((v) => v.trim()).filter(Boolean),
          },
        },
      }),
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    saveM.mutate()
  }

  const done = !!orgQ.data?.settings?.onboardingCompleted
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="pageHeaderCard">
        <div className="pageHeaderCardInner">
          <div className="pageHeaderCardLeft">
            <div className="pageHeaderCardTitle">Organization onboarding</div>
            <div className="pageHeaderCardSub">
              Configure starter defaults for your workspace and mark setup complete.
            </div>
          </div>
        </div>
      </div>
      <div className="card">
        {done ? (
          <div className="alert" style={{ borderColor: 'rgba(34,197,94,0.35)', background: 'rgba(34,197,94,0.08)' }}>
            Onboarding is already completed for this organization.
          </div>
        ) : null}
        <form className="form" style={{ gap: 12 }} onSubmit={onSubmit}>
          <label className="label">
            Departments seed (comma-separated)
            <input className="input" value={departmentSeed} onChange={(e) => setDepartmentSeed(e.target.value)} />
          </label>
          <label className="label">
            Default manager role for invites
            <select className="input" value={defaultRole} onChange={(e) => setDefaultRole(e.target.value)}>
              <option value="supervisor">Supervisor</option>
              <option value="manager">Manager</option>
              <option value="hr">HR</option>
            </select>
          </label>
          <label className="label">
            Initial invite emails (comma-separated)
            <input className="input" value={inviteEmails} onChange={(e) => setInviteEmails(e.target.value)} placeholder="team@company.com, lead@company.com" />
          </label>
          <button className="btn btnPrimary" type="submit" disabled={saveM.isPending}>
            {saveM.isPending ? 'Saving…' : 'Complete onboarding'}
          </button>
        </form>
      </div>
    </div>
  )
}
