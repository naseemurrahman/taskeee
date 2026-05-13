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
          <Link to="/" className="mktBrand" style={{ gap: 10, textDecoration: 'none', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
            {/* TASKEE T-mark — dark bg, gold border, T letterform in gold gradient */}
            <div style={{
              width: 36, height: 36, borderRadius: 10, flexShrink: 0,
              background: 'linear-gradient(135deg, #1c1710, #0d0b08)',
              border: '1.5px solid rgba(226,171,65,0.38)',
              display: 'grid', placeItems: 'center',
              boxShadow: '0 4px 16px rgba(226,171,65,0.18)',
            }}>
              <svg width="20" height="20" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <linearGradient id="navGold" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#f9e6a2"/>
                    <stop offset="100%" stopColor="#e2ab41"/>
                  </linearGradient>
                </defs>
                {/* T cross-bar */}
                <rect x="7" y="12" width="34" height="6.5" rx="3.25" fill="url(#navGold)"/>
                {/* T vertical stem */}
                <rect x="19.5" y="18.5" width="9" height="17.5" rx="2.5" fill="url(#navGold)"/>
              </svg>
            </div>
            {/* Wordmark */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0, minWidth: 0 }}>
              <span style={{
                fontWeight: 950, fontSize: 15,
                letterSpacing: '0.13em', textTransform: 'uppercase', lineHeight: 1.1,
                background: 'linear-gradient(135deg, #f9e6a2 0%, #e2ab41 55%, #c98317 100%)',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                backgroundClip: 'text', display: 'block',
              }}>TASKEE</span>
              <span style={{
                fontSize: 9, fontWeight: 700, letterSpacing: '0.05em',
                textTransform: 'uppercase', display: 'block', marginTop: 1,
                color: 'rgba(255,255,255,0.38)', WebkitTextFillColor: 'rgba(255,255,255,0.38)',
              }}>AI Task Intelligence</span>
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <div style={{
                  width: 34, height: 34, borderRadius: 10, flexShrink: 0,
                  background: 'linear-gradient(135deg, #1c1710, #0d0b08)',
                  border: '1.5px solid rgba(226,171,65,0.35)',
                  display: 'grid', placeItems: 'center',
                  boxShadow: '0 3px 12px rgba(226,171,65,0.14)',
                }}>
                  <svg width="18" height="18" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <defs>
                      <linearGradient id="footGold" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#f9e6a2"/>
                        <stop offset="100%" stopColor="#e2ab41"/>
                      </linearGradient>
                    </defs>
                    <rect x="7" y="12" width="34" height="6.5" rx="3.25" fill="url(#footGold)"/>
                    <rect x="19.5" y="18.5" width="9" height="17.5" rx="2.5" fill="url(#footGold)"/>
                  </svg>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                  <span style={{
                    fontWeight: 950, fontSize: 15,
                    letterSpacing: '0.12em', textTransform: 'uppercase', lineHeight: 1.1,
                    background: 'linear-gradient(135deg, #f9e6a2, #e2ab41)',
                    WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text', display: 'block',
                  }}>TASKEE</span>
                  <span style={{
                    fontSize: 9, fontWeight: 700, letterSpacing: '0.05em',
                    textTransform: 'uppercase', marginTop: 1, display: 'block',
                    color: 'rgba(255,255,255,0.35)', WebkitTextFillColor: 'rgba(255,255,255,0.35)',
                  }}>AI Task Intelligence</span>
                </div>
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
                  <a className="mktFooterLink" href="mailto:support@taskee.local">Support</a>
                </div>
              </div>
            </div>
          </div>

          <div style={{ width: '100%', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              © {new Date().getFullYear()} TASKEE. All rights reserved.
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
