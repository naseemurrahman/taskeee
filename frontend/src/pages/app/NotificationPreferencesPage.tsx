import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, getApiErrorMessage } from '../../lib/api'
import { browserPushSupported, disableBrowserPush, enableBrowserPush, getPushStatus } from '../../lib/browserPush'

type DigestPreferences = {
  frequency: 'off' | 'daily' | 'weekly'
  delivery_hour: number
  channels: string[]
  include_overdue: boolean
  include_due_today: boolean
  include_mentions: boolean
  is_enabled: boolean
}

function Toggle({ on, onChange, disabled = false }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} disabled={disabled} onClick={() => onChange(!on)}
      style={{ position: 'relative', width: 48, height: 26, borderRadius: 999, border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: on ? '#22c55e' : 'rgba(148,163,184,0.30)',
        opacity: disabled ? 0.55 : 1, transition: 'background 0.2s', flexShrink: 0, padding: 0, outline: 'none' }}>
      <span style={{ position: 'absolute', top: 3, left: on ? 25 : 3, width: 20, height: 20,
        borderRadius: '50%', background: '#fff', transition: 'left 0.15s ease',
        boxShadow: '0 1px 4px rgba(0,0,0,0.25)', display: 'block' }} />
    </button>
  )
}

export function NotificationPreferencesPage() {
  const qc = useQueryClient()
  const [error, setError] = useState('')
  const [prefs, setPrefs] = useState<DigestPreferences>({ frequency: 'daily', delivery_hour: 8, channels: ['in_app'], include_overdue: true, include_due_today: true, include_mentions: true, is_enabled: true })

  const statusQ = useQuery({ queryKey: ['push-status'], queryFn: getPushStatus, retry: false })
  const prefsQ = useQuery({
    queryKey: ['digest-preferences'],
    queryFn: () => apiFetch<{ preferences: DigestPreferences }>('/api/v1/push/digest-preferences'),
  })

  useEffect(() => {
    if (prefsQ.data?.preferences) setPrefs({ ...prefs, ...prefsQ.data.preferences })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefsQ.data?.preferences])

  const enableM = useMutation({
    mutationFn: enableBrowserPush,
    onSuccess: async () => { setError(''); await qc.invalidateQueries({ queryKey: ['push-status'] }) },
    onError: (err) => setError(getApiErrorMessage(err, 'Could not enable browser push notifications')),
  })

  const disableM = useMutation({
    mutationFn: disableBrowserPush,
    onSuccess: async () => { setError(''); await qc.invalidateQueries({ queryKey: ['push-status'] }) },
    onError: (err) => setError(getApiErrorMessage(err, 'Could not disable browser push notifications')),
  })

  const savePrefs = useMutation({
    mutationFn: () => apiFetch('/api/v1/push/digest-preferences', { method: 'PUT', json: prefs }),
    onSuccess: async () => { setError(''); await qc.invalidateQueries({ queryKey: ['digest-preferences'] }) },
    onError: (err) => setError(getApiErrorMessage(err, 'Could not save digest preferences')),
  })

  function setChannel(channel: string, enabled: boolean) {
    setPrefs(p => ({ ...p, channels: enabled ? [...new Set([...p.channels, channel])] : p.channels.filter(c => c !== channel) }))
  }

  const pushSupported = statusQ.data?.supported ?? browserPushSupported()
  const pushConfigured = statusQ.data?.enabled ?? false
  const pushSubscribed = statusQ.data?.subscribed ?? false
  const permission = statusQ.data?.permission || 'default'

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div className="pageHeaderCard"><div className="pageHeaderCardInner"><div className="pageHeaderCardLeft"><div className="pageHeaderCardTitle">Notification Preferences</div><div className="pageHeaderCardSub">Configure browser push delivery and scheduled task digests.</div></div></div></div>
      {error ? <div className="formError">{error}</div> : null}

      <section className="panelCard" style={{ padding: 18, display: 'grid', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <div><h3 style={{ margin: 0 }}>Browser push notifications</h3><p style={{ margin: '5px 0 0', color: 'var(--muted)', fontSize: 13 }}>Receive notifications even when the app is not focused.</p></div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="pill">{pushSubscribed ? 'Subscribed' : permission === 'denied' ? 'Blocked' : 'Not subscribed'}</span>
            {!pushSubscribed ? <button className="btn btnPrimary" type="button" disabled={!pushSupported || !pushConfigured || permission === 'denied' || enableM.isPending} onClick={() => enableM.mutate()}>{enableM.isPending ? 'Enabling…' : 'Enable push'}</button> : <button className="btn btnGhost" type="button" disabled={disableM.isPending} onClick={() => disableM.mutate()}>{disableM.isPending ? 'Disabling…' : 'Disable push'}</button>}
          </div>
        </div>
        {!pushSupported ? <div className="emptyState">This browser does not support service-worker push notifications.</div> : null}
        {pushSupported && !pushConfigured ? <div className="emptyState">Server push is not configured. Add VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in the backend environment.</div> : null}
        {permission === 'denied' ? <div className="emptyState">Browser permission is blocked. Re-enable notifications in browser site settings.</div> : null}
      </section>

      <section className="panelCard" style={{ padding: 18, display: 'grid', gap: 14 }}>
        <div><h3 style={{ margin: 0 }}>Scheduled digests</h3><p style={{ margin: '5px 0 0', color: 'var(--muted)', fontSize: 13 }}>Send summarized task updates at a predictable hour.</p></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          <label style={{ display: 'grid', gap: 6, color: 'var(--muted)', fontSize: 12 }}>Frequency<select className="input" value={prefs.frequency} onChange={e => setPrefs(p => ({ ...p, frequency: e.target.value as DigestPreferences['frequency'], is_enabled: e.target.value !== 'off' }))}><option value="off">Off</option><option value="daily">Daily</option><option value="weekly">Weekly</option></select></label>
          <label style={{ display: 'grid', gap: 6, color: 'var(--muted)', fontSize: 12 }}>Delivery hour<select className="input" value={prefs.delivery_hour} onChange={e => setPrefs(p => ({ ...p, delivery_hour: Number(e.target.value) }))}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}</select></label>
        </div>
        <div style={{ display: 'grid', gap: 10 }}>
          {[['in_app', 'In-app digest'], ['push', 'Browser push digest'], ['email', 'Email digest']].map(([key, label]) => <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: 12, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--bg2)' }}><div style={{ fontWeight: 800 }}>{label}</div><Toggle on={prefs.channels.includes(key)} onChange={v => setChannel(key, v)} /></div>)}
        </div>
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}><div>Include overdue tasks</div><Toggle on={prefs.include_overdue} onChange={v => setPrefs(p => ({ ...p, include_overdue: v }))} /></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}><div>Include tasks due today</div><Toggle on={prefs.include_due_today} onChange={v => setPrefs(p => ({ ...p, include_due_today: v }))} /></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}><div>Include mentions</div><Toggle on={prefs.include_mentions} onChange={v => setPrefs(p => ({ ...p, include_mentions: v }))} /></div>
        </div>
        <button className="btn btnPrimary" type="button" disabled={savePrefs.isPending} onClick={() => savePrefs.mutate()}>{savePrefs.isPending ? 'Saving…' : 'Save preferences'}</button>
      </section>
    </div>
  )
}
