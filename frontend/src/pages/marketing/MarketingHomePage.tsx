import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  Zap, Shield, BarChart3, MessageSquare, Clock, Users,
  CheckCircle, ArrowRight, Star, Globe, Layers,
  Bell, Lock, TrendingUp, Award, Camera, Brain, Play, X,
} from 'lucide-react'
import { useMktTheme } from '../../lib/mktTheme'

function useReveal(threshold = 0.1) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = ref.current; if (!el) return
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect() } }, { threshold })
    obs.observe(el); return () => obs.disconnect()
  }, [threshold])
  return { ref, visible }
}

const WORDS = ['Accountability.', 'Performance.', 'Clarity.', 'Excellence.', 'Results.']
function Typewriter() {
  const [idx, setIdx] = useState(0)
  const [shown, setShown] = useState(0)
  const [deleting, setDeleting] = useState(false)
  useEffect(() => {
    const word = WORDS[idx]
    const delay = deleting ? 40 : shown < word.length ? 80 : 2000
    const id = setTimeout(() => {
      if (!deleting && shown === word.length) { setDeleting(true); return }
      if (deleting && shown === 0) { setDeleting(false); setIdx(i => (i + 1) % WORDS.length); return }
      setShown(s => s + (deleting ? -1 : 1))
    }, delay)
    return () => clearTimeout(id)
  }, [idx, shown, deleting])
  return <span style={{ color: '#e2ab41' }}>{WORDS[idx].slice(0, shown)}<span style={{ opacity: 0.7, animation: 'blink 1s step-end infinite' }}>|</span></span>
}

function Counter({ to, suffix = '' }: { to: number; suffix?: string }) {
  const [val, setVal] = useState(0)
  const { ref, visible } = useReveal()
  useEffect(() => {
    if (!visible) return
    let step = 0; const id = setInterval(() => {
      step++; setVal(Math.round(to * step / 50))
      if (step >= 50) clearInterval(id)
    }, 25)
    return () => clearInterval(id)
  }, [visible, to])
  return <span ref={ref}>{val.toLocaleString()}{suffix}</span>
}

const LOGOS = ['Almalath Group','NordScale GmbH','GulfBuild Co.','Horizon Dynamics','Riyad Operations','Apex Consulting','TerraForm SA','ClearPath Ltd']
function LogoStrip({ theme }: { theme: 'dark' | 'light' }) {
  const color = theme === 'light' ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.25)'
  const border = theme === 'light' ? 'rgba(0,0,0,0.09)' : 'rgba(255,255,255,0.08)'
  return (
    <div style={{ overflow: 'hidden', flex: 1 }}>
      <style>{`@keyframes marquee{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}.mkt-mq{display:flex;gap:10px;animation:marquee 30s linear infinite;width:max-content}.mkt-mq:hover{animation-play-state:paused}`}</style>
      <div className="mkt-mq">
        {[...LOGOS, ...LOGOS].map((name, i) => (
          <div key={i} style={{ padding: '7px 18px', borderRadius: 7, whiteSpace: 'nowrap', border: `1px solid ${border}`, fontSize: 12.5, fontWeight: 700, color, letterSpacing: '0.02em' }}>{name}</div>
        ))}
      </div>
    </div>
  )
}

