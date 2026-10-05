import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import { brand } from '../config/brand'
import { useT } from '../i18n'
import { api, ApiError } from '../lib/api'
import { Logo } from '../components/Logo'
import { AppLock } from '../native/AppLock'
import { JoinMedia } from './JoinMedia'
import { useAuth } from './AuthContext'

function Shell({
  title,
  subtitle,
  children,
  media,
}: {
  title: string
  subtitle: string
  children: ReactNode
  /** Rendered to the right of the form on wide screens. */
  media?: ReactNode
}) {
  const column = (
    <div className="flex w-full max-w-md flex-col justify-center">
      <Link to="/" className="mb-8 flex items-center self-start" aria-label={brand.name}>
        <Logo height={40} />
      </Link>
      <h1 className="text-balance text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-500">{subtitle}</p>
      <div className="mt-7">{children}</div>
    </div>
  )

  if (!media) {
    return (
      <div className="min-h-dvh bg-canvas">
        <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10 pt-[max(env(safe-area-inset-top),2.5rem)] pb-[max(env(safe-area-inset-bottom),2.5rem)]">{column}</div>
      </div>
    )
  }

  return (
    <div className="min-h-dvh bg-canvas">
      <div className="mx-auto grid min-h-dvh max-w-6xl items-center gap-12 px-5 py-10 pt-[max(env(safe-area-inset-top),2.5rem)] pb-[max(env(safe-area-inset-bottom),2.5rem)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex justify-center lg:justify-start">{column}</div>
        <div className="h-full min-h-[34rem] py-4">{media}</div>
      </div>
    </div>
  )
}

function Field({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = `f-${props.name}`
  return (
    <div>
      <label htmlFor={id} className="block text-[12px] font-semibold text-ink-500">{label}</label>
      <input id={id} {...props}
        className="mt-1 w-full rounded-xl bg-white px-4 py-3 text-[14px] outline-none ring-1 ring-ink-200 focus:ring-2 focus:ring-brand-500" />
    </div>
  )
}

/** Maps an API failure onto wording a sender can act on. */
function useApiMessage() {
  const t = useT()
  return (err: unknown): string => {
    if (err instanceof ApiError) {
      if (err.code === 'invalid_credentials') return t('auth.errInvalid')
      if (err.code === 'account_locked') return t('auth.errLocked')
      if (err.code === 'account_deletion_blocked') return 'Your account has a pending transfer or unresolved funds. Contact support to settle it before deleting your account.'
      if (err.code === 'account_changed') return 'Your account changed during this request. Sign in again and try once more.'
      if (err.code === 'too_many_requests') return 'Too many attempts. Please wait a few minutes before trying again.'
      if (err.code === 'weak_password') return err.message || t('auth.errWeak')
      if (err.code === 'network_unavailable') return t('auth.errNetwork')
      if (err.message) return err.message
    }
    return t('auth.errGeneric')
  }
}

export function Login() {
  const t = useT()
  const { signIn, enterDemo, user, loading, isDemo } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const destination = (location.state as { from?: string } | null)?.from === '/delete-account' ? '/delete-account' : '/app'
  const toMessage = useApiMessage()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!loading && user && !isDemo) return <Navigate to={destination} replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await signIn(email, password)
      navigate(destination, { replace: true })
    } catch (err) {
      setError(toMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell title={t('auth.signInTitle')} subtitle={t('auth.signInSubtitle')}>
      <form onSubmit={submit} className="space-y-4">
        <Field label={t('auth.email')} name="email" type="email" autoComplete="email" required
               value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field label={t('auth.password')} name="password" type="password" autoComplete="current-password"
               required value={password} onChange={(e) => setPassword(e.target.value)} />
        <Link to="/forgot-password" className="block text-[13px] font-semibold text-brand-600">Forgot your password?</Link>
        {error ? <p role="alert" className="text-[13px] font-medium text-alert">{error}</p> : null}
        <button type="submit" disabled={busy}
          className="w-full rounded-full bg-brand-600 py-3 text-[14px] font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60">
          {busy ? t('auth.signingIn') : t('auth.signIn')}
        </button>
      </form>
      <p className="mt-6 text-center text-[13px] text-ink-500">
        {t('auth.noAccount')}{' '}
        <Link to="/register" className="font-semibold text-brand-600">{t('auth.createAccount')}</Link>
      </p>
      <AuthLegalLinks />
      {/* The walkthrough needs no credentials: it starts a badged demo session
          on seeded data, so a visitor can hold the product before joining. */}
      <p className="mt-3 text-center text-[13px] text-ink-500">
        <button
          type="button"
          onClick={() => {
            enterDemo()
            navigate('/app', { replace: true })
          }}
          className="font-semibold text-brand-600"
        >
          {t('marketing.tryDemo')}
        </button>
      </p>
    </Shell>
  )
}

