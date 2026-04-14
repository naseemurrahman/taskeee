/** Match backend normalizeStoredAvatarUrl — strip whitespace from data-URL base64. */
export function normalizeAvatarUrl(url: string | null | undefined): string | null {
  if (url == null || url === '') return null
  const s = String(url).trim()
  if (!s) return null
  if (/^https?:\/\//i.test(s)) return s
  const lower = s.toLowerCase()
  const idx = lower.indexOf('base64,')
  if (idx === -1) return s
  const head = s.slice(0, idx + 7)
  const b64 = s.slice(idx + 7).replace(/\s+/g, '')
  return head + b64
}

/** Cache-bust remote URLs; pass through data URLs unchanged. */
export function avatarDisplaySrc(url: string | null | undefined, cacheBust: number): string {
  const n = normalizeAvatarUrl(url)
  if (!n) return ''
  if (n.startsWith('data:')) return n
  const sep = n.includes('?') ? '&' : '?'
  return `${n}${sep}v=${cacheBust}`
}
