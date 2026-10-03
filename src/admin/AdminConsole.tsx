/**
 * Staff console.
 *
 * Deliberately English-only and outside the customer i18n dictionaries: this
 * is internal tooling for the Seattle back office, and translating it five ways
 * would add maintenance cost with no reader.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { api, ApiError, API_BASE, money, type AdminUser } from '../lib/api'
import { StaffPanel } from './StaffPanel'

interface TransferRow {
  id: string; reference: string; status: string
  send_amount_minor: number; send_currency: string; fee_minor: number
  receive_amount_minor: number; receive_currency: string
  created_at: string; user_email: string; first_name: string; last_name: string
  kyc_status: string; recipient_name: string; recipient_country: string
}

interface TrialBalance {
  balanced: boolean
  imbalances: { currency: string; off: number }[]
  accounts: { currency: string; account_code: string; balance_minor: number; entries: number }[]
}

interface SanctionsMatch {
  entityId: string
  officialId: string
  list: 'sdn' | 'non-sdn'
  programs: string[]
  entityType: string
  primaryName: string
  name: string
  nameId: string
  score: number
  matchType: 'exact' | 'reordered' | 'fuzzy'
}

interface ScreeningRecord {
  id: string
  subject_type: string
  subject_id: string
  provider: string
  status: string
  created_at: string
  is_current: boolean
  effective_cleared: boolean
  effective_clearance: {
    screening_id: string
    cleared_by: string | null
    cleared_by_name: string | null
    cleared_by_email: string | null
    cleared_at: string | null
    reason: string | null
  } | null
  cleared_by: string | null
  cleared_by_name?: string | null
  cleared_by_email?: string | null
  cleared_at: string | null
  review_reason: string | null
  match_json: {
    subjectName: string
    stage: string
    datasetVersion?: string
    datasetHash?: string
    checkedAt?: string
    normalizedName?: string
    matches?: SanctionsMatch[]
    reason?: string
    candidateCount?: number
  }
}

interface ScreeningReview {
  screenings: ScreeningRecord[]
  review_required: boolean
  screening_ready: boolean
  current_screening_ids: string[]
}

function screeningError(error: unknown): string {
  if (!(error instanceof ApiError)) return 'The screening request could not be completed. Please retry.'
  const messages: Record<string, string> = {
    reason_minimum_20_chars: 'Enter a review reason of at least 20 characters.',
    screening_not_reviewable: 'This screening is not available for a false-positive decision.',
    screening_outdated: 'The official dataset or matches have changed. Refresh screening before reviewing.',
    screening_subject_changed: 'The sender or recipient name has changed. Refresh screening before reviewing.',
    sanctions_unavailable: 'Current official sanctions data is unavailable. Screening and transfer release are blocked.',
    sanctions_review_required: 'Unresolved sanctions matches require a separate review decision before release.',
    not_funded: 'This transfer cannot be released because payment has not been confirmed.',
  }
  return messages[error.code] ?? `The screening request could not be completed (${error.code}).`
}

function ScreeningDetails({ screening }: { screening: ScreeningRecord }) {
  const metadata = screening.match_json
  const clearance = screening.effective_clearance ?? (screening.cleared_at ? {
    screening_id: screening.id,
    cleared_by: screening.cleared_by,
    cleared_by_name: screening.cleared_by_name,
    cleared_by_email: screening.cleared_by_email,
    cleared_at: screening.cleared_at,
    reason: screening.review_reason,
  } : null)
  const reviewed = screening.is_current ? screening.effective_cleared : !!screening.cleared_at
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">{screening.subject_type.replace(/_/g, ' ')} · {metadata.subjectName}</h3>
        <Pill status={reviewed ? 'reviewed_false_positive' : screening.status} />
        {!screening.is_current ? <span className="text-[11px] text-ink-500">Historical record</span> : null}
      </div>
      <dl className="mt-3 grid gap-2 text-[12px] sm:grid-cols-2">
        <div><dt className="text-ink-500">Screening provider</dt><dd>{screening.provider}</dd></div>
        <div><dt className="text-ink-500">Screened at / stage</dt><dd>{screening.created_at} · {metadata.stage}</dd></div>
        <div><dt className="text-ink-500">Official dataset version</dt><dd className="break-all">{metadata.datasetVersion ?? 'Unavailable'}</dd></div>
        <div><dt className="text-ink-500">Last successful source check</dt><dd>{metadata.checkedAt ?? 'Unavailable'}</dd></div>
        {metadata.datasetHash ? <div className="sm:col-span-2"><dt className="text-ink-500">Dataset SHA-256</dt><dd className="break-all font-mono text-[11px]">{metadata.datasetHash}</dd></div> : null}
      </dl>
      {metadata.reason ? (
        <p className="mt-3 text-[12px] text-alert">Screening requires attention: {metadata.reason.replace(/_/g, ' ')}</p>
      ) : null}
      {metadata.matches?.length ? (
        <div className="mt-4 space-y-3">
          {metadata.matches.map((match) => (
            <div key={`${match.entityId}:${match.nameId}`} className="rounded-xl bg-canvas p-3 text-[12px]">
              <p className="font-semibold">{match.primaryName}</p>
              <p className="mt-1 text-ink-600">Matched name or alias: {match.name}</p>
              <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                <div><dt className="text-ink-500">Official entity ID</dt><dd>{match.officialId} ({match.entityId})</dd></div>
                <div><dt className="text-ink-500">OFAC list</dt><dd>{match.list === 'sdn' ? 'SDN' : 'Consolidated non-SDN'}</dd></div>
                <div><dt className="text-ink-500">Programs</dt><dd>{match.programs.join(', ') || 'Not specified in source'}</dd></div>
                <div><dt className="text-ink-500">Name similarity</dt><dd>{match.score} · {match.matchType}</dd></div>
              </dl>
            </div>
          ))}
        </div>
      ) : <p className="mt-3 text-[12px] text-ink-600">No name matches recorded in this screening.</p>}
      {clearance ? (
        <div className="mt-4 rounded-xl bg-ok-soft p-3 text-[12px]">
          <p className="font-semibold">{screening.is_current ? 'False-positive decision recorded' : 'Historical false-positive decision'}</p>
          <p className="mt-1">Reviewer: {clearance.cleared_by_name ?? clearance.cleared_by_email ?? clearance.cleared_by} · {clearance.cleared_at}</p>
          <p className="mt-1 whitespace-pre-wrap">{clearance.reason}</p>
          {screening.is_current && clearance.screening_id !== screening.id ? (
            <p className="mt-2">Prior decision applies to the same screened name, official dataset and matched entities.</p>
          ) : null}
        </div>
      ) : null}
    </>
  )
}

const STATUS_TONE: Record<string, string> = {
  compliance_hold: 'bg-wait-soft text-brand-700',
  completed: 'bg-ok-soft text-brand-700',
  failed: 'bg-alert-soft text-alert',
  awaiting_payment: 'bg-ink-200 text-ink-700',
}

function Pill({ status }: { status: string }) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${STATUS_TONE[status] ?? 'bg-ink-200 text-ink-700'}`}>
      {status.replace(/_/g, ' ')}
    </span>
  )
}

export function AdminConsole() {
  const [admin, setAdmin] = useState<AdminUser | null>(null)
  const [checking, setChecking] = useState(true)
  const [needsSetup, setNeedsSetup] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const { admin } = await api.get<{ admin: AdminUser }>('/admin/auth/me')
      setAdmin(admin)
      setNeedsSetup(false)
    } catch {
      setAdmin(null)
      // No session. Offer the setup screen only while the backend says the
      // bootstrap is genuinely open.
      try {
        const { available } = await api.get<{ available: boolean }>('/bootstrap/status')
        setNeedsSetup(available)
      } catch {
        setNeedsSetup(false)
      }
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  if (checking) {
    return <div className="grid min-h-dvh place-items-center bg-ink-900 text-[13px] text-white/60">Checking session…</div>
  }
  if (!admin) return needsSetup ? <AdminSetup onCreated={refresh} /> : <AdminLogin onSignedIn={refresh} />
  return <Dashboard admin={admin} onSignedOut={() => setAdmin(null)} />
}

/**
 * First-run screen for creating the owner account.
 *
 * The setup key is required because /admin is a public URL: without it, whoever
 * loaded this page first would take the account. It is shown only while the
 * backend reports the bootstrap open, and stops appearing the moment an admin
 * exists.
 */
