import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch, apiUpload, ApiError } from '../../lib/api'
import { clearAuth, getUser, setUser, type AuthUser } from '../../state/auth'
import { Building2, CalendarClock, Clock, KeyRound, LogOut, Mail, ShieldCheck, UserRound } from 'lucide-react'
import { useI18n } from '../../i18n'
import { avatarDisplaySrc, normalizeAvatarUrl } from '../../lib/avatarUrl'

type UserDetail = {
  id: string
  email: string
  full_name: string
  role: string
  department?: string | null
  employee_code?: string | null
  manager_name?: string | null
  avatar_url?: string | null
  last_login_at?: string | null
  created_at?: string | null
  org_id?: string | null
}

async function fetchMe(userId: string) {
  return await apiFetch<{ user: UserDetail }>(`/api/v1/users/${encodeURIComponent(userId)}`)
}

async function patchMe(userId: string, patch: { fullName?: string; department?: string }) {
  return await apiFetch<{ user: UserDetail }>(`/api/v1/users/${encodeURIComponent(userId)}`, { method: 'PATCH', json: patch })
}

async function patchAvatar(userId: string, avatarUrl: string | null) {
  return await apiFetch<{ user: UserDetail }>(`/api/v1/users/${encodeURIComponent(userId)}/avatar`, {
    method: 'PATCH',
    json: { avatarUrl },
  })
}

async function postChangePassword(body: { currentPassword: string; newPassword: string }) {
  return await apiFetch(`/api/v1/auth/change-password`, { method: 'POST', json: body })
}

type AvatarDraft = null | { kind: 'preview'; file: File; url: string } | { kind: 'remove' }

async function uploadAvatarFile(userId: string, file: File): Promise<string> {
  const fd = new FormData()
  fd.set('avatar', file)
  const data = await apiUpload<{ avatarUrl?: string }>(`/api/v1/users/${encodeURIComponent(userId)}/avatar/upload`, fd)
  return data.avatarUrl || ''
}

