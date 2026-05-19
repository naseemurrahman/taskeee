import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useMemo, useState, useEffect } from 'react'
import { useI18n, type Lang } from '../../i18n'
import { useMktTheme } from '../../lib/mktTheme'

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
      <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
    </svg>
  )
}
function MoonIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  )
}

export function MarketingLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const { lang, setLang, t } = useI18n()
  const [theme, toggleTheme] = useMktTheme()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  const isHome = useMemo(
    () => location.pathname === '/' || location.pathname === '/home',
    [location.pathname],
  )

  useEffect(() => { setMobileOpen(false) }, [location.pathname])
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
    { label: 'How it works', action: () => goToSection('demo') },
    { label: t('mkt.pricing'), to: '/pricing' },
  ]

  const isDark = theme === 'dark'
  const navBg = scrolled
    ? (isDark ? 'rgba(6,8,16,0.92)' : 'rgba(248,248,246,0.94)')
    : 'transparent'
  const navBorder = scrolled
    ? (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)')
    : 'transparent'
  const navItemColor = isDark ? 'rgba(255,255,255,0.65)' : 'rgba(0,0,0,0.65)'
  const themeBtnBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'
  const themeBtnBorder = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)'
  const themeBtnColor = isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)'
  const ghostBtnBg = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'
  const ghostBtnBorder = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'
  const ghostBtnColor = isDark ? 'rgba(255,255,255,0.72)' : 'rgba(0,0,0,0.72)'
  const mobileMenuBg = isDark ? 'rgba(8,10,18,0.98)' : 'rgba(248,248,246,0.98)'
  const footerBg = isDark ? 'rgba(6,8,12,0.9)' : 'rgba(244,244,242,0.9)'
  const footerBorder = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)'
  const footerText = isDark ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.35)'
  const footerLink = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.5)'
  const footerLinkHover = isDark ? '#ffffff' : '#000000'
  const textColor = isDark ? '#ffffff' : '#0f0f0e'

  return (
    <div className="mktShell" data-mkt-theme={theme}>
      <header
        className="mktTopbar"
        style={{
          borderBottomColor: navBorder,
          background: navBg,
          backdropFilter: scrolled ? 'blur(20px)' : 'none',
          transition: 'all 0.3s ease',
        }}
      >
        <div className="mktTopbarInner">
          {/* Brand */}
          <Link to="/" className="mktBrand" style={{ gap: 10, textDecoration: 'none', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0, background: isDark ? 'linear-gradient(135deg, #1c1710, #0d0b08)' : 'linear-gradient(135deg, #fff8ec, #fef3dc)', border: '1.5px solid rgba(226,171,65,0.4)', display: 'grid', placeItems: 'center', boxShadow: '0 4px 16px rgba(226,171,65,0.16)' }}>
              <svg width="20" height="20" viewBox="0 0 48 48" fill="none">
                <defs><linearGradient id="ngold" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#f9e6a2"/><stop offset="100%" stopColor="#e2ab41"/></linearGradient></defs>
                <rect x="7" y="12" width="34" height="6.5" rx="3.25" fill="url(#ngold)"/>
                <rect x="19.5" y="18.5" width="9" height="17.5" rx="2.5" fill="url(#ngold)"/>
              </svg>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0, minWidth: 0 }}>
              <span style={{ fontWeight: 950, fontSize: 15, letterSpacing: '0.13em', textTransform: 'uppercase', lineHeight: 1.1, background: 'linear-gradient(135deg, #f9e6a2 0%, #e2ab41 55%, #c98317 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', display: 'block' }}>TASKEE</span>
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', display: 'block', marginTop: 1, color: isDark ? 'rgba(255,255,255,0.38)' : 'rgba(0,0,0,0.35)', WebkitTextFillColor: isDark ? 'rgba(255,255,255,0.38)' : 'rgba(0,0,0,0.35)' }}>AI Task Intelligence</span>
            </div>
          </Link>

          {/* Desktop nav */}
          <nav className="mktNav" aria-label="Primary navigation">
            {NAV_ITEMS.map(item =>
              item.to ? (
                <NavLink key={item.label} className={({ isActive }) => `mktNavItem${isActive ? ' mktNavItemActive' : ''}`} to={item.to} style={{ color: navItemColor }}>
                  {item.label}
                </NavLink>
              ) : (
                <button key={item.label} className="mktNavItem" onClick={item.action} style={{ color: navItemColor }}>
                  {item.label}
                </button>
              )
            )}
          </nav>

          {/* Actions */}
          <div className="mktActions">
            {/* Theme toggle */}
            <button
              onClick={toggleTheme}
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              style={{ width: 38, height: 38, borderRadius: 9, background: themeBtnBg, border: `1px solid ${themeBtnBorder}`, color: themeBtnColor, display: 'grid', placeItems: 'center', cursor: 'pointer', transition: 'all 0.15s', flexShrink: 0 }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.09)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = themeBtnBg }}
            >
              {isDark ? <SunIcon /> : <MoonIcon />}
            </button>

            <select className="mktLang" value={lang} onChange={e => setLang(e.target.value as Lang)} aria-label="Language"
              style={{ background: themeBtnBg, border: `1px solid ${themeBtnBorder}`, color: isDark ? 'rgba(255,255,255,0.65)' : 'rgba(0,0,0,0.65)' }}>
              <option value="en">{t('lang.en')}</option>
              <option value="ar">{t('lang.ar')}</option>
            </select>

            <Link className="mktBtn mktBtnGhost" to="/signin"
              style={{ background: ghostBtnBg, border: `1px solid ${ghostBtnBorder}`, color: ghostBtnColor }}>
              {t('mkt.signIn')}
            </Link>
            <Link className="mktBtn mktBtnPrimary" to="/signup" style={{ gap: 6, display: 'inline-flex', alignItems: 'center' }}>
              {t('mkt.signUp')}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            </Link>

            <button type="button" className="mktHamburger" aria-label={mobileOpen ? 'Close menu' : 'Open menu'} onClick={() => setMobileOpen(v => !v)}
              style={{ background: themeBtnBg, border: `1px solid ${themeBtnBorder}`, color: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)' }}>
              {mobileOpen ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
              )}
            </button>
          </div>
        </div>

        {mobileOpen && (
          <div className="mktMobileMenu animate-fadeInDown" style={{ background: mobileMenuBg, borderTop: `1px solid ${navBorder}` }}>
            {NAV_ITEMS.map(item =>
              item.to ? (
                <NavLink key={item.label} className="mktMobileItem" to={item.to} onClick={() => setMobileOpen(false)} style={{ color: navItemColor }}>
                  {item.label}
                </NavLink>
              ) : (
                <button key={item.label} className="mktMobileItem" onClick={item.action} style={{ color: navItemColor }}>
                  {item.label}
                </button>
              )
            )}
            <div style={{ padding: '14px 18px', display: 'flex', gap: 10, alignItems: 'center' }}>
              <Link className="mktBtn mktBtnGhost" style={{ flex: 1, justifyContent: 'center', display: 'flex', background: ghostBtnBg, border: `1px solid ${ghostBtnBorder}`, color: ghostBtnColor }} to="/signin">
                {t('mkt.signIn')}
              </Link>
              <Link className="mktBtn mktBtnPrimary" style={{ flex: 1, justifyContent: 'center', display: 'flex' }} to="/signup">
                {t('mkt.signUp')}
              </Link>
              <button onClick={toggleTheme} style={{ width: 42, height: 42, borderRadius: 9, background: themeBtnBg, border: `1px solid ${themeBtnBorder}`, color: themeBtnColor, display: 'grid', placeItems: 'center', cursor: 'pointer', flexShrink: 0 }}>
                {isDark ? <SunIcon /> : <MoonIcon />}
              </button>
            </div>
          </div>
        )}
      </header>

      <main className="mktMain" style={{ paddingTop: 66 }}>
        <Outlet />
      </main>

      <footer style={{ background: footerBg, borderTop: `1px solid ${footerBorder}`, padding: '48px 0 28px' }}>
        <div style={{ maxWidth: 1180, margin: '0 auto', padding: '0 32px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 40, flexWrap: 'wrap', marginBottom: 40 }}>
            <div style={{ maxWidth: 260 }}>
              <Link to="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 10, textDecoration: 'none', marginBottom: 14 }}>
                <div style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0, background: isDark ? 'linear-gradient(135deg, #1c1710, #0d0b08)' : 'linear-gradient(135deg, #fff8ec, #fef3dc)', border: '1.5px solid rgba(226,171,65,0.35)', display: 'grid', placeItems: 'center' }}>
                  <svg width="18" height="18" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="fg2" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#f9e6a2"/><stop offset="100%" stopColor="#e2ab41"/></linearGradient></defs><rect x="7" y="12" width="34" height="6.5" rx="3.25" fill="url(#fg2)"/><rect x="19.5" y="18.5" width="9" height="17.5" rx="2.5" fill="url(#fg2)"/></svg>
                </div>
                <div>
                  <div style={{ fontWeight: 950, fontSize: 13, letterSpacing: '0.12em', textTransform: 'uppercase', background: 'linear-gradient(135deg,#f9e6a2,#e2ab41)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', display: 'block' }}>TASKEE</div>
                  <div style={{ fontSize: 9, color: footerText, WebkitTextFillColor: footerText, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', marginTop: 1 }}>AI Task Intelligence</div>
                </div>
              </Link>
              <p style={{ fontSize: 12.5, color: footerText, lineHeight: 1.7 }}>Per-seat subscription. Admin/HR-controlled onboarding. AI-assisted approvals.</p>
            </div>
            <div style={{ display: 'flex', gap: 48, flexWrap: 'wrap' }}>
              {[
                { heading: 'Product', links: [{ label: 'Features', to: '/#solutions' }, { label: 'Pricing', to: '/pricing' }, { label: 'How it works', to: '/#demo' }] },
                { heading: 'Account', links: [{ label: 'Sign in', to: '/signin' }, { label: 'Sign up free', to: '/signup' }, { label: 'Support', to: 'mailto:support@taskee.app' }] },
              ].map(col => (
                <div key={col.heading}>
                  <div style={{ fontSize: 10.5, fontWeight: 900, color: footerText, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 14 }}>{col.heading}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {col.links.map(l => (
                      l.to.startsWith('mailto')
                        ? <a key={l.label} href={l.to} style={{ fontSize: 13, color: footerLink, textDecoration: 'none', fontWeight: 600, transition: 'color 0.12s' }} onMouseEnter={e => (e.currentTarget.style.color = footerLinkHover)} onMouseLeave={e => (e.currentTarget.style.color = footerLink)}>{l.label}</a>
                        : <Link key={l.label} to={l.to} style={{ fontSize: 13, color: footerLink, textDecoration: 'none', fontWeight: 600 }}>{l.label}</Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ borderTop: `1px solid ${footerBorder}`, paddingTop: 18, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ fontSize: 12, color: footerText }}>© {new Date().getFullYear()} TASKEE. All rights reserved.</div>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
              {['Privacy', 'Terms', 'Security'].map(l => (
                <span key={l} style={{ fontSize: 12, color: footerText, cursor: 'default', fontWeight: 600 }}>{l}</span>
              ))}
              <select style={{ height: 30, fontSize: 11, background: themeBtnBg, border: `1px solid ${themeBtnBorder}`, color: isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.55)', borderRadius: 7, padding: '0 8px', cursor: 'pointer' }} value={lang} onChange={e => setLang(e.target.value as Lang)}>
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
