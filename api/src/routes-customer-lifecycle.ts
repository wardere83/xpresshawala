import { Hono } from 'hono'
import { deleteCookie, getCookie } from 'hono/cookie'
import { hashToken } from './crypto.ts'
import {
  CustomerLifecycleError, customerPasswordProblem, deleteCustomerAccount,
  redeemCustomerPasswordReset, requestCustomerPasswordReset,
} from './customer-lifecycle.ts'
import type { Env, Vars } from './env'
import { FORGOT_ACCOUNT_LIMIT, FORGOT_IP_LIMIT, callerKey, overLimit } from './ratelimit'
import { USER_COOKIE, requireUser } from './sessions'

const UNIFORM = { ok: true, message: 'If an active account matches that address, a password reset email will be sent. Check your inbox and spam folder.' } as const
const RESET_LIMIT = { max: 20, windowSeconds: 600 }
const DELETE_LIMIT = { max: 5, windowSeconds: 600 }
export const customerLifecycle = new Hono<{ Bindings: Env; Variables: Vars }>()

customerLifecycle.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store')
  await next()
})

function trustedMutation(req: Request, env: Env): boolean {
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) return false
  const origin = req.headers.get('origin')
  if (!origin) return req.headers.get('sec-fetch-site') !== 'cross-site'
  const allowed = new Set([env.APP_ORIGIN, 'https://www.xpresstend.com', 'capacitor://localhost', 'https://localhost', 'http://localhost'])
  if (env.ENVIRONMENT === 'development') allowed.add('http://localhost:5173')
  return allowed.has(origin)
}

async function bodyOf(req: { json(): Promise<unknown> }): Promise<Record<string, unknown>> {
  const value = await req.json().catch(() => null)
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

customerLifecycle.post('/forgot-password', async (c) => {
  if (!trustedMutation(c.req.raw, c.env)) return c.json(UNIFORM)
  const body = await bodyOf(c.req)
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    || await overLimit(c.env, 'customer_reset_ip', callerKey(c.req.raw), FORGOT_IP_LIMIT, true)
    || await overLimit(c.env, 'customer_reset_account', await hashToken(email), FORGOT_ACCOUNT_LIMIT, true)) return c.json(UNIFORM)
  const pending = requestCustomerPasswordReset(c.env, email, { ip: c.req.header('cf-connecting-ip'), userAgent: c.req.header('user-agent') })
    .catch(() => { console.error('customer password recovery processing failed') })
  // Account lookup and mail delivery do not alter the response or its timing.
  c.executionCtx.waitUntil(pending)
  return c.json(UNIFORM)
})

customerLifecycle.post('/reset-password', async (c) => {
  if (!trustedMutation(c.req.raw, c.env)) return c.json({ error: 'invalid_request' }, 400)
  if (await overLimit(c.env, 'customer_reset_redeem_ip', callerKey(c.req.raw), RESET_LIMIT, true)) {
    return c.json({ error: 'too_many_requests' }, 429)
  }
  const body = await bodyOf(c.req)
  const token = typeof body.token === 'string' ? body.token : ''
  const password = typeof body.password === 'string' ? body.password : ''
  const problem = customerPasswordProblem(password)
  if (problem) return c.json({ error: 'weak_password', message: problem }, 400)
  try {
    await redeemCustomerPasswordReset(c.env, token, password, { ip: c.req.header('cf-connecting-ip'), userAgent: c.req.header('user-agent') })
    deleteCookie(c, USER_COOKIE, { path: '/' })
    return c.json({ ok: true })
  } catch (error) {
    if (error instanceof CustomerLifecycleError) return c.json({ error: error.code }, 400)
    throw error
  }
})

customerLifecycle.delete('/account', requireUser, async (c) => {
  if (!trustedMutation(c.req.raw, c.env)) return c.json({ error: 'invalid_request' }, 400)
  if (await overLimit(c.env, 'customer_delete', c.get('user').id, DELETE_LIMIT, true)) {
    return c.json({ error: 'too_many_requests' }, 429)
  }
  const body = await bodyOf(c.req)
  if (body.confirmation !== 'DELETE') return c.json({ error: 'confirmation_required' }, 400)
  const password = typeof body.password === 'string' ? body.password : ''
  try {
    const retainedFinancialRecords = await deleteCustomerAccount(c.env, c.get('user').id, password, await hashToken(getCookie(c, USER_COOKIE) ?? ''), {
      ip: c.req.header('cf-connecting-ip'), userAgent: c.req.header('user-agent'),
    })
    deleteCookie(c, USER_COOKIE, { path: '/' })
    return c.json({ ok: true, retainedFinancialRecords })
  } catch (error) {
    if (error instanceof CustomerLifecycleError) return c.json({ error: error.code }, error.code === 'invalid_credentials' ? 401 : 409)
    throw error
  }
})