function DemoVideo({ theme }: { theme: 'dark' | 'light' }) {
  const [modalOpen, setModalOpen] = useState(false)
  const YOUTUBE_ID = '' // ← Add your YouTube video ID here
  const border = theme === 'light' ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.08)'
  const uiBarBg = theme === 'light' ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.04)'
  const surfaceBg = theme === 'light' ? '#ffffff' : 'rgba(255,255,255,0.03)'
  const taskText = theme === 'light' ? '#1a1a18' : 'rgba(255,255,255,0.8)'
  const taskSub = theme === 'light' ? '#6b6b68' : 'rgba(255,255,255,0.32)'
  const tagBg = theme === 'light' ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.025)'
  return (
    <div>
      {modalOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={() => setModalOpen(false)}>
          <div style={{ position: 'relative', width: '100%', maxWidth: 960 }} onClick={e => e.stopPropagation()}>
            <button onClick={() => setModalOpen(false)} style={{ position: 'absolute', top: -44, right: 0, background: 'none', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600 }}>
              <X size={16} /> Close
            </button>
            {YOUTUBE_ID ? (
              <div style={{ position: 'relative', paddingBottom: '56.25%', borderRadius: 16, overflow: 'hidden' }}>
                <iframe style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }} src={`https://www.youtube.com/embed/${YOUTUBE_ID}?autoplay=1&rel=0`} allow="autoplay; fullscreen" allowFullScreen />
              </div>
            ) : (
              <div style={{ background: '#0b0d18', borderRadius: 16, padding: 56, textAlign: 'center' }}>
                <Brain size={40} color="#e2ab41" style={{ marginBottom: 18 }} />
                <div style={{ color: '#fff', fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Demo video coming soon</div>
                <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>Set YOUTUBE_ID in DemoVideo to link your recording</div>
              </div>
            )}
          </div>
        </div>
      )}
      <div style={{ position: 'relative', borderRadius: 20, overflow: 'hidden', border: `1px solid ${border}`, background: surfaceBg, boxShadow: theme === 'light' ? '0 24px 80px rgba(0,0,0,0.10)' : '0 24px 80px rgba(0,0,0,0.4)' }}>
        <div style={{ height: 44, background: uiBarBg, borderBottom: `1px solid ${border}`, display: 'flex', alignItems: 'center', padding: '0 16px', gap: 7 }}>
          {['#ef4444','#f59e0b','#22c55e'].map(c => <div key={c} style={{ width: 11, height: 11, borderRadius: '50%', background: c }} />)}
          <div style={{ flex: 1, height: 24, borderRadius: 5, background: theme === 'light' ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.06)', marginLeft: 6, display: 'flex', alignItems: 'center', paddingLeft: 10 }}>
            <span style={{ fontSize: 11, color: taskSub, fontFamily: 'monospace' }}>taskee.io/app/dashboard</span>
          </div>
        </div>
        <div style={{ padding: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 16 }}>
            {[['142','Tasks Active','#e2ab41'],['11','Overdue','#ef4444'],['87%','On-Time','#22c55e'],['6','AI Review','#8b5cf6']].map(([v,l,c]) => (
              <div key={l} style={{ padding: '11px 12px', borderRadius: 10, background: `${c}12`, border: `1px solid ${c}20` }}>
                <div style={{ fontSize: 20, fontWeight: 950, color: c, letterSpacing: '-0.5px' }}>{v}</div>
                <div style={{ fontSize: 10, color: taskSub, fontWeight: 600, marginTop: 2 }}>{l}</div>
              </div>
            ))}
          </div>
          {[
            { t:'Q3 infrastructure audit — server logs reviewed', a:'Bashir Al-Hamdan', tag:'AI Reviewed', c:'#8b5cf6', time:'2h ago' },
            { t:'New HR policy — distribute to 87 employees', a:'Lina Johansson', tag:'Approved', c:'#22c55e', time:'4h ago' },
            { t:'Field equipment inspection — photos attached', a:'Mohammed Al-Farsi', tag:'Submitted', c:'#38bdf8', time:'1h ago' },
            { t:'October payroll export — 120 employees', a:'Sara Al-Rashid', tag:'In Progress', c:'#e2ab41', time:'Now' },
          ].map(row => (
            <div key={row.t} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 13px', marginBottom: 6, borderRadius: 9, background: tagBg, border: `1px solid ${border}` }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: taskText, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.t}</div>
                <div style={{ fontSize: 11, color: taskSub }}>{row.a} · {row.time}</div>
              </div>
              <div style={{ padding: '2px 8px', borderRadius: 5, fontSize: 10, fontWeight: 800, background: `${row.c}20`, color: row.c, border: `1px solid ${row.c}30`, whiteSpace: 'nowrap' }}>{row.tag}</div>
            </div>
          ))}
          <div style={{ marginTop: 12, padding: '11px 14px', borderRadius: 9, background: 'rgba(226,171,65,0.07)', border: '1px solid rgba(226,171,65,0.18)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Brain size={13} color="#e2ab41" />
            <span style={{ fontSize: 12, color: '#e2ab41', fontWeight: 700 }}>JecZone AI · Low risk · 3 tasks flagged for reassignment · Updated now</span>
          </div>
        </div>
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(6,8,16,0.54)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'background 0.2s' }}
          onClick={() => setModalOpen(true)}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(6,8,16,0.38)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'rgba(6,8,16,0.54)')}>
          <div style={{ width: 76, height: 76, borderRadius: '50%', background: 'linear-gradient(135deg,#c98317,#e2ab41,#f4ca57)', display: 'grid', placeItems: 'center', boxShadow: '0 8px 44px rgba(226,171,65,0.45)', marginBottom: 14 }}>
            <Play size={28} color="#0a0800" fill="#0a0800" style={{ marginLeft: 4 }} />
          </div>
          <div style={{ color: '#fff', fontWeight: 800, fontSize: 15, letterSpacing: '-0.3px' }}>Watch 2-minute demo</div>
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 4 }}>Full AI-assisted workflow walkthrough</div>
        </div>
      </div>
    </div>
  )
}

