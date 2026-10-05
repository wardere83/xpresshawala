import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { App as CapApp } from '@capacitor/app'
import { BiometricAuth } from '@aparajita/capacitor-biometric-auth'
import { Lock } from 'lucide-react'
import { useT } from '../i18n'
import { Logo } from '../components/Logo'
import { hideSplash, isNative } from './capabilities'

/**
 * Biometric gate for the native apps.
 *
 * A remittance app shows balances, recipient names and transfer history, so a
 * borrowed or stolen phone should not open it just because a session cookie is
 * still valid. Mount this gate on the authenticated product layout, below the
 * account providers. The lock hides the product without discarding its state;
 * public sign-in, privacy and support routes remain accessible.
 *
 * It fails open rather than closed. A device with no enrolled biometry, or a
 * platform where the plugin is unavailable, is left unlocked. Locking someone
 * out of their own money because their phone has no fingerprint reader would be
 * a worse failure than the one this guards against.
 */

/** How long the app may sit in the background before it locks again. */
const RELOCK_AFTER_MS = 60_000

export function AppLock({ children }: { children: ReactNode }) {
  const t = useT()
  const [available, setAvailable] = useState(false)
  const [unlocked, setUnlocked] = useState(!isNative)
  const [checking, setChecking] = useState(isNative)
  const [authenticating, setAuthenticating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const backgroundedAt = useRef<number | null>(null)
  const authenticationPending = useRef(false)

  const authenticate = useCallback(async () => {
    if (authenticationPending.current) return
    authenticationPending.current = true
    setAuthenticating(true)
    setError(null)
    try {
      await BiometricAuth.authenticate({
        reason: t('lock.reason'),
        cancelTitle: t('common.cancel'),
        allowDeviceCredential: true,
        iosFallbackTitle: t('lock.usePasscode'),
        androidTitle: t('lock.title'),
        androidSubtitle: t('lock.reason'),
      })
      setUnlocked(true)
    } catch {
      // Cancelled or failed. Stay locked and let them try again.
      setError(t('lock.failed'))
    } finally {
      authenticationPending.current = false
      setAuthenticating(false)
    }
  }, [t])

  // `authenticate` is recreated whenever the language (and so `t`) changes.
  // The launch gate below must not re-run on that — switching language used to
  // summon a fresh Face ID prompt — so it reads the latest copy from a ref and
  // runs exactly once.
  const authenticateRef = useRef(authenticate)
  useEffect(() => {
    authenticateRef.current = authenticate
  }, [authenticate])

  useEffect(() => {
    if (!isNative) return
    // A cancelled biometric prompt must leave a visible lock and retry button,
    // even when the platform holds its launch splash until explicitly hidden.
    void hideSplash()
    let cancelled = false
    void (async () => {
      try {
        const info = await BiometricAuth.checkBiometry()
        // Hardware support alone does not mean the user has enrolled biometry.
        // A configured device passcode is also usable because authentication
        // explicitly permits device credentials as its fallback.
        const usable = info.isAvailable || info.deviceIsSecure
        if (cancelled) return
        setAvailable(usable)
        setChecking(false)
        if (usable) await authenticateRef.current()
        else setUnlocked(true)
      } catch {
        // Plugin unavailable: do not strand the user behind a lock we cannot open.
        if (cancelled) return
        setAvailable(false)
        setUnlocked(true)
        setChecking(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Re-lock after the app has been away long enough to change hands.
  useEffect(() => {
    if (!isNative || !available) return
    let disposed = false
    let remove: (() => void) | undefined
    void CapApp.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) {
        backgroundedAt.current = Date.now()
        return
      }
      const since = backgroundedAt.current
      backgroundedAt.current = null
      if (since && Date.now() - since > RELOCK_AFTER_MS) setUnlocked(false)
    }).then((handle) => {
      if (disposed) void handle.remove()
      else remove = () => void handle.remove()
    })
    return () => { disposed = true; remove?.() }
  }, [available])

  if (!isNative) return <>{children}</>

  const locked = !unlocked || checking

  return (
    <>
    <div hidden={locked} inert={locked} aria-hidden={locked || undefined}>
      {children}
    </div>
    {locked ? (
    <div role="dialog" aria-modal="true" aria-labelledby="app-lock-title"
      className="fixed inset-0 z-[100] grid min-h-dvh place-items-center overflow-y-auto bg-canvas px-6 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <div className="flex max-w-xs flex-col items-center text-center">
        <Logo height={36} />
        <span className="mt-8 grid h-14 w-14 place-items-center rounded-xl bg-brand-100 text-brand-700">
          <Lock size={22} />
        </span>
        <h1 id="app-lock-title" className="mt-5 text-[17px] font-semibold tracking-tight">{t('lock.title')}</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-500">{t('lock.reason')}</p>
        {error ? <p role="alert" className="mt-3 text-[13px] font-medium text-alert">{error}</p> : null}
        {!checking ? (
          <button
            type="button"
            disabled={authenticating}
            onClick={() => void authenticate()}
            className="mt-6 rounded-full bg-brand-600 px-6 py-3 text-[14px] font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
          >
            {t('lock.unlock')}
          </button>
        ) : null}
      </div>
    </div>
    ) : null}
    </>
  )
}
