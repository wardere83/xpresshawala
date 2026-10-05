import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../auth/AuthContext'
import { type AccountDataValue, type ApiRecipient, type ApiTransfer, type ApiCorridor, Ctx } from './AccountData'

export function AccountDataProvider({ children }: { children: ReactNode }) {
  const { user, isDemo } = useAuth()
  const [recipients, setRecipients] = useState<ApiRecipient[]>([])
  const [transfers, setTransfers] = useState<ApiTransfer[]>([])
  const [corridors, setCorridors] = useState<ApiCorridor[]>([])
  const [owner, setOwner] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestId = useRef(0)
  // Account mode is determined synchronously. A loading or failed account
  // request never opens the demo fallback, even for a single render.
  const live = !isDemo
  const current = live && !!user && owner === user.id

  const refresh = useCallback(async () => {
    const request = ++requestId.current
    if (!user || isDemo) {
      setRecipients([]); setTransfers([]); setCorridors([]); setOwner(null)
      setLoading(false); setError(null)
      return
    }
    setLoading(true); setError(null)
    try {
      const [r, t, c] = await Promise.all([
        api.get<{ recipients: ApiRecipient[] }>('/recipients'),
        api.get<{ transfers: ApiTransfer[] }>('/transfers'),
        api.get<{ corridors: ApiCorridor[] }>('/corridors'),
      ])
      if (!Array.isArray(r.recipients) || !Array.isArray(t.transfers) || !Array.isArray(c.corridors)) {
        throw new Error('Account services are temporarily unavailable. Please try again.')
      }
      if (request !== requestId.current) return
      setRecipients(r.recipients); setTransfers(t.transfers); setCorridors(c.corridors)
      setOwner(user.id)
    } catch (err) {
      if (request !== requestId.current) return
      setRecipients([]); setTransfers([]); setCorridors([]); setOwner(user.id)
      setError(err instanceof ApiError ? (err.message || err.code) : err instanceof Error ? err.message : 'Could not load your account.')
    } finally {
      if (request === requestId.current) setLoading(false)
    }
  }, [user, isDemo])

  useEffect(() => {
    void refresh()
    return () => { requestId.current += 1 }
  }, [refresh])

  const value = useMemo<AccountDataValue>(() => ({
    live,
    loading: live && !!user && (loading || !current),
    error: current ? error : null,
    recipients: current ? recipients : [],
    transfers: current ? transfers : [],
    corridors: current ? corridors : [],
    refresh,
    addRecipient: async (input) => {
      if (!user || isDemo) throw new Error('Sign in to save a recipient.')
      await api.post('/recipients', input)
      await refresh()
    },
  }), [live, user, isDemo, current, loading, error, recipients, transfers, corridors, refresh])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
