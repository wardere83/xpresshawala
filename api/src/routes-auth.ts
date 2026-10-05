import { Hono } from 'hono'
import { PBKDF2_ITERATIONS, hashPassword, newId, randomHex, verifyPassword } from './crypto'
import { audit } from './audit'
import type { Env, Vars } from './env'
import { issueAdminSession, issueUserSession, requireAdmin, requireUser, revokeAdminSession, revokeUserSession } from './sessions'
import { LOGIN_IP_LIMIT, REGISTER_IP_LIMIT, callerKey, overLimit } from './ratelimit'
import { customerLifecycle } from './routes-customer-lifecycle'
import { customerPasswordProblem } from './customer-lifecycle'

/** Five bad attempts, then a fifteen-minute lock on that account. */
const MAX_FAILED_LOGINS = 5
const LOCKOUT_MINUTES = 15

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const auth = new Hono<{ Bindings: Env; Variables: Vars }>()
auth.route('/', customerLifecycle)

auth.post('/register', async (c) => {
  if (await overLimit(c.env, 'register', callerKey(c.req.raw), REGISTER_IP_LIMIT)) {
    return c.json({ error: 'too_many_requests' }, 429)
  }
  const body = ((await c.req.json().catch(() => ({}))) as {
    email?: string; password?: string; firstName?: string; lastName?: string; language?: string
  })

  const email = (body.email ?? '').trim().toLowerCase()
  const password = body.password ?? ''
  const firstName = (body.firstName ?? '').trim()
  const lastName = (body.lastName ?? '').trim()

  if (!EMAIL_RE.test(email)) return c.json({ error: 'invalid_email' }, 400)
  if (!firstName || !lastName) return c.json({ error: 'name_required' }, 400)
  const pwProblem = customerPasswordProblem(password)
  if (pwProblem) return c.json({ error: 'weak_password', message: pwProblem }, 400)

  const existing = await c.env.DB.prepare(`SELECT id FROM users WHERE lower(email) = ?`).bind(email).first()
  if (existing) {
    // Deliberately the same shape as success: whether an email is registered
    // is not something an unauthenticated caller gets to enumerate.
    return c.json({ ok: true, verificationRequired: true })
  }

  const salt = randomHex(16)
  const hash = await hashPassword(password, salt, PBKDF2_ITERATIONS, c.env.SESSION_PEPPER ?? '')
  const id = newId('usr')
  const now = new Date().toISOString()

  const inserted = await c.env.DB.prepare(
    `INSERT INTO users (id, email, password_hash, password_salt, password_iterations,
                        first_name, last_name, preferred_language, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
  )
    .bind(id, email, hash, salt, PBKDF2_ITERATIONS, firstName, lastName, body.language ?? 'en', now, now)
    .run()
  if (inserted.meta.changes !== 1) return c.json({ ok: true, verificationRequired: true })

  await audit(c.env.DB, {
    actorType: 'customer', actorId: id, action: 'user.registered', entityType: 'user', entityId: id,
    ip: c.req.header('cf-connecting-ip'), userAgent: c.req.header('user-agent'),
  })

  if (!await issueUserSession(c, id, hash)) return c.json({ error: 'account_changed' }, 409)
  return c.json({ ok: true, verificationRequired: true })
})

auth.post('/login', async (c) => {
  // Before any hashing: the cost of the hash is the point of the attack.
  if (await overLimit(c.env, 'login', callerKey(c.req.raw), LOGIN_IP_LIMIT)) {
    return c.json({ error: 'too_many_requests' }, 429)
  }
  const body = ((await c.req.json().catch(() => ({}))) as { email?: string; password?: string })
  const email = (body.email ?? '').trim().toLowerCase()
  const password = body.password ?? ''

  const row = await c.env.DB.prepare(
    `SELECT id, password_hash, password_salt, password_iterations, status, failed_login_count, locked_until
       FROM users WHERE lower(email) = ?`,
  ).bind(email).first<Record<string, string | number>>()

  // Uniform failure so timing and wording never reveal whether the account exists.
  const fail = () => c.json({ error: 'invalid_credentials' }, 401)

  if (!row) {
    // Burn comparable time so a missing account is not measurably faster.
    await hashPassword(password, 'decoy', PBKDF2_ITERATIONS, c.env.SESSION_PEPPER ?? '')
    return fail()
  }

  if (row.locked_until && String(row.locked_until) > new Date().toISOString()) {
    return c.json({ error: 'account_locked', until: row.locked_until }, 429)
  }

  const ok = await verifyPassword(
    password, String(row.password_salt), Number(row.password_iterations),
    String(row.password_hash), c.env.SESSION_PEPPER ?? '',
  )

  if (!ok) {
    const failures = Number(row.failed_login_count) + 1
    const lockedUntil =
      failures >= MAX_FAILED_LOGINS
        ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000).toISOString()
        : null
    await c.env.DB.prepare(
      `UPDATE users SET failed_login_count = ?, locked_until = ?, updated_at = ? WHERE id = ? AND status='active' AND password_hash=?`,
    ).bind(failures, lockedUntil, new Date().toISOString(), row.id, row.password_hash).run()
    await audit(c.env.DB, {
      actorType: 'customer', actorId: String(row.id), action: 'user.login_failed',
      entityType: 'user', entityId: String(row.id), metadata: { failures },
      ip: c.req.header('cf-connecting-ip'), userAgent: c.req.header('user-agent'),
    })
    return fail()
  }

  if (row.status !== 'active') return c.json({ error: 'account_suspended' }, 403)

  const now = new Date().toISOString()
  await c.env.DB.prepare(
    `UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = ?, updated_at = ? WHERE id = ? AND status='active' AND password_hash=?`,
  ).bind(now, now, row.id, row.password_hash).run()

  if (!await issueUserSession(c, String(row.id), String(row.password_hash))) return fail()
  await audit(c.env.DB, {
    actorType: 'customer', actorId: String(row.id), action: 'user.login',
    entityType: 'user', entityId: String(row.id),
    ip: c.req.header('cf-connecting-ip'), userAgent: c.req.header('user-agent'),
  })
  return c.json({ ok: true })
})

auth.post('/logout', async (c) => {
  await revokeUserSession(c)
  return c.json({ ok: true })
})

auth.get('/me', requireUser, (c) => c.json({ user: c.get('user') }))

// ------------------------------------------------------------------ staff
export const adminAuth = new Hono<{ Bindings: Env; Variables: Vars }>()

adminAuth.post('/login', async (c) => {
  if (await overLimit(c.env, 'admin_login', callerKey(c.req.raw), LOGIN_IP_LIMIT)) {
    return c.json({ error: 'too_many_requests' }, 429)
  }
  const body = ((await c.req.json().catch(() => ({}))) as { email?: string; password?: string })
  const email = (body.email ?? '').trim().toLowerCase()
  const password = body.password ?? ''

  const row = await c.env.DB.prepare(
    `SELECT id, password_hash, password_salt, password_iterations, status, failed_login_count, locked_until
       FROM admins WHERE lower(email) = ?`,
  ).bind(email).first<Record<string, string | number>>()

  if (!row) {
    await hashPassword(password, 'decoy', PBKDF2_ITERATIONS, c.env.SESSION_PEPPER ?? '')
    return c.json({ error: 'invalid_credentials' }, 401)
  }
  if (row.locked_until && String(row.locked_until) > new Date().toISOString()) {
    return c.json({ error: 'account_locked' }, 429)
  }

  const ok = await verifyPassword(
    password, String(row.password_salt), Number(row.password_iterations),
    String(row.password_hash), c.env.SESSION_PEPPER ?? '',
  )
  if (!ok) {
    const failures = Number(row.failed_login_count) + 1
    // Staff lock out harder and for longer than customers.
    const lockedUntil = failures >= 3 ? new Date(Date.now() + 30 * 60_000).toISOString() : null
    await c.env.DB.prepare(`UPDATE admins SET failed_login_count = ?, locked_until = ? WHERE id = ?`)
      .bind(failures, lockedUntil, row.id).run()
    await audit(c.env.DB, {
      actorType: 'admin', actorId: String(row.id), action: 'admin.login_failed',
      metadata: { failures }, ip: c.req.header('cf-connecting-ip'),
    })
    return c.json({ error: 'invalid_credentials' }, 401)
  }
  if (row.status !== 'active') return c.json({ error: 'account_disabled' }, 403)

  await c.env.DB.prepare(
    `UPDATE admins SET failed_login_count = 0, locked_until = NULL, last_login_at = ? WHERE id = ?`,
  ).bind(new Date().toISOString(), row.id).run()

  await issueAdminSession(c, String(row.id))
  await audit(c.env.DB, {
    actorType: 'admin', actorId: String(row.id), action: 'admin.login',
    ip: c.req.header('cf-connecting-ip'), userAgent: c.req.header('user-agent'),
  })
  return c.json({ ok: true })
})

adminAuth.post('/logout', async (c) => {
  await revokeAdminSession(c)
  return c.json({ ok: true })
})

adminAuth.get('/me', requireAdmin, (c) => c.json({ admin: c.get('admin') }))
