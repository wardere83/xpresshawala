import { useNavigate } from 'react-router-dom'
import {
  Banknote,
  ChevronRight,
  ArrowUpRight,
  User,
  Headphones,
  Landmark,
  MessageCircleMore,
  ShieldCheck,
  Signal,
  Smartphone,
  TrendingUp,
} from 'lucide-react'
import { Logo } from '../components/AppLayout'
import { Avatar, SectionTitle } from '../components/ui'
import { useMirrorClass, useT } from '../i18n'
import { useTransfer } from '../state/TransferContext'
import { getRecipient, user } from '../data/mock'
import { useAuth } from '../auth/AuthContext'
import { useAccountData } from '../state/AccountData'
import { hueFor } from '../lib/view'
import { formatDate, rate, usd } from '../lib/format'
import type { TranslationKey } from '../i18n/en'
import type { DeliveryMethod } from '../state/TransferContext'

const services: {
  key: TranslationKey
  icon: typeof Smartphone
  hue: number
  method: DeliveryMethod
}[] = [
  { key: 'service.mobileMoney', icon: Smartphone, hue: 262, method: 'mobile' },
  { key: 'service.bankTransfer', icon: Landmark, hue: 152, method: 'bank' },
  { key: 'service.cashPickup', icon: Banknote, hue: 28, method: 'cash' },
  { key: 'service.airtime', icon: Signal, hue: 205, method: 'airtime' },
]

const quickActions: {
  titleKey: TranslationKey
  subKey: TranslationKey
  icon: typeof Smartphone
  hue: number
  to: string
}[] = [
  {
    titleKey: 'quick.help',
    subKey: 'quick.helpSub',
    icon: MessageCircleMore,
    hue: 262,
    to: '/help',
  },
  {
    titleKey: 'quick.rates',
    subKey: 'quick.ratesSub',
    icon: TrendingUp,
    hue: 152,
    to: '/rates',
  },
  {
    titleKey: 'quick.refer',
    subKey: 'quick.referSub',
    icon: ShieldCheck,
    hue: 250,
    to: '/refer',
  },
  {
    titleKey: 'quick.support',
    subKey: 'quick.supportSub',
    icon: Headphones,
    hue: 205,
    to: '/support',
  },
]

