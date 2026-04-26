import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useMemo, useState, useEffect } from 'react'
import { useI18n, type Lang } from '../../i18n'

export function MarketingLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const { lang, setLang, t } = useI18n()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  const isHome = useMemo(
    () => location.pathname === '/' || location.pathname === '/home',
    [location.pathname],
  )

  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  useEffect(() => {
    function onScroll() { setScrolled(window.scrollY > 20) }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  function goToSection(id: string) {
    setMobileOpen(false)
    if (!isHome) { navigate(`/#${id}`); return }
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const NAV_ITEMS = [
    { label: t('mkt.products'), action: () => goToSection('products') },
    { label: t('mkt.solutions'), action: () => goToSection('solutions') },
    { label: 'How it works', action: () => goToSection('workflow') },
    { label: t('mkt.pricing'), to: '/pricing' },
  ]

  return (
    <div className="mktShell">
      <header
        className="mktTopbar"
        style={{
          borderBottomColor: scrolled ? 'rgba(255,255,255,0.10)' : 'transparent',
          background: scrolled ? 'rgba(11,13,18,0.92)' : 'transparent',
          backdropFilter: scrolled ? 'blur(20px)' : 'none',
          transition: 'all 0.3s ease',
        }}
      >
        <div className="mktTopbarInner">
          {/* Brand */}
          <Link to="/" className="mktBrand" style={{ gap: 12 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 11,
              background: 'linear-gradient(135deg, #f4ca57, #d4a030)',
              display: 'grid', placeItems: 'center', flexShrink: 0,
              color: '#0b0d12', boxShadow: '0 4px 14px rgba(244,202,87,0.35)',
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                <path d="M2 17l10 5 10-5"/>
                <path d="M2 12l10 5 10-5"/>
              </svg>
            </div>
            <div className="mktBrandText">
              <div className="mktBrandName">TaskFlow Pro</div>
              <div className="mktBrandSub">HR + Workflows + AI</div>
            </div>
          </Link>

          {/* Desktop nav */}
          <nav className="mktNav" aria-label="Primary navigation">
            {NAV_ITEMS.map(item =>
              item.to ? (
                <NavLink
                  key={item.label}
                  className={({ isActive }) => `mktNavItem${isActive ? ' mktNavItemActive' : ''}`}
                  to={item.to}
                >
                  {item.label}
                </NavLink>
              ) : (
                <button key={item.label} className="mktNavItem" onClick={item.action}>
                  {item.label}
                </button>
              )
            )}
          </nav>

          {/* Desktop actions */}
          <div className="mktActions">
            <select
              className="mktLang"
              value={lang}
              onChange={e => setLang(e.target.value as Lang)}
              aria-label="Language"
            >
              <option value="en">{t('lang.en')}</option>
              <option value="ar">{t('lang.ar')}</option>
            </select>
            <Link className="mktBtn mktBtnGhost" to="/signin">{t('mkt.signIn')}</Link>
            <Link className="mktBtn mktBtnPrimary" to="/signup" style={{ gap: 6, display: 'inline-flex', alignItems: 'center' }}>
              {t('mkt.signUp')}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M5 12h14M12 5l7 7-7 7"/>
              </svg>
            </Link>

            {/* Mobile hamburger */}
            <button
              type="button"
              className="mktHamburger"
              aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
              onClick={() => setMobileOpen(v => !v)}
            >
              {mobileOpen ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/>
                  <line x1="3" y1="18" x2="21" y2="18"/>
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {mobileOpen && (
          <div className="mktMobileMenu animate-fadeInDown">
            {NAV_ITEMS.map(item =>
              item.to ? (
                <NavLink
                  key={item.label}
                  className="mktMobileItem"
                  to={item.to}
                  onClick={() => setMobileOpen(false)}
                >
                  {item.label}
                </NavLink>
              ) : (
                <button key={item.label} className="mktMobileItem" onClick={item.action}>
                  {item.label}
                </button>
              )
            )}
            <div style={{ padding: '14px 18px', display: 'flex', gap: 10 }}>
              <Link className="mktBtn mktBtnGhost" style={{ flex: 1, justifyContent: 'center', display: 'flex' }} to="/signin">
                {t('mkt.signIn')}
              </Link>
              <Link className="mktBtn mktBtnPrimary" style={{ flex: 1, justifyContent: 'center', display: 'flex' }} to="/signup">
                {t('mkt.signUp')}
              </Link>
            </div>
          </div>
        )}
      </header>

      <main className="mktMain" style={{ paddingTop: 66 }}>
        <Outlet />
      </main>

      <footer className="mktFooter">
        <div className="mktFooterInner" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', flexWrap: 'wrap', gap: 20 }}>
            {/* Brand col */}
            <div style={{ maxWidth: 300 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 10,
                  background: 'linear-gradient(135deg, #f4ca57, #d4a030)',
                  display: 'grid', placeItems: 'center', color: '#0b0d12',
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                    <path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
                  </svg>
                </div>
                <div className="mktFooterBrand">TaskFlow Pro</div>
              </div>
              <div className="mktFooterSub">
                Subscription per employee seat · Admin/HR controlled onboarding · AI-assisted approvals.
              </div>
            </div>

            {/* Link cols */}
            <div style={{ display: 'flex', gap: 48, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 900, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Product</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <Link className="mktFooterLink" to="/pricing">Pricing</Link>
                  <button className="mktFooterLink" style={{ background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0 }} onClick={() => goToSection('solutions')}>Solutions</button>
                  <button className="mktFooterLink" style={{ background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0 }} onClick={() => goToSection('products')}>Features</button>
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 900, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Account</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <Link className="mktFooterLink" to="/signin">Sign in</Link>
                  <Link className="mktFooterLink" to="/signup">Sign up free</Link>
                  <a className="mktFooterLink" href="mailto:support@taskflow.local">Support</a>
                </div>
              </div>
            </div>
          </div>

          <div style={{ width: '100%', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              © {new Date().getFullYear()} TaskFlow Pro. All rights reserved.
            </div>
            <div style={{ display: 'flex', gap: 16 }}>
              <select className="mktLang" style={{ height: 32, fontSize: 11 }} value={lang} onChange={e => setLang(e.target.value as Lang)} aria-label="Language">
                <option value="en">English</option>
                <option value="ar">العربية</option>
              </select>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
