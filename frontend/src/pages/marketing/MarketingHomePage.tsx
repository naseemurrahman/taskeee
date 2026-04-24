import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'

// ── Animated counter ──────────────────────────────────────────────
function CountUp({ to, suffix = '', prefix = '' }: { to: number; suffix?: string; prefix?: string }) {
  const [val, setVal] = useState(0)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return
      obs.disconnect()
      let start = 0; const step = to / 50
      const t = setInterval(() => { start = Math.min(start + step, to); setVal(Math.floor(start)); if (start >= to) clearInterval(t) }, 20)
    }, { threshold: 0.5 })
    if (ref.current) obs.observe(ref.current)
    return () => obs.disconnect()
  }, [to])
  return <span ref={ref}>{prefix}{val.toLocaleString()}{suffix}</span>
}

// ── Typewriter ────────────────────────────────────────────────────
const WORDS = ['Performance', 'Accountability', 'Velocity', 'Excellence', 'Clarity']
function Typewriter() {
  const [wi, setWi] = useState(0); const [ci, setCi] = useState(0); const [del, setDel] = useState(false)
  useEffect(() => {
    const word = WORDS[wi]
    const t = setTimeout(() => {
      if (!del) {
        if (ci < word.length) setCi(c => c + 1)
        else { setTimeout(() => setDel(true), 1400) }
      } else {
        if (ci > 0) setCi(c => c - 1)
        else { setDel(false); setWi(w => (w + 1) % WORDS.length) }
      }
    }, del ? 40 : 80)
    return () => clearTimeout(t)
  }, [wi, ci, del])
  return (
    <span style={{ color: 'var(--brand)', position: 'relative' }}>
      {WORDS[wi].slice(0, ci)}
      <span style={{ borderRight: '2px solid var(--brand)', marginLeft: 1, animation: 'blink 1s step-end infinite' }} />
    </span>
  )
}

// ── Feature card ──────────────────────────────────────────────────
function Feature({ icon, title, desc, color }: { icon: string; title: string; desc: string; color: string }) {
  return (
    <div style={{ padding: '28px 24px', borderRadius: 20, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', transition: 'all 0.2s', cursor: 'default' }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = color + '08'; (e.currentTarget as HTMLDivElement).style.borderColor = color + '40'; (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-3px)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.03)'; (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(255,255,255,0.08)'; (e.currentTarget as HTMLDivElement).style.transform = '' }}>
      <div style={{ width: 48, height: 48, borderRadius: 14, background: color + '18', border: `1.5px solid ${color}40`, display: 'grid', placeItems: 'center', fontSize: 22, marginBottom: 16 }}>{icon}</div>
      <div style={{ fontWeight: 900, fontSize: 17, color: '#fff', marginBottom: 8, letterSpacing: '-0.3px' }}>{title}</div>
      <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.55)', lineHeight: 1.7 }}>{desc}</div>
    </div>
  )
}

// ── Pricing card ──────────────────────────────────────────────────
function PricingCard({ plan, price, period, features, cta, highlight, color }: {
  plan: string; price: string; period?: string; features: string[]; cta: string; highlight?: boolean; color: string
}) {
  return (
    <div style={{ padding: 32, borderRadius: 24, background: highlight ? `linear-gradient(135deg, ${color}18 0%, rgba(255,255,255,0.04) 100%)` : 'rgba(255,255,255,0.03)', border: `1.5px solid ${highlight ? color + '60' : 'rgba(255,255,255,0.08)'}`, position: 'relative', transition: 'all 0.2s' }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-4px)'; (e.currentTarget as HTMLDivElement).style.boxShadow = `0 20px 60px ${color}20` }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = ''; (e.currentTarget as HTMLDivElement).style.boxShadow = '' }}>
      {highlight && <div style={{ position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)', background: color, color: '#000', fontSize: 11, fontWeight: 900, padding: '3px 14px', borderRadius: 999, letterSpacing: '0.08em' }}>MOST POPULAR</div>}
      <div style={{ fontSize: 13, fontWeight: 800, color: color, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>{plan}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 4 }}>
        <span style={{ fontSize: 40, fontWeight: 950, color: '#fff', letterSpacing: '-2px' }}>{price}</span>
        {period && <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)' }}>{period}</span>}
      </div>
      <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '20px 0' }} />
      <div style={{ display: 'grid', gap: 10, marginBottom: 28 }}>
        {features.map(f => (
          <div key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 14, color: 'rgba(255,255,255,0.75)' }}>
            <span style={{ color, fontWeight: 900, flexShrink: 0 }}>✓</span> {f}
          </div>
        ))}
      </div>
      <Link to="/signup" style={{ display: 'block', textAlign: 'center', padding: '13px 24px', borderRadius: 999, background: highlight ? color : 'transparent', color: highlight ? '#000' : color, border: `1.5px solid ${color}`, fontWeight: 800, fontSize: 14, textDecoration: 'none', transition: 'all 0.15s' }}
        onMouseEnter={e => { if (!highlight) { (e.currentTarget as HTMLAnchorElement).style.background = color; (e.currentTarget as HTMLAnchorElement).style.color = '#000' } }}
        onMouseLeave={e => { if (!highlight) { (e.currentTarget as HTMLAnchorElement).style.background = 'transparent'; (e.currentTarget as HTMLAnchorElement).style.color = color } }}>
        {cta}
      </Link>
    </div>
  )
}