function AdminSetup({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState({ email: '', name: '', password: '', secret: '' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (form.password.length < 16) {
      setError('Staff passwords must be at least 16 characters.')
      return
    }
    setBusy(true); setError(null)
    try {
      await fetch(`${API_BASE}/bootstrap/admin`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'x-bootstrap-secret': form.secret },
        body: JSON.stringify({ email: form.email, name: form.name, password: form.password }),
      }).then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
          throw new Error(
            body.error === 'not_found'
              ? 'That setup key was not accepted.'
              : body.message ?? body.error ?? 'Could not create the account.',
          )
        }
      })
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the account.')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="grid min-h-dvh place-items-center bg-ink-900 px-5">
        <div className="w-full max-w-sm rounded-[var(--radius-card)] bg-white p-7 text-center">
          <h1 className="text-[19px] font-semibold tracking-tight">Account created</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-500">
            Sign in with the email and password you just chose. Then remove the
            <code className="mx-1 rounded bg-canvas px-1.5 py-0.5 text-[12px]">ADMIN_BOOTSTRAP_SECRET</code>
            so this screen can never appear again.
          </p>
          <button onClick={onCreated}
            className="mt-6 w-full rounded-full bg-ink-900 py-3 text-[14px] font-semibold text-white">
            Go to sign in
          </button>
        </div>
      </div>
    )
  }

  const field = 'w-full rounded-xl bg-canvas px-4 py-3 text-[14px] outline-none ring-1 ring-ink-200 focus:ring-2 focus:ring-brand-500'

  return (
    <div className="grid min-h-dvh place-items-center bg-ink-900 px-5 py-10">
      <form onSubmit={submit} className="w-full max-w-sm rounded-[var(--radius-card)] bg-white p-7">
        <h1 className="text-[19px] font-semibold tracking-tight">Create the owner account</h1>
        <p className="mt-1.5 text-[12px] leading-relaxed text-ink-500">
          This runs once. Nobody else can create it after you.
        </p>
        <div className="mt-6 space-y-3">
          <input required type="email" placeholder="you@xpresstend.com" autoComplete="username"
            value={form.email} onChange={set('email')} className={field} />
          <input required placeholder="Your full name" autoComplete="name"
            value={form.name} onChange={set('name')} className={field} />
          <input required type="password" placeholder="Password, 16+ characters"
            autoComplete="new-password" value={form.password} onChange={set('password')} className={field} />
          <input required type="password" placeholder="Setup key"
            value={form.secret} onChange={set('secret')} className={field} />
          <p className="text-[11px] leading-snug text-ink-500">
            The setup key is the ADMIN_BOOTSTRAP_SECRET set on the Worker. It stops a
            stranger claiming this account before you do.
          </p>
        </div>
        {error ? <p role="alert" className="mt-3 text-[12px] font-medium text-alert">{error}</p> : null}
        <button type="submit" disabled={busy}
          className="mt-5 w-full rounded-full bg-ink-900 py-3 text-[14px] font-semibold text-white disabled:opacity-60">
          {busy ? 'Creating…' : 'Create account'}
        </button>
      </form>
    </div>
  )
}