export function Register() {
  const t = useT()
  const { register, user, loading, isDemo } = useAuth()
  const navigate = useNavigate()
  const toMessage = useApiMessage()
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', password: '' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!loading && user && !isDemo) return <Navigate to="/app" replace />

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await register(form)
      navigate('/app', { replace: true })
    } catch (err) {
      setError(toMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell
      title={t('auth.registerTitle')}
      subtitle={t('auth.registerSubtitle')}
      media={<JoinMedia />}
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('auth.firstName')} name="firstName" autoComplete="given-name" required
                 value={form.firstName} onChange={set('firstName')} />
          <Field label={t('auth.lastName')} name="lastName" autoComplete="family-name" required
                 value={form.lastName} onChange={set('lastName')} />
        </div>
        <Field label={t('auth.email')} name="email" type="email" autoComplete="email" required
               value={form.email} onChange={set('email')} />
        <Field label={t('auth.password')} name="password" type="password" autoComplete="new-password"
               required value={form.password} onChange={set('password')} />
        <p className="text-[11px] leading-snug text-ink-500">{t('auth.passwordHint')}</p>
        {error ? <p role="alert" className="text-[13px] font-medium text-alert">{error}</p> : null}
        <button type="submit" disabled={busy}
          className="w-full rounded-full bg-brand-600 py-3 text-[14px] font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60">
          {busy ? t('auth.creating') : t('auth.createAccount')}
        </button>
      </form>
      <p className="mt-6 text-center text-[13px] text-ink-500">
        {t('auth.haveAccount')}{' '}
        <Link to="/login" className="font-semibold text-brand-600">{t('auth.signIn')}</Link>
      </p>
      <AuthLegalLinks />
    </Shell>
  )
}

function AuthLegalLinks() {
  return <p className="mt-6 flex justify-center gap-5 text-[12px] text-ink-500">
    <Link to="/privacy" className="underline">Privacy policy</Link>
    <Link to="/support" className="underline">Contact support</Link>
  </p>
}

export function ForgotPassword() {
  const t = useT()
  const toMessage = useApiMessage()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true); setError(null)
    try {
      await api.post('/auth/forgot-password', { email })
      setDone(true)
    } catch (err) { setError(toMessage(err)) }
    finally { setBusy(false) }
  }
  return <Shell title="Reset your password" subtitle="Enter the email address you use for XpressTend.">
    {done ? <p role="status" className="rounded-xl bg-brand-50 p-4 text-[14px] leading-relaxed">
      If an active account matches that address, reset instructions will be emailed to it. Check your inbox and spam folder. Contact support if you need help.
    </p> : <form onSubmit={submit} className="space-y-4">
      <Field label={t('auth.email')} name="email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} />
      {error && <p role="alert" className="text-[13px] text-alert">{error}</p>}
      <button disabled={busy} className="w-full rounded-full bg-brand-600 py-3 font-semibold text-white disabled:opacity-60">{busy ? 'Sending…' : 'Send reset instructions'}</button>
    </form>}
    <Link to="/login" className="mt-5 block text-center text-[13px] font-semibold text-brand-600">Back to sign in</Link>
    <AuthLegalLinks />
  </Shell>
}

