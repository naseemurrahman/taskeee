import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  Zap, Shield, BarChart3, MessageSquare, Clock, Users,
  CheckCircle, ArrowRight, ChevronRight, Star, Globe,
  Layers, GitBranch, Bell, Lock, TrendingUp, Award,
} from 'lucide-react'

// ── Intersection observer hook for scroll reveals ────────────────────────────
function useReveal(threshold = 0.12) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect() } }, { threshold })
    obs.observe(el)
    return () => obs.disconnect()
  }, [threshold])
  return { ref, visible }
}

// ── Typewriter ───────────────────────────────────────────────────────────────
const WORDS = ['Results.', 'Clarity.', 'Accountability.', 'Performance.', 'Excellence.']
function Typewriter() {
  const [idx, setIdx] = useState(0)
  const [shown, setShown] = useState(0)
  const [deleting, setDeleting] = useState(false)
  useEffect(() => {
    const word = WORDS[idx]
    const delay = deleting ? 45 : shown < word.length ? 85 : 1800
    const id = setTimeout(() => {
      if (!deleting && shown === word.length) { setDeleting(true); return }
      if (deleting && shown === 0) { setDeleting(false); setIdx(i => (i + 1) % WORDS.length); return }
      setShown(s => s + (deleting ? -1 : 1))
    }, delay)
    return () => clearTimeout(id)
  }, [idx, shown, deleting])
  return (
    <span style={{ color: '#e2ab41' }}>
      {WORDS[idx].slice(0, shown)}
      <span style={{ opacity: 0.7, animation: 'blink 1s step-end infinite' }}>|</span>
    </span>
  )
}

// ── Stat counter ─────────────────────────────────────────────────────────────
function Counter({ to, suffix = '' }: { to: number; suffix?: string }) {
  const [val, setVal] = useState(0)
  const { ref, visible } = useReveal()
  useEffect(() => {
    if (!visible) return
    const steps = 40, interval = 30
    let step = 0
    const id = setInterval(() => {
      step++
      setVal(Math.round(to * (step / steps)))
      if (step >= steps) clearInterval(id)
    }, interval)
    return () => clearInterval(id)
  }, [visible, to])
  return <span ref={ref}>{val.toLocaleString()}{suffix}</span>
}

// ── Feature block ─────────────────────────────────────────────────────────────
function FeatureBlock({ icon, title, desc, index }: { icon: ReactNode; title: string; desc: string; index: number }) {
  const { ref, visible } = useReveal()
  return (
    <div ref={ref} style={{
      opacity: visible ? 1 : 0,
      transform: visible ? 'none' : 'translateY(28px)',
      transition: `opacity 0.55s ${index * 0.08}s ease, transform 0.55s ${index * 0.08}s ease`,
      padding: '28px 30px',
      borderRadius: 18,
      background: 'rgba(255,255,255,0.025)',
      border: '1px solid rgba(255,255,255,0.06)',
      backdropFilter: 'blur(8px)',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: 'linear-gradient(90deg, transparent, rgba(226,171,65,0.3), transparent)' }} />
      <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(226,171,65,0.1)', border: '1px solid rgba(226,171,65,0.2)', display: 'grid', placeItems: 'center', marginBottom: 18, color: '#e2ab41' }}>
        {icon}
      </div>
      <div style={{ fontSize: 15, fontWeight: 800, color: '#fff', marginBottom: 8, letterSpacing: '-0.3px' }}>{title}</div>
      <div style={{ fontSize: 13.5, color: 'rgba(255,255,255,0.42)', lineHeight: 1.7 }}>{desc}</div>
    </div>
  )
}