function BentoCard({ icon, title, desc, wide, color, index, theme }: { icon: ReactNode; title: string; desc: string; wide?: boolean; color: string; index: number; theme: 'dark' | 'light' }) {
  const { ref, visible } = useReveal()
  const bg = theme === 'light' ? '#ffffff' : 'rgba(255,255,255,0.025)'
  const border = theme === 'light' ? '1.5px solid rgba(0,0,0,0.07)' : '1px solid rgba(255,255,255,0.06)'
  const textColor = theme === 'light' ? '#0f0f0e' : '#ffffff'
  const descColor = theme === 'light' ? '#5a5a57' : 'rgba(255,255,255,0.42)'
  return (
    <div ref={ref} style={{ gridColumn: wide ? 'span 2' : 'span 1', opacity: visible ? 1 : 0, transform: visible ? 'none' : 'translateY(24px)', transition: `opacity 0.5s ${index * 0.07}s ease, transform 0.5s ${index * 0.07}s ease`, padding: '28px 30px', borderRadius: 16, background: bg, border, position: 'relative', overflow: 'hidden', boxShadow: theme === 'light' ? '0 2px 16px rgba(0,0,0,0.06)' : 'none' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, transparent, ${color}50, transparent)` }} />
      <div style={{ width: 42, height: 42, borderRadius: 11, background: `${color}15`, border: `1px solid ${color}30`, display: 'grid', placeItems: 'center', marginBottom: 18, color }}>{icon}</div>
      <div style={{ fontSize: 15, fontWeight: 800, color: textColor, marginBottom: 8, letterSpacing: '-0.3px' }}>{title}</div>
      <div style={{ fontSize: 13.5, color: descColor, lineHeight: 1.72 }}>{desc}</div>
    </div>
  )
}

function StepCard({ num, title, desc, icon, theme }: { num: string; title: string; desc: string; icon: ReactNode; theme: 'dark' | 'light' }) {
  const bg = theme === 'light' ? '#ffffff' : 'rgba(255,255,255,0.025)'
  const border = theme === 'light' ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.06)'
  const textColor = theme === 'light' ? '#0f0f0e' : '#ffffff'
  const descColor = theme === 'light' ? '#5a5a57' : 'rgba(255,255,255,0.42)'
  return (
    <div style={{ flex: 1, padding: '26px 24px', borderRadius: 14, background: bg, border: `1px solid ${border}`, boxShadow: theme === 'light' ? '0 2px 12px rgba(0,0,0,0.06)' : 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'linear-gradient(135deg,#c98317,#e2ab41)', display: 'grid', placeItems: 'center', fontWeight: 950, fontSize: 12, color: '#0a0800', flexShrink: 0 }}>{num}</div>
        <div style={{ color: '#e2ab41' }}>{icon}</div>
      </div>
      <div style={{ fontWeight: 800, fontSize: 14.5, color: textColor, marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 13, color: descColor, lineHeight: 1.7 }}>{desc}</div>
    </div>
  )
}

function Testimonial({ quote, name, role, company, initials, color, theme }: { quote: string; name: string; role: string; company: string; initials: string; color: string; theme: 'dark' | 'light' }) {
  const bg = theme === 'light' ? '#ffffff' : 'rgba(255,255,255,0.025)'
  const border = theme === 'light' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.07)'
  const quoteColor = theme === 'light' ? '#3d3d3b' : 'rgba(255,255,255,0.62)'
  const nameColor = theme === 'light' ? '#0f0f0e' : '#ffffff'
  const metaColor = theme === 'light' ? '#6b6b68' : 'rgba(255,255,255,0.3)'
  return (
    <div style={{ padding: '28px 28px', borderRadius: 16, background: bg, border: `1px solid ${border}`, display: 'flex', flexDirection: 'column', gap: 18, boxShadow: theme === 'light' ? '0 2px 12px rgba(0,0,0,0.06)' : 'none' }}>
      <div style={{ display: 'flex', gap: 2 }}>{[1,2,3,4,5].map(s => <Star key={s} size={13} fill="#e2ab41" color="#e2ab41" />)}</div>
      <div style={{ fontSize: 14, color: quoteColor, lineHeight: 1.8, fontStyle: 'italic' }}>&ldquo;{quote}&rdquo;</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 38, height: 38, borderRadius: '50%', background: `${color}20`, border: `1.5px solid ${color}40`, display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 900, color, flexShrink: 0 }}>{initials}</div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, color: nameColor }}>{name}</div>
          <div style={{ fontSize: 11.5, color: metaColor, marginTop: 2 }}>{role} · {company}</div>
        </div>
      </div>
    </div>
  )
}

function PricingCard({ plan, price, period, features, cta, color, highlight, theme }: { plan: string; price: string; period?: string; features: string[]; cta: string; color: string; highlight?: boolean; theme: 'dark' | 'light' }) {
  const bg = theme === 'light' ? '#ffffff' : 'rgba(255,255,255,0.025)'
  const border = theme === 'light' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.07)'
  const featureColor = theme === 'light' ? '#5a5a57' : 'rgba(255,255,255,0.55)'
  const priceColor = theme === 'light' ? '#0f0f0e' : '#ffffff'
  return (
    <div style={{ borderRadius: 20, padding: highlight ? '2px' : '0', background: highlight ? `linear-gradient(160deg, ${color}60, ${color}20, transparent)` : 'none', flex: '1 1 270px', minWidth: 250, maxWidth: 360 }}>
      <div style={{ padding: '30px 26px', borderRadius: highlight ? 18 : 20, background: highlight ? (theme === 'light' ? 'rgba(248,248,246,0.98)' : 'rgba(10,10,16,0.98)') : bg, border: highlight ? 'none' : `1px solid ${border}`, height: '100%', display: 'flex', flexDirection: 'column', gap: 20, position: 'relative', boxShadow: theme === 'light' ? '0 4px 24px rgba(0,0,0,0.08)' : 'none' }}>
        {highlight && <div style={{ position: 'absolute', top: 13, right: 13, padding: '4px 10px', borderRadius: 6, background: `${color}20`, border: `1px solid ${color}40`, fontSize: 10, fontWeight: 900, color, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Most popular</div>}
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, color, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>{plan}</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <span style={{ fontSize: 38, fontWeight: 950, color: priceColor, letterSpacing: '-1.5px' }}>{price}</span>
            {period && <span style={{ fontSize: 13, color: featureColor, fontWeight: 600 }}>{period}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9, flex: 1 }}>
          {features.map(f => (
            <div key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <CheckCircle size={13} color={color} style={{ flexShrink: 0, marginTop: 2 }} />
              <span style={{ fontSize: 13, color: featureColor, lineHeight: 1.5 }}>{f}</span>
            </div>
          ))}
        </div>
        <Link to="/signup" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: 46, borderRadius: 10, textDecoration: 'none', background: highlight ? 'linear-gradient(135deg,#c98317,#e2ab41,#f4ca57)' : (theme === 'light' ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.06)'), color: highlight ? '#0a0800' : priceColor, fontWeight: 800, fontSize: 14, border: highlight ? 'none' : `1px solid ${border}`, transition: 'all 0.15s' }}>
          {cta} <ArrowRight size={14} />
        </Link>
      </div>
    </div>
  )
}

export function MarketingHomePage() {
  const [theme] = useMktTheme()
  const bg = theme === 'light' ? '#f8f8f6' : '#060810'
  const text = theme === 'light' ? '#0f0f0e' : '#ffffff'
  const muted = theme === 'light' ? '#6b6b68' : 'rgba(255,255,255,0.38)'
  const border = theme === 'light' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.05)'
  const eyebrow = theme === 'light' ? 'rgba(168,106,14,0.9)' : 'rgba(226,171,65,0.7)'

  const bento = [
    { icon: <Brain size={20} />, color: '#e2ab41', wide: true, title: 'JecZone AI — your automated task reviewer', desc: 'Every submission is analysed before managers see it. AI flags missing evidence, quality issues, and late patterns — and generates a risk assessment automatically. No setup required.' },
    { icon: <Shield size={20} />, color: '#6366f1', title: 'Six-level role hierarchy', desc: 'Admin, HR, Director, Manager, Supervisor, Employee. Every action gated by role — configured in minutes, not weeks.' },
    { icon: <Camera size={20} />, color: '#38bdf8', title: 'Photo evidence on mobile', desc: 'Field workers photograph completed work and attach it directly to the task. No email chains, no spreadsheet attachments.' },
    { icon: <BarChart3 size={20} />, color: '#22c55e', wide: true, title: 'Analytics your managers will actually open', desc: 'Live completion rates, overdue heatmaps, team performance scores, and workload distribution — updated in real time. CSV export built in.' },
    { icon: <MessageSquare size={20} />, color: '#f59e0b', title: 'WhatsApp for field teams', desc: 'Notifications hit field workers on WhatsApp — the app they already check — not an inbox they ignore.' },
    { icon: <Clock size={20} />, color: '#8b5cf6', title: 'Full timestamped audit trail', desc: 'Every status change, approval, and comment is logged with a timestamp. One-click export for compliance review.' },
  ]

  const testimonials = [
    { quote: 'We cut project overruns by 40% in the first quarter. JecZone catches the issues our managers miss — before they become real problems.', name: 'Sarah Al-Rashid', role: 'VP Engineering', company: 'Horizon Tech', initials: 'SA', color: '#e2ab41' },
    { quote: 'Photo evidence changed everything for our field ops. No more "I thought it was done" — every task has proof attached.', name: 'Mohammed Al-Farsi', role: 'Operations Director', company: 'GulfBuild', initials: 'MF', color: '#38bdf8' },
    { quote: 'The role hierarchy is exactly what a 200-person org needs. HR, directors, supervisors — everyone sees exactly what they should.', name: 'Lina Johansson', role: 'Head of HR', company: 'NordScale', initials: 'LJ', color: '#8b5cf6' },
  ]

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,400;0,600;0,700;0,800;0,900;1,400&display=swap');
        @keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(28px)}to{opacity:1;transform:translateY(0)}}
        @keyframes scaleIn{from{opacity:0;transform:scale(0.96)}to{opacity:1;transform:scale(1)}}
        @keyframes marquee{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}
        .mkt-mq{display:flex;gap:10px;animation:marquee 30s linear infinite;width:max-content}
        .mkt-mq:hover{animation-play-state:paused}
        .mh-pill{display:inline-flex;align-items:center;gap:8px;padding:6px 14px;border-radius:8px;font-size:12px;font-weight:700;letter-spacing:0.03em;margin-bottom:24px;animation:fadeUp 0.6s ease both}
        .mh-h1{font-size:clamp(40px,5.5vw,74px);font-weight:950;letter-spacing:-2.5px;line-height:1.03;margin:0 0 20px;animation:fadeUp 0.6s 0.08s ease both}
        .mh-sub{font-size:clamp(15px,1.5vw,17.5px);line-height:1.8;max-width:500px;margin:0 0 36px;animation:fadeUp 0.6s 0.16s ease both}
        .mh-cta-row{display:flex;gap:12px;flex-wrap:wrap;animation:fadeUp 0.6s 0.24s ease both}
        .mh-cta-p{display:inline-flex;align-items:center;gap:10px;padding:0 28px;height:52px;border-radius:11px;background:linear-gradient(135deg,#c98317,#e2ab41,#f4ca57);color:#0a0800;font-weight:800;font-size:15px;text-decoration:none;transition:all 0.18s;font-family:inherit;border:none;cursor:pointer}
        .mh-cta-p:hover{box-shadow:0 10px 36px rgba(226,171,65,0.38);transform:translateY(-2px)}
        .mh-cta-s{display:inline-flex;align-items:center;gap:10px;padding:0 24px;height:52px;border-radius:11px;font-weight:700;font-size:15px;text-decoration:none;transition:all 0.18s;font-family:inherit}
        .mh-container{max-width:1180px;margin:0 auto;padding:0 32px}
        .mh-eyebrow{font-size:11px;font-weight:900;letter-spacing:0.14em;text-transform:uppercase;margin-bottom:14px;display:flex;align-items:center;gap:8px}
        .mh-eyebrow::before{content:'';display:block;width:20px;height:1.5px;background:currentColor;opacity:0.45}
        .mh-h2{font-size:clamp(26px,3.5vw,44px);font-weight:950;letter-spacing:-1.2px;margin:0 0 14px;line-height:1.08}
        .mh-h2-sub{font-size:15px;line-height:1.72;max-width:540px;margin:0 auto 52px}
        .mh-bento{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
        .mh-steps{display:flex;gap:12px}
        .mh-trust{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;letter-spacing:0.01em}
        .mh-stat-num{font-size:46px;font-weight:950;letter-spacing:-2px;background:linear-gradient(135deg,#f9e6a2,#e2ab41);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;line-height:1}
        @media(max-width:900px){
          .mh-hero-grid{grid-template-columns:1fr!important}
          .mh-hero-right{display:none!important}
          .mh-bento{grid-template-columns:1fr!important}
          .mh-bento>*{grid-column:span 1!important}
          .mh-steps{flex-direction:column!important}
          .mh-pricing-grid{flex-direction:column!important;align-items:center!important}
          .mh-stats-grid{grid-template-columns:repeat(2,1fr)!important}
        }
        @media(max-width:600px){.mh-container{padding:0 18px}.mh-h2{font-size:26px}}
      `}</style>

      <div style={{ background: bg, color: text, minHeight: '100vh', fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>

        {/* ═══ HERO ═══════════════════════════════════════════════════════ */}
        <section style={{ padding: '88px 0 72px', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            <div style={{ position: 'absolute', width: 900, height: 900, borderRadius: '50%', background: `radial-gradient(circle, rgba(226,171,65,${theme==='dark'?'0.06':'0.07'}) 0%, transparent 70%)`, top: -300, right: -200 }} />
            <div style={{ position: 'absolute', width: 600, height: 600, borderRadius: '50%', background: `radial-gradient(circle, rgba(99,102,241,${theme==='dark'?'0.06':'0.04'}) 0%, transparent 70%)`, bottom: -150, left: -100 }} />
            {theme === 'dark' && <svg style={{ position:'absolute',inset:0,width:'100%',height:'100%',opacity:0.025 }} xmlns="http://www.w3.org/2000/svg"><defs><pattern id="g1" width="60" height="60" patternUnits="userSpaceOnUse"><path d="M 60 0 L 0 0 0 60" fill="none" stroke="white" strokeWidth="1"/></pattern></defs><rect width="100%" height="100%" fill="url(#g1)"/></svg>}
          </div>

          <div className="mh-container">
            <div className="mh-hero-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 80, alignItems: 'center' }}>
              <div>
                <div className="mh-pill" style={{ background: theme==='dark'?'rgba(226,171,65,0.08)':'rgba(201,131,23,0.09)', border: theme==='dark'?'1px solid rgba(226,171,65,0.22)':'1px solid rgba(201,131,23,0.28)', color: theme==='dark'?'rgba(226,171,65,0.85)':'rgba(168,106,14,0.95)' }}>
                  <Brain size={12} /> Introducing JecZone AI v2 · Real-time risk scoring
                </div>
                <h1 className="mh-h1" style={{ color: text }}>Run your org.<br />Not just<br /><Typewriter /></h1>
                <p className="mh-sub" style={{ color: muted }}>TASKEE gives you AI-reviewed submissions, role-gated workflows, and live performance analytics — so nothing slips and no one is unaccountable.</p>
                <div className="mh-cta-row">
                  <Link to="/signup" className="mh-cta-p">Start free — no card <ArrowRight size={15} /></Link>
                  <a href="#demo" className="mh-cta-s"
                    style={{ background: theme==='dark'?'rgba(255,255,255,0.05)':'rgba(0,0,0,0.05)', border: theme==='dark'?'1px solid rgba(255,255,255,0.12)':'1px solid rgba(0,0,0,0.12)', color: theme==='dark'?'rgba(255,255,255,0.75)':'rgba(0,0,0,0.7)' }}
                    onClick={e => { e.preventDefault(); document.getElementById('demo')?.scrollIntoView({ behavior: 'smooth' }) }}>
                    <Play size={13} /> Watch demo
                  </a>
                </div>
                <div style={{ display: 'flex', gap: 22, marginTop: 36, flexWrap: 'wrap', animation: 'fadeUp 0.6s 0.32s ease both' }}>
                  {[[<Lock size={11}/>, 'No credit card'], [<Globe size={11}/>, 'Arabic & English'], [<Shield size={11}/>, 'Data encrypted']].map(([icon, label], i) => (
                    <span key={i} className="mh-trust" style={{ color: muted }}>{icon as ReactNode} {label as string}</span>
                  ))}
                </div>
              </div>

              <div className="mh-hero-right" style={{ animation: 'scaleIn 0.8s 0.2s ease both' }}>
                <div style={{ borderRadius: 18, overflow: 'hidden', border: `1px solid ${border}`, background: theme==='light'?'#fff':'rgba(255,255,255,0.025)', boxShadow: theme==='light'?'0 20px 60px rgba(0,0,0,0.1)':'0 20px 60px rgba(0,0,0,0.4)' }}>
                  <div style={{ height: 40, background: theme==='light'?'rgba(0,0,0,0.03)':'rgba(255,255,255,0.04)', borderBottom: `1px solid ${border}`, display: 'flex', alignItems: 'center', padding: '0 14px', gap: 6 }}>
                    {['#ef4444','#f59e0b','#22c55e'].map(c => <div key={c} style={{ width: 10, height: 10, borderRadius: '50%', background: c }} />)}
                    <div style={{ flex: 1, height: 22, borderRadius: 5, background: theme==='light'?'rgba(0,0,0,0.05)':'rgba(255,255,255,0.06)', marginLeft: 6 }} />
                  </div>
                  <div style={{ padding: 16 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 7, marginBottom: 10 }}>
                      {[['24','Active','#8b5cf6'],['7','Overdue','#ef4444'],['89%','Done','#22c55e']].map(([v,l,c]) => (
                        <div key={l} style={{ padding: '10px 11px', borderRadius: 8, background: `${c}12`, border: `1px solid ${c}25` }}>
                          <div style={{ fontSize: 17, fontWeight: 950, color: c }}>{v}</div>
                          <div style={{ fontSize: 9.5, color: muted, fontWeight: 700, marginTop: 2 }}>{l}</div>
                        </div>
                      ))}
                    </div>
                    {[{t:'Q3 server migration',s:'Critical',c:'#ef4444'},{t:'Onboard HR module',s:'In Progress',c:'#8b5cf6'},{t:'Field equipment check',s:'AI Reviewed',c:'#e2ab41'}].map(row => (
                      <div key={row.t} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 11px', marginBottom: 5, borderRadius: 7, background: theme==='light'?'rgba(0,0,0,0.03)':'rgba(255,255,255,0.025)', border: `1px solid ${border}` }}>
                        <span style={{ fontSize: 11.5, fontWeight: 600, color: theme==='light'?'#2d2d2b':'rgba(255,255,255,0.75)' }}>{row.t}</span>
                        <span style={{ fontSize: 9.5, fontWeight: 800, color: row.c, background: `${row.c}18`, border: `1px solid ${row.c}30`, padding: '2px 7px', borderRadius: 4, flexShrink: 0, marginLeft: 8 }}>{row.s}</span>
                      </div>
                    ))}
                    <div style={{ marginTop: 9, padding: '9px 12px', borderRadius: 8, background: 'rgba(226,171,65,0.07)', border: '1px solid rgba(226,171,65,0.18)', display: 'flex', alignItems: 'center', gap: 7 }}>
                      <Brain size={12} color="#e2ab41" /><span style={{ fontSize: 11, color: '#e2ab41', fontWeight: 700 }}>AI: Low risk · 2 tasks flagged</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ═══ TRUST STRIP ════════════════════════════════════════════════ */}
        <div style={{ borderTop: `1px solid ${border}`, borderBottom: `1px solid ${border}`, padding: '18px 0' }}>
          <div className="mh-container">
            <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'nowrap', overflow: 'hidden' }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: muted, textTransform: 'uppercase', letterSpacing: '0.08em', flexShrink: 0 }}>Trusted by</span>
              <LogoStrip theme={theme} />
            </div>
          </div>
        </div>

        {/* ═══ STATS ══════════════════════════════════════════════════════ */}
        <section style={{ padding: '68px 0' }}>
          <div className="mh-container">
            <div className="mh-stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 0 }}>
              {[{to:500,suffix:'+',label:'Active organizations'},{to:10000,suffix:'+',label:'Tasks tracked daily'},{to:98.9,suffix:'%',label:'Uptime guarantee'},{to:35,suffix:'%',label:'Faster delivery avg.'}].map(({to,suffix,label},i) => (
                <div key={label} style={{ textAlign: 'center', padding: '18px 16px', borderRight: i < 3 ? `1px solid ${border}` : 'none' }}>
                  <div className="mh-stat-num"><Counter to={to} suffix={suffix} /></div>
                  <div style={{ fontSize: 11.5, color: muted, fontWeight: 700, marginTop: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <div style={{ borderTop: `1px solid ${border}` }} />

        {/* ═══ DEMO VIDEO ══════════════════════════════════════════════════ */}
        <section id="demo" style={{ padding: '96px 0' }}>
          <div className="mh-container">
            <div style={{ textAlign: 'center', marginBottom: 48 }}>
              <div className="mh-eyebrow" style={{ color: eyebrow, justifyContent: 'center' }}>Product walkthrough</div>
              <h2 className="mh-h2" style={{ color: text }}>From assignment to approval.<br />Every step, on record.</h2>
              <p className="mh-h2-sub" style={{ color: muted }}>See how tasks move through AI review, manager approval, and audit logging — live in the platform.</p>
            </div>
            <DemoVideo theme={theme} />
          </div>
        </section>

        <div style={{ borderTop: `1px solid ${border}` }} />

        {/* ═══ FEATURES BENTO ══════════════════════════════════════════════ */}
        <section style={{ padding: '96px 0' }}>
          <div className="mh-container">
            <div style={{ textAlign: 'center', marginBottom: 52 }}>
              <div className="mh-eyebrow" style={{ color: eyebrow, justifyContent: 'center' }}>Built for operators</div>
              <h2 className="mh-h2" style={{ color: text }}>Everything your managers need.<br />Nothing their teams will fight.</h2>
              <p className="mh-h2-sub" style={{ color: muted }}>Designed for operations, field crews, HR, and finance — all in one platform, all accountable.</p>
            </div>
            <div className="mh-bento">
              {bento.map((f, i) => <BentoCard key={f.title} {...f} index={i} theme={theme} />)}
            </div>
          </div>
        </section>

        <div style={{ borderTop: `1px solid ${border}` }} />

        {/* ═══ HOW IT WORKS ════════════════════════════════════════════════ */}
        <section style={{ padding: '96px 0' }}>
          <div className="mh-container">
            <div style={{ textAlign: 'center', marginBottom: 52 }}>
              <div className="mh-eyebrow" style={{ color: eyebrow, justifyContent: 'center' }}>How it works</div>
              <h2 className="mh-h2" style={{ color: text }}>Five steps. Zero ambiguity.</h2>
              <p className="mh-h2-sub" style={{ color: muted }}>Every task follows the same path. Nothing skips a step, nothing goes untracked.</p>
            </div>
            <div className="mh-steps">
              {[
                { num:'01', icon:<Layers size={14}/>, title:'Create & assign', desc:'Manager creates task with deadline and priority. AI recommends assignee based on workload.' },
                { num:'02', icon:<Camera size={14}/>, title:'Work & upload evidence', desc:'Employee attaches photo evidence and posts updates in the per-task comment thread.' },
                { num:'03', icon:<Brain size={14}/>, title:'AI pre-reviews', desc:'JecZone analyses the submission — completeness, evidence quality — before manager is notified.' },
                { num:'04', icon:<CheckCircle size={14}/>, title:'Manager approves', desc:'Manager approves, requests changes, or rejects. All decisions logged with timestamps.' },
                { num:'05', icon:<Bell size={14}/>, title:'Notify & measure', desc:'WhatsApp or email confirmations sent. Dashboards update. Audit trail closes.' },
              ].map(s => <StepCard key={s.num} {...s} theme={theme} />)}
            </div>
          </div>
        </section>

        <div style={{ borderTop: `1px solid ${border}` }} />

        {/* ═══ TESTIMONIALS ════════════════════════════════════════════════ */}
        <section style={{ padding: '96px 0' }}>
          <div className="mh-container">
            <div style={{ textAlign: 'center', marginBottom: 48 }}>
              <div className="mh-eyebrow" style={{ color: eyebrow, justifyContent: 'center' }}>Customer stories</div>
              <h2 className="mh-h2" style={{ color: text }}>Teams that switched never looked back.</h2>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 14 }}>
              {testimonials.map(t => <Testimonial key={t.name} {...t} theme={theme} />)}
            </div>
          </div>
        </section>

        <div style={{ borderTop: `1px solid ${border}` }} />

        {/* ═══ PRICING ═════════════════════════════════════════════════════ */}
        <section style={{ padding: '96px 0', background: theme==='dark'?'rgba(226,171,65,0.012)':'rgba(226,171,65,0.025)' }}>
          <div className="mh-container">
            <div style={{ textAlign: 'center', marginBottom: 52 }}>
              <div className="mh-eyebrow" style={{ color: eyebrow, justifyContent: 'center' }}>Pricing</div>
              <h2 className="mh-h2" style={{ color: text }}>One seat, one price. Scale as you grow.</h2>
              <p className="mh-h2-sub" style={{ color: muted }}>Monthly billing. Cancel anytime. Every plan includes the core task engine.</p>
            </div>
            <div className="mh-pricing-grid" style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap', alignItems: 'stretch' }}>
              <PricingCard theme={theme} plan="Starter" price="Free" features={['Up to 10 team members','Core task management','Basic analytics','Email notifications','Community support']} cta="Get started free" color="#38bdf8" />
              <PricingCard theme={theme} plan="Professional" price="$12" period="/seat/month" features={['Up to 50 members','JecZone AI analysis','Advanced analytics + CSV','WhatsApp notifications','HR & leave management','Priority support (< 4h)']} cta="Start free trial" color="#e2ab41" highlight />
              <PricingCard theme={theme} plan="Enterprise" price="Custom" features={['Unlimited members','Custom approval flows','Dedicated account manager','SSO / SAML','SLA guarantee','On-premise option']} cta="Talk to sales" color="#8b5cf6" />
            </div>
          </div>
        </section>

        <div style={{ borderTop: `1px solid ${border}` }} />

        {/* ═══ CTA BANNER ══════════════════════════════════════════════════ */}
        <section style={{ padding: '96px 0', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(ellipse 80% 70% at 50% 50%, rgba(226,171,65,${theme==='dark'?'0.05':'0.06'}) 0%, transparent 70%)`, pointerEvents: 'none' }} />
          <div className="mh-container" style={{ textAlign: 'center', position: 'relative' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 7, background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)', fontSize: 11.5, fontWeight: 800, color: '#4ade80', marginBottom: 24 }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e', animation: 'blink 2s ease-in-out infinite' }} />
              Live now — 5-minute setup
            </div>
            <h2 style={{ fontSize: 'clamp(30px,5vw,58px)', fontWeight: 950, letterSpacing: '-2px', color: text, margin: '0 0 16px', lineHeight: 1.06 }}>
              Your team deserves<br />
              <span style={{ background: 'linear-gradient(135deg,#f9e6a2,#e2ab41,#c98317)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>real accountability.</span>
            </h2>
            <p style={{ fontSize: 16, color: muted, lineHeight: 1.7, maxWidth: 420, margin: '0 auto 40px' }}>Start free. No credit card. Live in five minutes.</p>
            <Link to="/signup" className="mh-cta-p" style={{ fontSize: 16, height: 56, padding: '0 36px', display: 'inline-flex' }}>Create your workspace <ArrowRight size={17} /></Link>
            <div style={{ display: 'flex', gap: 24, justifyContent: 'center', marginTop: 36, flexWrap: 'wrap' }}>
              {[[<Award size={12}/>, 'Rated 4.9/5'], [<TrendingUp size={12}/>, '35% faster delivery'], [<Shield size={12}/>, 'Enterprise-grade security'], [<Users size={12}/>, '500+ organizations']].map(([icon, text2], i) => (
                <span key={i} className="mh-trust" style={{ color: muted }}>{icon as ReactNode} {text2 as string}</span>
              ))}
            </div>
          </div>
        </section>

      </div>
    </>
  )
}