/**
 * Recovering a staff account.
 *
 * Two things people lose, and they are different problems:
 *
 *   password  a reset link, emailed. Passwords are stored as PBKDF2 hashes and
 *             cannot be read back by anyone, so there is nothing to retrieve;
 *             the only possible answer is to set a new one.
 *
 *   address   which email the account is under. The only safe answer is to
 *             confirm an address the person already has, by writing to it. An
 *             endpoint that told a caller which addresses exist would be an
 *             account enumeration tool, so this one cannot do that, and the
 *             copy says so rather than implying otherwise.
 *
 * Both replies are identical whether or not the address has an account, which
 * is why the confirmation below is worded as a conditional.
 */
function AdminRecover({ mode, onBack }: { mode: 'password' | 'address'; onBack: () => void }) {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  const password = mode === 'password'

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await api.post(password ? '/admin/auth/forgot-password' : '/admin/auth/forgot-email', { email })
    } catch {
      /*
       * Swallowed on purpose. The server answers the same way for an unknown
       * address as for a real one, so surfacing a network error here would be
       * the only signal that distinguished them. The confirmation is honest
       * either way: it promises an email only if an account exists.
       */
    } finally {
      setBusy(false)
      setSent(true)
    }
  }

  if (sent) {
    return (
      <div className="w-full max-w-sm rounded-[var(--radius-card)] bg-white p-7">
        <h1 className="text-[19px] font-semibold tracking-tight">Check your inbox</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-500">
          If <span className="font-semibold text-ink-700">{email}</span> has a staff account,
          we have sent it an email. Look in spam too.
        </p>
        {password ? (
          <p className="mt-3 text-[12px] leading-relaxed text-ink-500">
            The link lasts one hour and works once. If it does not arrive, an owner can
            generate one for you from the Staff tab.
          </p>
        ) : null}
        <button
          onClick={onBack}
          className="mt-6 w-full rounded-full bg-ink-900 py-3 text-[14px] font-semibold text-white"
        >
          Back to sign in
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="w-full max-w-sm rounded-[var(--radius-card)] bg-white p-7">
      <h1 className="text-[19px] font-semibold tracking-tight">
        {password ? 'Reset your password' : 'Which address do I use?'}
      </h1>
      <p className="mt-1.5 text-[12px] leading-relaxed text-ink-500">
        {password
          ? 'Enter your staff address and we will email you a link to choose a new password. Passwords cannot be looked up, only replaced.'
          : 'Enter an address you might have registered. If it has a staff account we will confirm it by email. We cannot tell you an address you do not already have.'}
      </p>
      <input
        type="email"
        required
        autoFocus
        placeholder="you@xpresstend.com"
        autoComplete="username"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="mt-5 w-full rounded-xl bg-canvas px-4 py-3 text-[14px] outline-none ring-1 ring-ink-200 focus:ring-2 focus:ring-brand-500"
      />
      <button
        type="submit"
        disabled={busy}
        className="mt-4 w-full rounded-full bg-ink-900 py-3 text-[14px] font-semibold text-white disabled:opacity-60"
      >
        {busy ? 'Sending…' : password ? 'Email me a reset link' : 'Confirm this address'}
      </button>
      <button
        type="button"
        onClick={onBack}
        className="mt-3 w-full rounded-full py-2.5 text-[13px] font-semibold text-ink-600 transition-colors hover:text-ink-900"
      >
        Back to sign in
      </button>
    </form>
  )
}

