import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  TRANSFER_FEE, getCorridor, getRecipient, corridors as demoCorridors,
  recipients, transactions as seedTransactions, type PaymentMethodId, type Transaction,
} from '../data/mock'
import { makeReference } from '../lib/format'
import { api, ApiError, type Quote as ApiQuote } from '../lib/api'
import { useAuth } from '../auth/AuthContext'
import { useAccountData } from './AccountData'
import { hueFor } from '../lib/view'
import { type DeliveryMethod, FEE_MODE, type Quote, type TransferReceipt, TransferContext, type TransferValue } from './TransferContext'

const emptyRecipient: ReturnType<typeof getRecipient> = {
  id: '', name: 'Choose a recipient', phone: '', wallet: '', last4: '',
  corridorCode: '', favourite: false, relation: '', relationI18n: {}, hue: 180,
}
type CreatedTransfer = ApiQuote & { id: string; reference: string; status: string }
type PendingPayment = {
  transfer: CreatedTransfer
  // The reviewed quote expires no later than the subsequently created record.
  // Once this lower bound passes, inspect the server's exact expiry before pay.
  reviewedUntil: number
  uncertainPayment: boolean
}
type TransferPaymentState = {
  id: string
  status: string
  paid_at: string | null
  quote_expires_at: string | null
}

function quoteView(q: ApiQuote): Quote {
  return {
    amountUsd: q.sendAmountMinor / 100, fee: q.feeMinor / 100,
    totalUsd: q.totalChargedMinor / 100, recipientUsd: q.sendAmountMinor / 100,
    recipientLocal: q.receiveAmountMinor / 100, rate: q.effectiveRateE8 / 1e8,
    currency: q.receiveCurrency,
  }
}

function validQuote(q: ApiQuote | undefined): q is ApiQuote {
  return !!q && [q.sendAmountMinor, q.feeMinor, q.totalChargedMinor, q.receiveAmountMinor, q.effectiveRateE8].every(Number.isSafeInteger)
    && q.sendAmountMinor > 0 && q.feeMinor >= 0 && q.totalChargedMinor >= q.sendAmountMinor
    && q.receiveAmountMinor > 0 && q.effectiveRateE8 > 0 && q.sendCurrency === 'USD' && /^[A-Z]{3}$/.test(q.receiveCurrency)
}

