import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BadgeCheck, Globe, HelpCircle, LogOut, ScrollText, ShieldCheck, UserRound } from 'lucide-react'
import { LanguageSwitcher } from '../components/LanguageSwitcher'
import { Avatar, ListRow, ScreenHeader } from '../components/ui'
import { brand } from '../config/brand'
import { useI18n } from '../i18n'
import { user } from '../data/mock'
import { useAuth } from '../auth/AuthContext'
import { hueFor } from '../lib/view'

export function Profile() {
  const { user: account, isDemo, signOut } = useAuth()
  const { t } = useI18n()
  const navigate = useNavigate()
  const [personalOpen, setPersonalOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const name = account ? `${account.firstName} ${account.lastName}` : isDemo ? user.fullName : 'Account'
  const email = account?.email ?? (isDemo ? user.email : 'Unavailable')
  const verified = !isDemo && account?.kycStatus === 'verified'
  const createdAt = account && 'createdAt' in account && typeof account.createdAt === 'string' ? account.createdAt : null
  const joinedYear = createdAt && Number.isFinite(Date.parse(createdAt)) ? new Date(createdAt).getUTCFullYear() : null

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <ScreenHeader title={t('profile.title')} />
      <div className="flex-1 overflow-y-auto no-scrollbar px-4 pb-6">
        <section className="card flex items-center gap-3.5 p-4">
          <Avatar name={name} hue={hueFor(name)} size={56} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[16px] font-semibold text-ink-900">{name}</p>
            <p className="truncate text-[12px] text-ink-500"><bdi>{email}</bdi></p>
            <p className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold ${verified ? 'bg-ok-soft text-brand-700' : 'bg-canvas text-ink-700'}`}>
              {verified ? <BadgeCheck size={12} /> : <UserRound size={12} />}
              {isDemo ? 'Demo identity — sample data' : verified ? t('profile.verified') : `Identity verification: ${account?.kycStatus?.replaceAll('_', ' ') ?? 'unavailable'}`}
            </p>
          </div>
        </section>
        {(isDemo || joinedYear !== null) && <p className="mt-2 px-1 text-[11.5px] text-ink-500">
          {isDemo ? `Sample member since ${user.memberSince}` : t('profile.member', { year: joinedYear! })}
        </p>}
        <section className="card mt-4 flex items-center justify-between gap-3 px-4 py-3.5">
          <span className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-50 text-brand-600"><Globe size={18} /></span>
            <span className="text-[14px] font-semibold text-ink-900">{t('profile.language')}</span>
          </span>
          <LanguageSwitcher />
        </section>
        <section className="card mt-4 divide-y divide-ink-200/60 overflow-hidden">
          <ListRow onClick={() => setPersonalOpen((open) => !open)} icon={<UserRound size={17} />} title={t('profile.personal')} />
          {personalOpen && <div className="space-y-2 px-4 py-3 text-[13px] text-ink-700">
            <p>{name}</p><p><bdi>{email}</bdi></p>
            <p>{isDemo ? 'These details are examples from the product tour.' : `Account status: ${account?.status ?? 'unavailable'}`}</p>
          </div>}
          {!isDemo && <ListRow onClick={() => navigate('/forgot-password')} icon={<ShieldCheck size={17} />} title="Password recovery" />}
          <ListRow onClick={() => navigate('/help')} icon={<HelpCircle size={17} />} title={t('profile.help')} />
          <ListRow onClick={() => navigate('/privacy')} icon={<ScrollText size={17} />} title="Privacy and data retention" />
          {!isDemo && <ListRow onClick={() => navigate('/delete-account')} icon={<UserRound size={17} />} title="Delete account" />}
        </section>
        {error && <p role="alert" className="mt-3 text-sm text-alert">{error}</p>}
        <button type="button" onClick={() => {
          void signOut().then(() => navigate('/')).catch(() => setError('Could not sign out. Please try again.'))
        }} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-white py-3.5 text-[14px] font-bold text-alert shadow-[var(--shadow-card)] transition hover:bg-alert-soft">
          <LogOut size={16} />{t('profile.signOut')}
        </button>
        <footer className="mt-6 space-y-1 text-center text-[11px] leading-relaxed text-ink-500">
          <p className="font-semibold">{brand.name}</p>
          <p><bdi>{brand.hq.city}, {brand.hq.state}</bdi></p>
          <p>{brand.legal.licence}</p>
          <p><bdi>{brand.support.email}</bdi> · <bdi>{brand.support.phone}</bdi></p>
        </footer>
      </div>
    </div>
  )
}
