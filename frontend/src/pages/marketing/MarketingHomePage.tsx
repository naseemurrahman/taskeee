import { Link } from 'react-router-dom'
import { useState, useEffect, useRef } from 'react'

const TICKER_ITEMS = [
  'AI-assisted approvals',
  'Role-based hierarchy',
  'Per-seat billing',
  'HR automation',
  'Real-time analytics',
  'Audit trail',
]

function AnimatedTicker() {
  const [idx, setIdx] = useState(0)
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    const interval = setInterval(() => {
      setVisible(false)
      setTimeout(() => {
        setIdx((i) => (i + 1) % TICKER_ITEMS.length)
        setVisible(true)
      }, 350)
    }, 2600)
    return () => clearInterval(interval)
  }, [])
  return (
    <span
      className="heroTicker"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(8px)',
        transition: 'opacity 0.35s ease, transform 0.35s ease',
        display: 'inline-block',
      }}
    >
      {TICKER_ITEMS[idx]}
    </span>
  )
}

function CountUp({ target, suffix = '' }: { target: number; suffix?: string }) {
  const [val, setVal] = useState(0)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        observer.disconnect()
        let start = 0
        const step = target / 60
        const timer = setInterval(() => {
          start = Math.min(start + step, target)
          setVal(Math.floor(start))
          if (start >= target) clearInterval(timer)
        }, 16)
      },
      { threshold: 0.5 },
    )
    if (ref.current) observer.observe(ref.current)
    return () => observer.disconnect()
  }, [target])
  return <span ref={ref}>{val.toLocaleString()}{suffix}</span>
}

const FEATURES = [
  {
    icon: 'users',
    title: 'HRIS',
    text: 'Full employee directory with profiles, org chart, time-off workflows, and performance tracking.',
    color: '#f4ca57',
  },
  {
    icon: 'zap',
    title: 'AI Approvals',
    text: 'Employees submit work. AI reviews, approves or rejects with full audit trail and manager override.',
    color: '#6d5efc',
  },
  {
    icon: 'calendar',
    title: 'Task & Projects',
    text: 'Kanban boards, deadlines, dependencies, recurrence, and priority management across your org.',
    color: '#10b981',
  },
  {
    icon: 'bar',
    title: 'Analytics',
    text: 'Live dashboards for workload, completion rates, bottlenecks, and individual performance scores.',
    color: '#38bdf8',
  },
  {
    icon: 'shield',
    title: 'Role-Based Access',
    text: 'Admin → HR → Manager → Supervisor → Employee. Every level sees exactly what they need.',
    color: '#f97316',
  },
  {
    icon: 'dollar',
    title: 'Stripe Billing',
    text: 'Per-seat subscriptions with invoices, usage limits, and a self-serve customer portal.',
    color: '#a78bfa',
  },
]

const WORKFLOW_STEPS = [
  { n: '01', title: 'Admin creates org', desc: 'Set up your organization, configure settings, choose a subscription plan.' },
  { n: '02', title: 'Invite managers', desc: 'Add managers and HR. They get role-scoped access automatically.' },
  { n: '03', title: 'Add employees', desc: 'Managers add employees. Seat limits enforced per subscription tier.' },
  { n: '04', title: 'Assign & track work', desc: 'Assign tasks with deadlines, priorities, and dependencies.' },
  { n: '05', title: 'AI reviews submissions', desc: 'Employees submit work. AI approves, rejects, or escalates.' },
]

function FeatureIcon({ type, color }: { type: string; color: string }) {
  const s = { width: 22, height: 22, stroke: color, fill: 'none', strokeWidth: 1.8 } as React.SVGProps<SVGSVGElement>
  if (type === 'users') return <svg viewBox="0 0 24 24" {...s}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
  if (type === 'zap') return <svg viewBox="0 0 24 24" {...s}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
  if (type === 'calendar') return <svg viewBox="0 0 24 24" {...s}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
  if (type === 'bar') return <svg viewBox="0 0 24 24" {...s}><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
  if (type === 'shield') return <svg viewBox="0 0 24 24" {...s}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
  return <svg viewBox="0 0 24 24" {...s}><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
}