// ── Testimonial ───────────────────────────────────────────────────
function Testimonial({ quote, name, role, company, avatar }: { quote: string; name: string; role: string; company: string; avatar: string }) {
  return (
    <div style={{ padding: '28px 24px', borderRadius: 20, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
      <div style={{ fontSize: 32, marginBottom: 12, lineHeight: 1 }}>"</div>
      <div style={{ fontSize: 15, color: 'rgba(255,255,255,0.75)', lineHeight: 1.7, marginBottom: 20, fontStyle: 'italic' }}>{quote}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'linear-gradient(135deg, #e2ab41, #8B5CF6)', display: 'grid', placeItems: 'center', fontSize: 16, fontWeight: 900, flexShrink: 0 }}>{avatar}</div>
        <div>
          <div style={{ fontWeight: 800, fontSize: 14, color: '#fff' }}>{name}</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>{role} · {company}</div>
        </div>
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────
export function MarketingHomePage() {
  return (
    <div style={{ background: '#0a0a10', minHeight: '100vh', color: '#fff', fontFamily: 'system-ui, -apple-system, sans-serif', overflowX: 'hidden' }}>
      <style>{`
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-12px)} }
        @keyframes gradientShift { 0%{background-position:0% 50%} 50%{background-position:100% 50%} 100%{background-position:0% 50%} }
        .heroGlow { position:absolute; border-radius:50%; filter:blur(80px); pointer-events:none; }
        .statCard:hover { transform:translateY(-2px); }
        @media(max-width:768px){
          .heroTitle{font-size:clamp(32px,8vw,56px)!important}
          .heroGrid{grid-template-columns:1fr!important;gap:20px!important}
          .featGrid{grid-template-columns:1fr!important}
          .priceGrid{grid-template-columns:1fr!important}
          .statsRow{grid-template-columns:1fr 1fr!important}
          .testGrid{grid-template-columns:1fr!important}
          .navLinks{display:none!important}
        }
      `}</style>

      {/* ── Hero ── */}
      <section style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '100px max(24px, calc(50vw - 600px)) 80px', position: 'relative', overflow: 'hidden' }}>
        {/* Glow orbs */}
        <div className="heroGlow" style={{ width: 600, height: 600, background: '#e2ab4130', top: -200, left: '60%' }} />
        <div className="heroGlow" style={{ width: 400, height: 400, background: '#8B5CF630', bottom: -100, left: '20%' }} />

        {/* Grid texture */}
        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(255,255,255,0.02) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.02) 1px,transparent 1px)', backgroundSize: '48px 48px', pointerEvents: 'none' }} />

        <div className="heroGrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 60, alignItems: 'center', width: '100%', maxWidth: 1200, position: 'relative' }}>
          {/* Left */}
          <div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 14px', borderRadius: 999, background: 'rgba(226,171,65,0.12)', border: '1px solid rgba(226,171,65,0.3)', fontSize: 12, fontWeight: 800, color: '#e2ab41', marginBottom: 24, letterSpacing: '0.05em' }}>
              🚀 AI-POWERED TASK MANAGEMENT
            </div>
            <h1 className="heroTitle" style={{ fontSize: 'clamp(40px,5vw,68px)', fontWeight: 950, letterSpacing: '-2px', lineHeight: 1.05, margin: '0 0 16px' }}>
              Manage Teams.<br />
              Drive <Typewriter />
            </h1>
            <p style={{ fontSize: 18, color: 'rgba(255,255,255,0.6)', lineHeight: 1.7, margin: '0 0 36px', maxWidth: 480 }}>
              The only task management platform built for performance — with AI analysis, role-based hierarchy, and real-time insights that make every team member accountable.
            </p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 48 }}>
              <Link to="/signup" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '14px 28px', borderRadius: 999, background: '#e2ab41', color: '#000', fontWeight: 900, fontSize: 16, textDecoration: 'none', transition: 'all 0.15s' }}
                onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.background = '#f0bc52'; (e.currentTarget as HTMLAnchorElement).style.transform = 'scale(1.03)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.background = '#e2ab41'; (e.currentTarget as HTMLAnchorElement).style.transform = '' }}>
                Start for free
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
              </Link>
              <Link to="/app/dashboard" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '14px 28px', borderRadius: 999, border: '1.5px solid rgba(255,255,255,0.2)', color: 'rgba(255,255,255,0.85)', fontWeight: 700, fontSize: 16, textDecoration: 'none', transition: 'all 0.15s' }}
                onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.borderColor = 'rgba(255,255,255,0.5)'; (e.currentTarget as HTMLAnchorElement).style.color = '#fff' }}
                onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.borderColor = 'rgba(255,255,255,0.2)'; (e.currentTarget as HTMLAnchorElement).style.color = 'rgba(255,255,255,0.85)' }}>
                View live demo
              </Link>
            </div>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
              {[['✓ Free 14-day trial', ''], ['✓ No credit card', ''], ['✓ SOC 2 ready', '']].map(([t]) => (
                <span key={t} style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', fontWeight: 600 }}>{t}</span>
              ))}
            </div>
          </div>

          {/* Right — dashboard preview */}
          <div style={{ position: 'relative', animation: 'float 6s ease-in-out infinite' }}>
            <div style={{ borderRadius: 20, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)', boxShadow: '0 40px 80px rgba(0,0,0,0.6)', backdropFilter: 'blur(12px)' }}>
              {/* Mock topbar */}
              <div style={{ background: 'rgba(255,255,255,0.06)', padding: '12px 16px', display: 'flex', gap: 6, alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#ff5f57' }} />
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#febc2e' }} />
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#28c840' }} />
                <div style={{ flex: 1, height: 22, borderRadius: 6, background: 'rgba(255,255,255,0.06)', margin: '0 12px' }} />
              </div>
              {/* Mock KPIs */}
              <div style={{ padding: '16px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                {[['Total Tasks', '128', '#e2ab41'], ['In Progress', '34', '#8B5CF6'], ['Completed', '89', '#22c55e'], ['Overdue', '5', '#ef4444']].map(([l, v, c]) => (
                  <div key={l} style={{ padding: '10px 12px', borderRadius: 12, background: (c as string) + '10', border: `1px solid ${c}28` }}>
                    <div style={{ fontSize: 18, fontWeight: 900, color: c as string }}>{v}</div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>{l}</div>
                  </div>
                ))}
              </div>
              {/* Mock chart bars */}
              <div style={{ padding: '0 16px 16px', display: 'flex', gap: 6, alignItems: 'flex-end', height: 80 }}>
                {[40, 65, 55, 80, 70, 90, 75, 85, 60, 95, 78, 88, 72, 92].map((h, i) => (
                  <div key={i} style={{ flex: 1, height: `${h}%`, borderRadius: 4, background: i % 3 === 0 ? '#e2ab4160' : i % 3 === 1 ? '#22c55e50' : '#8B5CF640', transition: 'all 0.3s' }} />
                ))}
              </div>
              {/* Mock task rows */}
              <div style={{ padding: '0 16px 16px', display: 'grid', gap: 6 }}>
                {[['Prepare Q2 Report', 'In Progress', '#8B5CF6'], ['Review design system', 'Completed', '#22c55e'], ['Deploy backend API', 'Overdue', '#ef4444']].map(([t, s, c]) => (
                  <div key={t as string} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: c as string, flexShrink: 0 }} />
                    <span style={{ flex: 1, fontSize: 11, color: 'rgba(255,255,255,0.7)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t as string}</span>
                    <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 999, background: (c as string) + '18', color: c as string, fontWeight: 800 }}>{s as string}</span>
                  </div>
                ))}
              </div>
            </div>
            {/* Floating badge */}
            <div style={{ position: 'absolute', top: -20, right: -20, background: '#22c55e', borderRadius: 14, padding: '10px 16px', fontSize: 12, fontWeight: 900, color: '#fff', boxShadow: '0 8px 24px rgba(34,197,94,0.4)', animation: 'float 4s ease-in-out infinite' }}>
              ✓ 89% completion rate
            </div>
            <div style={{ position: 'absolute', bottom: -16, left: -16, background: '#8B5CF6', borderRadius: 14, padding: '10px 16px', fontSize: 12, fontWeight: 900, color: '#fff', boxShadow: '0 8px 24px rgba(139,92,246,0.4)', animation: 'float 5s ease-in-out infinite 1s' }}>
              🤖 AI analysis ready
            </div>
          </div>
        </div>
      </section>

      {/* ── Stats ── */}
      <section style={{ padding: '60px max(24px, calc(50vw - 600px))', borderTop: '1px solid rgba(255,255,255,0.06)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="statsRow" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 32, textAlign: 'center' }}>
          {[
            { val: 10000, suffix: '+', label: 'Tasks Completed Daily', color: '#e2ab41' },
            { val: 98, suffix: '%', label: 'Uptime SLA Guaranteed', color: '#22c55e' },
            { val: 500, suffix: '+', label: 'Organizations Trust Us', color: '#8B5CF6' },
            { val: 40, suffix: '%', label: 'Avg. Productivity Boost', color: '#38bdf8' },
          ].map(({ val, suffix, label, color }) => (
            <div key={label} className="statCard" style={{ transition: 'all 0.2s' }}>
              <div style={{ fontSize: 48, fontWeight: 950, letterSpacing: '-2px', color, lineHeight: 1 }}>
                <CountUp to={val} suffix={suffix} />
              </div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', marginTop: 8, fontWeight: 600 }}>{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" style={{ padding: '100px max(24px, calc(50vw - 600px))' }}>
        <div style={{ textAlign: 'center', marginBottom: 60 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 14px', borderRadius: 999, background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.3)', fontSize: 12, fontWeight: 800, color: '#8B5CF6', marginBottom: 20, letterSpacing: '0.05em' }}>
            EVERYTHING YOU NEED
          </div>
          <h2 style={{ fontSize: 'clamp(28px,4vw,48px)', fontWeight: 950, letterSpacing: '-1.5px', color: '#fff', margin: '0 0 16px' }}>
            Built for how real teams work
          </h2>
          <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.5)', maxWidth: 560, margin: '0 auto' }}>
            From solo freelancers to enterprise organizations — TaskFlow Pro scales with your business and adapts to your workflow.
          </p>
        </div>
        <div className="featGrid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          <Feature icon="🤖" color="#e2ab41" title="AI Task Intelligence" desc="JecZone AI analyzes your team's performance in real time, suggests status changes, and identifies bottlenecks before they become crises." />
          <Feature icon="📊" color="#8B5CF6" title="Real-Time Analytics" desc="10+ live charts — task velocity, completion rates, project timelines, employee leaderboards — all refreshed every 60 seconds." />
          <Feature icon="🔐" color="#38bdf8" title="Role-Based Access" desc="Granular permissions for Admins, HR, Managers, Supervisors, and Employees. Everyone sees exactly what they need — nothing more." />
          <Feature icon="💬" color="#22c55e" title="Task Comments & Chat" desc="Every task has a threaded comment section. Assignees and managers discuss, mention teammates, and track decisions in context." />
          <Feature icon="🗂" color="#f97316" title="Kanban + List + Calendar" desc="Switch between Board, Table, and Calendar views. Drag tasks between status columns. Visualize deadlines on a monthly grid." />
          <Feature icon="📱" color="#ec4899" title="Works Everywhere" desc="Fully responsive on any device. Optimized for mobile, tablet, and desktop — dark and light themes included out of the box." />
          <Feature icon="📧" color="#14b8a6" title="WhatsApp & Email Alerts" desc="Instant notifications when tasks are assigned, deadlines approach, or approvals are needed — delivered right where your team communicates." />
          <Feature icon="🏢" color="#a78bfa" title="Multi-Org Ready" desc="Isolated data per organization. Perfect for agencies managing multiple clients, or enterprises with regional divisions." />
          <Feature icon="📈" color="#fbbf24" title="Performance Scores" desc="Each employee gets a composite performance score based on completion rate, on-time delivery, and active workload balance." />
        </div>
      </section>

      {/* ── Pricing ── */}
      <section id="pricing" style={{ padding: '100px max(24px, calc(50vw - 600px))', background: 'rgba(255,255,255,0.02)' }}>
        <div style={{ textAlign: 'center', marginBottom: 60 }}>
          <h2 style={{ fontSize: 'clamp(28px,4vw,48px)', fontWeight: 950, letterSpacing: '-1.5px', color: '#fff', margin: '0 0 16px' }}>Simple, transparent pricing</h2>
          <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.5)' }}>Start free. Scale when you need it. Cancel anytime.</p>
        </div>
        <div className="priceGrid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, maxWidth: 960, margin: '0 auto' }}>
          <PricingCard plan="Starter" price="Free" features={['Up to 5 team members', '3 active projects', 'Basic task management', 'Email notifications', '7-day data retention']} cta="Start free" color="#38bdf8" />
          <PricingCard plan="Professional" price="$12" period="/seat/mo" highlight features={['Unlimited team members', 'Unlimited projects', 'AI task analysis', 'WhatsApp + Email alerts', 'Advanced analytics', 'Role-based access', 'Priority support']} cta="Start 14-day trial" color="#e2ab41" />
          <PricingCard plan="Enterprise" price="Custom" features={['Everything in Pro', 'SSO / SAML', 'Dedicated support', 'SLA guarantee', 'Custom integrations', 'Audit logs & compliance', 'On-premise option']} cta="Contact sales" color="#8B5CF6" />
        </div>
      </section>

      {/* ── Testimonials ── */}
      <section id="testimonials" style={{ padding: '100px max(24px, calc(50vw - 600px))' }}>
        <div style={{ textAlign: 'center', marginBottom: 60 }}>
          <h2 style={{ fontSize: 'clamp(28px,4vw,48px)', fontWeight: 950, letterSpacing: '-1.5px', color: '#fff', margin: '0 0 16px' }}>Loved by teams worldwide</h2>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 4 }}>{'★★★★★'.split('').map((s, i) => <span key={i} style={{ color: '#e2ab41', fontSize: 20 }}>{s}</span>)}</div>
        </div>
        <div className="testGrid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          <Testimonial quote="TaskFlow Pro cut our project delivery time by 35%. The AI insights flag at-risk tasks before they become real problems." name="Sarah Al-Rashid" role="VP Engineering" company="Horizon Tech" avatar="S" />
          <Testimonial quote="Finally a task tool that understands org hierarchy. Our managers see their team, employees see their work — clean separation." name="Mohammed Khalid" role="Operations Director" company="Gulf Ventures" avatar="M" />
          <Testimonial quote="The WhatsApp notifications alone saved us 2 hours of follow-up calls per day. Our team actually responds now." name="Aisha Bakr" role="HR Manager" company="Nafis Group" avatar="A" />
        </div>
      </section>

      {/* ── CTA ── */}
      <section style={{ padding: '100px max(24px, calc(50vw - 600px))', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
        <div className="heroGlow" style={{ width: 500, height: 500, background: '#e2ab4120', top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }} />
        <div style={{ position: 'relative' }}>
          <h2 style={{ fontSize: 'clamp(32px,5vw,64px)', fontWeight: 950, letterSpacing: '-2px', color: '#fff', margin: '0 0 20px' }}>
            Ready to transform<br />your team's performance?
          </h2>
          <p style={{ fontSize: 18, color: 'rgba(255,255,255,0.5)', marginBottom: 40 }}>Join thousands of organizations managing smarter with AI.</p>
          <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link to="/signup" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '16px 36px', borderRadius: 999, background: '#e2ab41', color: '#000', fontWeight: 900, fontSize: 18, textDecoration: 'none', transition: 'all 0.15s', boxShadow: '0 8px 32px rgba(226,171,65,0.4)' }}
              onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.transform = 'scale(1.04)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.transform = '' }}>
              Get started — it's free
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer style={{ padding: '60px max(24px, calc(50vw - 600px)) 40px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 40, marginBottom: 48 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: '#e2ab41', display: 'grid', placeItems: 'center' }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2.5"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
              </div>
              <span style={{ fontWeight: 950, fontSize: 16, color: '#fff' }}>TaskFlow Pro</span>
            </div>
            <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)', lineHeight: 1.7, maxWidth: 260 }}>AI-powered task management for organizations that demand performance and accountability.</p>
          </div>
          {[['Product', ['Features', 'Pricing', 'Changelog', 'Roadmap']], ['Company', ['About', 'Blog', 'Careers', 'Press']], ['Legal', ['Privacy', 'Terms', 'Security', 'Cookies']]].map(([title, links]) => (
            <div key={title as string}>
              <div style={{ fontWeight: 800, fontSize: 13, color: '#fff', marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{title as string}</div>
              <div style={{ display: 'grid', gap: 10 }}>
                {(links as string[]).map(l => <a key={l} href="#" style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)', textDecoration: 'none', transition: 'color 0.15s' }} onMouseEnter={e => (e.currentTarget.style.color = '#fff')} onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.4)')}>{l}</a>)}
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, paddingTop: 24, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.3)' }}>© 2026 TaskFlow Pro. All rights reserved.</div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.3)' }}>Built with ❤️ for high-performance teams</div>
        </div>
      </footer>
    </div>
  )
}
