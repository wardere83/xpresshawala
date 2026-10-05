import { useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, Star } from 'lucide-react'
import { Avatar, ScreenHeader } from '../components/ui'
import { useI18n } from '../i18n'
import { useTransfer } from '../state/TransferContext'
import { useAccountData } from '../state/AccountData'
import { recipients as seeded, relationName } from '../data/mock'
import { seededRecipientView, toRecipientView, type RecipientView } from '../lib/view'

/**
 * A signed-in customer sees their own recipients and can add more. Everyone
 * else sees the seeded set, because /app is reachable without an account and
 * an empty tour would say nothing about the product.
 */
export function Recipients() {
  const { t, lang } = useI18n()
  const navigate = useNavigate()
  const { setRecipientId } = useTransfer()
  const { live, loading, error, recipients: mine, corridors, addRecipient } = useAccountData()
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)

  const rows: RecipientView[] = useMemo(
    () =>
      live
        ? mine.map(toRecipientView)
        : seeded.map((r) => seededRecipientView(r, relationName(r, lang))),
    [live, mine, lang],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.detail.replace(/\s/g, '').toLowerCase().includes(q.replace(/\s/g, '')),
    )
  }, [query, rows])

  const favourites = filtered.filter((r) => r.favourite)
  const others = filtered.filter((r) => !r.favourite)

  const open = (id: string) => {
    setRecipientId(id)
    navigate('/send')
  }

  const renderRow = (r: RecipientView) => (
    <li key={r.id}>
      <button
        type="button"
        onClick={() => open(r.id)}
        className="flex w-full items-center gap-3 px-4 py-3 text-start transition hover:bg-brand-50/70"
      >
        <Avatar name={r.name} hue={r.hue} size={44} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[14px] font-bold text-ink-900">{r.name}</span>
            {r.favourite && <Star size={12} className="fill-xt-turquoise text-xt-turquoise" />}
          </span>
          <span className="block truncate text-[12px] text-ink-500">
            {r.subtitle} · <bdi>{r.detail}</bdi>
          </span>
        </span>
      </button>
    </li>
  )

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <ScreenHeader
        title={t('recipients.title')}
        right={
          <button
            type="button"
            aria-label={t('recipients.add')}
            disabled={live && (loading || !!error || corridors.length === 0)}
            onClick={() => (live ? setAdding((v) => !v) : navigate('/send'))}
            className="grid h-9 w-9 place-items-center rounded-full bg-brand-600 text-white transition hover:bg-brand-700"
          >
            <Plus size={18} strokeWidth={2.6} />
          </button>
        }
      />

      <div className="px-4 pb-3">
        <div className="flex items-center gap-2 rounded-xl bg-white px-3.5 py-3 shadow-[var(--shadow-card)]">
          <Search size={17} className="shrink-0 text-ink-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('recipients.searchPlaceholder')}
            aria-label={t('common.search')}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-ink-900 outline-none placeholder:text-ink-500"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar px-4 pb-6">
        {adding && live ? (
          <AddRecipient
            countries={[...new Set(corridors.map((c) => c.receive_country))]}
            onCancel={() => setAdding(false)}
            onSave={async (input) => {
              await addRecipient(input)
              setAdding(false)
            }}
          />
        ) : null}

        {error ? (
          <p role="alert" className="mt-10 text-center text-[13px] font-medium text-alert">{error}</p>
        ) : loading && rows.length === 0 ? (
          <p className="mt-10 text-center text-[13px] text-ink-500">…</p>
        ) : filtered.length === 0 ? (
          <p className="mt-10 text-center text-[13px] text-ink-500">{t('recipients.empty')}</p>
        ) : null}

        {favourites.length > 0 && (
          <>
            <h2 className="mt-2 mb-2 text-[13px] font-bold text-ink-700">
              {t('recipients.favourites')}
            </h2>
            <ul className="card overflow-hidden divide-y divide-ink-200/60">
              {favourites.map(renderRow)}
            </ul>
          </>
        )}

        {others.length > 0 && (
          <>
            {favourites.length > 0 ? (
              <h2 className="mt-5 mb-2 text-[13px] font-bold text-ink-700">{t('recipients.all')}</h2>
            ) : null}
            <ul className="card mt-2 overflow-hidden divide-y divide-ink-200/60">
              {others.map(renderRow)}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}

const PAYOUT_METHODS = [
  { value: 'mobile_wallet', label: 'Mobile wallet' },
  { value: 'bank_account', label: 'Bank account' },
  { value: 'cash_pickup', label: 'Cash pickup' },
]

function AddRecipient({
  onCancel,
  onSave,
  countries,
}: {
  onCancel: () => void
  countries: string[]
  onSave: (input: {
    fullName: string; country: string; payoutMethod: string; phone?: string; relationship?: string
  }) => Promise<void>
}) {
  const { t, lang } = useI18n()
  const countryNames = new Intl.DisplayNames([lang], { type: 'region' })
  const [form, setForm] = useState({
    fullName: '', country: countries[0] ?? '', payoutMethod: 'mobile_wallet',
    phone: '', relationship: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      await onSave(form)
    } catch {
      setError(t('recipients.addFailed'))
    } finally {
      setBusy(false)
    }
  }

  const field =
    'w-full rounded-xl bg-white px-4 py-3 text-[14px] text-ink-900 outline-none ring-1 ring-ink-200 focus:ring-2 focus:ring-brand-500'

  return (
    <form onSubmit={submit} className="card mb-4 space-y-3 p-4">
      <h2 className="text-[14px] font-bold">{t('recipients.add')}</h2>
      <p className="text-[12px] text-ink-500">Saved details are for test records. Delivery services are not connected.</p>
      <input required placeholder={t('recipients.fullName')} value={form.fullName}
             onChange={set('fullName')} className={field} />
      <select value={form.country} onChange={set('country')} className={field} aria-label={t('marketing.destination')}>
        {countries.map((country) => (
          <option key={country} value={country}>{countryNames.of(country) ?? country}</option>
        ))}
      </select>
      <select value={form.payoutMethod} onChange={set('payoutMethod')} className={field}
              aria-label={t('recipients.payoutMethod')}>
        {PAYOUT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
      </select>
      <input placeholder={t('recipients.phoneOptional')} value={form.phone} onChange={set('phone')}
             className={field} inputMode="tel" />
      {error ? <p role="alert" className="text-[13px] font-medium text-alert">{error}</p> : null}
      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={busy || !form.country}
          className="flex-1 rounded-full bg-brand-600 py-3 text-[14px] font-semibold text-white disabled:opacity-60">
          {busy ? t('common.saving') : t('common.save')}
        </button>
        <button type="button" onClick={onCancel}
          className="rounded-full border border-ink-200 px-5 py-3 text-[14px] font-semibold text-ink-700">
          {t('common.cancel')}
        </button>
      </div>
    </form>
  )
}
