import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api'
import { getUser } from '../../state/auth'

type Message = { role: 'user' | 'assistant'; content: string; ts: number }
type Task = { id: string; title: string; status: string; priority?: string | null; assigned_to_name?: string | null; due_date?: string | null }

async function fetchContext() {
  const [tasks, perf, projects] = await Promise.all([
    apiFetch<{ tasks?: Task[] }>('/api/v1/tasks?limit=100&page=1').then(d => d.tasks || []),
    apiFetch<any>('/api/v1/performance/summary').catch(() => null),
    apiFetch<{ projects: any[] }>('/api/v1/projects').then(d => d.projects || []),
  ])
  return { tasks, perf, projects }
}

async function callAI(messages: Message[], context: any): Promise<string> {


  // Call backend proxy — keeps Anthropic API key secure on server
  const data = await apiFetch<{ text: string; error?: string }>('/api/v1/ai/chat', {
    method: 'POST',
    json: {
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      context,
    },
  })
  if (data.error) throw new Error(data.error)
  return data.text || 'No response.'
}

function renderMessage(text: string, onApply: (taskId: string, status: string) => void) {
  const parts = text.split(/(\[ACTION:[^\]]+\])/g)
  return parts.map((part, i) => {
    const match = part.match(/\[ACTION:\s*CHANGE_STATUS\s+task_id="([^"]+)"\s+to="([^"]+)"\]/)
    if (match) {
      return (
        <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 999, background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)', color: '#22c55e', fontSize: 11, fontWeight: 800, margin: '2px 0', cursor: 'pointer' }}
          onClick={() => onApply(match[1], match[2])}>
          ⚡ Apply: set to {match[2]}
        </span>
      )
    }
    return <span key={i}>{part}</span>
  })
}

const QUICK_PROMPTS = [
  '📊 Summarize team performance',
  '⚠️ Show overdue tasks and suggest fixes',
  '🔄 Suggest which tasks need status updates',
  '📈 What needs immediate attention?',
  '👥 Who has the most workload?',
  '🎯 Give me a sprint health check',
]