// ── Workflow step ─────────────────────────────────────────────────────────────
function WorkflowStep({ num, title, desc, icon }: { num: string; title: string; desc: string; icon: ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
        <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'linear-gradient(135deg,#c98317,#e2ab41)', display: 'grid', placeItems: 'center', fontWeight: 950, fontSize: 14, color: '#0a0800' }}>{num}</div>
        <div style={{ width: 1, flex: 1, background: 'rgba(255,255,255,0.07)', marginTop: 8, minHeight: 40 }} />
      </div>
      <div style={{ paddingBottom: 36, paddingTop: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, color: '#e2ab41' }}>{icon}<span style={{ fontWeight: 800, fontSize: 14, color: '#fff' }}>{title}</span></div>
        <div style={{ fontSize: 13.5, color: 'rgba(255,255,255,0.4)', lineHeight: 1.7 }}>{desc}</div>
      </div>
    </div>
  )
}

// ── Testimonial ───────────────────────────────────────────────────────────────
function Testimonial({ quote, name, role, company, initials, color }: { quote: string; name: string; role: string; company: string; initials: string; color: string }) {
  return (
    <div style={{ padding: '28px 30px', borderRadius: 20, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', gap: 2 }}>
        {[1,2,3,4,5].map(s => <Star key={s} size={13} fill="#e2ab41" color="#e2ab41" />)}
      </div>
      <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.62)', lineHeight: 1.75, fontStyle: 'italic' }}>&ldquo;{quote}&rdquo;</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 38, height: 38, borderRadius: '50%', background: `${color}22`, border: `1.5px solid ${color}44`, display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 900, color, flexShrink: 0 }}>{initials}</div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#fff' }}>{name}</div>
          <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.3)', marginTop: 1 }}>{role} · {company}</div>
        </div>
      </div>
    </div>
  )
}

