import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
} from 'react-router-dom'
import {
  ArrowLeft,
  ArrowUpRight,
  Home,
  MessageCircle,
  Receipt,
  Users,
  X,
} from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { useT, type TranslationKey } from '../i18n'
import { BottomNav } from './BottomNav'
import { LanguageSwitcher } from './LanguageSwitcher'
import { Logo as BrandLogo } from './Logo'
import { StatusBar } from './ui'
import { isNative } from '../native/capabilities'
import { useBrandCopy } from '../marketing/brandCopy'
import './app-experience.css'

const NAV_ROUTES = ['/app', '/recipients', '/activity', '/profile']
const LINKS: { to: string; label: TranslationKey; icon: typeof Home }[] = [
  { to: '/app', label: 'nav.home', icon: Home },
  { to: '/recipients', label: 'nav.recipients', icon: Users },
  { to: '/activity', label: 'nav.activity', icon: Receipt },
  { to: '/assistant', label: 'chat.title', icon: MessageCircle },
]
function Logo({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  return <BrandLogo tone={tone} height={28} />
}
export { Logo }

export function AppLayout() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const t = useT()
  const copy = useBrandCopy()
  const { isDemo, signOut } = useAuth()
  const tone = pathname === '/success' ? 'dark' : 'light'
  const exit = async () => {
    if (isDemo) await signOut()
    navigate('/')
  }
  return (
    <div
      className={`product-shell ${isNative ? 'product-native' : 'product-web'}`}
    >
      {!isNative && (
        <aside className="product-sidebar">
          <Link to="/" aria-label="XpressTend">
            <BrandLogo height={38} />
          </Link>
          <div className="product-sidebar-content">
            <p className="product-eyebrow">{copy.connected}</p>
            <h2>{copy.shellTitle}</h2>
            <p className="product-sidebar-body">{copy.shellBody}</p>
            <nav aria-label={copy.experience}>
              {LINKS.map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to} end>
                  <Icon size={18} strokeWidth={1.6} />
                  {t(label)}
                </NavLink>
              ))}
            </nav>
            {isDemo && (
              <Link className="product-create-account" to="/register">
                {t('marketing.getStarted')} <ArrowUpRight size={16} />
              </Link>
            )}
          </div>
          <div className="product-sidebar-footer">
            <LanguageSwitcher />
            <button onClick={() => void exit()}>
              <ArrowLeft size={14} />
              {copy.back}
            </button>
          </div>
        </aside>
      )}
      <main className="product-main">
        <div
          className={`product-phone ${tone === 'dark' ? 'product-phone-dark' : ''}`}
        >
          {!isNative && (
            <div className="product-status">
              <StatusBar tone={tone} />
            </div>
          )}
          {isDemo && (
            <div className="product-explore-bar">
              <span>{copy.exploreLabel}</span>
              <button onClick={() => void exit()} aria-label={copy.exit}>
                <X size={14} />
              </button>
            </div>
          )}
          {!isDemo && (
            <div role="note" className="border-b border-brand-200 bg-brand-50 px-4 py-3 text-[12px] leading-relaxed text-ink-700">
              Test mode. Transfers are simulated; no customer funds are charged or delivered.
            </div>
          )}
          <Outlet />
          {NAV_ROUTES.includes(pathname) && <BottomNav />}
        </div>
      </main>
    </div>
  )
}