export function AiAssistant() {
  const me = getUser()
  const qc = useQueryClient()
  const [messages, setMessages] = useState<Message[]>([{
    role: 'assistant',
    content: 'Hi ' + (me?.fullName?.split(' ')[0] || 'there') + '! I\'m JecZone AI. I have live access to your organization\'s tasks, projects, and team performance.\n\nAsk me anything — I can identify bottlenecks, suggest status changes, analyze workload, or write a status report.',
    ts: Date.now(),
  }])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const { data: context } = useQuery({
    queryKey: ['ai', 'context'],
    queryFn: fetchContext,
    staleTime: 60_000,
    refetchInterval: 60_000,
  })

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const applyM = useMutation({
    mutationFn: ({ taskId, status }: { taskId: string; status: string }) =>
      apiFetch(`/api/v1/tasks/${taskId}/status`, { method: 'PATCH', json: { status } }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      setMessages(prev => [...prev, { role: 'assistant', content: `✅ Done — task status updated to "${vars.status}".`, ts: Date.now() }])
    },
    onError: () => setMessages(prev => [...prev, { role: 'assistant', content: '❌ Failed to apply status change. Check task permissions.', ts: Date.now() }]),
  })

  function handleApply(taskId: string, status: string) {
    if (window.confirm(`Apply status change to "${status}"?`)) applyM.mutate({ taskId, status })
  }

  async function send(text: string) {
    const msg = text.trim()
    if (!msg || loading) return
    const userMsg: Message = { role: 'user', content: msg, ts: Date.now() }
    const nextMessages = [...messages, userMsg]
    setMessages(nextMessages)
    setInput('')
    setLoading(true)
    try {
      const reply = await callAI(nextMessages, context || { tasks: [], projects: [], perf: null })
      setMessages(prev => [...prev, { role: 'assistant', content: reply, ts: Date.now() }])
    } catch (err: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Failed to get a response: ' + (err?.message || 'Unknown error'), ts: Date.now() }])
    } finally {
      setLoading(false)
      setTimeout(() => textareaRef.current?.focus(), 50)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* Header card */}
      <div className="formCardV3">
        <div className="formCardV3Head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 44, height: 44, borderRadius: 14, background: 'linear-gradient(135deg, #6d5efc, #e2ab41)', display: 'grid', placeItems: 'center', fontSize: 22 }}>🤖</div>
            <div>
              <div className="formCardV3Title">JecZone AI Assistant</div>
              <div className="formCardV3Sub">Live org data · Status suggestions · Team analysis</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {context && <>
              <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 999, background: 'rgba(34,197,94,0.12)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.22)' }}>{context.tasks.length} tasks live</span>
              {context.tasks.filter((t: Task) => t.status === 'overdue').length > 0 && (
                <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 999, background: 'rgba(239,68,68,0.12)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.22)' }}>
                  ⚠ {context.tasks.filter((t: Task) => t.status === 'overdue').length} overdue
                </span>
              )}
            </>}
          </div>
        </div>
      </div>

      {/* Quick prompts */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {QUICK_PROMPTS.map(p => (
          <button key={p} type="button" className="btn btnGhost btnSm" style={{ fontSize: 12, borderRadius: 999 }} onClick={() => send(p)} disabled={loading}>{p}</button>
        ))}
      </div>

      {/* Chat window */}
      <div className="formCardV3" style={{ padding: 0 }}>
        <div style={{ height: 400, overflowY: 'auto', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {messages.map((m, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, flexDirection: m.role === 'user' ? 'row-reverse' : 'row', alignItems: 'flex-start' }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center', fontSize: m.role === 'assistant' ? 14 : 12, fontWeight: 900, background: m.role === 'assistant' ? 'linear-gradient(135deg, #6d5efc, #e2ab41)' : 'var(--brandDim)', border: m.role === 'user' ? '1.5px solid var(--brandBorder)' : 'none', color: m.role === 'user' ? 'var(--brand)' : undefined }}>
                {m.role === 'assistant' ? '🤖' : (me?.fullName || 'U').charAt(0).toUpperCase()}
              </div>
              <div style={{ maxWidth: '78%' }}>
                <div style={{ padding: '10px 14px', borderRadius: m.role === 'user' ? '14px 14px 4px 14px' : '14px 14px 14px 4px', background: m.role === 'user' ? 'var(--brandDim)' : 'var(--surfaceUp)', border: '1px solid ' + (m.role === 'user' ? 'var(--brandBorder)' : 'var(--border)'), fontSize: 13, lineHeight: 1.6, color: 'var(--text)', wordBreak: 'break-word' }}>
                  {m.role === 'assistant' ? renderMessage(m.content, handleApply) : m.content}
                </div>
              </div>
            </div>
          ))}
          {loading && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg,#6d5efc,#e2ab41)', display: 'grid', placeItems: 'center', fontSize: 14 }}>🤖</div>
              <div style={{ padding: '12px 16px', borderRadius: '14px 14px 14px 4px', background: 'var(--surfaceUp)', border: '1px solid var(--border)' }}>
                <span style={{ display: 'inline-flex', gap: 5 }}>
                  {[0,1,2].map(n => <span key={n} style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--brand)', display: 'inline-block', animation: `pulse 1.2s ${n*0.2}s ease-in-out infinite` }} />)}
                </span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
        {/* Input */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <textarea ref={textareaRef} className="taskCommentTextarea" style={{ borderRadius: 14, flex: 1 }} value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) } }}
            placeholder="Ask about tasks, performance, bottlenecks… (Enter to send)" rows={2} disabled={loading}
          />
          <button type="button" className="taskCommentSend" onClick={() => send(input)} disabled={loading || !input.trim()}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
          {messages.length > 1 && (
            <button type="button" className="btn btnGhost btnSm" style={{ flexShrink: 0, borderRadius: 999 }} onClick={() => setMessages([messages[0]])} disabled={loading} title="Clear">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
