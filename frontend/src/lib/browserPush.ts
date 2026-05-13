import { apiFetch } from './api'

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i)
  return outputArray
}

export function browserPushSupported() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

export async function getPushStatus() {
  const keyStatus = await apiFetch<{ publicKey: string | null; enabled: boolean }>('/api/v1/push/vapid-public-key')
  const permission = browserPushSupported() ? Notification.permission : 'unsupported'
  let subscribed = false
  if (browserPushSupported()) {
    const registration = await navigator.serviceWorker.ready
    const existing = await registration.pushManager.getSubscription()
    subscribed = !!existing
  }
  return { ...keyStatus, permission, supported: browserPushSupported(), subscribed }
}

export async function enableBrowserPush() {
  if (!browserPushSupported()) throw new Error('Browser push notifications are not supported in this browser.')
  const { publicKey, enabled } = await apiFetch<{ publicKey: string | null; enabled: boolean }>('/api/v1/push/vapid-public-key')
  if (!enabled || !publicKey) throw new Error('Push notifications are not configured on the server.')

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Notification permission was not granted.')

  const registration = await navigator.serviceWorker.ready
  const existing = await registration.pushManager.getSubscription()

  if (existing) {
    await apiFetch('/api/v1/push/subscriptions', { method: 'DELETE', json: { endpoint: existing.endpoint } }).catch(() => null)
    await existing.unsubscribe().catch(() => null)
  }

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  })

  const subscriptionPayload = JSON.parse(JSON.stringify(subscription.toJSON())) as Record<string, unknown>
  await apiFetch('/api/v1/push/subscriptions', { method: 'POST', json: subscriptionPayload })
  return subscription
}

export async function disableBrowserPush() {
  if (!browserPushSupported()) return
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  if (!subscription) return
  await apiFetch('/api/v1/push/subscriptions', { method: 'DELETE', json: { endpoint: subscription.endpoint } }).catch(() => null)
  await subscription.unsubscribe().catch(() => null)
}
