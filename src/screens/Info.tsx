import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ChevronDown,
  Copy,
  Gift,
  Headphones,
  Mail,
  MessageCircleMore,
  Phone,
  TrendingUp,
} from 'lucide-react'
import { PrimaryButton, ScreenHeader, SecondaryButton, Toast } from '../components/ui'
import { brand } from '../config/brand'
import { useI18n } from '../i18n'
import { corridorName, corridors, TRANSFER_FEE, user } from '../data/mock'
import { rate as fmtRate, usd } from '../lib/format'
import type { TranslationKey } from '../i18n/en'
import { useAuth } from '../auth/AuthContext'
import { Unavailable } from './Unavailable'

/* ------------------------------------------------------------------ */
/* Live rates                                                          */
/* ------------------------------------------------------------------ */

export function Rates() {
  const { isDemo } = useAuth()
  return isDemo ? <DemoRates /> : <Unavailable title="Transfer pricing" message="Live customer exchange and delivery services are unavailable. The test transfer form requests a current server quote for supported test destinations." to="/send" action="Open test quote form" />
}

function DemoRates() {
  const { t, lang } = useI18n()
  const navigate = useNavigate()

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <ScreenHeader title={t('rates.title')} onBack={() => navigate(-1)} />
      <div className="flex-1 overflow-y-auto no-scrollbar px-4 pb-6">
        <div className="flex items-center gap-2 rounded-xl bg-brand-50 px-4 py-3">
          <TrendingUp size={16} className="text-brand-600" />
          <p className="text-[12px] font-semibold text-brand-700">Sample rates and fees for the product demonstration.</p>
        </div>

        <ul className="card mt-4 divide-y divide-ink-200/60 overflow-hidden">
          {corridors.map((c) => (
            <li key={c.code} className="flex items-center gap-3 px-4 py-3.5">
              <span className="text-[22px]" aria-hidden="true">
                {c.flag}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-bold text-ink-900">
                  {corridorName(c, lang)}
                </span>
                <span className="block text-[11.5px] text-ink-500">
                  {t('rates.feeFrom', { fee: usd(TRANSFER_FEE) })}
                </span>
              </span>
              {/* Dollars in, dollars out. "1 : 1" needs no translation and is
                  the honest value; the old column printed a conversion that no
                  longer happens. */}
              <span className="text-end">
                <span className="block text-[14px] font-semibold tabular-nums text-ink-900">
                  {c.currency === 'USD' ? '1 : 1' : <bdi>{fmtRate(c.rate)}</bdi>}
                </span>
                <span className="block text-[11px] text-ink-500">
                  {c.currency === 'USD' ? (
                    <bdi>USD</bdi>
                  ) : (
                    <>
                      <bdi>{c.currency}</bdi> {t('rates.perUsd')}
                    </>
                  )}
                </span>
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-5">
          <PrimaryButton onClick={() => navigate('/send')}>{t('home.sendMoney')}</PrimaryButton>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Help centre                                                         */
/* ------------------------------------------------------------------ */

const faqs: { q: TranslationKey; a: TranslationKey }[] = [
  { q: 'help.q1', a: 'help.a1' },
  { q: 'help.q2', a: 'help.a2' },
  { q: 'help.q3', a: 'help.a3' },
  { q: 'help.q4', a: 'help.a4' },
  { q: 'help.q5', a: 'help.a5' },
]

export function Help() {
  const { isDemo } = useAuth()
  return isDemo ? <DemoHelp /> : <AccountHelp />
}

function AccountHelp() {
  const navigate = useNavigate()
  return <div className="flex flex-1 flex-col overflow-hidden">
    <ScreenHeader title="Account help" onBack={() => navigate(-1)} />
    <div className="flex-1 overflow-y-auto px-4 pb-6">
      <section className="card space-y-4 p-4 text-[13px] leading-relaxed text-ink-700">
        <div><h2 className="font-bold">Can I send real money?</h2><p>Customer money movement is unavailable. Test transfers do not charge a bank or card and do not deliver funds.</p></div>
        <div><h2 className="font-bold">Where are my recipients and transfer records?</h2><p>Your account shows only your saved recipients and API transfer records. If loading fails, retry instead of relying on sample data.</p></div>
        <div><h2 className="font-bold">How do I recover or delete my account?</h2><p>Use Password recovery or Delete account in Profile. Required financial records may be retained under the privacy policy.</p></div>
      </section>
      <div className="mt-5"><PrimaryButton onClick={() => navigate('/support')}>Contact support</PrimaryButton></div>
    </div>
  </div>
}

function DemoHelp() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [open, setOpen] = useState<number | null>(0)

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <ScreenHeader title={t('help.title')} onBack={() => navigate(-1)} />
      <div className="flex-1 overflow-y-auto no-scrollbar px-4 pb-6">
        <p className="text-[13px] text-ink-500">{t('help.subtitle')}</p>

        <ul className="card mt-4 divide-y divide-ink-200/60 overflow-hidden">
          {faqs.map((f, i) => {
            const isOpen = open === i
            return (
              <li key={f.q}>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center gap-3 px-4 py-3.5 text-start"
                >
                  <span className="flex-1 text-[13.5px] font-semibold text-ink-900">{t(f.q)}</span>
                  <ChevronDown
                    size={17}
                    className={`shrink-0 text-ink-500 transition ${isOpen ? 'rotate-180' : ''}`}
                  />
                </button>
                {isOpen && (
                  <p className="animate-fade-up px-4 pb-4 text-[12.5px] leading-relaxed text-ink-500">
                    {t(f.a, { fee: usd(TRANSFER_FEE) })}
                  </p>
                )}
              </li>
            )
          })}
        </ul>

        <div className="mt-5 space-y-3">
          <PrimaryButton onClick={() => navigate('/assistant')}>{t('quick.help')}</PrimaryButton>
          <SecondaryButton onClick={() => navigate('/support')}>{t('help.contact')}</SecondaryButton>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Refer & earn                                                        */
/* ------------------------------------------------------------------ */

export function Refer() {
  const { isDemo } = useAuth()
  return isDemo ? <DemoRefer /> : <Unavailable title="Referrals" message="The referral rewards program is not available for customer accounts. No referral earnings or redeemable referral code have been issued." />
}

function DemoRefer() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [toast, setToast] = useState<string | null>(null)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(user.referralCode)
      setToast(t('success.copied'))
    } catch {
      setToast(user.referralCode)
    }
    window.setTimeout(() => setToast(null), 1600)
  }

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      <ScreenHeader title={t('refer.title')} onBack={() => navigate(-1)} />
      <div className="flex-1 overflow-y-auto no-scrollbar px-4 pb-6">
        <section className="rounded-[var(--radius-card)] bg-gradient-to-br from-brand-600 to-brand-800 p-6 text-center text-white shadow-[var(--shadow-float)]">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-xl bg-white/15">
            <Gift size={26} />
          </span>
          <p className="mt-4 text-[14px] leading-relaxed text-white/85">Sample referral program — this code and these earnings are demonstration data.</p>
          <p className="mt-5 text-[11px] font-bold tracking-[0.18em] text-white/60 uppercase">
            {t('refer.yourCode')}
          </p>
          <p className="mt-1 text-[24px] font-semibold tracking-wide">
            <bdi>{user.referralCode}</bdi>
          </p>
        </section>

        <div className="card mt-4 flex items-center justify-between px-4 py-3.5">
          <span className="text-[13px] text-ink-500">{t('refer.earned')}</span>
          <span className="text-[16px] font-semibold text-brand-700">
            <bdi>{usd(user.referralEarned)}</bdi>
          </span>
        </div>

        <div className="mt-5 space-y-3">
          <PrimaryButton onClick={copy}>
            <span className="flex items-center justify-center gap-2">
              <Copy size={16} />
              {t('refer.copy')}
            </span>
          </PrimaryButton>
          <SecondaryButton onClick={() => navigate('/recipients')}>{t('refer.invite')}</SecondaryButton>
        </div>
      </div>
      {toast && <Toast message={toast} />}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Live support                                                        */
/* ------------------------------------------------------------------ */

export function Support() {
  const { isDemo } = useAuth()
  const { t } = useI18n()
  const navigate = useNavigate()

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <ScreenHeader title={t('support.title')} onBack={() => navigate(-1)} />
      <div className="flex-1 overflow-y-auto no-scrollbar px-4 pb-6">
        <div className="flex items-center gap-3 rounded-xl bg-brand-50 px-4 py-3.5">
          <Headphones size={18} className="text-brand-600" />
          <p className="text-[12.5px] font-semibold text-brand-700">{isDemo ? 'Product demonstration. Use the contacts below for real account support.' : 'Use the email or phone contact below for account support.'}</p>
        </div>

        <div className="card mt-4 divide-y divide-ink-200/60 overflow-hidden">
          {isDemo && <button
            type="button"
            onClick={() => navigate('/assistant')}
            className="flex w-full items-center gap-3 px-4 py-4 text-start transition hover:bg-brand-50/70"
          >
            <MessageCircleMore size={19} className="text-brand-600" />
            <span className="text-[14px] font-semibold text-ink-900">Open the demo assistant</span>
          </button>}
          <a
            href={`tel:${brand.support.phone.replace(/[^\d+]/g, '')}`}
            className="flex w-full items-center gap-3 px-4 py-4 text-start transition hover:bg-brand-50/70"
          >
            <Phone size={19} className="text-brand-600" />
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-semibold text-ink-900">{t('support.call')}</span>
              <span className="block text-[12px] text-ink-500">
                <bdi>{brand.support.phone}</bdi>
              </span>
            </span>
          </a>
          <a
            href={`mailto:${brand.support.email}`}
            className="flex w-full items-center gap-3 px-4 py-4 text-start transition hover:bg-brand-50/70"
          >
            <Mail size={19} className="text-brand-600" />
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-semibold text-ink-900">
                {t('support.email')}
              </span>
              <span className="block text-[12px] text-ink-500">
                <bdi>{brand.support.email}</bdi>
              </span>
            </span>
          </a>
        </div>

        <p className="mt-6 text-center text-[11.5px] leading-relaxed text-ink-500">
          <bdi>
            {brand.name}
          </bdi>
          <br />
          {brand.hq.city}, {brand.hq.state}, {brand.hq.country}
          <br />
          {brand.legal.licence}
        </p>
      </div>
    </div>
  )
}