export function Home() {
  const { user: account, isDemo } = useAuth()
  const { recipients: accountRecipients, transfers, error } = useAccountData()
  const t = useT()
  const mirror = useMirrorClass()
  const navigate = useNavigate()
  const { history, corridor, setDeliveryMethod, setRecipientId } = useTransfer()
  const accountLatest = transfers[0]
  const latest = isDemo
    ? history[0]
    : accountLatest
      ? {
          date: accountLatest.created_at,
          amountUsd: accountLatest.send_amount_minor / 100,
          status: accountLatest.status,
        }
      : null
  const latestRecipient =
    isDemo && history[0]
      ? getRecipient(history[0].recipientId)
      : accountLatest
        ? {
            name: accountLatest.recipient_name,
            hue: hueFor(accountLatest.recipient_name),
          }
        : null
  const favourites = isDemo
    ? ['r1', 'r2', 'r3'].map(getRecipient)
    : accountRecipients.slice(0, 3).map((r) => ({
        id: r.id,
        name: r.full_name,
        phone: r.phone ?? r.country,
        hue: hueFor(r.full_name),
      }))

  return (
    <div className="flex-1 overflow-y-auto no-scrollbar">
      <div className="product-home-top">
        <Logo />
        <button
          type="button"
          onClick={() => navigate('/profile')}
          aria-label={t('nav.profile')}
        >
          <User size={18} strokeWidth={1.6} />
        </button>
      </div>
      <div className="product-home-content">
        {error && (
          <p role="alert" className="mb-3 text-sm text-alert">
            {error}
          </p>
        )}
        <div className="product-home-greeting">
          <h1>
            {t('home.greeting', { name: account?.firstName ?? (isDemo ? user.firstName : 'there') })}
          </h1>
          <p>{t('home.subtitle')}</p>
        </div>
        <section className="product-send-card">
          <button type="button" onClick={() => navigate('/send')}>
            <span>
              <strong>{t('home.sendMoney')}</strong>
              <small>{t('home.sendMoneySub')}</small>
            </span>
            <span className="product-send-arrow">
              <ArrowUpRight size={21} />
            </span>
          </button>
          {isDemo ? <div className="product-services">
            {services.map(({ key, icon: Icon, method }) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setDeliveryMethod(method)
                  navigate('/send')
                }}
              >
                <Icon size={22} strokeWidth={1.5} />
                <span>{t(key)}</span>
              </button>
            ))}
          </div> : <p className="px-4 pb-4 text-[12px] text-ink-500">Test transfers only. Bank, wallet, cash pickup and airtime delivery are unavailable.</p>}
        </section>

        {/* Recent transaction */}
        <section className="product-home-section card p-4">
          <SectionTitle
            title={t('home.recentTransaction')}
            action={t('common.viewAll')}
            onAction={() => navigate('/activity')}
          />
          {latest && latestRecipient ? (
            <button
              type="button"
              onClick={() => navigate('/activity')}
              className="flex w-full items-center gap-3 text-start"
            >
              <Avatar name={latestRecipient.name} hue={latestRecipient.hue} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-bold text-ink-900">
                  {latestRecipient.name}
                </span>
                <span className="block text-[12px] text-ink-500">
                  {formatDate(latest.date)}
                </span>
              </span>
              <span className="text-end">
                <span className="block text-[14px] font-semibold text-ink-900">
                  <bdi>{usd(latest.amountUsd)}</bdi>
                </span>
                <span
                  className={`flex items-center justify-end gap-1.5 text-[12px] font-semibold ${
                    latest.status === 'completed'
                      ? 'text-brand-700'
                      : 'text-ink-500'
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      latest.status === 'completed' ? 'bg-ok' : 'bg-wait'
                    }`}
                    aria-hidden="true"
                  />
                  {isDemo ? t(latest.status === 'completed' ? 'common.completed' : 'common.pending') : latest.status.replaceAll('_', ' ')}
                </span>
              </span>
            </button>
          ) : (
            <p className="text-[13px] text-ink-500">
              {t('home.noTransactions')}
            </p>
          )}
        </section>

        {/* Recipients */}
        <section className="product-home-section card p-4">
          <SectionTitle
            title={t('home.recipients')}
            action={t('common.viewAll')}
            onAction={() => navigate('/recipients')}
          />
          {favourites.length === 0 && (
            <button
              className="text-sm text-ink-500"
              onClick={() => navigate('/recipients')}
            >
              {t('recipients.add')}
            </button>
          )}
          <ul className="space-y-1">
            {favourites.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => {
                    setRecipientId(r.id)
                    navigate('/send')
                  }}
                  className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-xl px-2 py-1.5 text-start transition hover:bg-brand-50/70"
                >
                  <Avatar name={r.name} hue={r.hue} size={40} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-bold text-ink-900">
                      {r.name}
                    </span>
                    <span className="block text-[12px] text-ink-500">
                      <bdi>{r.phone}</bdi>
                    </span>
                  </span>
                  <ChevronRight
                    size={17}
                    className={`text-ink-500 ${mirror}`}
                  />
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section
          className="product-home-tools"
          aria-label={t('home.quickActions')}
        >
          {quickActions.filter(({ to }) => isDemo || ['/help', '/support'].includes(to)).map(({ titleKey, icon: Icon, to }) => (
            <button key={titleKey} type="button" onClick={() => navigate(to)}>
              <Icon size={17} strokeWidth={1.6} />
              <span>{t(titleKey)}</span>
            </button>
          ))}
        </section>

        {isDemo && <p className="mt-6 text-center text-[11px] leading-relaxed text-ink-500">
          <bdi>
            1 USD = {rate(corridor.rate)} {corridor.currency}
          </bdi>
        </p>}
      </div>
    </div>
  )
}
