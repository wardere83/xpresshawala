import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ChevronLeft, Mic, MoreVertical, Send, Sparkles } from 'lucide-react'
import { Avatar } from '../components/ui'
import { useI18n, useMirrorClass } from '../i18n'
import { useTransfer } from '../state/TransferContext'
import { maskedWallet, rate as fmtRate, usd } from '../lib/format'
import { corridorName } from '../data/mock'
import { useAuth } from '../auth/AuthContext'
import { Unavailable } from './Unavailable'

type Message = {
  id: number
  from: 'user' | 'bot'
  kind: 'text' | 'quote' | 'actions'
  text?: string
  time: string
}

const SCRIPT_TIME = '9:41 AM'

function liveTime() {
  return new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export function Assistant() {
  const { isDemo } = useAuth()
  return isDemo ? <DemoAssistant /> : <Unavailable title="Account help" message="The conversational assistant is a product demonstration and does not manage customer accounts. Contact support for account help." to="/support" action="Contact support" />
}

function DemoAssistant() {
  const { t, lang } = useI18n()
  const mirror = useMirrorClass()
  const navigate = useNavigate()
  const location = useLocation()
  const intent = (location.state as { intent?: string } | null)?.intent
  const { recipient, corridor, quote, setAmountUsd } = useTransfer()

  const [messages, setMessages] = useState<Message[]>([])
  const [typing, setTyping] = useState(false)
  const [draft, setDraft] = useState('')
  const idRef = useRef(0)
  const timers = useRef<number[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)

  const nextId = () => ++idRef.current

  const push = (msg: Omit<Message, 'id'>) =>
    setMessages((prev) => [...prev, { ...msg, id: nextId() }])

  const schedule = (fn: () => void, delay: number) => {
    timers.current.push(window.setTimeout(fn, delay))
  }

  // Reset and replay whenever the intent or language changes.
  useEffect(() => {
    timers.current.forEach(window.clearTimeout)
    timers.current = []
    setMessages([])
    setTyping(false)

    if (intent === 'send') {
      setAmountUsd(500)
      push({ from: 'user', kind: 'text', text: t('chat.userSend500'), time: SCRIPT_TIME })
      setTyping(true)
      schedule(() => {
        setTyping(false)
        push({
          from: 'bot',
          kind: 'text',
          time: SCRIPT_TIME,
          text: t('chat.botConfirmIntro', {
            amount: usd(500),
            name: recipient.name,
            last4: recipient.last4,
          }),
        })
      }, 900)
      schedule(() => push({ from: 'user', kind: 'text', text: t('common.yes'), time: SCRIPT_TIME }), 1700)
      schedule(() => push({ from: 'bot', kind: 'quote', time: SCRIPT_TIME }), 2300)
      schedule(
        () => push({ from: 'bot', kind: 'text', text: t('chat.looksGood'), time: SCRIPT_TIME }),
        2900,
      )
      schedule(() => push({ from: 'bot', kind: 'actions', time: SCRIPT_TIME }), 3200)
    } else if (intent === 'rate') {
      push({ from: 'user', kind: 'text', text: t('chat.rateQuestion'), time: SCRIPT_TIME })
      setTyping(true)
      schedule(() => {
        setTyping(false)
        push({
          from: 'bot',
          kind: 'text',
          time: SCRIPT_TIME,
          text: t('chat.rateAnswer', { rate: fmtRate(corridor.rate) }),
        })
      }, 900)
    } else {
      push({ from: 'bot', kind: 'text', text: t('chat.greeting'), time: SCRIPT_TIME })
    }

    return () => {
      timers.current.forEach(window.clearTimeout)
      timers.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent, lang])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, typing])

  const suggestions = useMemo(
    () => [
      { label: t('chat.suggest.send'), reply: 'send' as const },
      { label: t('chat.suggest.rate'), reply: 'rate' as const },
    ],
    [t],
  )

  const answer = (text: string) => {
    const lower = text.toLowerCase()
    setTyping(true)
    schedule(() => {
      setTyping(false)
      if (/(rate|sarif|heerk|exchange)/.test(lower)) {
        push({
          from: 'bot',
          kind: 'text',
          time: liveTime(),
          text: t('chat.rateAnswer', { rate: fmtRate(corridor.rate) }),
        })
      } else if (/(send|dir|lacag|\$|money)/.test(lower)) {
        push({
          from: 'bot',
          kind: 'text',
          time: liveTime(),
          text: t('chat.botConfirmIntro', {
            amount: usd(quote.amountUsd),
            name: recipient.name,
            last4: recipient.last4,
          }),
        })
        schedule(() => push({ from: 'bot', kind: 'quote', time: liveTime() }), 500)
        schedule(() => push({ from: 'bot', kind: 'actions', time: liveTime() }), 800)
      } else {
        push({ from: 'bot', kind: 'text', time: liveTime(), text: t('chat.fallback') })
      }
    }, 800)
  }

  const submit = (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    push({ from: 'user', kind: 'text', text: trimmed, time: liveTime() })
    setDraft('')
    answer(trimmed)
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-canvas">
      <p className="px-4 py-2 text-[12px] text-ink-500">Scripted demo — these are sample conversations.</p>
      {/* Header */}
      <header className="flex shrink-0 items-center gap-2 border-b border-ink-200/60 bg-white px-3 py-2.5">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label={t('common.back')}
          className="grid h-9 w-9 place-items-center rounded-full text-ink-700 transition hover:bg-brand-600/5"
        >
          <ChevronLeft size={22} strokeWidth={2.2} className={mirror} />
        </button>
        <span className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700">
          <Sparkles size={16} className="text-white" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-bold text-ink-900">
            {t('chat.title')}
          </div>
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-brand-700">
            <span className="h-1.5 w-1.5 rounded-full bg-ok" />
            {t('common.online')}
          </div>
        </div>
        <button
          type="button"
          onClick={() => navigate('/help')}
          aria-label={t('quick.help')}
          className="grid h-9 w-9 place-items-center rounded-full text-ink-500 transition hover:bg-brand-600/5"
        >
          <MoreVertical size={18} />
        </button>
      </header>

      {/* Thread */}
      <div ref={scrollRef} className="flex-1 space-y-2.5 overflow-y-auto no-scrollbar px-3 py-4">
        {messages.map((m) => {
          if (m.kind === 'quote') {
            return (
              <div key={m.id} className="animate-fade-up card p-4">
                <h3 className="mb-2 text-[14px] font-bold text-ink-900">{t('chat.confirmDetails')}</h3>
                <dl className="divide-y divide-ink-200/70">
                  <QuoteRow
                    label={t('field.recipient')}
                    value={
                      <span className="flex items-center gap-1.5">
                        {recipient.name}
                        <Avatar name={recipient.name} hue={recipient.hue} size={20} />
                      </span>
                    }
                  />
                  <QuoteRow
                    label={t('field.mobileWallet')}
                    value={<bdi>{maskedWallet(recipient.wallet, recipient.last4)}</bdi>}
                  />
                  <QuoteRow
                    label={t('field.country')}
                    value={
                      <span className="flex items-center gap-1.5">
                        {corridorName(corridor, lang)}
                        <span aria-hidden="true">{corridor.flag}</span>
                      </span>
                    }
                  />
                  <QuoteRow label={t('field.youSend')} value={usd(quote.amountUsd)} />
                  <QuoteRow label={t('field.fee')} value={usd(quote.fee)} />
                  <QuoteRow label={t('field.recipientGets')} value={usd(quote.recipientUsd)} strong />
                  <QuoteRow label={t('field.delivery')} value={t('common.instant')} />
                </dl>
              </div>
            )
          }

          if (m.kind === 'actions') {
            return (
              <div key={m.id} className="animate-fade-up grid grid-cols-2 gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => navigate('/app')}
                  className="rounded-xl border border-brand-200 bg-white py-3.5 text-[14px] font-bold text-brand-600 transition hover:bg-brand-50"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/send')}
                  className="rounded-xl bg-brand-600 py-3.5 text-[14px] font-bold text-white shadow-[var(--shadow-float)] transition hover:bg-brand-700"
                >
                  {t('common.continue')}
                </button>
              </div>
            )
          }

          const mine = m.from === 'user'
          return (
            <div
              key={m.id}
              className={`animate-fade-up flex items-end gap-2 ${mine ? 'justify-end' : 'justify-start'}`}
            >
              {!mine && (
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700">
                  <Sparkles size={12} className="text-white" />
                </span>
              )}
              <div
                className={`max-w-[78%] rounded-xl px-3.5 py-2.5 text-[13px] leading-relaxed shadow-[var(--shadow-card)] ${
                  mine
                    ? 'rounded-ee-md bg-brand-600 text-white'
                    : 'rounded-es-md bg-white text-ink-900'
                }`}
              >
                <p>{m.text}</p>
                <p
                  className={`mt-1 text-end text-[10px] ${mine ? 'text-white/60' : 'text-ink-500'}`}
                >
                  <bdi>{m.time}</bdi>
                  {mine && ' ✓✓'}
                </p>
              </div>
            </div>
          )
        })}

        {typing && (
          <div className="flex items-end gap-2">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700">
              <Sparkles size={12} className="text-white" />
            </span>
            <div className="flex gap-1 rounded-xl rounded-es-md bg-white px-3.5 py-3 shadow-[var(--shadow-card)]">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="h-1.5 w-1.5 rounded-full bg-ink-400"
                  style={{ animation: `bar-bounce 1s ease-in-out ${i * 0.15}s infinite` }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t border-ink-200/60 bg-white px-3 py-2.5 pb-[max(env(safe-area-inset-bottom),10px)]">
        <div className="mb-2 flex gap-2">
          {suggestions.map((s) => (
            <button
              key={s.reply}
              type="button"
              onClick={() => submit(s.label)}
              className="rounded-full bg-brand-50 px-3 py-1.5 text-[12px] font-semibold text-brand-700 transition hover:bg-brand-100"
            >
              {s.label}
            </button>
          ))}
        </div>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            submit(draft)
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('chat.placeholder')}
            aria-label={t('chat.placeholder')}
            className="min-w-0 flex-1 rounded-full bg-canvas px-4 py-3 text-[13px] text-ink-900 outline-none placeholder:text-ink-500"
          />
          {draft.trim() ? (
            <button
              type="submit"
              aria-label={t('chat.suggest.send')}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand-600 text-white transition hover:bg-brand-700"
            >
              <Send size={18} className={mirror} />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => navigate('/voice')}
              aria-label={t('nav.speak')}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand-600 text-white transition hover:bg-brand-700"
            >
              <Mic size={18} />
            </button>
          )}
        </form>
      </div>
    </div>
  )
}

function QuoteRow({
  label,
  value,
  strong = false,
}: {
  label: string
  value: React.ReactNode
  strong?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <dt className="text-[12.5px] text-ink-500">{label}</dt>
      <dd
        className={`text-end text-[12.5px] text-ink-900 ${strong ? 'font-semibold' : 'font-semibold'}`}
      >
        <bdi>{value}</bdi>
      </dd>
    </div>
  )
}