export function ProfilePage() {
  const navigate = useNavigate()
  const { t } = useI18n()
  const me = getUser()
  const userId = me?.id || ''
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['me', userId], queryFn: () => fetchMe(userId), enabled: !!userId })

  const [error, setError] = useState<string | null>(null)
  const [pwError, setPwError] = useState<string | null>(null)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const [avatarDraft, setAvatarDraft] = useState<AvatarDraft>(null)
  const [heroAvatarBroken, setHeroAvatarBroken] = useState(false)

  const current = useMemo(() => {
    const u = q.data?.user
    return {
      email: u?.email || me?.email || '',
      role: u?.role || me?.role || '',
      fullName: u?.full_name || me?.fullName || '',
      department: u?.department || '',
      employeeCode: u?.employee_code || '—',
      manager: u?.manager_name || '—',
      lastLogin: u?.last_login_at ? new Date(u.last_login_at).toLocaleString() : '—',
      memberSince: u?.created_at ? new Date(u.created_at).toLocaleDateString() : '—',
      orgId: u?.org_id || me?.orgId || '—',
    }
  }, [q.data, me])

  type ProfileSavePayload = {
    fullName: string
    department?: string
    avatarDraft: AvatarDraft
  }

  const m = useMutation<
    Awaited<ReturnType<typeof patchMe>>,
    Error,
    ProfileSavePayload
  >({
    mutationFn: async (payload: ProfileSavePayload) => {
      if (payload.avatarDraft?.kind === 'preview') {
        await uploadAvatarFile(userId, payload.avatarDraft.file)
      } else if (payload.avatarDraft?.kind === 'remove') {
        await patchAvatar(userId, null)
      }
      return await patchMe(userId, { fullName: payload.fullName, department: payload.department })
    },
    onSuccess: async (data) => {
      setError(null)
      setPhotoError(null)
      setAvatarDraft(null)
      const next: AuthUser | null = me ? { ...me, fullName: data.user.full_name } : null
      if (next) setUser(next)
      qc.setQueryData<{ user: UserDetail }>(['me', userId], (prev) => {
        const prevAvatar = prev?.user?.avatar_url
        const nextAvatar = data.user?.avatar_url
        const mergedUser = {
          ...prev?.user,
          ...data.user,
          avatar_url:
            nextAvatar !== undefined && nextAvatar !== null && String(nextAvatar).trim() !== ''
              ? nextAvatar
              : prevAvatar ?? null,
        }
        return { user: mergedUser }
      })
      await qc.invalidateQueries({ queryKey: ['me'] })
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        const d = err.data as { details?: Array<{ msg?: string; message?: string }> } | null
        const detailMsg = d?.details?.map((x) => x.msg || x.message).filter(Boolean).join(' ')
        const msg = detailMsg || err.message
        if (/avatar|image|photo/i.test(msg)) setPhotoError(msg)
        else setError(msg)
      } else setError('Failed to update profile.')
    },
  })

  const [pwOk, setPwOk] = useState(false)

  const pwM = useMutation({
    mutationFn: postChangePassword,
    onSuccess: () => {
      setPwError(null)
      setPwOk(true)
    },
    onError: (err) => {
      if (err instanceof ApiError) setPwError(err.message)
      else setPwError('Could not change password.')
    },
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setPhotoError(null)
    const fd = new FormData(e.currentTarget as HTMLFormElement)
    const fullName = String(fd.get('fullName') || '').trim()
    const department = String(fd.get('department') || '').trim()
    if (!fullName) return setError('Name is required.')
    m.mutate({ fullName, department: department || undefined, avatarDraft })
  }

  const rawAvatarUrl = q.data?.user?.avatar_url ?? null
  const displayAvatarUrl =
    avatarDraft?.kind === 'preview' ? avatarDraft.url : avatarDraft?.kind === 'remove' ? null : rawAvatarUrl
  const normalizedAvatar = normalizeAvatarUrl(displayAvatarUrl)
  const headerAvatar = avatarDisplaySrc(displayAvatarUrl, q.dataUpdatedAt)

  useEffect(() => {
    setHeroAvatarBroken(false)
  }, [displayAvatarUrl])

  useEffect(() => {
    setAvatarDraft(null)
  }, [userId])

  return (
    <div className="profilePage">
      {/* Page header card */}
      <div className="pageHeaderCard">
        <div className="pageHeaderCardInner">
          <div className="pageHeaderCardLeft">
            <div className="pageHeaderCardTitle">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              My Profile
            </div>
            <div className="pageHeaderCardSub">Update your personal information, change your password, manage security settings, and upload a profile photo.</div>
            <div className="pageHeaderCardMeta">
              <span className="pageHeaderCardTag"><span style={{ fontSize: 10 }}>👤</span> Personal info</span>
              <span className="pageHeaderCardTag"><span style={{ fontSize: 10 }}>🔑</span> Password &amp; security</span>
              <span className="pageHeaderCardTag"><span style={{ fontSize: 10 }}>📸</span> Profile photo</span>
            </div>
          </div>
        </div>
      </div>

      <div className="card profileHero">
        <div className="profileHeroMain">
          <div className="profileHeroAvatar" aria-hidden="true">
            {normalizedAvatar && !heroAvatarBroken ? (
              <img
                src={headerAvatar}
                alt=""
                decoding="async"
                onError={() => setHeroAvatarBroken(true)}
              />
            ) : (
              <UserRound size={22} />
            )}
          </div>
          <div className="profileHeroText">
            <h1 className="profileHeroTitle">{current.fullName || 'Your profile'}</h1>
            <p className="profileHeroSub">
              <Mail size={14} style={{ verticalAlign: 'middle', marginRight: 6, opacity: 0.85 }} />
              {current.email} · {current.role}
            </p>
          </div>
        </div>
        <div className="profileHeroMeta">
          <span className="pill pillMuted">Code {current.employeeCode}</span>
          <span className="pill">Manager · {current.manager}</span>
        </div>
      </div>

      {q.isLoading ? <div className="card profileMuted">Loading…</div> : null}
      {q.isError ? <div className="alert alertError">Failed to load profile.</div> : null}
      {error ? <div className="alert alertError">{error}</div> : null}
      {photoError ? <div className="alert alertError">{photoError}</div> : null}
      {pwError ? <div className="alert alertError">{pwError}</div> : null}
      {pwOk ? (
        <div className="alert" style={{ borderColor: 'rgba(16,185,129,0.35)', background: 'rgba(16,185,129,0.08)' }}>
          Password updated. Use your new password next sign-in (existing sessions may end).
        </div>
      ) : null}

      <div className="profileGrid">
        <div className="profileMain">
        <div className="card profileCard">
          <div className="profileCardHead">
            <Building2 size={16} />
            <span>Organization</span>
          </div>
          <ul className="profileDetailList">
            <li>
              <span className="profileDetailKey">Department</span>
              <span className="profileDetailVal">{current.department || '—'}</span>
            </li>
            <li>
              <span className="profileDetailKey">Manager</span>
              <span className="profileDetailVal">{current.manager}</span>
            </li>
            <li>
              <span className="profileDetailKey">Employee code</span>
              <span className="profileDetailVal">{current.employeeCode}</span>
            </li>
            <li>
              <span className="profileDetailKey">Organization ID</span>
              <span className="profileDetailVal mono">{current.orgId}</span>
            </li>
          </ul>
        </div>

        <div className="card profileCard">
          <div className="profileCardHead">
            <ShieldCheck size={16} />
            <span>Account &amp; profile</span>
          </div>
          <p className="profileCardLead">Update your name, department, and photo. Email and role are managed by your organization.</p>

          <div className="profilePhotoRow">
            <div>
              <div className="label" style={{ marginBottom: 8 }}>
                Profile photo
              </div>
              <div className="profilePhotoActions">
                <label className="btn btnGhost profileUploadBtn" style={{ width: 'auto' }}>
                  {m.isPending ? 'Saving…' : 'Choose photo (PNG, JPG)'}
                <input
                  type="file"
                  accept=".png,.jpg,.jpeg,.jpe,image/png,image/jpeg,image/jpg"
                  style={{ display: 'none' }}
                  disabled={m.isPending}
                  onChange={(ev) => {
                    const f = ev.target.files?.[0]
                    ev.target.value = ''
                    if (!f) return
                    setPhotoError(null)
                    const okType =
                      ['image/png', 'image/jpeg', 'image/jpg'].includes(f.type) ||
                      /\.png$/i.test(f.name) ||
                      /\.jpe?g$/i.test(f.name)
                    if (!okType) {
                      setPhotoError('Only PNG or JPEG images are allowed.')
                      return
                    }
                    if (f.size > 6_000_000) {
                      setPhotoError('Image too large (max 6MB before compression).')
                      return
                    }
                    const preview = URL.createObjectURL(f)
                    setAvatarDraft({ kind: 'preview', file: f, url: preview })
                  }}
                />
                </label>
                {avatarDraft?.kind === 'remove' ? (
                  <button
                    type="button"
                    className="btn btnGhost profileUploadBtn"
                    onClick={() => setAvatarDraft(null)}
                    disabled={m.isPending}
                  >
                    Undo remove
                  </button>
                ) : rawAvatarUrl || avatarDraft?.kind === 'preview' ? (
                  <button
                    type="button"
                    className="btn btnGhost profileUploadBtn"
                    onClick={() => {
                      if (avatarDraft?.kind === 'preview') setAvatarDraft(null)
                      else setAvatarDraft({ kind: 'remove' })
                    }}
                    disabled={m.isPending}
                  >
                    {avatarDraft?.kind === 'preview' ? 'Discard new photo' : 'Remove photo'}
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          <form onSubmit={onSubmit} className="form profileForm">
            <label className="label">
              Email
              <input className="input" value={current.email} readOnly />
            </label>
            <label className="label">
              Role
              <input className="input" value={current.role} readOnly />
            </label>
            <label className="label">
              Full name
              <input className="input" name="fullName" key={current.fullName} defaultValue={current.fullName} placeholder="Full name" />
            </label>
            <label className="label">
              Department
              <input
                className="input"
                name="department"
                key={current.department}
                defaultValue={current.department}
                placeholder="e.g. Engineering"
              />
            </label>
            <div className="profileFormActions">
              <button className="btn btnPrimary" type="submit" disabled={m.isPending}>
                {m.isPending ? 'Saving…' : 'Save changes'}
              </button>
              <span className="profileFormHint">Name, department, and photo are saved together. Updates sync everywhere you’re signed in.</span>
            </div>
          </form>
        </div>

        <div className="card profileCard">
          <div className="profileCardHead">
            <LogOut size={16} />
            <span>Session</span>
          </div>
          <p className="profileCardLead">Sign out on this device. You can sign in again anytime.</p>
          <button
            type="button"
            className="btn btnGhost"
            style={{ marginTop: 4, height: 42 }}
            onClick={() => {
              clearAuth()
              navigate('/signin', { replace: true })
            }}
          >
            {t('common.signOut')}
          </button>
        </div>

        </div>

        <div className="profileAside">
          <div className="card profileCard">
            <div className="profileCardHead">
              <KeyRound size={16} />
              <span>Security</span>
            </div>
            <p className="profileCardLead">Change your password. MFA and recovery remain on the sign-in flow.</p>
            <form
              className="form profilePwForm"
              onSubmit={(e) => {
                e.preventDefault()
                setPwError(null)
                const fd = new FormData(e.currentTarget as HTMLFormElement)
                const cur = String(fd.get('currentPassword') || '')
                const n1 = String(fd.get('newPassword') || '')
                const n2 = String(fd.get('newPassword2') || '')
                if (n1.length < 8) return setPwError('New password must be at least 8 characters.')
                if (n1 !== n2) return setPwError('New passwords do not match.')
                pwM.mutate({ currentPassword: cur, newPassword: n1 })
              }}
            >
              <label className="label">
                Current password
                <input className="input" type="password" name="currentPassword" autoComplete="current-password" required />
              </label>
              <label className="label">
                New password
                <input className="input" type="password" name="newPassword" autoComplete="new-password" required minLength={8} />
              </label>
              <label className="label">
                Confirm new password
                <input className="input" type="password" name="newPassword2" autoComplete="new-password" required minLength={8} />
              </label>
              <button className="btn btnPrimary" type="submit" disabled={pwM.isPending} style={{ height: 42 }}>
                {pwM.isPending ? 'Updating…' : 'Change password'}
              </button>
            </form>
            <a className="btn btnGhost profileForgotLink" href="/forgot-password">
              Forgot password
            </a>
          </div>

          <div className="card profileCard">
            <div className="profileCardHead">
              <Clock size={16} />
              <span>Sign-in &amp; membership</span>
            </div>
            <ul className="profileDetailList">
              <li>
                <span className="profileDetailKey">
                  <CalendarClock size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                  Last sign-in
                </span>
                <span className="profileDetailVal">{current.lastLogin}</span>
              </li>
              <li>
                <span className="profileDetailKey">Member since</span>
                <span className="profileDetailVal">{current.memberSince}</span>
              </li>
            </ul>
            <p className="profileCardLead" style={{ marginTop: 12, marginBottom: 0 }}>
              This card is only your account summary. Organization-wide audit events (logins, tasks, profile changes, and more) appear on the{' '}
              <strong>Logs</strong> page for admins, HR, and directors-not duplicated here.
            </p>
            <p className="profileCardLead" style={{ marginTop: 12, marginBottom: 0 }}>
              Task comments notify assignees and managers in-app and by email when SMTP is configured under Integrations / deployment settings.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
