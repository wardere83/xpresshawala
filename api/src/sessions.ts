import type { Context, Next } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { hashToken, newId, randomHex } from './crypto'
import type { Env, SessionAdmin, SessionUser, Vars } from './env'

export const USER_COOKIE = 'xt_session'
export const ADMIN_COOKIE = 'xt_admin'

const USER_TTL_SECONDS = 60 * 60 * 24 * 30 // 30 days
/** Staff sessions are deliberately short: they can move other people's money. */
const ADMIN_TTL_SECONDS = 60 * 60 * 8

type Ctx = Context<{ Bindings: Env; Variables: Vars }>

/**
 * SameSite=None because the native apps call this API cross-origin from
 * capacitor://localhost. Under Lax the cookie is simply never sent from the
 * WebView, so sign-in succeeds and every subsequent request is anonymous.
 *
 * None requires Secure, which holds in production. The CORS allowlist in
 * index.ts is what keeps this from being an open door: only the site and the
 * app origins may make credentialed calls.
 */
function cookieOptions(env: Env, maxAge: number) {
  const isDev = env.ENVIRONMENT === 'development'
  return {
    httpOnly: true,
    secure: !isDev,
    sameSite: (isDev ? 'Lax' : 'None') as 'Lax' | 'None',
    path: '/',
    maxAge,
  }
}

export async function issueUserSession(c: Ctx, userId: string, expectedPasswordHash?: string): Promise<boolean> {
  const token = randomHex(32)
  const expiresAt = new Date(Date.now() + USER_TTL_SECONDS * 1000).toISOString()
  const result = await c.env.DB.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, ip, user_agent, created_at)
     SELECT ?, id, ?, ?, ?, ?, ? FROM users
      WHERE id = ? AND status = 'active' AND (? IS NULL OR password_hash = ?)`,
  )
    .bind(
      newId('ses'),
      await hashToken(token),
      expiresAt,
      c.req.header('cf-connecting-ip') ?? null,
      c.req.header('user-agent') ?? null,
      new Date().toISOString(),
      userId,
      expectedPasswordHash ?? null,
      expectedPasswordHash ?? null,
    )
    .run()
  // A password reset or account deletion may finish while login is hashing.
  // That request must not mint a new session from its old credential check.
  if (result.meta.changes !== 1) return false
  setCookie(c, USER_COOKIE, token, cookieOptions(c.env, USER_TTL_SECONDS))
  return true
}

export async function issueAdminSession(c: Ctx, adminId: string): Promise<void> {
  const token = randomHex(32)
  const expiresAt = new Date(Date.now() + ADMIN_TTL_SECONDS * 1000).toISOString()
  await c.env.DB.prepare(
    `INSERT INTO admin_sessions (id, admin_id, token_hash, expires_at, ip, user_agent, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      newId('asn'),
      adminId,
      await hashToken(token),
      expiresAt,
      c.req.header('cf-connecting-ip') ?? null,
      c.req.header('user-agent') ?? null,
      new Date().toISOString(),
    )
    .run()
  setCookie(c, ADMIN_COOKIE, token, cookieOptions(c.env, ADMIN_TTL_SECONDS))
}

export async function revokeUserSession(c: Ctx): Promise<void> {
  const token = getCookie(c, USER_COOKIE)
  if (token) {
    await c.env.DB.prepare(`UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL`)
      .bind(new Date().toISOString(), await hashToken(token))
      .run()
  }
  deleteCookie(c, USER_COOKIE, { path: '/' })
}

export async function revokeAdminSession(c: Ctx): Promise<void> {
  const token = getCookie(c, ADMIN_COOKIE)
  if (token) {
    await c.env.DB.prepare(
      `UPDATE admin_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL`,
    )
      .bind(new Date().toISOString(), await hashToken(token))
      .run()
  }
  deleteCookie(c, ADMIN_COOKIE, { path: '/' })
}

/** Rejects anything without a live customer session. */
export async function requireUser(c: Ctx, next: Next) {
  const token = getCookie(c, USER_COOKIE)
  if (!token) return c.json({ error: 'not_authenticated' }, 401)

  const row = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.first_name, u.last_name, u.kyc_status, u.kyc_tier, u.status, u.created_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?`,
  )
    .bind(await hashToken(token), new Date().toISOString())
    .first<Record<string, string | number>>()

  if (!row) return c.json({ error: 'not_authenticated' }, 401)
  if (row.status !== 'active') return c.json({ error: 'account_suspended' }, 403)

  const user: SessionUser = {
    id: String(row.id),
    email: String(row.email),
    firstName: String(row.first_name),
    lastName: String(row.last_name),
    kycStatus: String(row.kyc_status),
    kycTier: Number(row.kyc_tier),
    status: String(row.status),
    createdAt: String(row.created_at),
  }
  c.set('user', user)
  await next()
}

/** Rejects anything without a live staff session. */
export async function requireAdmin(c: Ctx, next: Next) {
  const token = getCookie(c, ADMIN_COOKIE)
  if (!token) return c.json({ error: 'not_authenticated' }, 401)

  const row = await c.env.DB.prepare(
    `SELECT a.id, a.email, a.name, a.role, a.status
       FROM admin_sessions s JOIN admins a ON a.id = s.admin_id
      WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?`,
  )
    .bind(await hashToken(token), new Date().toISOString())
    .first<Record<string, string>>()

  if (!row) return c.json({ error: 'not_authenticated' }, 401)
  if (row.status !== 'active') return c.json({ error: 'account_disabled' }, 403)

  c.set('admin', {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role as SessionAdmin['role'],
  })
  await next()
}

/** Route guard for actions only senior staff may take. */
export function requireRole(...roles: SessionAdmin['role'][]) {
  return async (c: Ctx, next: Next) => {
    const admin = c.get('admin')
    if (!admin || !roles.includes(admin.role)) {
      return c.json({ error: 'insufficient_role' }, 403)
    }
    await next()
  }
}
