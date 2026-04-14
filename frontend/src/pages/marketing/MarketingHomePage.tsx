import { Link } from 'react-router-dom'

export function MarketingHomePage() {
  return (
    <div className="mktPage">
      <section className="mktHero">
        <div className="mktHeroGrid">
          <div className="animate-fadeInUp">
            <div className="mktKicker animate-fadeIn stagger-1">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 6, verticalAlign: 'middle' }}>
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
              </svg>
              HR automation · Tasks · Approvals · Billing
            </div>
            <h1 className="mktH1 animate-fadeInUp stagger-2">
              A professional org platform for{' '}
              <span style={{
                background: 'linear-gradient(135deg, var(--primary), #d4a84b)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text'
              }}>
                HR + managers
              </span>
              .
            </h1>
            <p className="mktLead animate-fadeInUp stagger-3">
              Run structured workflows for onboarding, approvals, tasks, and performance — with role-based hierarchy and per-employee subscriptions.
            </p>
            <div className="mktHeroCtas animate-fadeInUp stagger-4">
              <Link className="mktBtn mktBtnPrimary" to="/signup">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: 8 }}>
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
                Start free
              </Link>
              <Link className="mktBtn mktBtnGhost" to="/pricing">See pricing</Link>
            </div>
            <div className="mktMiniNote animate-fadeIn stagger-5">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 6, verticalAlign: 'middle' }}>
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
              Admin/HR creates org → adds managers → managers add employees → assign tasks → employee submits → AI approval.
            </div>
          </div>

          <div className="mktHeroCard animate-fadeInUp stagger-3" style={{ position: 'relative', overflow: 'hidden' }}>
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'radial-gradient(ellipse at top right, rgba(244, 202, 87, 0.08), transparent 60%)',
              pointerEvents: 'none'
            }} />
            <div className="mktHeroCardTop">
              <div className="mktChip">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: 4 }}>
                  <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>
                </svg>
                Dashboard
              </div>
              <div className="mktChip mktChipSoft">AI approvals</div>
              <div className="mktChip mktChipSoft">Seat billing</div>
            </div>
            <div className="mktHeroMock">
              <div className="mktMockRow">
                <div className="mktMockKpi">
                  <div className="mktMockKpiVal" style={{ color: 'var(--primary)' }}>12</div>
                  <div className="mktMockKpiLab">Employees</div>
                </div>
                <div className="mktMockKpi">
                  <div className="mktMockKpiVal" style={{ color: '#6d5efc' }}>38</div>
                  <div className="mktMockKpiLab">Open tasks</div>
                </div>
                <div className="mktMockKpi">
                  <div className="mktMockKpiVal" style={{ color: '#10b981' }}>4</div>
                  <div className="mktMockKpiLab">Approvals</div>
                </div>
              </div>
              <div className="mktMockPanel">
                <div className="mktMockPanelTitle">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 6, verticalAlign: 'middle' }}>
                    <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
                  </svg>
                  Things to do
                </div>
                <div className="mktMockItem">✓ Approve time off requests</div>
                <div className="mktMockItem">✓ Review submitted task evidence</div>
                <div className="mktMockItem">→ Invite new manager</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mktSection">
        <div className="mktSectionHead">
          <div className="mktKicker animate-fadeInUp">Let your system do the work</div>
          <h2 className="mktH2 animate-fadeInUp stagger-1">Smart HR automation</h2>
          <p className="mktText animate-fadeInUp stagger-2">Set workflows for onboarding and requests, then let them run hands-free.</p>
        </div>
        <div className="mktGrid2">
          <div className="mktFeatureWide animate-fadeInUp stagger-3">
            <div className="mktBullets">
              <div>✓ Automate onboarding and build custom workflows with clicks or AI</div>
              <div>✓ Route approvals across Finance, HR, and leadership with flexible flows</div>
              <div>✓ Build custom workflows and trigger them with any data or actions</div>
              <div>✓ Slash manual work and keep everyone on track with nudges and reminders</div>
            </div>
          </div>
          <div className="mktFeatureWide animate-fadeInUp stagger-4">
            <div className="mktFeatureTitle">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 8, color: 'var(--primary)' }}>
                <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
              </svg>
              Workflow approvals with AI
            </div>
            <div className="mktFeatureText">
              Employees submit work. AI can approve, reject, or route to a manager for manual review — and everything is logged in the timeline.
            </div>
            <div className="mktBullets">
              <div>→ Request AI approval from employee tasks</div>
              <div>→ Consistent decisions + audit trail</div>
              <div>→ Manager override when needed</div>
            </div>
          </div>
        </div>
      </section>

      <section id="products" className="mktSection">
        <div className="mktSectionHead">
          <div className="mktKicker animate-fadeInUp">Products</div>
          <h2 className="mktH2 animate-fadeInUp stagger-1">Everything your org needs, connected.</h2>
          <p className="mktText animate-fadeInUp stagger-2">A unified platform that combines HR, task operations, billing, and AI-assisted approvals.</p>
        </div>
        <div className="mktGrid3">
          <div className="mktFeature animate-fadeInUp stagger-3">
            <div className="mktFeatureIcon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
            </div>
            <div className="mktFeatureTitle">HRIS</div>
            <div className="mktFeatureText">Employees directory, profiles, and time-off workflows.</div>
          </div>
          <div className="mktFeature animate-fadeInUp stagger-4">
            <div className="mktFeatureIcon" style={{ background: 'rgba(109, 94, 252, 0.14)', borderColor: 'rgba(109, 94, 252, 0.22)', color: 'rgba(109, 94, 252, 0.95)' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
              </svg>
            </div>
            <div className="mktFeatureTitle">Workflows</div>
            <div className="mktFeatureText">Task assignment, approvals, audit logs, and automation primitives.</div>
          </div>
          <div className="mktFeature animate-fadeInUp stagger-5">
            <div className="mktFeatureIcon" style={{ background: 'rgba(16, 185, 129, 0.14)', borderColor: 'rgba(16, 185, 129, 0.22)', color: 'rgba(16, 185, 129, 0.95)' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
              </svg>
            </div>
            <div className="mktFeatureTitle">Billing</div>
            <div className="mktFeatureText">Stripe subscriptions, seat limits, invoices, and customer portal.</div>
          </div>
        </div>
      </section>

      <section id="solutions" className="mktSection">
        <div className="mktSectionHead">
          <div className="mktKicker animate-fadeInUp">Solutions</div>
          <h2 className="mktH2 animate-fadeInUp stagger-1">Built for hierarchy and accountability.</h2>
          <p className="mktText animate-fadeInUp stagger-2">Admin/HR can access everything. Managers see team scope. Employees focus on assigned work.</p>
        </div>
        <div className="mktGrid2">
          <div className="mktFeatureWide animate-fadeInUp stagger-3">
            <div className="mktFeatureTitle">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 8, color: 'var(--primary)' }}>
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              </svg>
              Role-based access
            </div>
            <div className="mktFeatureText">Admin & HR: org-wide. Manager: team scope. Employee: self + assigned tasks.</div>
            <div className="mktBullets">
              <div>✓ Assign tasks and set deadlines</div>
              <div>✓ Track performance & workload</div>
              <div>✓ Audit logs for sensitive actions</div>
            </div>
          </div>
          <div className="mktFeatureWide animate-fadeInUp stagger-4">
            <div className="mktFeatureTitle">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 8, color: '#6d5efc' }}>
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
              </svg>
              AI-assisted approvals
            </div>
            <div className="mktFeatureText">Employees submit work; AI can approve/reject or route to managers for manual review.</div>
            <div className="mktBullets">
              <div>✓ Reduce manual review time</div>
              <div>✓ Consistent decisions with thresholds</div>
              <div>✓ Full timeline of decisions</div>
            </div>
          </div>
        </div>
      </section>

      <section id="resources" className="mktSection">
        <div className="mktSectionHead">
          <div className="mktKicker animate-fadeInUp">Resources</div>
          <h2 className="mktH2 animate-fadeInUp stagger-1">Reports and insights you can act on.</h2>
          <p className="mktText animate-fadeInUp stagger-2">Real-time dashboards, exports, AI summaries (with fallback), and search.</p>
        </div>
        <div className="mktGrid3">
          <div className="mktFeature animate-fadeInUp stagger-3">
            <div className="mktFeatureIcon" style={{ background: 'rgba(56, 189, 248, 0.14)', borderColor: 'rgba(56, 189, 248, 0.22)', color: 'rgba(56, 189, 248, 0.95)' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
              </svg>
            </div>
            <div className="mktFeatureTitle">Dashboards</div>
            <div className="mktFeatureText">Charts for progress, assignments, deadlines, and performance.</div>
          </div>
          <div className="mktFeature animate-fadeInUp stagger-4">
            <div className="mktFeatureIcon" style={{ background: 'rgba(249, 115, 22, 0.14)', borderColor: 'rgba(249, 115, 22, 0.22)', color: 'rgba(249, 115, 22, 0.95)' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
              </svg>
            </div>
            <div className="mktFeatureTitle">Reports</div>
            <div className="mktFeatureText">Generate, view, and export reports (CSV/JSON).</div>
          </div>
          <div className="mktFeature animate-fadeInUp stagger-5">
            <div className="mktFeatureIcon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
            </div>
            <div className="mktFeatureTitle">Search</div>
            <div className="mktFeatureText">Global search across tasks, people, and reports.</div>
          </div>
        </div>
      </section>

      <section className="mktCta">
        <div className="mktCtaInner animate-fadeInUp">
          <div>
            <div className="mktCtaTitle">Ready to set up your organization?</div>
            <div className="mktCtaText">Start with Admin/HR access and invite your managers in minutes.</div>
          </div>
          <div className="mktHeroCtas">
            <Link className="mktBtn mktBtnPrimary" to="/signup">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: 8 }}>
                <path d="M5 12h14M12 5l7 7-7 7"/>
              </svg>
              Create account
            </Link>
            <Link className="mktBtn mktBtnGhost" to="/signin">Sign in</Link>
          </div>
        </div>
      </section>
    </div>
  )
}
