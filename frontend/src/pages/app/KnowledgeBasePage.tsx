import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, getApiErrorMessage } from '../../lib/api'
import { getUser } from '../../state/auth'

type Article = {
  id: string
  title: string
  summary?: string | null
  content?: string | null
  category?: string | null
  tags?: string[]
  visibility?: string
  updated_at?: string
}

type ArticleListResponse = { articles: Article[]; page: number; limit: number; total: number }
type ArticleResponse = { article: Article }

function canWrite(role?: string) {
  return ['manager', 'hr', 'director', 'admin'].includes(String(role || '').toLowerCase())
}

function allowedVisibility(role?: string) {
  const r = String(role || '').toLowerCase()
  if (r === 'admin') return ['org', 'management', 'hr', 'admin']
  if (r === 'director' || r === 'hr') return ['org', 'management', 'hr']
  if (r === 'manager') return ['org', 'management']
  return ['org']
}

export function KnowledgeBasePage() {
  const queryClient = useQueryClient()
  const me = getUser()
  const writer = canWrite(me?.role)
  const [q, setQ] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ title: '', summary: '', content: '', category: '', tags: '', visibility: 'org' })

  const listQ = useQuery({
    queryKey: ['knowledge-base', q],
    queryFn: () => apiFetch<ArticleListResponse>(`/api/v1/knowledge-base?limit=50${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}`),
  })

  const articleQ = useQuery({
    queryKey: ['knowledge-base', selectedId],
    queryFn: () => apiFetch<ArticleResponse>(`/api/v1/knowledge-base/${selectedId}`),
    enabled: !!selectedId,
  })

  const articles = listQ.data?.articles || []
  const selected = articleQ.data?.article || null
  const visibilityOptions = useMemo(() => allowedVisibility(me?.role), [me?.role])

  function resetForm(article?: Article | null) {
    setForm({
      title: article?.title || '',
      summary: article?.summary || '',
      content: article?.content || '',
      category: article?.category || '',
      tags: article?.tags?.join(', ') || '',
      visibility: article?.visibility || 'org',
    })
  }

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['knowledge-base'] }),
      queryClient.invalidateQueries({ queryKey: ['full-search'] }),
    ])
  }

  const saveArticle = useMutation({
    mutationFn: () => {
      const payload = {
        title: form.title.trim(),
        summary: form.summary.trim() || null,
        content: form.content.trim(),
        category: form.category.trim() || null,
        tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
        visibility: form.visibility,
      }
      return selectedId && editing
        ? apiFetch<ArticleResponse>(`/api/v1/knowledge-base/${selectedId}`, { method: 'PATCH', json: payload })
        : apiFetch<ArticleResponse>('/api/v1/knowledge-base', { method: 'POST', json: payload })
    },
    onSuccess: async (data) => { setSelectedId(data.article.id); setEditing(false); setError(''); await refresh() },
    onError: (err) => setError(getApiErrorMessage(err, 'Could not save article')),
  })

  const archiveArticle = useMutation({
    mutationFn: () => apiFetch(`/api/v1/knowledge-base/${selectedId}`, { method: 'DELETE' }),
    onSuccess: async () => { setSelectedId(null); setEditing(false); setError(''); await refresh() },
    onError: (err) => setError(getApiErrorMessage(err, 'Could not archive article')),
  })

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div className="pageHeaderCard"><div className="pageHeaderCardInner"><div className="pageHeaderCardLeft"><div className="pageHeaderCardTitle">Knowledge Base</div><div className="pageHeaderCardSub">Store SOPs, wiki articles, and searchable internal documentation.</div></div>{writer ? <button className="btn btnPrimary" type="button" onClick={() => { setSelectedId(null); resetForm(null); setEditing(true) }}>New article</button> : null}</div></div>
      {error ? <div className="formError">{error}</div> : null}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 0.8fr) minmax(0, 1.4fr)', gap: 16 }}>
        <section className="panelCard" style={{ padding: 16, display: 'grid', gap: 12, alignContent: 'start' }}>
          <input className="input" value={q} onChange={e => setQ(e.target.value)} placeholder="Search articles, tags, SOPs…" />
          {listQ.isLoading ? <div className="emptyState">Loading articles…</div> : articles.length ? <div style={{ display: 'grid', gap: 8 }}>{articles.map(article => <button key={article.id} type="button" className="searchResultCard" onClick={() => { setSelectedId(article.id); setEditing(false); resetForm(article) }} style={{ textAlign: 'left' }}><div className="searchResultType">{article.category || article.visibility || 'article'}</div><div style={{ minWidth: 0 }}><div className="searchResultTitle">{article.title}</div><div className="searchResultSub">{article.summary || article.tags?.join(', ') || 'No summary'}</div></div></button>)}</div> : <div className="emptyState">No articles found.</div>}
        </section>
        <section className="panelCard" style={{ padding: 16, minHeight: 420 }}>
          {editing ? <div style={{ display: 'grid', gap: 12 }}><h3 style={{ margin: 0 }}>{selectedId ? 'Edit article' : 'New article'}</h3><input className="input" value={form.title} onChange={e => setForm(v => ({ ...v, title: e.target.value }))} placeholder="Title" /><input className="input" value={form.summary} onChange={e => setForm(v => ({ ...v, summary: e.target.value }))} placeholder="Summary" /><input className="input" value={form.category} onChange={e => setForm(v => ({ ...v, category: e.target.value }))} placeholder="Category" /><input className="input" value={form.tags} onChange={e => setForm(v => ({ ...v, tags: e.target.value }))} placeholder="Tags, comma separated" /><select className="input" value={form.visibility} onChange={e => setForm(v => ({ ...v, visibility: e.target.value }))}>{visibilityOptions.map(v => <option key={v} value={v}>{v}</option>)}</select><textarea className="input" rows={12} value={form.content} onChange={e => setForm(v => ({ ...v, content: e.target.value }))} placeholder="Article content" /><div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}><button className="btn btnPrimary" type="button" disabled={saveArticle.isPending || form.title.trim().length < 2 || form.content.trim().length < 2} onClick={() => saveArticle.mutate()}>{saveArticle.isPending ? 'Saving…' : 'Save'}</button><button className="btn btnGhost" type="button" onClick={() => setEditing(false)}>Cancel</button></div></div> : selected ? <article style={{ display: 'grid', gap: 12 }}><div><div className="searchResultType">{selected.visibility || 'org'}</div><h2 style={{ margin: '6px 0 4px' }}>{selected.title}</h2><div style={{ color: 'var(--muted)', fontSize: 13 }}>{selected.category || 'General'}{selected.updated_at ? ` · Updated ${new Date(selected.updated_at).toLocaleString()}` : ''}</div></div>{selected.summary ? <p style={{ margin: 0, color: 'var(--muted)' }}>{selected.summary}</p> : null}{selected.tags?.length ? <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{selected.tags.map(tag => <span key={tag} className="pill">{tag}</span>)}</div> : null}<div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.65 }}>{selected.content}</div>{writer ? <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}><button className="btn btnGhost" type="button" onClick={() => { resetForm(selected); setEditing(true) }}>Edit</button><button className="btn btnGhost" type="button" disabled={archiveArticle.isPending} onClick={() => archiveArticle.mutate()}>{archiveArticle.isPending ? 'Archiving…' : 'Archive'}</button></div> : null}</article> : <div className="emptyState">Select an article or create a new one.</div>}
        </section>
      </div>
    </div>
  )
}
