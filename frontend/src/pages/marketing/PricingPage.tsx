import { Link } from 'react-router-dom'

function PlanCard(props: { name: string; price: string; tagline: string; bullets: string[]; primary?: boolean }) {
  return (
    <div className={`mktPlan ${props.primary ? 'mktPlanPrimary' : ''}`}>
      <div className="mktPlanName">{props.name}</div>
      <div className="mktPlanPrice">{props.price}</div>
      <div className="mktPlanTag">{props.tagline}</div>
      <div className="mktPlanBullets">
        {props.bullets.map((b) => (
          <div key={b} className="mktPlanBullet">✓ {b}</div>
        ))}
      </div>
      <div style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Link className={`mktBtn ${props.primary ? 'mktBtnPrimary' : 'mktBtnGhost'}`} to="/signup">Get started</Link>
        <Link className="mktBtn mktBtnGhost" to="/signin">Sign in</Link>
      </div>
      <div className="mktPlanFine">Billed per organization, based on active employee seats.</div>
    </div>
  )
}

export function PricingPage() {
  return (
    <div className="mktPage">
      <section className="mktSection" style={{ paddingTop: 34 }}>
        <div className="mktSectionHead">
          <div className="mktKicker">Pricing</div>
          <h1 className="mktH1" style={{ fontSize: 44, marginTop: 10 }}>Subscriptions by employee seats.</h1>
          <p className="mktLead">Admin/HR starts the organization, invites managers, and adds employees. Pay only for active seats.</p>
        </div>

        <div className="mktGrid3" style={{ marginTop: 18 }}>
          <PlanCard
            name="Free"
            price="$0"
            tagline="For testing and small teams"
            bullets={[
              'Core tasks & projects',
              'Basic analytics',
              'Email + password + MFA',
            ]}
          />
          <PlanCard
            name="Basic"
            price="$4 / seat / month"
            tagline="For growing teams"
            bullets={[
              'HRIS (employees + time off)',
              'Reports + exports',
              'Audit logs',
              'Stripe billing + invoices',
            ]}
            primary
          />
          <PlanCard
            name="Pro"
            price="$10 / seat / month"
            tagline="For advanced operations"
            bullets={[
              'AI-assisted approvals',
              'Advanced analytics & insights',
              'Integrations (Slack/Calendar)',
              'Priority support',
            ]}
          />
        </div>

        <div className="mktFeatureWide" style={{ marginTop: 18 }}>
          <div className="mktFeatureTitle">Business model</div>
          <div className="mktFeatureText">
            Your organization subscribes based on the number of active employees (seats). Admin/HR can add managers.
            Managers (and Admin/HR) can add employees and assign tasks. Seat limits are enforced when adding users.
          </div>
          <div className="mktBullets" style={{ marginTop: 10 }}>
            <div>• Subscription = seats (active users)</div>
            <div>• Admin/HR: full access, org-wide</div>
            <div>• Manager: team scope (projects, performance, profile settings)</div>
          </div>
        </div>
      </section>
    </div>
  )
}