export function ResetPassword() {
  const t = useT()
  const { token = '' } = useParams()
  const { refresh } = useAuth()
  const toMessage = useApiMessage()
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (password !== confirmation) { setError('The passwords do not match.'); return }
    setBusy(true); setError(null)
    try {
      await api.post('/auth/reset-password', { token, password })
      await refresh()
      setPassword(''); setConfirmation(''); setDone(true)
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'invalid_token' ? 'This reset link has expired or has already been used. Request a new link.' : toMessage(err))
    } finally { setBusy(false) }
  }
  const validFormat = /^[a-f0-9]{64}$/.test(token)
  return <Shell title="Choose a new password" subtitle="Reset links expire after one hour and can be used once.">
    {done ? <p role="status" className="rounded-xl bg-brand-50 p-4 text-[14px]">Your password has been reset. Sign in with your new password.</p> : validFormat ? <form onSubmit={submit} className="space-y-4">
      <Field label={t('auth.password')} name="password" type="password" autoComplete="new-password" minLength={12} required value={password} onChange={e => setPassword(e.target.value)} />
      <Field label="Confirm new password" name="confirmation" type="password" autoComplete="new-password" minLength={12} required value={confirmation} onChange={e => setConfirmation(e.target.value)} />
      <p className="text-[12px] text-ink-500">{t('auth.passwordHint')}</p>
      {error && <p role="alert" className="text-[13px] text-alert">{error}</p>}
      <button disabled={busy} className="w-full rounded-full bg-brand-600 py-3 font-semibold text-white disabled:opacity-60">{busy ? 'Resetting…' : 'Reset password'}</button>
    </form> : <p role="alert" className="text-[13px] text-alert">This reset link is invalid.</p>}
    <Link to={done ? '/login' : '/forgot-password'} className="mt-5 block text-center text-[13px] font-semibold text-brand-600">{done ? 'Sign in' : 'Request a new reset link'}</Link>
    <AuthLegalLinks />
  </Shell>
}

/** Also serves the public web deletion URL required by Google Play. */
export function DeleteAccount() {
  const { user, isDemo, loading, refresh } = useAuth()
  const t = useT()
  const toMessage = useApiMessage()
  const [password, setPassword] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!confirmed) return
    setBusy(true); setError(null)
    try {
      await api.delete('/auth/account', { password, confirmation: 'DELETE' })
      setPassword(''); setDone(true)
      await refresh()
    } catch (err) { setError(toMessage(err)) }
    finally { setBusy(false) }
  }
  const content = <Shell title="Delete your XpressTend account" subtitle="Close your account and remove your sign-in details and profile contact information.">
    {done ? <p role="status" className="rounded-xl bg-brand-50 p-4 text-[14px] leading-relaxed">Your account has been deleted and all sessions have been signed out. Transaction and compliance records are retained where required.</p> : <>
      <p className="mb-5 text-[13px] leading-relaxed text-ink-500">Deletion is permanent. Transaction, recipient and compliance records associated with financial activity may be retained to meet recordkeeping obligations. Transfers or unresolved funds must be settled before deletion.</p>
      {loading ? <p role="status">Loading your account…</p> : !user || isDemo ? <>
        <p className="text-[14px]">Sign in to the account you want to delete, then confirm deletion with your password.</p>
        <Link to="/login" state={{ from: '/delete-account' }} className="mt-5 block rounded-full bg-brand-600 py-3 text-center font-semibold text-white">Sign in to delete your account</Link>
      </> : <form onSubmit={submit} className="space-y-4">
        <p className="text-[14px]">Account: <bdi>{user.email}</bdi></p>
        <Field label={t('auth.password')} name="password" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} />
        <label className="flex items-start gap-3 text-[13px]"><input type="checkbox" required checked={confirmed} onChange={e => setConfirmed(e.target.checked)} className="mt-1" />I understand that deleting my account is permanent.</label>
        {error && <p role="alert" className="text-[13px] text-alert">{error}</p>}
        <button disabled={busy || !confirmed} className="w-full rounded-full bg-alert py-3 font-semibold text-white disabled:opacity-60">{busy ? 'Deleting…' : 'Delete my account'}</button>
        <Link to="/profile" className="block text-center text-[13px] font-semibold text-brand-600">Keep my account</Link>
      </form>}
    </>}
    <AuthLegalLinks />
  </Shell>
  // This route also serves public deletion instructions. Keep its own state
  // above the conditional gate so deletion success survives signing out, while
  // native relocking hides and retains the authenticated password form.
  return user && !isDemo ? <AppLock>{content}</AppLock> : content
}

/** Gate for the product routes. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center bg-canvas text-[13px] text-ink-500">
        {'…'}
      </div>
    )
  }
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}
