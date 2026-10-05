import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Apple, ArrowDownUp, Check, ChevronRight, Lock, CreditCard, Landmark } from 'lucide-react'
import { ScreenHeader, Avatar, PrimaryButton } from '../components/ui'
import { useI18n, useMirrorClass } from '../i18n'
import { useTransfer } from '../state/TransferContext'
import { useAuth } from '../auth/AuthContext'
import { useAccountData } from '../state/AccountData'
import { hueFor } from '../lib/view'
import { paymentMethods, recipients, relationName, user, TRANSFER_FEE } from '../data/mock'
import { amount as fmtAmount, rate as fmtRate, usd } from '../lib/format'
import type { TranslationKey } from '../i18n/en'

export function SendMoney() {
  const { isDemo } = useAuth()
  const { recipients: mine, loading, error: accountError } = useAccountData()
  const { t, lang } = useI18n()
  const mirror = useMirrorClass()
  const navigate = useNavigate()
  const {
    recipient,
    setRecipientId,
    corridor,
    quote,
    amountUsd,
    setAmountUsd,
    paymentMethod,
    setPaymentMethod,
    availableError,
    quoteReady,
    quoteLoading,
  } = useTransfer()

  const [raw, setRaw] = useState(String(amountUsd))
  const [pickerOpen, setPickerOpen] = useState(false)

  const parsed = Number(raw.replace(/[^0-9.]/g, '')) || 0
  const tooLow = isDemo ? parsed <= TRANSFER_FEE : parsed <= 0 || !/^\d+(?:\.\d{0,2})?$/.test(raw)
  const tooHigh = isDemo && quote.totalUsd > user.balanceUsd
  const error = tooLow ? (isDemo ? t('send.amountTooLow', { fee: usd(TRANSFER_FEE) }) : 'Enter a positive amount with up to two decimal places.')
    : tooHigh ? t('send.amountTooHigh') : availableError
  const pickerRecipients = isDemo ? recipients : mine.map((r) => ({
    id: r.id, name: r.full_name, phone: r.phone ?? '', wallet: r.bank_name ?? r.payout_method.replaceAll('_', ' '),
    corridorCode: r.country, last4: r.phone?.slice(-4) ?? '', favourite: false,
    relation: r.relationship ?? r.country, relationI18n: {}, hue: hueFor(r.full_name),
  }))

  const onAmountChange = (value: string) => {
    const cleaned = value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1')
    setRaw(cleaned)
    setAmountUsd(Number(cleaned) || 0)
  }

  if (!isDemo && mine.length === 0) return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <ScreenHeader title={t('send.title')} onBack={() => navigate(-1)} />
      <div className="px-4 py-6">
        <p role={accountError ? 'alert' : undefined} className="mb-4 text-[14px] text-ink-700">
          {loading ? 'Loading your recipients…' : accountError ?? 'Add a recipient before creating a test transfer.'}
        </p>
        {!loading && <PrimaryButton onClick={() => navigate('/recipients')}>{t('recipients.add')}</PrimaryButton>}
      </div>
    </div>
  )

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <ScreenHeader title={t('send.title')} onBack={() => navigate(-1)} />

      <div className="flex-1 overflow-y-auto no-scrollbar px-4 pb-6">
        {/* Recipient */}
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="card flex w-full items-center gap-3 p-3.5 text-start transition active:scale-[0.99]"
        >
          <Avatar name={recipient.name} hue={recipient.hue} size={42} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-bold text-ink-900">{recipient.name}</span>
            <span className="block truncate text-[12px] text-ink-500">
              <bdi>{recipient.phone}</bdi> · <bdi>{recipient.wallet}</bdi>
            </span>
          </span>
          <span className="text-[12px] font-semibold text-brand-600">{t('send.changeRecipient')}</span>
          <ChevronRight size={16} className={`text-ink-500 ${mirror}`} />
        </button>

        {/* From */}
        <p className="mt-5 mb-2 text-[13px] font-bold text-ink-700">{t('send.from')}</p>
        <div className="card p-4">
          <div className="flex items-center gap-2.5">
            <span className="text-[22px]" aria-hidden="true">
              🇺🇸
            </span>
            <span className="text-[13px] font-bold text-ink-700">
              <bdi>USD · US Dollar</bdi>
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-1" dir="ltr">
            <span className="text-[26px] font-semibold text-ink-900">$</span>
            <input
              value={raw}
              onChange={(e) => onAmountChange(e.target.value)}
              inputMode="decimal"
              aria-label={t('field.youSend')}
              className="w-full min-w-0 bg-transparent text-[30px] font-semibold tracking-tight text-ink-900 outline-none"
            />
          </div>
          <p className="mt-1 text-[12px] text-ink-500">
            {isDemo ? <>{t('field.availableBalance')} · <bdi>{usd(user.balanceUsd)}</bdi></> : 'Live wallet funding is unavailable. This is a test account.'}
          </p>
        </div>

        {/* Swap marker */}
        <div className="relative -my-2 flex justify-center">
          <span className="grid h-9 w-9 place-items-center rounded-full border-4 border-canvas bg-brand-600 text-white">
            <ArrowDownUp size={15} strokeWidth={2.4} />
          </span>
        </div>

        {/* To */}
        <p className="mt-3 mb-2 text-[13px] font-bold text-ink-700">{t('send.toGets')}</p>
        <div className="card p-4">
          <div className="flex items-center gap-2.5">
            <span className="text-[22px]" aria-hidden="true">
              {corridor.flag}
            </span>
            <span className="text-[13px] font-bold text-ink-700">
              <bdi>
                {corridor.currency ? <>{corridor.currency} · {corridor.currencyName}</> : 'Choose a recipient for a test quote'}
              </bdi>
            </span>
          </div>
          <p className="mt-2 text-[30px] font-semibold tracking-tight text-ink-900">
            <bdi>{quoteReady ? fmtAmount(quote.recipientLocal) : '—'}</bdi>
          </p>
          <p className="mt-1 text-[12px] text-ink-500">{t('field.estimated')}</p>
        </div>

        {/* Corridors pay out in the currency they are funded in, so there is
            no exchange rate to show. Printing "1 USD = 1 USD" would look like
            a bug. The row returns on its own if an FX corridor is ever added. */}
        {quoteReady && corridor.currency !== 'USD' ? (
          <div className="mt-3 flex items-center justify-between rounded-xl bg-brand-50 px-4 py-3">
            <span className="text-[12px] font-semibold text-brand-700">{t('field.exchangeRate')}</span>
            <span className="text-[12px] font-bold text-brand-700">
              <bdi>
                1 USD = {fmtRate(corridor.rate)} {corridor.currency}
              </bdi>
            </span>
          </div>
        ) : null}

        {error && (
          <p className="mt-3 rounded-xl bg-alert-soft px-4 py-3 text-[12px] font-semibold text-alert">
            {error}
          </p>
        )}

        {/* Payment method */}
        <p className="mt-6 mb-2 text-[13px] font-bold text-ink-700">{t('field.paymentMethod')}</p>
        <div className="card overflow-hidden">
          {!isDemo ? <p className="px-4 py-4 text-[13px] text-ink-700">Test funding — no bank or card is charged. Bank and wallet connections are unavailable.</p> : paymentMethods.map((m, i) => {
            const selected = paymentMethod === m.id
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setPaymentMethod(m.id)}
                aria-pressed={selected}
                className={`flex w-full items-center gap-3 px-4 py-3.5 text-start transition ${
                  i > 0 ? 'border-t border-ink-200/60' : ''
                } ${selected ? 'bg-brand-50/70' : 'hover:bg-brand-600/[0.02]'}`}
              >
                <span
                  className={`grid h-9 w-11 shrink-0 place-items-center rounded-lg text-[10px] font-bold ${
                    selected ? 'bg-brand-100 text-brand-700' : 'bg-canvas text-ink-500'
                  }`}
                >
                  <PaymentGlyph id={m.id} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-semibold text-ink-900">
                    {t(m.labelKey as TranslationKey)}
                  </span>
                  {m.detail && (
                    <span className="block text-[12px] text-ink-500">
                      <bdi>{m.detail}</bdi>
                    </span>
                  )}
                </span>
                <span
                  className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 ${
                    selected ? 'border-brand-600 bg-brand-600' : 'border-ink-200'
                  }`}
                >
                  {selected && <Check size={12} strokeWidth={4} className="text-white" />}
                </span>
              </button>
            )
          })}
        </div>

        <div className="mt-6">
          <PrimaryButton disabled={!!error || !quoteReady} onClick={() => navigate('/review')}>
            {quoteLoading ? 'Getting a test quote…' : t('common.continue')}
          </PrimaryButton>
          <p className="mt-3 flex items-center justify-center gap-1.5 text-[11px] font-semibold text-ink-500">
            <Lock size={12} />
            {t('common.secure')}
          </p>
        </div>
      </div>

      {/* Recipient picker */}
      {pickerOpen && (
        <div className="absolute inset-0 z-40 flex flex-col justify-end">
          <button
            type="button"
            aria-label={t('common.close')}
            onClick={() => setPickerOpen(false)}
            className="absolute inset-0 bg-brand-600/40"
          />
          <div className="animate-fade-up relative max-h-[70%] overflow-y-auto no-scrollbar rounded-t-[28px] bg-white pb-6">
            <div className="sticky top-0 bg-white px-4 pt-4 pb-2">
              <span className="mx-auto mb-3 block h-1 w-10 rounded-full bg-ink-200" />
              <h2 className="text-[15px] font-bold text-ink-900">{t('send.chooseRecipient')}</h2>
            </div>
            <ul>
              {pickerRecipients.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setRecipientId(r.id)
                      setPickerOpen(false)
                    }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-start transition hover:bg-brand-50/70"
                  >
                    <Avatar name={r.name} hue={r.hue} size={40} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-semibold text-ink-900">
                        {r.name}
                      </span>
                      <span className="block truncate text-[12px] text-ink-500">
                        {relationName(r, lang)} · <bdi>{r.phone}</bdi>
                      </span>
                    </span>
                    {r.id === recipient.id && <Check size={16} className="text-brand-600" strokeWidth={3} />}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}

function PaymentGlyph({ id }: { id: string }) {
  if (id === 'bank') return <Landmark size={17} strokeWidth={2} />
  if (id === 'debit') return <CreditCard size={17} strokeWidth={2} />
  if (id === 'apple')
    return (
      <span className="flex items-center gap-0.5 text-[10px] font-bold">
        <Apple size={12} className="fill-current" />
        Pay
      </span>
    )
  return <span className="text-[10px] font-bold">G Pay</span>
}
