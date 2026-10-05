import { useMemo, useState } from 'react'
import { ArrowUpRight, Clock } from 'lucide-react'
import { Avatar, ScreenHeader } from '../components/ui'
import { useI18n, useMirrorClass } from '../i18n'
import { useTransfer } from '../state/TransferContext'
import { useAccountData } from '../state/AccountData'
import { getRecipient } from '../data/mock'
import { formatDate, usd } from '../lib/format'

type Filter = 'all' | 'completed' | 'pending'

type Row = {
  id: string
  name: string
  subtitle: string
  hue: number
  amountUsd: number
  date: string
  status: string
}

/** Stable avatar colour for a real recipient, who has no seeded hue. */
function hueFor(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360
  return h
}

export function Activity() {
  const { t } = useI18n()
  const mirror = useMirrorClass()
  const { history: demoHistory } = useTransfer()
  const { live, loading, error, transfers } = useAccountData()
  const [filter, setFilter] = useState<Filter>('all')

  /**
   * One shape for the list, whichever source it came from.
   *
   * A signed-in customer sees only their own transfers; the seeded history is
   * shown solely to a visitor touring the app without an account, so real and
   * demo figures can never be confused for one another.
   */
  const rows: Row[] = useMemo(() => {
    if (live) {
      return transfers.map((tr) => ({
        id: tr.id,
        name: tr.recipient_name,
        subtitle: tr.recipient_country,
        hue: hueFor(tr.recipient_name),
        amountUsd: tr.send_amount_minor / 100,
        date: tr.created_at,
        status: tr.status,
      }))
    }
    return demoHistory.map((tx) => {
      const r = getRecipient(tx.recipientId)
      return {
        id: tx.id,
        name: r.name,
        subtitle: r.wallet,
        hue: r.hue,
        amountUsd: tx.amountUsd,
        date: tx.date,
        status: tx.status,
      }
    })
  }, [live, transfers, demoHistory])

  const filters: { id: Filter; label: string }[] = [
    { id: 'all', label: t('activity.filterAll') },
    { id: 'completed', label: live ? 'Completed tests' : t('activity.filterSent') },
    { id: 'pending', label: live ? 'Pending tests' : t('activity.filterPending') },
  ]

  const visible = useMemo(
    () => (filter === 'all' ? rows : rows.filter((r) => filter === 'completed' ? r.status === 'completed' : !['completed', 'failed', 'cancelled', 'refunded'].includes(r.status))),
    [filter, rows],
  )

  const monthTotal = useMemo(() => {
    const now = new Date()
    return rows
      .filter((r) => {
        const d = new Date(r.date)
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
      })
      .reduce((sum, r) => sum + r.amountUsd, 0)
  }, [rows])

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <ScreenHeader title={t('activity.title')} />

      <div className="flex-1 overflow-y-auto no-scrollbar px-4 pb-6">
        <section className="rounded-[var(--radius-card)] bg-gradient-to-br from-brand-600 to-brand-800 p-5 text-white shadow-[var(--shadow-float)]">
          <p className="text-[12px] font-semibold text-white/70">{live ? 'Test transfer amounts this month' : t('activity.sentThisMonth')}</p>
          <p className="mt-1 text-[30px] leading-none font-semibold">
            <bdi>{usd(monthTotal)}</bdi>
          </p>
          <p className="mt-2 text-[12px] text-white/70">
            {/* Counted from the same rows the list renders, so the number can
                never disagree with what is on screen. */}
            {t('activity.transfers', { count: rows.length })}
          </p>
        </section>

        <div className="mt-4 flex gap-2">
          {filters.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              aria-pressed={filter === f.id}
              className={`rounded-full px-3.5 py-1.5 text-[12px] font-bold transition ${
                filter === f.id
                  ? 'bg-brand-600 text-white'
                  : 'bg-white text-ink-500 shadow-[var(--shadow-card)] hover:text-ink-700'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {error ? (
          <p role="alert" className="mt-10 text-center text-[13px] font-medium text-alert">{error}</p>
        ) : loading && rows.length === 0 ? (
          <p className="mt-10 text-center text-[13px] text-ink-500">…</p>
        ) : visible.length === 0 ? (
          <p className="mt-10 text-center text-[13px] text-ink-500">{t('activity.empty')}</p>
        ) : (
          <ul className="card mt-4 divide-y divide-ink-200/60 overflow-hidden">
            {visible.map((row) => {
              const done = row.status === 'completed'
              return (
                <li key={row.id} className="flex items-center gap-3 px-4 py-3">
                  <Avatar name={row.name} hue={row.hue} size={42} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-bold text-ink-900">{row.name}</p>
                    <p className="truncate text-[12px] text-ink-500">
                      {formatDate(row.date)} · <bdi>{row.subtitle}</bdi>
                    </p>
                  </div>
                  <div className="text-end">
                    <p className="text-[14px] font-semibold text-ink-900">
                      <bdi>{usd(row.amountUsd)}</bdi>
                    </p>
                    <p
                      className={`flex items-center justify-end gap-1 text-[11.5px] font-semibold ${
                        done ? 'text-brand-700' : 'text-ink-500'
                      }`}
                    >
                      {done ? <ArrowUpRight size={13} className={mirror} /> : <Clock size={13} />}
                      {live ? row.status.replaceAll('_', ' ') : done ? t('activity.filterSent') : t('activity.filterPending')}
                    </p>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
