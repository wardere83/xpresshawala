import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Mic, Sparkles, X } from 'lucide-react'
import { LanguageSwitcher } from '../components/LanguageSwitcher'
import { Waveform } from '../components/ui'
import { useT } from '../i18n'
import type { TranslationKey } from '../i18n/en'
import { useAuth } from '../auth/AuthContext'
import { Unavailable } from './Unavailable'

const LISTEN_SECONDS = 20

const samples: { key: TranslationKey; intent: string }[] = [
  { key: 'voice.sample1', intent: 'send' },
  { key: 'voice.sample2', intent: 'history' },
  { key: 'voice.sample3', intent: 'add' },
  { key: 'voice.sample4', intent: 'rate' },
]

export function Voice() {
  const { isDemo } = useAuth()
  return isDemo ? <DemoVoice /> : <Unavailable title="Voice commands" message="Voice recognition is not available for customer accounts. Use the transfer form to create a test record; no audio is recorded." to="/send" action="Open test transfer form" />
}

function DemoVoice() {
  const t = useT()
  const navigate = useNavigate()
  const [listening, setListening] = useState(true)
  const [seconds, setSeconds] = useState(LISTEN_SECONDS)

  useEffect(() => {
    if (!listening) return
    const id = window.setInterval(() => {
      setSeconds((s) => {
        if (s <= 1) {
          window.clearInterval(id)
          setListening(false)
          return 0
        }
        return s - 1
      })
    }, 1000)
    return () => window.clearInterval(id)
  }, [listening])

  const finish = (intent: string) => navigate('/assistant', { state: { intent } })

  return (
    <div className="flex flex-1 flex-col overflow-y-auto no-scrollbar">
      {/* Header */}
      <div className="flex items-start justify-between px-4 pt-1 pb-2">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="flex h-9 items-center gap-1 rounded-full px-2 text-[14px] font-semibold text-brand-600 transition hover:bg-brand-50"
        >
          <X size={20} strokeWidth={2.4} />
          <span className="sr-only">{t('common.close')}</span>
        </button>
        <div className="pt-1 text-center">
          <h1 className="text-[16px] font-bold text-ink-900">{t('voice.title')}</h1>
        </div>
        <LanguageSwitcher />
      </div>

      {/* Orb */}
      <div className="flex flex-1 flex-col items-center justify-center px-6">
        <div className="relative grid h-[220px] w-[220px] place-items-center">
          {listening && (
            <>
              <span
                className="absolute h-[190px] w-[190px] rounded-full bg-brand-500/20"
                style={{ animation: 'pulse-ring 2.4s ease-out infinite' }}
                aria-hidden="true"
              />
              <span
                className="absolute h-[190px] w-[190px] rounded-full bg-brand-500/15"
                style={{ animation: 'pulse-ring 2.4s ease-out 1.2s infinite' }}
                aria-hidden="true"
              />
            </>
          )}
          <span className="absolute h-[186px] w-[186px] rounded-full bg-brand-100/70" aria-hidden="true" />
          <span className="absolute h-[152px] w-[152px] rounded-full bg-brand-200/70" aria-hidden="true" />

          <button
            type="button"
            onClick={() => (listening ? setListening(false) : (setSeconds(LISTEN_SECONDS), setListening(true)))}
            aria-label={listening ? t('voice.stop') : t('voice.tapToStart')}
            className="relative grid h-[124px] w-[124px] place-items-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-[0_18px_40px_-12px_rgba(11,37,47,0.45)] transition active:scale-95"
          >
            {listening ? (
              <span className="px-6">
                <Waveform height={40} color="rgba(255,255,255,0.92)" />
              </span>
            ) : (
              <Mic size={44} strokeWidth={2} />
            )}
          </button>
        </div>

        <h2 className="mt-8 text-[22px] font-semibold text-ink-900">
          {listening ? t('voice.listening') : t('voice.tapToStart')}
        </h2>
        <p className="mt-1 text-[13px] text-ink-500">{t('voice.speakNow')}</p>

        {listening && (
          <div className="mt-6 flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={() => finish('send')}
              className="rounded-xl border border-ink-200 bg-white px-10 py-3 text-[15px] font-bold text-brand-600 shadow-[var(--shadow-card)] transition active:scale-[0.98] hover:bg-brand-50"
            >
              {t('voice.stop')}
            </button>
            <span className="text-[12px] text-ink-500">
              {t('voice.secondsLeft', { seconds })}
            </span>
          </div>
        )}
      </div>

      {/* Samples */}
      <div className="px-6 pb-6">
        <p className="mb-3 text-[13px] font-semibold text-ink-500">{t('voice.trySaying')}</p>
        <div className="flex flex-col items-start gap-2">
          {samples.map(({ key, intent }) => (
            <button
              key={key}
              type="button"
              onClick={() => finish(intent)}
              className="rounded-xl bg-white px-4 py-2.5 text-[13px] font-medium text-ink-700 shadow-[var(--shadow-card)] transition active:scale-[0.98] hover:text-brand-700"
            >
              “{t(key)}”
            </button>
          ))}
        </div>

        <p className="mt-6 flex items-center justify-center gap-1.5 text-[12px] font-semibold text-ink-500">
          <Sparkles size={14} className="text-brand-600" />
          Scripted demo — no audio is recorded
        </p>
      </div>
    </div>
  )
}