function AdminLogin({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [recover, setRecover] = useState<'password' | 'address' | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      await api.post('/admin/auth/login', { email, password })
      onSignedIn()
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'account_locked'
          ? 'Too many attempts. This account is locked for 30 minutes.'
          : 'Those credentials were not accepted.',
      )
    } finally {
      setBusy(false)
    }
  }

  if (recover) {
    return (
      <div className="grid min-h-dvh place-items-center bg-ink-900 px-5 py-10">
        <AdminRecover mode={recover} onBack={() => setRecover(null)} />
      </div>
    )
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-ink-900 px-5 py-10">
      <form onSubmit={submit} className="w-full max-w-sm rounded-[var(--radius-card)] bg-white p-7">
        <h1 className="text-[19px] font-semibold tracking-tight">Staff sign in</h1>
        <p className="mt-1.5 text-[12px] text-ink-500">Authorised personnel only. Sessions last 8 hours.</p>
        <div className="mt-6 space-y-3">
          <input type="email" required placeholder="you@xpresstend.com" autoComplete="username"
            value={email} onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl bg-canvas px-4 py-3 text-[14px] outline-none ring-1 ring-ink-200 focus:ring-2 focus:ring-brand-500" />
          <input type="password" required placeholder="Password" autoComplete="current-password"
            value={password} onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-xl bg-canvas px-4 py-3 text-[14px] outline-none ring-1 ring-ink-200 focus:ring-2 focus:ring-brand-500" />
        </div>
        {error ? <p role="alert" className="mt-3 text-[12px] font-medium text-alert">{error}</p> : null}
        <button type="submit" disabled={busy}
          className="mt-5 w-full rounded-full bg-ink-900 py-3 text-[14px] font-semibold text-white disabled:opacity-60">
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        {/* Both recovery paths sit here rather than behind one "trouble signing
            in?" link, because they answer different questions and someone who
            has forgotten which address they use will not look for it under
            "forgot password". */}
        <div className="mt-4 flex items-center justify-between gap-3 border-t border-ink-200 pt-4">
          <button
            type="button"
            onClick={() => setRecover('password')}
            className="text-[12px] font-semibold text-ink-600 transition-colors hover:text-brand-600"
          >
            Forgot password?
          </button>
          <button
            type="button"
            onClick={() => setRecover('address')}
            className="text-[12px] font-semibold text-ink-600 transition-colors hover:text-brand-600"
          >
            Forgot your email?
          </button>
        </div>
      </form>
    </div>
  )
}

