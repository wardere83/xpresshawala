import { useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowUpRight, Globe2, ShieldCheck, Languages, ScanLine } from 'lucide-react'
import { brand } from '../config/brand'
import { useT } from '../i18n'
import { LanguageSwitcher } from '../components/LanguageSwitcher'
import { Logo } from '../components/Logo'
import { useAuth } from '../auth/AuthContext'
import { useBrandCopy } from './brandCopy'
import { useCorporateCopy } from './corporateCopy'
import { InteractiveGlobe } from './InteractiveGlobe'
import { BrandFilm } from './BrandFilm'
import { AppShowcase } from './AppShowcase'
import './marketing.css'

export function Marketing() {
  const t = useT()
  const labels = useBrandCopy()
  const copy = useCorporateCopy()
  const { user, enterDemo } = useAuth()
  const navigate = useNavigate()
  const explore = () => {
    if (!user) enterDemo()
    navigate('/app')
  }
  const companyLinks = [
    { to: '/company', label: labels.trustCompany },
    { to: '/compliance', label: labels.trustCompliance },
    { to: '/security', label: labels.trustSecurity },
    { to: '/partners', label: labels.trustPartners },
  ]

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  return (
    <div className="brand-site corporate-site">
      <a
        className="brand-skip"
        href="#main"
        onClick={(event) => {
          event.preventDefault()
          document.getElementById('main')?.focus()
        }}
      >
        {labels.skip}
      </a>
      <header className="brand-header">
        <div className="brand-header-inner brand-width">
          <Link to="/" aria-label={brand.name} className="brand-wordmark">
            <Logo variant="full" height={42} />
          </Link>
          <nav aria-label={copy.navigation} className="brand-nav corporate-nav">
            {companyLinks.map((link) => (
              <Link key={link.to} to={link.to}>{link.label}</Link>
            ))}
          </nav>
          <LanguageSwitcher />
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        <section className="corporate-hero">
          <div className="corporate-hero-inner brand-width">
            <div className="corporate-hero-copy">
              <p className="brand-eyebrow">{copy.heroEyebrow}</p>
              <h1>{copy.heroFirst}<br /><span>{copy.heroSecond}</span></h1>
              <p className="corporate-intro">{copy.heroIntro}</p>
              <div className="brand-actions">
                <Link className="brand-primary" to="/partners">
                  {copy.partnerAction} <ArrowUpRight size={17} aria-hidden="true" />
                </Link>
                <Link className="brand-text-link" to="/company">
                  {copy.companyAction} <ArrowUpRight size={17} aria-hidden="true" />
                </Link>
              </div>
            </div>
            <InteractiveGlobe />
          </div>
        </section>

        <div className="corporate-film">
          <BrandFilm />
        </div>

        <AppShowcase onExplore={explore} />

        <section className="corporate-company brand-width" aria-labelledby="company-heading">
          <div className="corporate-company-intro">
            <div>
              <p className="brand-eyebrow">{copy.companyEyebrow}</p>
              <h2 className="brand-display" id="company-heading">{copy.companyTitle}</h2>
            </div>
            <div>
              <p className="brand-body">{copy.companyBody}</p>
              <Link className="brand-text-link" to="/company">
                {copy.companyLink} <ArrowUpRight size={17} aria-hidden="true" />
              </Link>
            </div>
          </div>
          <dl className="corporate-facts">
            <div><dt>{copy.factsLocation}</dt><dd>{brand.hq.city}, {brand.hq.state}</dd></div>
            <div><dt>{copy.factsRegistration}</dt><dd><a href={brand.nmls.verifyUrl} target="_blank" rel="noopener noreferrer">NMLS ID {brand.nmls.id} <ArrowUpRight size={15} aria-hidden="true" /></a></dd></div>
            <div><dt>{copy.factsFocus}</dt><dd>{copy.factsFocusValue}</dd></div>
          </dl>
        </section>

        <section className="corporate-principles" aria-labelledby="approach-heading">
          <div className="brand-width">
            <p className="brand-eyebrow">{copy.principlesEyebrow}</p>
            <h2 className="brand-display" id="approach-heading">{copy.principlesTitle}</h2>
            <div className="corporate-cards">
              {[
                { Icon: ScanLine, title: copy.clarityTitle, body: copy.clarityBody },
                { Icon: Languages, title: copy.accessTitle, body: copy.accessBody },
                { Icon: ShieldCheck, title: copy.accountabilityTitle, body: copy.accountabilityBody },
              ].map(({ Icon, title, body }) => (
                <article key={title} className="corporate-card">
                  <Icon size={27} strokeWidth={1.4} aria-hidden="true" />
                  <h3>{title}</h3>
                  <p>{body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="corporate-partners brand-width" aria-labelledby="partners-heading">
          <div>
            <p className="brand-eyebrow">{copy.partnerEyebrow}</p>
            <h2 className="brand-display" id="partners-heading">{copy.partnerTitle}</h2>
            <p className="brand-body">{copy.partnerBody}</p>
            <div className="brand-actions">
              <a className="brand-primary" href={`mailto:${brand.support.email}?subject=${encodeURIComponent(copy.inquirySubject)}`}>
                {copy.inquiryAction} <ArrowUpRight size={17} aria-hidden="true" />
              </a>
              <Link className="brand-text-link" to="/partners">{copy.partnerLink} <ArrowUpRight size={17} aria-hidden="true" /></Link>
            </div>
          </div>
          <Globe2 className="corporate-partner-icon" size={164} strokeWidth={0.6} aria-hidden="true" />
        </section>

        <section className="brand-trust" aria-labelledby="trust-heading">
          <div className="brand-trust-inner brand-width">
            <div>
              <p className="brand-eyebrow">{copy.trustEyebrow}</p>
              <h2 className="brand-display" id="trust-heading">{copy.trustTitle}</h2>
              <p className="brand-body">{copy.trustBody}</p>
            </div>
            <ul className="brand-trust-links">
              {companyLinks.map((link) => (
                <li key={link.to}><Link to={link.to}>{link.label}<ArrowUpRight size={16} aria-hidden="true" /></Link></li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <footer className="brand-footer brand-width">
        <div className="brand-footer-top">
          <div className="brand-footer-brand">
            <Link to="/" aria-label={brand.name}><Logo variant="full" height={44} /></Link>
            <p>{brand.hq.city}, {brand.hq.state}, {brand.hq.country}</p>
            <p>
              <a href={`mailto:${brand.support.email}`}>{brand.support.email}</a><br />
              <a href={`tel:${brand.support.phone.replace(/[^+\d]/g, '')}`}>{brand.support.phone}</a>
            </p>
          </div>
          <nav className="brand-footer-columns" aria-label={labels.footerCompany}>
            <div>
              <h2>{labels.footerCompany}</h2>
              {companyLinks.map((link) => <Link key={link.to} to={link.to}>{link.label}</Link>)}
            </div>
            <div>
              <h2>{copy.footerContact}</h2>
              <Link to="/support">{copy.footerContact}</Link>
              <a href={`mailto:${brand.support.email}?subject=${encodeURIComponent(copy.inquirySubject)}`}>{copy.partnerAction}</a>
              <Link to="/login">{t('marketing.signIn')}</Link>
            </div>
            <div>
              <h2>{labels.footerLegal}</h2>
              <Link to="/privacy">{copy.footerPrivacy}</Link>
              <a href={brand.nmls.verifyUrl} target="_blank" rel="noopener noreferrer">NMLS ID {brand.nmls.id}</a>
            </div>
          </nav>
        </div>
        <div className="brand-footer-bottom" lang="en" dir="ltr">
          <p className="brand-footer-legal">{brand.legal.licence}{' '}<a href={brand.nmls.verifyUrl} target="_blank" rel="noopener noreferrer">Verify at NMLS Consumer Access</a>.</p>
          <p className="brand-footer-legal">{brand.legal.operatingStatus}</p>
          <p className="brand-footer-copyright">© {new Date().getFullYear()} {brand.legalName}. All rights reserved.</p>
        </div>
      </footer>
    </div>
  )
}
