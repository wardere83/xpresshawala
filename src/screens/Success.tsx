import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Clock, Copy, Share2 } from 'lucide-react'
import { PrimaryButton, SummaryRow, Toast } from '../components/ui'
import { useI18n } from '../i18n'
import { useTransfer } from '../state/TransferContext'
import { formatDateTime, maskedWallet, usd } from '../lib/format'

const CONFETTI = [
  { left: '12%', delay: '0s', hue: 45 },
  { left: '22%', delay: '0.35s', hue: 200 },
  { left: '34%', delay: '0.1s', hue: 340 },
  { left: '46%', delay: '0.5s', hue: 150 },
  { left: '58%', delay: '0.2s', hue: 275 },
  { left: '70%', delay: '0.45s', hue: 20 },
  { left: '82%', delay: '0.05s', hue: 190 },
  { left: '90%', delay: '0.3s', hue: 90 },
]

export function Success() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const { lastReceipt, reset } = useTransfer()
  const lastTransaction = lastReceipt?.transaction
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    if (!lastTransaction) navigate('/app', { replace: true })
  }, [lastTransaction, navigate])

  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(null), 1600)
    return () => window.clearTimeout(id)
  }, [toast])

  if (!lastTransaction) return null
  const { recipient, quote, isDemo } = lastReceipt!
  const title = isDemo ? t('success.title') : 'Test transfer recorded'
  const subtitle = isDemo ? t('success.subtitle', { amount: usd(quote.recipientUsd), name: recipient.name })
    : `Pending review for ${recipient.name}. No money has been delivered.`

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setToast(t('success.copied'))
    } catch {
      setToast(value)
    }
  }

  const share = async () => {
    const text = `${subtitle} · ${lastTransaction.reference}`
    if (navigator.share) {
      try {
        await navigator.share({ title, text })
        return
      } catch {
        /* user dismissed the share sheet */
      }
    }
    void copy(text)
  }

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden bg-[radial-gradient(120%_100%_at_50%_0%,#18313B_0%,#0B252F_70%,#0B252F_100%)]">
      {/* Confetti */}
      {isDemo && <div className="pointer-events-none absolute inset-x-0 top-0 h-64 overflow-hidden" aria-hidden="true">
        {CONFETTI.map((c, i) => (
          <span
            key={i}
            className="absolute top-0 h-2.5 w-1.5 rounded-[2px]"
            style={{
              left: c.left,
              background: c.hue % 2 === 0 ? 'var(--color-xt-turquoise)' : 'var(--color-xt-pale)',
              animation: `confetti-fall 2.6s ease-in ${c.delay} infinite`,
            }}
          />
        ))}
      </div>}

      <div className="relative flex-1 overflow-y-auto no-scrollbar px-5 pt-6 pb-8">
        <div className="flex flex-col items-center text-center">
          <span className="animate-pop-in grid h-20 w-20 place-items-center rounded-full bg-xt-turquoise shadow-[0_12px_36px_-8px_rgba(75,209,211,0.8)]">
            {isDemo ? <Check size={40} strokeWidth={3.4} className="text-xt-navy" /> : <Clock size={40} strokeWidth={2} className="text-xt-navy" />}
          </span>
          <h1 className="mt-5 text-[26px] font-semibold text-white">{title}</h1>
          <p className="mt-2 text-[13.5px] text-white/75">
            {subtitle}
          </p>
          <p className="mt-2 flex items-center gap-1.5 text-[12px] font-semibold text-white/60">
            <bdi>{maskedWallet(recipient.wallet, recipient.last4)}</bdi>
          </p>
        </div>

        {/* Receipt */}
        <section className="mt-6 rounded-[var(--radius-card)] bg-white p-4">
          <button
            type="button"
            onClick={() => copy(lastTransaction.reference)}
            className="flex w-full items-center justify-between gap-3 py-2 text-start"
          >
            <span className="text-[13px] text-ink-500">{t('field.referenceId')}</span>
            <span className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-900">
              <bdi>{lastTransaction.reference}</bdi>
              <Copy size={13} className="text-ink-500" />
            </span>
          </button>
          <SummaryRow label={t('field.dateTime')} value={formatDateTime(lastTransaction.date)} />
          <div className="my-1 border-t border-ink-200/70" />
          <SummaryRow label={isDemo ? t('success.youSent') : 'Test amount'} value={usd(quote.amountUsd)} />
          <SummaryRow label={t('field.fee')} value={usd(quote.fee)} />
          <SummaryRow label={t('field.total')} value={usd(quote.totalUsd)} strong />
          <SummaryRow label={isDemo ? t('field.recipientGets') : 'Money delivered'} value={isDemo ? usd(quote.recipientUsd) : 'None — test mode'} strong />
          <SummaryRow label={t('field.delivery')} value={isDemo ? 'Demo simulation' : 'Pending compliance review'} />
        </section>

        <div className="mt-5 space-y-3">
          <button
            type="button"
            onClick={share}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-white py-3.5 text-[14px] font-bold text-ink-900 transition active:scale-[0.99]"
          >
            {t('success.share')}
            <Share2 size={16} />
          </button>
          <button
            type="button"
            onClick={() => {
              reset()
              navigate('/send')
            }}
            className="w-full rounded-xl bg-white py-3.5 text-[14px] font-bold text-brand-600 transition active:scale-[0.99]"
          >
            {t('success.sendAnother')}
          </button>
          <PrimaryButton
            onClick={() => {
              reset()
              navigate('/app')
            }}
          >
            {t('common.done')}
          </PrimaryButton>
        </div>
      </div>

      {toast && <Toast message={toast} />}
    </div>
  )
}
