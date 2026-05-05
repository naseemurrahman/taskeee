import { Link } from 'react-router-dom'

type Plan = {
  name: string
  price: string
  tagline: string
  bullets: string[]
  primary?: boolean
  note?: string
}

function PlanCard(props: Plan) {
  return (
    <div className={`mktPlan ${props.primary ? 'mktPlanPrimary' : ''}`}>
      <div className="mktPlanName">{props.name}</div>
      <div className="mktPlanPrice">{props.price}</div>
      <div className="mktPlanTag">{props.tagline}</div>
      <div className="mktPlanBullets">
        {props.bullets.map((b) => <div key={b} className="mktPlanBullet">✓ {b}</div>)}
      </div>
      <div style={{ marginTop: 18, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Link className={`mktBtn ${props.primary ? 'mktBtnPrimary' : 'mktBtnGhost'}`} to="/signup">Start trial</Link>
        <Link className="mktBtn mktBtnGhost" to="/signin">Sign in</Link>
      </div>
      <div className="mktPlanFine">{props.note || 'Billed per active employee seat. Admin, HR, and manager controls included.'}</div>
    </div>
  )
}

const plans: Plan[] = [
  {
    name: 'Basic',
    price: '$4 / seat / month',
    tagline: 'For teams that need clean task ownership and HR workflows.',
    bullets: [
      'Tasks, projects, board, calendar, and comments',
      'Employees, departments, time off, and profiles',
      'Email notifications and in-app reminders',
      'Reports, exports, and activity logs',
      'Role-based access for admin, HR, manager, and employee',
    ],
    primary: true,
  },
  {
    name: 'Pro',
    price: '$10 / seat / month',
    tagline: 'For advanced operations that need AI, audit, and delivery controls.',
    bullets: [
      'Everything in Basic',
      'AI-assisted task signals and approval guidance',
      'WhatsApp + email notification diagnostics',
      'Audit trail, readiness checks, and backup validation',
      'Advanced analytics, insights, and priority support',
    ],
  },
]

export function PricingPage() {
  return (
    <div className="mktPage">
      <section className="mktSection" style={{ paddingTop: 44 }}>
        <div className="mktSectionHead">
          <div className="mktKicker">Pricing</div>
          <h1 className="mktH1" style={{ fontSize: 44, marginTop: 10 }}>Two clear plans. No duplicate pricing.</h1>
          <p className="mktLead">Choose Basic for structured team operations, or Pro when you need AI insights, WhatsApp delivery diagnostics, audit controls, and readiness tooling.</p>
        </div>

        <div className="mktGrid3 marketingTwoPlanGrid" style={{ marginTop: 24 }}>
          {plans.map((plan) => <PlanCard key={plan.name} {...plan} />)}
        </div>

        <div className="mktFeatureWide" style={{ marginTop: 22 }}>
          <div className="mktFeatureTitle">Billing model</div>
          <div className="mktFeatureText">
            Your organization subscribes based on active employee seats. Admin/HR controls onboarding, managers can assign and monitor work, and employees only see their own authorized scope.
          </div>
          <div className="mktBullets" style={{ marginTop: 10 }}>
            <div>• Basic: task management, HR workflow, reports, exports, and role access</div>
            <div>• Pro: Basic plus AI signals, WhatsApp diagnostics, audit/readiness tooling, and advanced insights</div>
            <div>• Stripe billing can be enabled when production pricing is finalized</div>
          </div>
        </div>
      </section>
    </div>
  )
}
