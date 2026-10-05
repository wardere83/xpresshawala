import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { App as CapApp } from '@capacitor/app'
import { Network } from '@capacitor/network'
import { useT } from '../i18n'
import { Logo } from '../components/Logo'
import { hideSplash, isNative, setStatusBarTint } from './capabilities'

/** Screens that paint a dark ground and need the status bar to match. */
const DARK_TINT_ROUTES = ['/success']

/* Both from the document palette: the canvas is border gray over white, and
   the success screen is primary navy. */
const LIGHT_TINT = '#F5F8F9'
const DARK_TINT = '#0B252F'

/**
 * Native behaviour that has no web equivalent: dismissing the launch splash
 * once React has painted, keeping the status bar in step with the screen,
 * making the Android back gesture behave like a back button rather than
 * quitting mid-transfer, and telling the sender when the network drops.
 *
 * Renders only the offline notice; everything else is side effects.
 */
export function NativeShell() {
  const location = useLocation()
  const navigate = useNavigate()
  const t = useT()
  const [offline, setOffline] = useState(false)
  /**
   * The launch reveal continues the native splash in the web layer: the same
   * wordmark, on the same white ground, breathes up a few percent and then
   * dissolves into the first screen. The static splash crossfades into this
   * overlay (200ms native fade), so launch reads as one continuous motion
   * instead of a hard cut from artwork to UI. 'hold' shows the mark at rest,
   * 'leave' plays the exit, 'done' unmounts the overlay entirely.
   */
  const [reveal, setReveal] = useState<'hold' | 'leave' | 'done'>(isNative ? 'hold' : 'done')

  // The splash is configured not to auto-hide, so the first paint is never a
  // white flash. Dismiss it once we are mounted and the UI is on screen.
  useEffect(() => {
    void hideSplash()
  }, [])

  useEffect(() => {
    if (!isNative) return
    const leave = window.setTimeout(() => setReveal('leave'), 500)
    const done = window.setTimeout(() => setReveal('done'), 1150)
    return () => {
      window.clearTimeout(leave)
      window.clearTimeout(done)
    }
  }, [])

  // Preserve pinch zoom for accessibility. The native stylesheet keeps small
  // form fields at 16px so focusing them does not trigger iOS input zoom.
  useEffect(() => {
    if (!isNative) return
    document.documentElement.classList.add('native')
    document
      .querySelector('meta[name="viewport"]')
      ?.setAttribute(
        'content',
        'width=device-width, initial-scale=1.0, viewport-fit=cover',
      )
  }, [])

  useEffect(() => {
    const dark = DARK_TINT_ROUTES.includes(location.pathname)
    void setStatusBarTint(dark ? DARK_TINT : LIGHT_TINT, dark ? 'dark' : 'light')
  }, [location.pathname])

  // Android hardware/gesture back. Without this the OS closes the app from any
  // screen, which mid-transfer reads as losing the money.
  useEffect(() => {
    if (!isNative) return
    let disposed = false
    let remove: (() => void) | undefined
    void CapApp.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack && location.pathname !== '/') {
        navigate(-1)
      } else {
        void CapApp.exitApp()
      }
    }).then((handle) => {
      if (disposed) void handle.remove()
      else remove = () => void handle.remove()
    })
    return () => { disposed = true; remove?.() }
  }, [location.pathname, navigate])

  useEffect(() => {
    let disposed = false
    let remove: (() => void) | undefined
    void Network.getStatus().then((status) => {
      if (!disposed) setOffline(!status.connected)
    }).catch(() => { /* A missing network plugin must not prevent launch. */ })
    void Network.addListener('networkStatusChange', (status) => {
      if (!disposed) setOffline(!status.connected)
    }).then((handle) => {
      if (disposed) void handle.remove()
      else remove = () => void handle.remove()
    }).catch(() => { /* Offline notices are best-effort when unsupported. */ })
    return () => { disposed = true; remove?.() }
  }, [])

  return (
    <>
      {reveal !== 'done' ? (
        <div
          aria-hidden="true"
          className={`launch-reveal text-ink-900 ${reveal === 'leave' ? 'launch-reveal--leave' : ''}`}
        >
          <Logo height={44} className="launch-reveal__mark" />
        </div>
      ) : null}
      {offline ? (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-x-0 top-0 z-50 bg-ink-900 px-4 py-2 text-center text-[13px] font-semibold text-white"
        >
          {t('network.offline')}
        </div>
      ) : null}
    </>
  )
}
