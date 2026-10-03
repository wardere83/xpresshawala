import { useEffect } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { brand } from '../config/brand'
import { Logo } from '../components/Logo'

const COMPANY_NAV = [
  { to: '/company', label: 'Company' },
  { to: '/partners', label: 'Partnerships' },
  { to: '/compliance', label: 'Compliance' },
  { to: '/security', label: 'Security' },
]

function scrollToSection(id: string) {
  const target = document.getElementById(id)
  if (!target) return
  target.tabIndex = -1
  target.focus({ preventScroll: true })
  target.scrollIntoView({
    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    block: 'start',
  })
}

export function Shell({
  title,
  intro,
  updated,
  children,
}: {
  title: string
  intro?: string
  updated?: string
  children: React.ReactNode
}) {
  useEffect(() => {
    const previousTitle = document.title
    document.title = `${title} | ${brand.name}`
    window.scrollTo(0, 0)
    return () => { document.title = previousTitle }
  }, [title])

  return (
    <div lang="en" dir="ltr" className="min-h-dvh bg-white text-ink-900">
      <a
        className="sr-only z-50 rounded-lg bg-white p-3 text-sm font-semibold focus:not-sr-only focus:absolute focus:left-4 focus:top-4"
        href="#company-content"
        onClick={(event) => {
          event.preventDefault()
          scrollToSection('company-content')
        }}
      >
        Skip to content
      </a>
      <header className="border-b border-ink-200/70 pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex max-w-5xl flex-col gap-5 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <Link className="w-fit rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-600" to="/" aria-label={`${brand.name} home`}>
            <Logo variant="full" height={42} />
          </Link>
          <nav aria-label="Company" className="flex flex-wrap gap-x-1 gap-y-1 text-sm">
            {COMPANY_NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => `rounded-lg px-3 py-2 font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${isActive ? 'bg-brand-50 text-brand-700' : 'text-ink-600 hover:bg-canvas hover:text-brand-700'}`}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main id="company-content" tabIndex={-1} className="mx-auto max-w-5xl px-5 py-10 focus:outline-none sm:px-8 sm:py-14">
        <div className="max-w-3xl border-b border-ink-200 pb-8 sm:pb-10">
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-700">{brand.legalName}</p>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
          {intro ? <p className="mt-5 text-base leading-relaxed text-ink-600 sm:text-lg">{intro}</p> : null}
          {updated ? <p className="mt-4 text-sm text-ink-500">Last updated {updated}</p> : null}
        </div>
        <div className="mt-8 max-w-3xl space-y-6 text-[15px] leading-7 text-ink-700 sm:mt-10">{children}</div>
      </main>
      <PageFooter />
    </div>
  )
}

export function PageFooter() {
  return (
    <footer className="border-t border-ink-200/70 bg-canvas">
      <div className="mx-auto max-w-5xl px-5 py-9 text-sm leading-relaxed text-ink-600 sm:px-8">
        <div className="grid gap-7 sm:grid-cols-2">
          <div>
            <p className="font-semibold text-ink-900">{brand.legalName}</p>
            <p className="mt-2">{brand.hq.city}, {brand.hq.state}, {brand.hq.country}</p>
            <p className="mt-3">
              <a className="underline underline-offset-4" href={`mailto:${brand.support.email}`}>
                {brand.support.email}
              </a>
              <br />
              <a className="underline underline-offset-4" href={`tel:${brand.support.phone.replace(/[^+\d]/g, '')}`}>
                {brand.support.phone}
              </a>
            </p>
          </div>
          <nav aria-label="Company resources" className="grid grid-cols-2 content-start gap-x-4 gap-y-3">
            {COMPANY_NAV.map((item) => (
              <Link key={item.to} className="hover:text-brand-700 hover:underline" to={item.to}>{item.label}</Link>
            ))}
            <Link className="hover:text-brand-700 hover:underline" to="/privacy">Privacy policy</Link>
            <Link className="hover:text-brand-700 hover:underline" to="/support">Contact and support</Link>
          </nav>
        </div>
        <div className="mt-7 border-t border-ink-200 pt-6 text-xs leading-6 text-ink-500">
          <p>{brand.legal.licence}</p>
          <p className="mt-3">{brand.legal.operatingStatus}</p>
          <p className="mt-4">© {new Date().getFullYear()} {brand.legalName}. All rights reserved.</p>
        </div>
      </div>
    </footer>
  )
}

export function H({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <h2 id={id} tabIndex={-1} className="scroll-mt-6 pt-3 text-xl font-semibold tracking-tight text-ink-900 focus:outline-none">
      {children}
    </h2>
  )
}

export function Q({ q, id, children }: { q: string; id?: string; children: React.ReactNode }) {
  return (
    <p id={id} className="scroll-mt-6 focus:outline-none">
      <strong className="text-ink-900">{q}</strong> {children}
    </p>
  )
}

export function Contents({ items }: { items: { id: string; label: string }[] }) {
  return (
    <nav aria-label="On this page" className="rounded-2xl border border-ink-200 bg-canvas p-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-ink-500">On this page</p>
      <ul className="mt-3 grid gap-1 sm:grid-cols-2 sm:gap-x-5">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className="rounded py-1 text-left text-sm text-ink-700 underline decoration-ink-300 underline-offset-4 hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
              onClick={() => scrollToSection(item.id)}
            >
              {item.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}

export function Facts({ rows }: { rows: { k: string; v: React.ReactNode }[] }) {
  return (
    <dl className="divide-y divide-ink-200/70 overflow-hidden rounded-2xl border border-ink-200">
      {rows.map((row) => (
        <div key={row.k} className="grid gap-1 px-5 py-4 sm:grid-cols-[180px_1fr] sm:gap-5">
          <dt className="text-sm font-semibold text-ink-900">{row.k}</dt>
          <dd className="min-w-0 break-words text-sm text-ink-700">{row.v}</dd>
        </div>
      ))}
    </dl>
  )
}