export function MarketingHomePage() {
  return (
    <div className="mktPage">

      {/* HERO */}
      <section className="heroSection">
        <div className="heroOrb heroOrb1" />
        <div className="heroOrb heroOrb2" />
        <div className="heroOrb heroOrb3" />

        <div className="heroContent">
          <div className="heroBadge animate-fadeIn">
            <span className="heroBadgeDot" />
            Real-time WebSocket notifications · AI approvals · Stripe billing
          </div>

          <h1 className="heroH1 animate-fadeInUp stagger-1">
            The org platform for<br />
            <span className="heroAccent">HR, tasks</span> &amp;{' '}
            <AnimatedTicker />
          </h1>

          <p className="heroLead animate-fadeInUp stagger-2">
            Run structured workflows for onboarding, approvals, and performance — with role-based hierarchy, per-employee subscriptions, and AI-assisted decisions.
          </p>

          <div className="heroCtas animate-fadeInUp stagger-3">
            <Link className="heroCtaBtn" to="/signup">
              Start free
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </Link>
            <Link className="mktBtn mktBtnGhost" to="/pricing">See pricing</Link>
          </div>

          <div className="heroStats animate-fadeInUp stagger-4">
            <div className="heroStatItem">
              <div className="heroStatVal"><CountUp target={5000} suffix="+" /></div>
              <div className="heroStatLab">Active employees</div>
            </div>
            <div className="heroStatDiv" />
            <div className="heroStatItem">
              <div className="heroStatVal"><CountUp target={12000} suffix="+" /></div>
              <div className="heroStatLab">Tasks completed</div>
            </div>
            <div className="heroStatDiv" />
            <div className="heroStatItem">
              <div className="heroStatVal"><CountUp target={98} suffix="%" /></div>
              <div className="heroStatLab">Approval accuracy</div>
            </div>
          </div>
        </div>

        {/* Dashboard mockup */}
        <div className="heroDashMock animate-fadeInUp stagger-3">
          <div className="heroDashBar">
            <span className="heroDashDot" style={{ background: '#ef4444' }} />
            <span className="heroDashDot" style={{ background: '#f59e0b' }} />
            <span className="heroDashDot" style={{ background: '#10b981' }} />
            <span className="heroDashTitle">TaskFlow Pro — Dashboard</span>
          </div>
          <div className="heroDashBody">
            <div className="heroDashKpis">
              {[
                { val: '38', label: 'Open tasks', color: '#f4ca57' },
                { val: '12', label: 'Team members', color: '#6d5efc' },
                { val: '94%', label: 'On-time rate', color: '#10b981' },
                { val: '4', label: 'Pending AI', color: '#38bdf8' },
              ].map((k) => (
                <div className="heroDashKpi" key={k.label}>
                  <div className="heroDashKpiVal" style={{ color: k.color }}>{k.val}</div>
                  <div className="heroDashKpiLab">{k.label}</div>
                </div>
              ))}
            </div>
            <div className="heroDashRow">
              <div className="heroDashPanel">
                <div className="heroDashPanelTitle">Recent Activity</div>
                {[
                  { text: 'Q2 Report submitted', tag: 'AI approved', tagColor: '#10b981' },
                  { text: 'Onboarding: Sara K.', tag: 'In progress', tagColor: '#f4ca57' },
                  { text: 'Time-off request', tag: 'Pending', tagColor: '#6d5efc' },
                ].map((item) => (
                  <div className="heroDashItem" key={item.text}>
                    <span style={{ fontSize: 12 }}>{item.text}</span>
                    <span className="heroDashTag" style={{ color: item.tagColor }}>{item.tag}</span>
                  </div>
                ))}
              </div>
              <div className="heroDashMini">
                <div className="heroDashPanelTitle">Task breakdown</div>
                {[
                  { label: 'Completed', pct: 62, color: '#10b981' },
                  { label: 'In progress', pct: 28, color: '#f4ca57' },
                  { label: 'Overdue', pct: 10, color: '#ef4444' },
                ].map((b) => (
                  <div key={b.label} style={{ marginTop: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 4 }}>
                      <span>{b.label}</span><span>{b.pct}%</span>
                    </div>
                    <div style={{ height: 5, background: 'rgba(255,255,255,0.08)', borderRadius: 3 }}>
                      <div style={{ height: '100%', width: `${b.pct}%`, background: b.color, borderRadius: 3 }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* TRUST BAR */}
      <div className="trustBar animate-fadeIn">
        <span className="trustLabel">Trusted by teams at</span>
        {['Acme Corp', 'Veritas', 'Novu Labs', 'Orion Health', 'Stratum'].map((n) => (
          <span className="trustLogo" key={n}>{n}</span>
        ))}
      </div>

      {/* FEATURES GRID */}
      <section className="mktSection">
        <div className="mktSectionHead">
          <div className="mktKicker animate-fadeInUp">Platform</div>
          <h2 className="mktH2 animate-fadeInUp stagger-1">Everything your org needs, connected.</h2>
          <p className="mktText animate-fadeInUp stagger-2">One platform for HR, operations, billing, and AI-powered automation.</p>
        </div>
        <div className="featGrid animate-fadeInUp stagger-3">
          {FEATURES.map((f) => (
            <div className="featCard" key={f.title}>
              <div className="featIcon" style={{ color: f.color, borderColor: `${f.color}22`, background: `${f.color}12` }}>
                <FeatureIcon type={f.icon} color={f.color} />
              </div>
              <div className="featTitle">{f.title}</div>
              <div className="featText">{f.text}</div>
            </div>
          ))}
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="mktSection">
        <div className="mktSectionHead">
          <div className="mktKicker animate-fadeInUp">Workflow</div>
          <h2 className="mktH2 animate-fadeInUp stagger-1">Up and running in minutes.</h2>
          <p className="mktText animate-fadeInUp stagger-2">A clear hierarchy from first login to first AI-approved task.</p>
        </div>
        <div className="workflowSteps animate-fadeInUp stagger-3">
          {WORKFLOW_STEPS.map((s, i) => (
            <div className="workflowStep" key={s.n}>
              <div className="workflowN">{s.n}</div>
              {i < WORKFLOW_STEPS.length - 1 && <div className="workflowLine" />}
              <div className="workflowContent">
                <div className="workflowTitle">{s.title}</div>
                <div className="workflowDesc">{s.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* AI BLOCK */}
      <section className="mktSection">
        <div className="aiBlock animate-fadeInUp">
          <div className="aiBlockLeft">
            <div className="mktKicker">AI-Powered</div>
            <h2 className="mktH2" style={{ margin: '10px 0 14px' }}>Let the machine handle approvals.</h2>
            <p className="mktText">Employees submit work with evidence. AI reviews against criteria, makes a decision, and logs every step — no bottlenecks.</p>
            <div className="aiBullets">
              {[
                { color: '#10b981', text: 'Consistent decisions with configurable thresholds' },
                { color: '#f4ca57', text: 'Full timeline: submitted → AI decision → optional override' },
                { color: '#6d5efc', text: 'Manager override always available' },
                { color: '#38bdf8', text: 'Graceful fallback to manual review when AI unavailable' },
              ].map((b) => (
                <div className="aiBullet" key={b.text}>
                  <span className="aiBulletDot" style={{ background: b.color }} />
                  {b.text}
                </div>
              ))}
            </div>
          </div>
          <div className="aiBlockRight">
            <div className="aiDecisionCard">
              <div className="aiDecisionTop">
                <div>
                  <div style={{ fontWeight: 800, fontSize: 13 }}>Task: Q2 Financial Report</div>
                  <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, marginTop: 3 }}>Submitted by Alex M. · 2 min ago</div>
                </div>
                <div style={{ padding: '4px 10px', borderRadius: 20, background: 'rgba(16,185,129,0.15)', color: '#10b981', fontSize: 11, fontWeight: 800, border: '1px solid rgba(16,185,129,0.25)' }}>
                  AI Approved
                </div>
              </div>
              <div style={{ marginTop: 14, padding: '10px 14px', background: 'rgba(255,255,255,0.04)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.07)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>Confidence score</span>
                  <span style={{ fontWeight: 900, color: '#10b981', fontSize: 20 }}>96%</span>
                </div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', lineHeight: 1.6 }}>
                  All required criteria met. Evidence: 3 attachments. Deadline: on time. Peer reviews: 2/2 positive.
                </div>
              </div>
              <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                <button style={{ flex: 1, padding: '8px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)', color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>View timeline</button>
                <button style={{ flex: 1, padding: '8px 12px', borderRadius: 8, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)', color: '#f87171', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Override</button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ROLE GRID */}
      <section id="solutions" className="mktSection">
        <div className="mktSectionHead">
          <div className="mktKicker animate-fadeInUp">Access control</div>
          <h2 className="mktH2 animate-fadeInUp stagger-1">Built for hierarchy and accountability.</h2>
          <p className="mktText animate-fadeInUp stagger-2">Every role sees exactly what it needs.</p>
        </div>
        <div className="roleGrid animate-fadeInUp stagger-3">
          {[
            { role: 'Admin / HR', color: '#f4ca57', desc: 'Full org access. Manage users, billing, integrations, audit logs, and global reports.', pills: ['All pages', 'Billing', 'Audit', 'HRIS'] },
            { role: 'Manager', color: '#6d5efc', desc: 'Team-scoped access. Assign tasks, review performance, manage CRM pipeline and projects.', pills: ['Team scope', 'CRM', 'Reports', 'Board'] },
            { role: 'Employee', color: '#10b981', desc: 'Personal task queue. Submit work, request time off, view own analytics.', pills: ['My tasks', 'Dashboard', 'Analytics'] },
          ].map((r) => (
            <div className="roleCard" key={r.role} style={{ borderColor: `${r.color}22` }}>
              <div className="roleTitle" style={{ color: r.color }}>{r.role}</div>
              <div className="roleDesc">{r.desc}</div>
              <div className="rolePills">
                {r.pills.map((p) => (
                  <span className="rolePill" key={p} style={{ color: r.color, borderColor: `${r.color}30`, background: `${r.color}0e` }}>{p}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="heroCta animate-fadeInUp">
        <div className="heroCtaGlow" />
        <div className="heroCtaInner">
          <div className="heroCtaTitle">Ready to set up your organization?</div>
          <div className="heroCtaText">Start with Admin/HR access — no credit card needed. Invite your managers and go live in minutes.</div>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 24, flexWrap: 'wrap' }}>
            <Link className="heroCtaBtn" to="/signup">
              Create account free
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </Link>
            <Link className="mktBtn mktBtnGhost" to="/pricing">See pricing</Link>
          </div>
        </div>
      </section>
    </div>
  )
}