// ── Pricing card ──────────────────────────────────────────────────────────────
function PricingCard({ plan, price, period, features, cta, color, highlight }: { plan: string; price: string; period?: string; features: string[]; cta: string; color: string; highlight?: boolean }) {
  return (
    <div style={{
      borderRadius: 22,
      padding: highlight ? '2px' : '0',
      background: highlight ? `linear-gradient(160deg, ${color}60, ${color}20, transparent)` : 'none',
      flex: '1 1 280px',
      minWidth: 260,
      maxWidth: 360,
    }}>
      <div style={{
        padding: '32px 28px',
        borderRadius: highlight ? 20 : 22,
        background: highlight ? 'rgba(12,14,28,0.98)' : 'rgba(255,255,255,0.025)',
        border: highlight ? 'none' : '1px solid rgba(255,255,255,0.07)',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 24,
        position: 'relative',
        overflow: 'hidden',
      }}>
        {highlight && <div style={{ position: 'absolute', top: 14, right: 14, padding: '4px 10px', borderRadius: 6, background: `${color}20`, border: `1px solid ${color}40`, fontSize: 10, fontWeight: 900, color, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Most popular</div>}
        <div>
          <div style={{ fontSize: 12, fontWeight: 800, color, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>{plan}</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <span style={{ fontSize: 40, fontWeight: 950, color: '#fff', letterSpacing: '-1.5px' }}>{price}</span>
            {period && <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', fontWeight: 600 }}>{period}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
          {features.map(f => (
            <div key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <CheckCircle size={14} color={color} style={{ flexShrink: 0, marginTop: 2 }} />
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', lineHeight: 1.5 }}>{f}</span>
            </div>
          ))}
        </div>
        <Link to="/signup" style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          height: 48, borderRadius: 12, textDecoration: 'none',
          background: highlight ? `linear-gradient(135deg,#c98317,#e2ab41,#f4ca57)` : `rgba(255,255,255,0.06)`,
          color: highlight ? '#0a0800' : '#fff',
          fontWeight: 800, fontSize: 14,
          border: highlight ? 'none' : '1px solid rgba(255,255,255,0.1)',
          transition: 'all 0.15s',
        }}>
          {cta} <ArrowRight size={14} />
        </Link>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export function MarketingHomePage() {
  const { ref: statsRef, visible: statsVisible } = useReveal()

  const features = [
    { icon: <Zap size={20} />, title: 'AI-Powered Task Analysis', desc: 'JecZone AI reviews every submission, flags risks, suggests reassignments, and generates performance reports — automatically.' },
    { icon: <Shield size={20} />, title: 'Role-Based Access Control', desc: 'Admin, HR, Director, Manager, Supervisor, Employee — every action is scoped to the right level. No exceptions, no workarounds.' },
    { icon: <BarChart3 size={20} />, title: 'Real-Time Analytics', desc: 'Live dashboards with completion rates, overdue alerts, workload heatmaps, and team performance scores updated as work happens.' },
    { icon: <MessageSquare size={20} />, title: 'Task Chat & Evidence', desc: 'Comment threads per task. Upload photos as evidence. WhatsApp delivery for field teams. Everything logged, nothing lost.' },
    { icon: <Clock size={20} />, title: 'Approval Workflows', desc: 'Multi-stage approval flows. AI pre-review before manager sign-off. Track every decision with a timestamped audit trail.' },
    { icon: <Users size={20} />, title: 'HR & Leave Management', desc: 'Full employee directory, leave requests, time-off approvals, and payroll exports — integrated with the task layer.' },
  ]

  const testimonials = [
    { quote: 'TASKEE cut our project delivery time by 35%. The AI insights flag at-risk tasks before they become real problems.', name: 'Sarah Al-Rashid', role: 'VP Engineering', company: 'Horizon Tech', initials: 'SA', color: '#e2ab41' },
    { quote: 'Our managers finally have visibility into what field teams are actually doing. The evidence upload feature is a game-changer.', name: 'Mohammed Al-Farsi', role: 'Operations Director', company: 'GulfBuild', initials: 'MF', color: '#38bdf8' },
    { quote: 'The role-based access is exactly what a 200-person org needs. HR, managers, and employees each see exactly what they should.', name: 'Lina Johansson', role: 'Head of HR', company: 'NordScale', initials: 'LJ', color: '#8b5cf6' },
  ]

  return (
    <>
      <style>{`
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes floatY { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-12px)} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(32px)} to{opacity:1;transform:translateY(0)} }
        @keyframes scaleIn { from{opacity:0;transform:scale(0.94)} to{opacity:1;transform:scale(1)} }
        .mkt-hero-pill { display:inline-flex;align-items:center;gap:8px;padding:6px 14px;border-radius:999px;background:rgba(226,171,65,0.08);border:1px solid rgba(226,171,65,0.22);font-size:12px;font-weight:700;color:rgba(226,171,65,0.85);letter-spacing:0.04em;margin-bottom:28px;animation:fadeUp 0.6s ease both; }
        .mkt-hero-h1 { font-size:clamp(42px,6vw,76px);font-weight:950;letter-spacing:-3px;line-height:1.02;color:#fff;margin:0 0 20px;animation:fadeUp 0.6s 0.1s ease both; }
        .mkt-hero-sub { font-size:clamp(15px,1.6vw,18px);color:rgba(255,255,255,0.42);line-height:1.75;max-width:520px;margin:0 0 40px;animation:fadeUp 0.6s 0.2s ease both; }
        .mkt-cta-primary { display:inline-flex;align-items:center;gap:10px;padding:0 28px;height:54px;border-radius:14px;background:linear-gradient(135deg,#c98317,#e2ab41,#f4ca57);color:#0a0800;font-weight:800;font-size:15px;text-decoration:none;transition:all 0.18s;letter-spacing:-0.01em; }
        .mkt-cta-primary:hover { box-shadow:0 12px 40px rgba(226,171,65,0.35),0 4px 12px rgba(0,0,0,0.3);transform:translateY(-2px); }
        .mkt-cta-secondary { display:inline-flex;align-items:center;gap:10px;padding:0 24px;height:54px;border-radius:14px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.10);color:rgba(255,255,255,0.7);font-weight:700;font-size:15px;text-decoration:none;transition:all 0.18s; }
        .mkt-cta-secondary:hover { background:rgba(255,255,255,0.08);border-color:rgba(255,255,255,0.18);color:#fff; }
        .mkt-section { padding:100px 0; }
        .mkt-section-sm { padding:70px 0; }
        .mkt-container { max-width:1160px;margin:0 auto;padding:0 32px; }
        .mkt-eyebrow { font-size:11.5px;font-weight:900;letter-spacing:0.14em;text-transform:uppercase;color:rgba(226,171,65,0.7);margin-bottom:16px;display:flex;align-items:center;gap:8px; }
        .mkt-eyebrow::before { content:'';display:block;width:24px;height:1px;background:rgba(226,171,65,0.4); }
        .mkt-h2 { font-size:clamp(28px,4vw,46px);font-weight:950;letter-spacing:-1.5px;color:#fff;margin:0 0 16px;line-height:1.08; }
        .mkt-h2-sub { font-size:15px;color:rgba(255,255,255,0.38);line-height:1.7;max-width:540px;margin:0 auto 56px; }
        .mkt-feat-grid { display:grid;grid-template-columns:repeat(auto-fit,minmax(310px,1fr));gap:16px; }
        .mkt-stat-num { font-size:48px;font-weight:950;letter-spacing:-2px;background:linear-gradient(135deg,#f9e6a2,#e2ab41);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;line-height:1; }
        .mkt-stat-label { font-size:12.5px;color:rgba(255,255,255,0.38);font-weight:700;margin-top:6px;text-transform:uppercase;letter-spacing:0.06em; }
        .mkt-divider { border:none;border-top:1px solid rgba(255,255,255,0.05);margin:0; }
        .mkt-trust-badge { display:inline-flex;align-items:center;gap:7px;font-size:12px;font-weight:700;color:rgba(255,255,255,0.28);letter-spacing:0.01em; }
        .mkt-hero-ui { width:100%;border-radius:18px;overflow:hidden;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.02);animation:scaleIn 0.8s 0.3s ease both; }
        .mkt-ui-bar { height:38px;background:rgba(255,255,255,0.04);border-bottom:1px solid rgba(255,255,255,0.06);display:flex;align-items:center;padding:0 14px;gap:6px; }
        .mkt-ui-dot { width:10px;height:10px;border-radius:50%; }
        .mkt-ui-content { padding:20px; }
        .mkt-ui-card { padding:14px 16px;border-radius:12px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);margin-bottom:10px;display:flex;justify-content:space-between;align-items:center; }
        .mkt-ui-tag { padding:3px 10px;border-radius:6px;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:0.06em; }
        @media(max-width:860px){
          .mkt-hero-grid{grid-template-columns:1fr!important}
          .mkt-hero-right{display:none!important}
          .mkt-feat-grid{grid-template-columns:1fr!important}
          .mkt-pricing-grid{flex-direction:column!important;align-items:center!important}
        }
        @media(max-width:600px){
          .mkt-container{padding:0 20px}
          .mkt-section{padding:64px 0}
          .mkt-h2{font-size:28px}
        }
      `}</style>

      <div style={{ background: '#060810', color: '#fff', minHeight: '100vh' }}>

        {/* ══════════════════ HERO ══════════════════ */}
        <section style={{ padding: '80px 0 60px', position: 'relative', overflow: 'hidden' }}>
          {/* Mesh background */}
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            <div style={{ position: 'absolute', width: 800, height: 800, borderRadius: '50%', background: 'radial-gradient(circle, rgba(226,171,65,0.07) 0%, transparent 70%)', top: -200, right: -100 }} />
            <div style={{ position: 'absolute', width: 600, height: 600, borderRadius: '50%', background: 'radial-gradient(circle, rgba(99,102,241,0.06) 0%, transparent 70%)', bottom: -200, left: 0 }} />
            {/* Grid lines */}
            <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.035 }} xmlns="http://www.w3.org/2000/svg">
              <defs><pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse"><path d="M 60 0 L 0 0 0 60" fill="none" stroke="white" strokeWidth="1"/></pattern></defs>
              <rect width="100%" height="100%" fill="url(#grid)" />
            </svg>
          </div>

          <div className="mkt-container">
            <div className="mkt-hero-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 72, alignItems: 'center' }}>
              {/* Left */}
              <div>
                <div className="mkt-hero-pill">
                  <Zap size={12} />
                  Now with JecZone AI · Llama 3.3 70B
                </div>
                <h1 className="mkt-hero-h1">
                  Task management<br />built for <Typewriter />
                </h1>
                <p className="mkt-hero-sub">
                  The only platform that combines AI-powered task intelligence, role-based hierarchy, and real-time analytics — so every team member is accountable, always.
                </p>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', animation: 'fadeUp 0.6s 0.3s ease both' }}>
                  <Link to="/signup" className="mkt-cta-primary">
                    Start free — no card needed <ArrowRight size={16} />
                  </Link>
                  <Link to="/signin" className="mkt-cta-secondary">
                    Sign in <ChevronRight size={14} />
                  </Link>
                </div>
                <div style={{ display: 'flex', gap: 24, marginTop: 36, flexWrap: 'wrap', animation: 'fadeUp 0.6s 0.4s ease both' }}>
                  {[
                    [<Lock size={12} />, 'No credit card'],
                    [<Globe size={12} />, 'Multi-language'],
                    [<Shield size={12} />, 'Data encrypted'],
                  ].map(([icon, label], i) => (
                    <span key={i} className="mkt-trust-badge">{icon as ReactNode} {label as string}</span>
                  ))}
                </div>
              </div>

              {/* Right — app preview */}
              <div className="mkt-hero-right" style={{ animation: 'scaleIn 0.8s 0.3s ease both' }}>
                <div className="mkt-hero-ui">
                  <div className="mkt-ui-bar">
                    <div className="mkt-ui-dot" style={{ background: '#ef4444' }} />
                    <div className="mkt-ui-dot" style={{ background: '#f59e0b' }} />
                    <div className="mkt-ui-dot" style={{ background: '#22c55e' }} />
                    <div style={{ flex: 1, height: 22, borderRadius: 6, background: 'rgba(255,255,255,0.06)', margin: '0 8px' }} />
                  </div>
                  <div className="mkt-ui-content">
                    {/* Mini dashboard preview */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 14 }}>
                      {[['24', 'Active', '#8b5cf6'], ['7', 'Overdue', '#ef4444'], ['89%', 'Done', '#22c55e']].map(([v, l, c]) => (
                        <div key={l} style={{ padding: '12px 14px', borderRadius: 10, background: `${c}12`, border: `1px solid ${c}25` }}>
                          <div style={{ fontSize: 20, fontWeight: 950, color: c }}>{v}</div>
                          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', fontWeight: 700, marginTop: 2 }}>{l}</div>
                        </div>
                      ))}
                    </div>
                    {[
                      { title: 'Quarterly server migration', tag: 'Critical', tagColor: '#ef4444', who: 'Bashir A.' },
                      { title: 'Onboard new HR module', tag: 'In Progress', tagColor: '#8b5cf6', who: 'Nasim R.' },
                      { title: 'Configure network switches', tag: 'Submitted', tagColor: '#38bdf8', who: 'Muddaser K.' },
                      { title: 'Update employee contracts', tag: 'Approved', tagColor: '#22c55e', who: 'Sarah M.' },
                    ].map(row => (
                      <div key={row.title} className="mkt-ui-card">
                        <div>
                          <div style={{ fontSize: 12.5, fontWeight: 700, color: 'rgba(255,255,255,0.75)', marginBottom: 4 }}>{row.title}</div>
                          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.28)' }}>{row.who}</div>
                        </div>
                        <div className="mkt-ui-tag" style={{ background: `${row.tagColor}18`, color: row.tagColor, border: `1px solid ${row.tagColor}30` }}>{row.tag}</div>
                      </div>
                    ))}
                    {/* Risk bar */}
                    <div style={{ marginTop: 14, padding: '12px 16px', borderRadius: 12, background: 'rgba(226,171,65,0.06)', border: '1px solid rgba(226,171,65,0.15)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <span style={{ fontSize: 11.5, fontWeight: 800, color: 'rgba(226,171,65,0.8)' }}>⚡ AI Risk Score</span>
                        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>Updated just now</span>
                      </div>
                      <div style={{ height: 6, borderRadius: 999, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: '32%', background: 'linear-gradient(90deg,#e2ab41,#f4ca57)', borderRadius: 999 }} />
                      </div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 6 }}>32% risk · 3 tasks need attention</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <hr className="mkt-divider" />

        {/* ══════════════════ STATS ══════════════════ */}
        <section className="mkt-section-sm" id="products">
          <div className="mkt-container">
            <div ref={statsRef} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 0, opacity: statsVisible ? 1 : 0, transition: 'opacity 0.7s ease' }}>
              {[
                { to: 500, suffix: '+', label: 'Organizations' },
                { to: 10000, suffix: '+', label: 'Daily tasks tracked' },
                { to: 98.9, suffix: '%', label: 'Uptime SLA' },
                { to: 35, suffix: '%', label: 'Avg delivery gain' },
              ].map(({ to, suffix, label }, i) => (
                <div key={label} style={{ textAlign: 'center', padding: '24px 20px', borderRight: i < 3 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
                  <div className="mkt-stat-num"><Counter to={to} suffix={suffix} /></div>
                  <div className="mkt-stat-label">{label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <hr className="mkt-divider" />

        {/* ══════════════════ FEATURES ══════════════════ */}
        <section className="mkt-section" id="solutions">
          <div className="mkt-container">
            <div style={{ textAlign: 'center', marginBottom: 56 }}>
              <div className="mkt-eyebrow" style={{ justifyContent: 'center' }}>Why TASKEE</div>
              <h2 className="mkt-h2">Everything your team needs.<br />Nothing they don't.</h2>
              <p className="mkt-h2-sub">Built for organizations that demand precision — from task creation to completion audit.</p>
            </div>
            <div className="mkt-feat-grid">
              {features.map((f, i) => <FeatureBlock key={f.title} {...f} index={i} />)}
            </div>
          </div>
        </section>

        <hr className="mkt-divider" />

        {/* ══════════════════ HOW IT WORKS ══════════════════ */}
        <section className="mkt-section" id="workflow">
          <div className="mkt-container">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 80, alignItems: 'start' }}>
              <div>
                <div className="mkt-eyebrow">How it works</div>
                <h2 className="mkt-h2" style={{ textAlign: 'left', margin: '0 0 14px' }}>From assignment<br />to approval,<br />fully tracked.</h2>
                <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.38)', lineHeight: 1.75, marginBottom: 48 }}>Every task follows a defined workflow. No ambiguity, no lost work, no missed deadlines slipping through unnoticed.</p>
                <Link to="/signup" className="mkt-cta-primary" style={{ display: 'inline-flex' }}>
                  See it in action <ArrowRight size={15} />
                </Link>
              </div>
              <div>
                {[
                  { num: '01', icon: <Layers size={14} />, title: 'Create and assign', desc: 'Managers create tasks with priority, deadline, and project. AI capacity guidance recommends the right assignee based on current workload.' },
                  { num: '02', icon: <GitBranch size={14} />, title: 'Work and submit evidence', desc: 'Employees work through tasks, upload photo or file evidence, and submit for review — with a chat thread per task for updates.' },
                  { num: '03', icon: <Zap size={14} />, title: 'AI reviews first', desc: 'JecZone AI analyses the submission before the manager sees it — flagging gaps, risks, or quality issues automatically.' },
                  { num: '04', icon: <CheckCircle size={14} />, title: 'Manager approves', desc: 'With full context visible, managers approve, request changes, or reject — and the outcome is logged to the audit trail.' },
                  { num: '05', icon: <Bell size={14} />, title: 'Notify and measure', desc: 'Stakeholders are notified via in-app, email, or WhatsApp. Performance dashboards update in real time.' },
                ].map(s => <WorkflowStep key={s.num} {...s} />)}
              </div>
            </div>
          </div>
        </section>

        <hr className="mkt-divider" />

        {/* ══════════════════ TESTIMONIALS ══════════════════ */}
        <section className="mkt-section">
          <div className="mkt-container">
            <div style={{ textAlign: 'center', marginBottom: 52 }}>
              <div className="mkt-eyebrow" style={{ justifyContent: 'center' }}>Customer stories</div>
              <h2 className="mkt-h2">Teams that switched<br />never looked back.</h2>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 16 }}>
              {testimonials.map(t => <Testimonial key={t.name} {...t} />)}
            </div>
          </div>
        </section>

        <hr className="mkt-divider" />

        {/* ══════════════════ PRICING ══════════════════ */}
        <section className="mkt-section" id="pricing" style={{ background: 'rgba(226,171,65,0.015)' }}>
          <div className="mkt-container">
            <div style={{ textAlign: 'center', marginBottom: 52 }}>
              <div className="mkt-eyebrow" style={{ justifyContent: 'center' }}>Pricing</div>
              <h2 className="mkt-h2">Simple. Transparent.<br />Per employee seat.</h2>
              <p className="mkt-h2-sub">Scale up or down anytime. No lock-in contracts.</p>
            </div>
            <div className="mkt-pricing-grid" style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap', alignItems: 'stretch' }}>
              <PricingCard plan="Starter" price="Free" features={['Up to 10 team members','Core task management','Basic analytics','Email notifications','Community support']} cta="Get started free" color="#38bdf8" />
              <PricingCard plan="Professional" price="$12" period="/seat/month" features={['Up to 50 team members','AI task analysis (JecZone)','Advanced analytics & charts','WhatsApp notifications','HR & leave management','Priority support']} cta="Start free trial" color="#e2ab41" highlight />
              <PricingCard plan="Enterprise" price="Custom" features={['Unlimited members','Custom approval workflows','Dedicated account manager','SSO / SAML integration','SLA uptime guarantee','On-premise option']} cta="Talk to sales" color="#8b5cf6" />
            </div>
          </div>
        </section>

        <hr className="mkt-divider" />

        {/* ══════════════════ CTA BANNER ══════════════════ */}
        <section style={{ padding: '90px 0', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 80% 80% at 50% 50%, rgba(226,171,65,0.05) 0%, transparent 70%)', pointerEvents: 'none' }} />
          <div className="mkt-container" style={{ textAlign: 'center', position: 'relative' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 8, background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)', fontSize: 11.5, fontWeight: 800, color: '#4ade80', marginBottom: 24 }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e', animation: 'blink 2s ease-in-out infinite' }} />
              Live — no setup required
            </div>
            <h2 style={{ fontSize: 'clamp(32px,5vw,60px)', fontWeight: 950, letterSpacing: '-2px', color: '#fff', margin: '0 0 18px', lineHeight: 1.05 }}>
              Your team deserves<br />
              <span style={{ background: 'linear-gradient(135deg,#f9e6a2,#e2ab41,#c98317)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>better tooling.</span>
            </h2>
            <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.38)', lineHeight: 1.7, marginBottom: 40, maxWidth: 440, margin: '0 auto 40px' }}>
              Start free, scale when you're ready. Setup takes under 5 minutes.
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              <Link to="/signup" className="mkt-cta-primary" style={{ fontSize: 16, height: 58, padding: '0 36px' }}>
                Create your workspace <ArrowRight size={17} />
              </Link>
            </div>
            <div style={{ display: 'flex', gap: 28, justifyContent: 'center', marginTop: 36, flexWrap: 'wrap' }}>
              {[
                [<Award size={13} />, 'Rated 4.9/5 by customers'],
                [<TrendingUp size={13} />, '35% avg delivery improvement'],
                [<Shield size={13} />, 'Enterprise-grade security'],
              ].map(([icon, text], i) => (
                <span key={i} className="mkt-trust-badge" style={{ fontSize: 12.5 }}>{icon as ReactNode}{text as string}</span>
              ))}
            </div>
          </div>
        </section>

        {/* ══════════════════ FOOTER ══════════════════ */}
        <footer style={{ borderTop: '1px solid rgba(255,255,255,0.05)', padding: '48px 0 32px' }}>
          <div className="mkt-container">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 40, flexWrap: 'wrap', marginBottom: 40 }}>
              {/* Brand */}
              <div style={{ maxWidth: 260 }}>
                <Link to="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 10, textDecoration: 'none', marginBottom: 14 }}>
                  <div style={{ width: 34, height: 34, borderRadius: 10, background: 'linear-gradient(135deg,#1c1710,#0d0b08)', border: '1.5px solid rgba(226,171,65,0.35)', display: 'grid', placeItems: 'center' }}>
                    <svg width="18" height="18" viewBox="0 0 48 48" fill="none">
                      <defs><linearGradient id="fgold" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#f9e6a2"/><stop offset="100%" stopColor="#e2ab41"/></linearGradient></defs>
                      <rect x="7" y="12" width="34" height="6.5" rx="3.25" fill="url(#fgold)"/>
                      <rect x="19.5" y="18.5" width="9" height="17.5" rx="2.5" fill="url(#fgold)"/>
                    </svg>
                  </div>
                  <div>
                    <div style={{ fontWeight: 950, fontSize: 14, letterSpacing: '0.12em', textTransform: 'uppercase', background: 'linear-gradient(135deg,#f9e6a2,#e2ab41)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>TASKEE</div>
                    <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.05em', textTransform: 'uppercase', WebkitTextFillColor: 'rgba(255,255,255,0.3)' }}>AI Task Intelligence</div>
                  </div>
                </Link>
                <p style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.28)', lineHeight: 1.7 }}>Per-seat subscription. Admin/HR-controlled onboarding. AI-assisted approvals.</p>
              </div>
              {/* Links */}
              <div style={{ display: 'flex', gap: 48, flexWrap: 'wrap' }}>
                {[
                  { heading: 'Product', links: [{ label: 'Features', to: '/#solutions' }, { label: 'Pricing', to: '/pricing' }, { label: 'How it works', to: '/#workflow' }] },
                  { heading: 'Account', links: [{ label: 'Sign in', to: '/signin' }, { label: 'Sign up free', to: '/signup' }, { label: 'Support', to: 'mailto:support@taskee.app' }] },
                ].map(col => (
                  <div key={col.heading}>
                    <div style={{ fontSize: 10.5, fontWeight: 900, color: 'rgba(255,255,255,0.22)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 14 }}>{col.heading}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {col.links.map(l => (
                        l.to.startsWith('mailto')
                          ? <a key={l.label} href={l.to} style={{ fontSize: 13, color: 'rgba(255,255,255,0.38)', textDecoration: 'none', fontWeight: 600, transition: 'color 0.12s' }} onMouseEnter={e => (e.currentTarget.style.color = '#fff')} onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.38)')}>{l.label}</a>
                          : <Link key={l.label} to={l.to} style={{ fontSize: 13, color: 'rgba(255,255,255,0.38)', textDecoration: 'none', fontWeight: 600 }}>{l.label}</Link>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.22)' }}>© {new Date().getFullYear()} TASKEE. All rights reserved.</div>
              <div style={{ display: 'flex', gap: 16 }}>
                {['Privacy', 'Terms', 'Security'].map(l => (
                  <span key={l} style={{ fontSize: 12, color: 'rgba(255,255,255,0.22)', cursor: 'default', fontWeight: 600 }}>{l}</span>
                ))}
              </div>
            </div>
          </div>
        </footer>
      </div>
    </>
  )
}
