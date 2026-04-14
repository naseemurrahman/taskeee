import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useMemo } from 'react'
import { useI18n, type Lang } from '../../i18n'

export function MarketingLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const { lang, setLang, t } = useI18n()

  const isHome = useMemo(() => location.pathname === '/' || location.pathname === '/home', [location.pathname])

  function goToSection(id: string) {
    if (!isHome) {
      navigate(`/#${id}`)
      return
    }
    const el = document.getElementById(id)
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="mktShell">
      <header className="mktTopbar">
        <div className="mktTopbarInner">
          <Link to="/" className="mktBrand">
            <div className="mktBrandMark">TF</div>
            <div className="mktBrandText">
              <div className="mktBrandName">TaskFlow Pro</div>
              <div className="mktBrandSub">HR + Workflows</div>
            </div>
          </Link>

          <nav className="mktNav" aria-label="Primary navigation">
            <button className="mktNavItem" onClick={() => goToSection('products')}>{t('mkt.products')}</button>
            <button className="mktNavItem" onClick={() => goToSection('solutions')}>{t('mkt.solutions')}</button>
            <button className="mktNavItem" onClick={() => goToSection('resources')}>{t('mkt.resources')}</button>
            <NavLink className={({ isActive }) => `mktNavItem ${isActive ? 'mktNavItemActive' : ''}`} to="/pricing">{t('mkt.pricing')}</NavLink>
          </nav>

          <div className="mktActions">
            <select className="mktLang" value={lang} onChange={(e) => setLang(e.target.value as Lang)} aria-label="Language">
              <option value="en">{t('lang.en')}</option>
              <option value="ar">{t('lang.ar')}</option>
            </select>
            <Link className="mktBtn mktBtnGhost" to="/signin">{t('mkt.signIn')}</Link>
            <Link className="mktBtn mktBtnPrimary" to="/signup">{t('mkt.signUp')}</Link>
          </div>
        </div>
      </header>

      <main className="mktMain">
        <Outlet />
      </main>

      <footer className="mktFooter">
        <div className="mktFooterInner">
          <div>
            <div className="mktFooterBrand">TaskFlow Pro</div>
            <div className="mktFooterSub">Subscription per employee seat · Admin/HR controlled onboarding · AI-assisted approvals.</div>
          </div>
          <div className="mktFooterLinks">
            <a className="mktFooterLink" href="mailto:support@taskflow.local">Support</a>
            <Link className="mktFooterLink" to="/pricing">Pricing</Link>
            <Link className="mktFooterLink" to="/signin">Sign in</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}