function Dashboard({ admin, onSignedOut }: { admin: AdminUser; onSignedOut: () => void }) {
  const [tab, setTab] = useState<'queue' | 'staff'>('queue')
  const [rows, setRows] = useState<TransferRow[]>([])
  const [filter, setFilter] = useState('compliance_hold')
  const [balance, setBalance] = useState<TrialBalance | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [selectedTransfer, setSelectedTransfer] = useState<TransferRow | null>(null)
  const [review, setReview] = useState<ScreeningReview | null>(null)
  const [reviewBusy, setReviewBusy] = useState(false)
  const [reviewError, setReviewError] = useState<string | null>(null)
  const [reviewMessage, setReviewMessage] = useState<string | null>(null)
  const [reviewReasons, setReviewReasons] = useState<Record<string, string>>({})
  const [clearingId, setClearingId] = useState<string | null>(null)
  const reviewRequest = useRef(0)

  const canDecide = admin.role === 'compliance' || admin.role === 'owner'

  const load = useCallback(async () => {
    const [t, b] = await Promise.all([
      api.get<{ transfers: TransferRow[] }>(`/admin/transfers?status=${encodeURIComponent(filter)}`),
      api.get<TrialBalance>('/admin/ledger/trial-balance'),
    ])
    setRows(t.transfers)
    setBalance(b)
  }, [filter])

  useEffect(() => { void load().catch(() => setNote('Could not load the queue.')) }, [load])

  async function refreshReview(id: string, rescreen = false) {
    const request = ++reviewRequest.current
    setReviewBusy(true); setReviewError(null); setReviewMessage(null)
    try {
      if (rescreen) await api.post(`/admin/transfers/${id}/screen`)
      const result = await api.get<ScreeningReview>(`/admin/transfers/${id}/screenings`)
      if (request === reviewRequest.current) setReview(result)
    } catch (err) {
      if (request === reviewRequest.current) {
        setReview(null)
        setReviewError(screeningError(err))
      }
    } finally {
      if (request === reviewRequest.current) setReviewBusy(false)
    }
  }

  function openReview(transfer: TransferRow) {
    setSelectedTransfer(transfer); setReview(null); setReviewReasons({})
    void refreshReview(transfer.id, canDecide)
  }

  async function clearScreening(screening: ScreeningRecord) {
    const reason = reviewReasons[screening.id]?.trim() ?? ''
    if (!selectedTransfer || !canDecide || reason.length < 20) return
    setClearingId(screening.id); setReviewError(null); setReviewMessage(null)
    try {
      await api.post(`/admin/screenings/${screening.id}/clear`, { reason })
      await refreshReview(selectedTransfer.id)
      await load()
      setReviewReasons((reasons) => ({ ...reasons, [screening.id]: '' }))
      setReviewMessage('The false-positive decision was recorded. Transfer release remains a separate action.')
    } catch (err) {
      setReviewError(screeningError(err))
    } finally {
      setClearingId(null)
    }
  }

  const canRelease = canDecide && !reviewBusy && !clearingId && review?.screening_ready === true && review.review_required === false

  async function decide(id: string, action: 'approve' | 'reject') {
    if (action === 'approve' && (!canRelease || selectedTransfer?.id !== id)) {
      setNote('Load current screening results and resolve sanctions matches before release.')
      return
    }
    const reason = action === 'reject' ? window.prompt('Reason for rejecting this transfer:')?.trim() : undefined
    if (action === 'reject' && !reason) return
    setBusyId(id); setNote(null)
    try {
      await api.post(`/admin/transfers/${id}/${action}`, action === 'reject' ? { reason } : undefined)
      await load()
      if (selectedTransfer?.id === id) {
        ++reviewRequest.current
        setSelectedTransfer(null); setReview(null)
      }
    } catch (err) {
      setNote(action === 'approve' ? screeningError(err) : err instanceof ApiError ? `Could not reject: ${err.code}` : 'Could not reject.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="border-b border-ink-200/70 bg-ink-900 text-white">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-5 py-4">
          <span className="text-[15px] font-semibold tracking-tight">XpressTend Operations</span>
          <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide">
            {admin.role}
          </span>
          <div className="ml-auto flex items-center gap-3 text-[12px]">
            <span className="text-white/60">{admin.email}</span>
            <button onClick={() => api.post('/admin/auth/logout').then(onSignedOut)}
              className="rounded-full bg-white/10 px-3 py-1.5 font-semibold hover:bg-white/20">
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-8">
        <div className="mb-6 flex gap-2 border-b border-ink-200/70">
          {([['queue', 'Transfers'], ['staff', 'Staff']] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`-mb-px border-b-2 px-4 py-2.5 text-[13px] font-semibold transition ${
                tab === key
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-ink-500 hover:text-ink-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'staff' ? <StaffPanel me={admin} /> : null}

        {tab === 'queue' ? (
        <>
        {balance ? (
          <div className={`mb-6 rounded-xl px-4 py-3 text-[13px] font-semibold ${
            balance.balanced ? 'bg-ok-soft text-brand-700' : 'bg-alert-soft text-alert'}`}>
            {balance.balanced
              ? 'Ledger balanced — every currency nets to zero.'
              : `LEDGER OUT OF BALANCE: ${balance.imbalances.map((i) => `${i.currency} off by ${i.off}`).join(', ')}`}
          </div>
        ) : null}

        <div className="mb-4 flex flex-wrap items-center gap-2">
          {['compliance_hold', 'awaiting_payment', 'completed', 'failed', 'all'].map((s) => (
            <button key={s} onClick={() => setFilter(s)}
              className={`rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition ${
                filter === s ? 'bg-brand-600 text-white' : 'bg-white text-ink-600 ring-1 ring-ink-200'}`}>
              {s.replace(/_/g, ' ')}
            </button>
          ))}
        </div>

        {note ? <p role="alert" className="mb-4 text-[13px] font-medium text-alert">{note}</p> : null}

        <div className="overflow-x-auto rounded-[var(--radius-card)] bg-white ring-1 ring-ink-200/70">
          <table className="w-full min-w-[860px] text-left text-[13px]">
            <thead className="border-b border-ink-200/70 text-[11px] uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-4 py-3">Reference</th>
                <th className="px-4 py-3">Sender</th>
                <th className="px-4 py-3">Recipient</th>
                <th className="px-4 py-3 text-right">Sends</th>
                <th className="px-4 py-3 text-right">Receives</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-ink-500">Nothing in this queue.</td></tr>
              ) : rows.map((r) => (
                <tr key={r.id} className="border-b border-ink-200/50 last:border-0">
                  <td className="px-4 py-3 font-semibold tabular-nums">{r.reference}</td>
                  <td className="px-4 py-3">
                    <div>{r.first_name} {r.last_name}</div>
                    <div className="text-[11px] text-ink-500">{r.user_email} · KYC {r.kyc_status}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div>{r.recipient_name}</div>
                    <div className="text-[11px] text-ink-500">{r.recipient_country}</div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {money(r.send_amount_minor, r.send_currency)}
                    <div className="text-[11px] text-ink-500">+{money(r.fee_minor, r.send_currency)} fee</div>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">
                    {money(r.receive_amount_minor, r.receive_currency)}
                  </td>
                  <td className="px-4 py-3"><Pill status={r.status} /></td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button disabled={!!busyId || !!clearingId} onClick={() => openReview(r)}
                        className="rounded-full bg-brand-600 px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50">
                        Review screenings
                      </button>
                      {r.status === 'compliance_hold' && canDecide ? (
                        <button disabled={!!busyId || !!clearingId || reviewBusy} onClick={() => decide(r.id, 'reject')}
                          className="rounded-full bg-white px-3 py-1.5 text-[12px] font-semibold text-alert ring-1 ring-ink-200 disabled:opacity-50">
                          Reject
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {selectedTransfer ? (
          <section aria-label="Sanctions review" className="mt-6 rounded-[var(--radius-card)] bg-white p-5 ring-1 ring-ink-200/70">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-[16px] font-semibold">Sanctions review · {selectedTransfer.reference}</h2>
              <div className="flex gap-2">
                <button disabled={reviewBusy || !!clearingId || !!busyId} onClick={() => refreshReview(selectedTransfer.id, canDecide)}
                  className="rounded-full px-3 py-1.5 text-[12px] font-semibold ring-1 ring-ink-200 disabled:opacity-50">
                  {canDecide ? 'Refresh screening' : 'Reload results'}
                </button>
                <button disabled={!!clearingId || !!busyId} onClick={() => {
                  ++reviewRequest.current
                  setSelectedTransfer(null); setReview(null); setReviewBusy(false)
                }} className="rounded-full px-3 py-1.5 text-[12px] font-semibold ring-1 ring-ink-200 disabled:opacity-50">
                  Close review
                </button>
              </div>
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-ink-500">
              Review official entity identifiers, listed names and aliases, programs and the dataset version.
              A name similarity score is a screening signal. Record a false-positive decision only after verifying the parties are distinct.
            </p>
            {reviewBusy ? <p role="status" className="mt-4 text-[13px] text-ink-500">Loading current screening results…</p> : null}
            {reviewError ? <p role="alert" className="mt-4 text-[13px] text-alert">{reviewError}</p> : null}
            {reviewMessage ? <p role="status" className="mt-4 text-[13px] text-brand-700">{reviewMessage}</p> : null}
            {review ? (
              <>
                <p className={`mt-4 rounded-xl p-3 text-[13px] font-semibold ${review.screening_ready && !review.review_required ? 'bg-ok-soft text-brand-700' : 'bg-alert-soft text-alert'}`}>
                  {!review.screening_ready
                    ? 'Current screening is not ready. Refresh screening before considering release.'
                    : review.review_required
                      ? 'Unresolved sanctions matches block release.'
                      : 'Current sender and recipient screening records have no unresolved sanctions matches.'}
                </p>
                <div className="mt-4 space-y-4">
                  {review.screenings.length ? review.screenings.map((screening) => {
                    const reviewable = canDecide && screening.is_current && !screening.effective_cleared && !screening.cleared_at
                      && screening.status === 'potential_match'
                      && !['unusable_name', 'candidate_limit'].includes(screening.match_json.reason ?? '')
                    return (
                      <article key={screening.id} className="rounded-2xl border border-ink-200 p-4 text-[13px]">
                        <ScreeningDetails screening={screening} />
                        {reviewable ? (
                          <form className="mt-4 border-t border-ink-200 pt-4" onSubmit={(event) => { event.preventDefault(); void clearScreening(screening) }}>
                            <label htmlFor={`review-reason-${screening.id}`} className="block text-[12px] font-semibold">False-positive review reason</label>
                            <textarea id={`review-reason-${screening.id}`} required minLength={20}
                              value={reviewReasons[screening.id] ?? ''} onChange={(event) => setReviewReasons((reasons) => ({ ...reasons, [screening.id]: event.target.value }))}
                              placeholder="Explain the evidence distinguishing this party from the listed entity (at least 20 characters)."
                              className="mt-2 min-h-24 w-full rounded-xl bg-canvas p-3 text-[13px] outline-none ring-1 ring-ink-200 focus:ring-2 focus:ring-brand-500" />
                            <button type="submit" disabled={reviewBusy || !!clearingId || (reviewReasons[screening.id]?.trim().length ?? 0) < 20}
                              className="mt-3 rounded-full bg-ink-900 px-4 py-2 text-[12px] font-semibold text-white disabled:opacity-50">
                              {clearingId === screening.id ? 'Recording decision…' : 'Record false-positive decision'}
                            </button>
                          </form>
                        ) : null}
                      </article>
                    )
                  }) : <p className="text-[13px] text-ink-500">No screening records are available for this transfer.</p>}
                </div>
              </>
            ) : null}
            {selectedTransfer.status === 'compliance_hold' ? (
              <div className="mt-5 border-t border-ink-200 pt-4">
                <p className="mb-3 text-[12px] text-ink-500">
                  {canDecide
                    ? 'Release checks current sanctions data, unresolved matches and confirmed funding again on the server.'
                    : 'A compliance or owner role is required to record review decisions and release transfers.'}
                </p>
                {canDecide ? <button disabled={!canRelease || busyId === selectedTransfer.id} onClick={() => decide(selectedTransfer.id, 'approve')}
                  className="rounded-full bg-brand-600 px-4 py-2 text-[12px] font-semibold text-white disabled:opacity-50">Release</button> : null}
              </div>
            ) : null}
          </section>
        ) : null}
        </>
        ) : null}
      </main>
    </div>
  )
}