export function TransferProvider({ children }: { children: ReactNode }) {
  const { user: account, isDemo } = useAuth()
  const { recipients: mine, corridors: availableCorridors, loading, error: accountError, refresh } = useAccountData()
  const live = !isDemo
  const [selection, setSelection] = useState<{ owner: string; id: string } | null>(null)
  const owner = isDemo ? 'demo' : account?.id ?? 'signed-out'
  const recipientId = selection?.owner === owner ? selection.id : isDemo ? recipients[0].id : ''
  const setRecipientId = useCallback((id: string) => setSelection({ owner, id }), [owner])
  const [amountUsd, setAmountUsd] = useState(500)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodId>('bank')
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>('mobile')
  const [history, setHistory] = useState<Transaction[]>(seedTransactions)
  const [receipt, setReceipt] = useState<(TransferReceipt & { owner: string }) | null>(null)
  const [commitError, setCommitError] = useState<string | null>(null)
  const [serverQuote, setServerQuote] = useState<{ key: string; quote: ApiQuote } | null>(null)
  const [quoteFailure, setQuoteFailure] = useState<{ key: string; message: string } | null>(null)
  const [quoteRevision, setQuoteRevision] = useState(0)
  const pendingPayments = useRef(new Map<string, PendingPayment>())
  const ambiguousCreations = useRef(new Set<string>())
  const committing = useRef(false)
  const mineSelected = live ? mine.find((r) => r.id === recipientId) : undefined
  const liveCorridor = mineSelected ? availableCorridors.find((c) => c.receive_country === mineSelected.country && c.send_currency === 'USD') : undefined
  const quoteKey = `${owner}:${mineSelected?.id ?? ''}:${liveCorridor?.id ?? ''}:${Math.round(amountUsd * 100)}`

  const recipient = useMemo(() => {
    if (isDemo) return getRecipient(recipientId)
    if (!mineSelected) return emptyRecipient
    return {
      ...emptyRecipient, id: mineSelected.id, name: mineSelected.full_name,
      phone: mineSelected.phone ?? '', wallet: mineSelected.bank_name ?? mineSelected.payout_method.replaceAll('_', ' '),
      last4: mineSelected.phone?.slice(-4) ?? '', hue: hueFor(mineSelected.full_name),
      corridorCode: mineSelected.country, relation: mineSelected.relationship ?? '',
    }
  }, [isDemo, mineSelected, recipientId])

  useEffect(() => {
    if (isDemo || !account || !mineSelected || !liveCorridor || !Number.isFinite(amountUsd) || amountUsd <= 0) return
    let cancelled = false
    const timeout = window.setTimeout(() => {
      void api.post<{ quote: ApiQuote }>('/quote', {
        corridorId: liveCorridor.id, sendAmountMinor: Math.round(amountUsd * 100),
      }).then(({ quote: q }) => {
        if (cancelled) return
        if (!validQuote(q) || q.receiveCurrency !== liveCorridor.receive_currency || q.sendAmountMinor !== Math.round(amountUsd * 100)
          || !Number.isFinite(Date.parse(q.expiresAt)) || Date.parse(q.expiresAt) <= Date.now()) {
          throw new Error('A current transfer quote is unavailable.')
        }
        setServerQuote({ key: quoteKey, quote: q }); setQuoteFailure(null)
      }).catch((err: unknown) => {
        if (!cancelled) setQuoteFailure({ key: quoteKey, message: err instanceof Error ? err.message : 'A current transfer quote is unavailable.' })
      })
    }, 200)
    return () => { cancelled = true; window.clearTimeout(timeout) }
  }, [isDemo, account, mineSelected, liveCorridor, amountUsd, quoteKey, quoteRevision])

  const currentQuote = serverQuote?.key === quoteKey && Date.parse(serverQuote.quote.expiresAt) > Date.now() ? serverQuote.quote : null
  const quoteReady = isDemo || !!currentQuote
  const quoteLoading = live && !!mineSelected && !!liveCorridor && !currentQuote && quoteFailure?.key !== quoteKey
  const corridor = useMemo(() => {
    if (isDemo) return getCorridor(recipient.corridorCode)
    const country = recipient.corridorCode
    const known = demoCorridors.find((c) => c.code === country)
    return {
      code: country, currency: liveCorridor?.receive_currency ?? '',
      country: known?.country ?? (/^[A-Z]{2}$/.test(country) ? new Intl.DisplayNames(['en'], { type: 'region' }).of(country) ?? country : country), countryI18n: known?.countryI18n ?? {},
      flag: /^[A-Z]{2}$/.test(country) ? String.fromCodePoint(...[...country].map((c) => 127397 + c.charCodeAt(0))) : '',
      rate: currentQuote ? currentQuote.effectiveRateE8 / 1e8 : 0,
      currencyName: liveCorridor?.receive_currency === 'USD' ? 'US Dollar' : liveCorridor?.receive_currency ?? '', wallets: [],
    }
  }, [isDemo, recipient.corridorCode, liveCorridor, currentQuote])

  const quote = useMemo<Quote>(() => {
    if (live) return currentQuote ? quoteView(currentQuote) : { amountUsd, fee: 0, totalUsd: amountUsd, recipientUsd: 0, recipientLocal: 0, rate: 0, currency: liveCorridor?.receive_currency ?? '' }
    const fee = TRANSFER_FEE
    const recipientUsd = FEE_MODE === 'added' ? amountUsd : Math.max(0, amountUsd - fee)
    return { amountUsd, fee, totalUsd: FEE_MODE === 'added' ? amountUsd + fee : amountUsd, recipientUsd, recipientLocal: recipientUsd * corridor.rate, rate: corridor.rate, currency: corridor.currency }
  }, [live, currentQuote, amountUsd, liveCorridor, corridor])

  const availableError = isDemo ? null
    : !account ? 'Sign in to create a test transfer.'
      : loading ? 'Loading your account…'
        : accountError ? accountError
          : !mineSelected ? 'Choose one of your saved recipients before continuing.'
            : !liveCorridor ? 'Transfers to this recipient’s country are currently unavailable.'
              : account.status !== 'active' ? 'This account cannot create transfers.'
                : account.kycStatus !== 'verified' ? 'Identity verification is required before a test transfer.'
                  : quoteFailure?.key === quoteKey ? quoteFailure.message
                    : !currentQuote ? 'A current transfer quote is required before continuing.' : null

  const commit = useCallback(async (password: string): Promise<Transaction> => {
    setCommitError(null)
    if (committing.current) throw new Error('A transfer request is already being processed.')
    committing.current = true
    try {
      if (!isDemo) {
        if (availableError || !account || !mineSelected || !liveCorridor || !currentQuote) throw new Error(availableError ?? 'A test transfer is currently unavailable.')
        if (!password) throw new Error('Enter your account password to authorize this test.')
        if (ambiguousCreations.current.has(quoteKey)) throw new Error('The previous transfer request could not be confirmed. Check your activity before creating another test.')
        let pending = pendingPayments.current.get(quoteKey)
        if (pending && pending.reviewedUntil <= Date.now()) {
          const { transfer: state } = await api.get<{ transfer: TransferPaymentState }>(`/transfers/${pending.transfer.id}`)
          if (!state || state.id !== pending.transfer.id || state.paid_at !== null
            || !['awaiting_payment', 'compliance_hold'].includes(state.status)) {
            throw new Error('The earlier payment status must be checked in your activity before another test can be created.')
          }
          const expiresAt = typeof state.quote_expires_at === 'string' ? Date.parse(state.quote_expires_at) : NaN
          if (!Number.isFinite(expiresAt)) throw new Error('The earlier transfer expiry could not be verified. Check your activity before trying again.')
          if (expiresAt <= Date.now()) {
            if (pending.uncertainPayment) throw new Error('The earlier payment result could not be confirmed. Check your activity before creating another test.')
            pendingPayments.current.delete(quoteKey)
            setServerQuote(null); setQuoteFailure(null); setQuoteRevision((revision) => revision + 1)
            throw new Error('The earlier test quote expired. A new quote is being requested; review it before trying again.')
          }
          pending.reviewedUntil = expiresAt
        }
        if (Date.parse(currentQuote.expiresAt) <= Date.now()) {
          setServerQuote(null); setQuoteFailure(null); setQuoteRevision((revision) => revision + 1)
          throw new Error('Your quote expired. A new test quote is being requested; review it before continuing.')
        }
        if (!pending) {
          try {
            const response = await api.post<{ transfer: CreatedTransfer }>('/transfers', {
              corridorId: liveCorridor.id, recipientId: mineSelected.id, sendAmountMinor: Math.round(amountUsd * 100),
            })
            if (!response.transfer?.id || !response.transfer.reference || !validQuote(response.transfer)) {
              ambiguousCreations.current.add(quoteKey)
              throw new Error('The transfer could not be verified. Check your activity before trying again.')
            }
            pending = { transfer: response.transfer, reviewedUntil: Date.parse(currentQuote.expiresAt), uncertainPayment: false }
            pendingPayments.current.set(quoteKey, pending)
          } catch (err) {
            if (err instanceof ApiError && (err.status === 0 || err.status >= 500)) {
              ambiguousCreations.current.add(quoteKey)
              throw new Error('The transfer request could not be confirmed. Check your activity before trying again.')
            }
            throw err
          }
        }
        const created = pending.transfer
        const previouslyUncertain = pending.uncertainPayment
        pending.uncertainPayment = true
        let paid: { ok: boolean; status: string; testMode: boolean }
        try {
          paid = await api.post(`/transfers/${created.id}/pay`, { password })
        } catch (err) {
          if (!previouslyUncertain && err instanceof ApiError
            && ((err.code === 'authorization_failed' && err.status === 401) || (err.code === 'quote_expired' && err.status === 409))) {
            pending.uncertainPayment = false
            if (err.code === 'quote_expired') {
              pendingPayments.current.delete(quoteKey)
              setServerQuote(null); setQuoteFailure(null); setQuoteRevision((revision) => revision + 1)
              throw new Error('The earlier test quote expired. A new quote is being requested; review it before trying again.')
            }
          }
          throw err
        }
        if (paid.ok !== true || paid.testMode !== true || typeof paid.status !== 'string') throw new Error('The test transfer status could not be verified. Check your activity.')
        const q = quoteView(created)
        const tx: Transaction = { id: created.id, recipientId: mineSelected.id, amountUsd: q.amountUsd, fee: q.fee, date: new Date().toISOString(), status: 'pending', reference: created.reference }
        setReceipt({ owner, transaction: tx, quote: q, recipient, isDemo: false, status: paid.status })
        pendingPayments.current.delete(quoteKey)
        await refresh()
        return tx
      }
      const tx: Transaction = { id: `demo-${Date.now()}`, recipientId, amountUsd, fee: TRANSFER_FEE, date: new Date().toISOString(), status: 'completed', reference: makeReference() }
      setHistory((prev) => [tx, ...prev])
      setReceipt({ owner, transaction: tx, quote, recipient, isDemo: true, status: 'demo_completed' })
      return tx
    } catch (err) {
      if (!isDemo && (pendingPayments.current.has(quoteKey) || ambiguousCreations.current.has(quoteKey))) await refresh()
      setCommitError(err instanceof Error ? err.message : 'Could not create that transfer.')
      throw err
    } finally { committing.current = false }
  }, [isDemo, availableError, account, mineSelected, liveCorridor, currentQuote, amountUsd, recipient, refresh, owner, recipientId, quote, quoteKey])

  const reset = useCallback(() => {
    setAmountUsd(500); setPaymentMethod('bank'); setDeliveryMethod('mobile'); setCommitError(null); setReceipt(null)
  }, [])
  const lastReceipt = receipt?.owner === owner ? receipt : null
  const value = useMemo<TransferValue>(() => ({
    recipientId, setRecipientId, amountUsd, setAmountUsd, paymentMethod, setPaymentMethod,
    deliveryMethod, setDeliveryMethod, recipient, corridor, quote, history: isDemo ? history : [],
    lastTransaction: lastReceipt?.transaction ?? null, lastReceipt,
    commit, reset, live, commitError, availableError, quoteReady, quoteLoading,
  }), [recipientId, setRecipientId, amountUsd, paymentMethod, deliveryMethod, recipient, corridor, quote, isDemo, history, lastReceipt, commit, reset, live, commitError, availableError, quoteReady, quoteLoading])
  return <TransferContext.Provider value={value}>{children}</TransferContext.Provider>
}
