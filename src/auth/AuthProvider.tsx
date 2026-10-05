import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, ApiError, type AccountUser } from '../lib/api'
import { type AuthState, Ctx } from './AuthContext'

/**
 * The demo walkthrough's synthetic user. Entirely local: it is never sent to
 * the API, and the data providers treat a demo session as not-live, so every
 * screen falls back to the seeded sample data rather than anyone's account.
 */
const DEMO_USER: AccountUser = {
  id: 'demo',
  email: 'demo@xpresstend.com',
  firstName: 'Amina',
  lastName: 'Demo',
  kycStatus: 'approved',
  kycTier: 1,
  status: 'active',
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AccountUser | null>(null)
  const [demo, setDemo] = useState(false)
  const [loading, setLoading] = useState(true)

  const loadSession = useCallback(async () => {
    const { user } = await api.get<{ user: AccountUser }>('/auth/me')
    setUser(user)
    return user
  }, [])

  const refresh = useCallback(async () => {
    try {
      await loadSession()
    } catch (err) {
      // 401 simply means signed out; anything else is left to the caller's UI.
      if (!(err instanceof ApiError) || err.status !== 401) console.warn('session check failed', err)
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [loadSession])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const value = useMemo<AuthState>(
    () => ({
      // A real session, when one exists, always outranks the demo.
      user: user ?? (demo ? DEMO_USER : null),
      loading,
      isDemo: demo && !user,
      enterDemo: () => {
        setDemo(true)
        setLoading(false)
      },
      refresh,
      signIn: async (email, password) => {
        await api.post('/auth/login', { email, password })
        // A successful login response alone does not prove the session cookie
        // was accepted. Do not navigate into a signed-out or demo account.
        await loadSession()
        setDemo(false)
      },
      register: async (input) => {
        await api.post('/auth/register', input)
        try {
          await loadSession()
        } catch (err) {
          if (err instanceof ApiError && err.status === 401) {
            throw new ApiError(401, 'registration_incomplete', 'If you already have an account, sign in or reset your password. Otherwise, please try again.')
          }
          throw err
        }
        setDemo(false)
      },
      signOut: async () => {
        if (demo && !user) {
          setDemo(false)
          return
        }
        await api.post('/auth/logout')
        setUser(null)
        setDemo(false)
      },
    }),
    [user, demo, loading, refresh, loadSession],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
