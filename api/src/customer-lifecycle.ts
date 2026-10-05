import { PBKDF2_ITERATIONS, hashPassword, hashToken, newId, randomHex, verifyPassword } from './crypto.ts'
import { customerPasswordResetEmail, sendEmail } from './email.ts'
import type { Env } from './env'

export const CUSTOMER_RESET_MINUTES = 60
export const CUSTOMER_PASSWORD_MAX_LENGTH = 128

export class CustomerLifecycleError extends Error {
  readonly code: 'invalid_token' | 'weak_password' | 'invalid_credentials' | 'account_deletion_blocked' | 'account_changed'

  constructor(code: 'invalid_token' | 'weak_password' | 'invalid_credentials' | 'account_deletion_blocked' | 'account_changed') {
    super(code)
    this.name = 'CustomerLifecycleError'
    this.code = code
  }
}

export function customerPasswordProblem(password: string): string | null {
  if (password.length < 12) return 'Password must be at least 12 characters.'
  if (password.length > CUSTOMER_PASSWORD_MAX_LENGTH) return 'Password must be no more than 128 characters.'
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password)) return 'Password must mix upper and lower case.'
  if (!/[0-9]/.test(password)) return 'Password must contain a number.'
  return null
}

export function isCustomerResetUsable(row: { status: string; expires_at: string; used_at: string | null; revoked_at: string | null } | null, now = Date.now()): boolean {
  if (!row || row.status !== 'active' || row.used_at || row.revoked_at) return false
  const expires = Date.parse(row.expires_at)
  return Number.isFinite(expires) && expires > now
}

function lifecycleAudit(db: D1Database, args: { userId: string; action: string; now: string; metadata?: unknown; ip?: string; userAgent?: string }, guard?: { sql: string; values: string[] }) {
  return db.prepare(
    `INSERT INTO audit_log(id,actor_type,actor_id,action,entity_type,entity_id,metadata,ip,user_agent,created_at)
     SELECT ?, 'customer', ?, ?, 'user', ?, ?, ?, ?, ?${guard ? ` WHERE ${guard.sql}` : ''}`,
  ).bind(newId('aud'), args.userId, args.action, args.userId,
    args.metadata === undefined ? null : JSON.stringify(args.metadata), args.ip ?? null, args.userAgent ?? null, args.now,
    ...(guard?.values ?? []))
}

/** Runs after the uniform HTTP response. Raw capabilities go only to email. */
export async function requestCustomerPasswordReset(env: Env, email: string, context: { ip?: string; userAgent?: string } = {}): Promise<void> {
  const user = await env.DB.prepare(
    `SELECT id,email,first_name,password_hash FROM users WHERE lower(email)=? AND status='active'`,
  ).bind(email).first<{ id: string; email: string; first_name: string; password_hash: string }>()
  if (!user) return
  const id = newId('crs')
  const token = randomHex(32)
  const now = new Date().toISOString()
  const expires = new Date(Date.now() + CUSTOMER_RESET_MINUTES * 60_000).toISOString()
  const results = await env.DB.batch([
    env.DB.prepare(`UPDATE customer_password_resets SET revoked_at=? WHERE user_id=? AND used_at IS NULL AND revoked_at IS NULL`)
      .bind(now, user.id),
    env.DB.prepare(
      `INSERT INTO customer_password_resets(id,user_id,token_hash,expires_at,created_at)
       SELECT ?,id,?,?,? FROM users WHERE id=? AND status='active' AND password_hash=?`,
    ).bind(id, await hashToken(token), expires, now, user.id, user.password_hash),
  ])
  if (results[1]?.meta.changes !== 1) return
  const origin = new URL(env.APP_ORIGIN)
  if (origin.protocol !== 'https:' && env.ENVIRONMENT !== 'development' && env.ENVIRONMENT !== 'test') {
    throw new Error('Recovery requires an HTTPS application origin')
  }
  const link = `${origin.origin}/#/reset-password/${token}`
  const delivery = await sendEmail(env, { to: user.email, ...customerPasswordResetEmail({ name: user.first_name, link, minutes: CUSTOMER_RESET_MINUTES }) })
  if (!delivery.sent) {
    await env.DB.prepare(`UPDATE customer_password_resets SET revoked_at=? WHERE id=? AND used_at IS NULL AND revoked_at IS NULL`)
      .bind(new Date().toISOString(), id).run()
  }
  await lifecycleAudit(env.DB, {
    userId: user.id, action: 'user.reset_requested', now,
    metadata: { emailConfigured: delivery.configured, emailSent: delivery.sent, provider: delivery.provider ?? null, error: delivery.error ?? null },
    ...context,
  }).run()
}

/** Claim, credentials, token invalidation and session revocation are atomic. */
export async function redeemCustomerPasswordReset(env: Env, token: string, password: string, context: { ip?: string; userAgent?: string } = {}): Promise<void> {
  if (!/^[0-9a-f]{64}$/.test(token)) throw new CustomerLifecycleError('invalid_token')
  if (customerPasswordProblem(password)) throw new CustomerLifecycleError('weak_password')
  const tokenHash = await hashToken(token)
  const row = await env.DB.prepare(
    `SELECT r.id,r.user_id,r.expires_at,r.used_at,r.revoked_at,u.status
       FROM customer_password_resets r JOIN users u ON u.id=r.user_id WHERE r.token_hash=?`,
  ).bind(tokenHash).first<{ id: string; user_id: string; status: string; expires_at: string; used_at: string | null; revoked_at: string | null }>()
  if (!isCustomerResetUsable(row)) throw new CustomerLifecycleError('invalid_token')
  const salt = randomHex(16)
  const hash = await hashPassword(password, salt, PBKDF2_ITERATIONS, env.SESSION_PEPPER ?? '')
  const now = new Date().toISOString()
  const claim = newId('redemption')
  const guard = { sql: `EXISTS (SELECT 1 FROM customer_password_resets WHERE id=? AND claim_id=? AND used_at=?)`, values: [row!.id, claim, now] }
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE customer_password_resets SET used_at=?,claim_id=?
        WHERE id=? AND token_hash=? AND used_at IS NULL AND revoked_at IS NULL AND expires_at>?
          AND EXISTS (SELECT 1 FROM users WHERE id=customer_password_resets.user_id AND status='active')`,
    ).bind(now, claim, row!.id, tokenHash, now),
    env.DB.prepare(
      `UPDATE users SET password_hash=?,password_salt=?,password_iterations=?,failed_login_count=0,locked_until=NULL,updated_at=?
        WHERE id=? AND status='active' AND ${guard.sql}`,
    ).bind(hash, salt, PBKDF2_ITERATIONS, now, row!.user_id, ...guard.values),
    env.DB.prepare(`UPDATE sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL AND ${guard.sql}`)
      .bind(now, row!.user_id, ...guard.values),
    env.DB.prepare(`UPDATE customer_password_resets SET revoked_at=? WHERE user_id=? AND id<>? AND used_at IS NULL AND revoked_at IS NULL AND ${guard.sql}`)
      .bind(now, row!.user_id, row!.id, ...guard.values),
    env.DB.prepare(`UPDATE email_tokens SET used_at=? WHERE user_id=? AND purpose='reset_password' AND used_at IS NULL AND ${guard.sql}`)
      .bind(now, row!.user_id, ...guard.values),
    lifecycleAudit(env.DB, { userId: row!.user_id, action: 'user.password_reset', now, ...context }, guard),
  ])
  if (results[0]?.meta.changes !== 1 || results[1]?.meta.changes !== 1) throw new CustomerLifecycleError('invalid_token')
}

const UNFUNDED_CANCELABLE = `t.status IN ('draft','awaiting_payment','compliance_hold')
  AND t.paid_at IS NULL AND t.payment_provider IS NULL AND t.payment_intent_id IS NULL
  AND t.payout_provider IS NULL AND t.payout_reference IS NULL
  AND NOT EXISTS (SELECT 1 FROM transfer_postings p WHERE p.transfer_id=t.id)
  AND NOT EXISTS (SELECT 1 FROM ledger_entries l WHERE l.transfer_id=t.id)`

/** Correlated with the current users row; every monetary guard is per transfer. */
export const ACCOUNT_FINANCIAL_GUARD = `
  NOT EXISTS (SELECT 1 FROM transfers t WHERE t.user_id=u.id
    AND t.status NOT IN ('completed','failed','cancelled','refunded') AND NOT (${UNFUNDED_CANCELABLE}))
  AND NOT EXISTS (
    SELECT 1 FROM transfers t WHERE t.user_id=u.id AND t.paid_at IS NULL AND
      (t.payment_provider IS NOT NULL OR t.payment_intent_id IS NOT NULL
       OR t.payout_provider IS NOT NULL OR t.payout_reference IS NOT NULL)
  )
  AND NOT EXISTS (
    SELECT 1 FROM ledger_entries l JOIN transfers t ON t.id=l.transfer_id
     WHERE t.user_id=u.id AND l.account_code='payout_payable'
     GROUP BY l.transfer_id,l.currency HAVING SUM(l.amount_minor)<>0
  )
  AND NOT EXISTS (
    SELECT 1 FROM ledger_entries l JOIN transfers t ON t.id=l.transfer_id
     WHERE t.user_id=u.id GROUP BY l.transfer_id,l.entry_group,l.currency HAVING SUM(l.amount_minor)<>0
  )
  AND NOT EXISTS (
    SELECT 1 FROM transfer_postings p JOIN transfers t ON t.id=p.transfer_id
     WHERE t.user_id=u.id AND (t.paid_at IS NULL OR p.kind NOT IN ('funding','payout')
       OR NOT EXISTS (SELECT 1 FROM ledger_entries l WHERE l.transfer_id=t.id AND l.entry_group=p.entry_group))
  )
  AND NOT EXISTS (
    SELECT 1 FROM ledger_entries l JOIN transfers t ON t.id=l.transfer_id
     WHERE t.user_id=u.id AND (t.paid_at IS NULL
       OR NOT EXISTS (SELECT 1 FROM transfer_postings p WHERE p.transfer_id=t.id AND p.entry_group=l.entry_group))
  )
  AND NOT EXISTS (
    SELECT 1 FROM transfers t WHERE t.user_id=u.id AND (
      (t.status='completed' AND t.paid_at IS NULL) OR (t.paid_at IS NOT NULL AND (
      NOT EXISTS (SELECT 1 FROM transfer_postings p WHERE p.transfer_id=t.id AND p.kind='funding')
      OR NOT EXISTS (SELECT 1 FROM transfer_postings p WHERE p.transfer_id=t.id AND p.kind='payout')
      OR NOT EXISTS (SELECT 1 FROM ledger_entries l WHERE l.transfer_id=t.id AND l.account_code='payout_payable')
    )))
  )`

const HAS_RETAINED_RECORDS = `(EXISTS (SELECT 1 FROM transfers t WHERE t.user_id=u.id)
  OR EXISTS (SELECT 1 FROM kyc_checks k WHERE k.user_id=u.id)
  OR EXISTS (SELECT 1 FROM sanctions_screenings s WHERE s.subject_type='user' AND s.subject_id=u.id)
  OR EXISTS (SELECT 1 FROM sanctions_screenings s JOIN recipients r ON r.id=s.subject_id WHERE s.subject_type='recipient' AND r.user_id=u.id))`

/** Removes the live account. Immutable financial/compliance evidence survives. */
export async function deleteCustomerAccount(env: Env, userId: string, password: string, sessionHash: string, context: { ip?: string; userAgent?: string } = {}): Promise<boolean> {
  const user = await env.DB.prepare(
    `SELECT id,password_hash,password_salt,password_iterations,status FROM users WHERE id=?`,
  ).bind(userId).first<{ id: string; password_hash: string; password_salt: string; password_iterations: number; status: string }>()
  if (!user || user.status !== 'active' || !password || password.length > 1024
    || !await verifyPassword(password, user.password_salt, user.password_iterations, user.password_hash, env.SESSION_PEPPER ?? '')) {
    throw new CustomerLifecycleError('invalid_credentials')
  }
  const now = new Date().toISOString()
  const operation = newId('deletion')
  const guard = { sql: `EXISTS (SELECT 1 FROM customer_account_deletions WHERE user_id=? AND operation_id=?)`, values: [userId, operation] }
  const results = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO customer_account_deletions(user_id,operation_id,deleted_at,retained_financial_records)
       SELECT u.id,?,?,CASE WHEN ${HAS_RETAINED_RECORDS} THEN 1 ELSE 0 END FROM users u
        WHERE u.id=? AND u.status='active' AND u.password_hash=? AND ${ACCOUNT_FINANCIAL_GUARD}
          AND EXISTS (SELECT 1 FROM sessions s WHERE s.user_id=u.id AND s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>?)
       ON CONFLICT(user_id) DO NOTHING`,
    ).bind(operation, now, userId, user.password_hash, sessionHash, now),
    env.DB.prepare(
      `INSERT INTO customer_retained_identities(user_id,identity_json,retained_at)
       SELECT u.id,json_object('firstName',u.first_name,'lastName',u.last_name,'country',u.country),?
         FROM users u WHERE u.id=? AND ${guard.sql} AND
          (EXISTS (SELECT 1 FROM transfers t WHERE t.user_id=u.id) OR EXISTS (SELECT 1 FROM kyc_checks k WHERE k.user_id=u.id))`,
    ).bind(now, userId, ...guard.values),
    env.DB.prepare(
      `INSERT INTO transfer_events(id,transfer_id,from_status,to_status,actor_type,actor_id,note,created_at)
       SELECT ? || '_' || t.id,t.id,t.status,'cancelled','customer',?,
              'Unfunded quote cancelled during account deletion',?
         FROM transfers t WHERE t.user_id=? AND ${UNFUNDED_CANCELABLE} AND ${guard.sql}`,
    ).bind(newId('tev'), userId, now, userId, ...guard.values),
    env.DB.prepare(
      `UPDATE transfers AS t SET status='cancelled',updated_at=?
        WHERE t.user_id=? AND ${UNFUNDED_CANCELABLE} AND ${guard.sql}`,
    ).bind(now, userId, ...guard.values),
    env.DB.prepare(
      `UPDATE users SET status='closed',email=?,email_verified_at=NULL,phone=NULL,first_name='Deleted',last_name='Customer',
        country='ZZ',preferred_language='en',password_hash=?,password_salt=?,password_iterations=1,
        kyc_status='unverified',kyc_tier=0,failed_login_count=0,locked_until=NULL,last_login_at=NULL,updated_at=?
       WHERE id=? AND ${guard.sql}`,
    ).bind(`deleted-${userId}@deleted.invalid`, randomHex(32), randomHex(16), now, userId, ...guard.values),
    env.DB.prepare(`DELETE FROM sessions WHERE user_id=? AND ${guard.sql}`).bind(userId, ...guard.values),
    env.DB.prepare(`DELETE FROM email_tokens WHERE user_id=? AND ${guard.sql}`).bind(userId, ...guard.values),
    env.DB.prepare(`DELETE FROM customer_password_resets WHERE user_id=? AND ${guard.sql}`).bind(userId, ...guard.values),
    env.DB.prepare(
      `DELETE FROM recipients WHERE user_id=? AND NOT EXISTS (SELECT 1 FROM transfers t WHERE t.recipient_id=recipients.id) AND ${guard.sql}`,
    ).bind(userId, ...guard.values),
    env.DB.prepare(`UPDATE recipients SET archived_at=COALESCE(archived_at,?),relationship=NULL,updated_at=? WHERE user_id=? AND ${guard.sql}`)
      .bind(now, now, userId, ...guard.values),
    lifecycleAudit(env.DB, {
      userId, action: 'user.account_deleted', now,
      metadata: { retention: 'financial_compliance_records', operationId: operation }, ...context,
    }, guard),
  ])
  if (results[0]?.meta.changes !== 1) {
    const eligible = await env.DB.prepare(`SELECT CASE WHEN ${ACCOUNT_FINANCIAL_GUARD} THEN 1 ELSE 0 END AS eligible FROM users u WHERE u.id=?`)
      .bind(userId).first<{ eligible: number }>()
    throw new CustomerLifecycleError(eligible?.eligible === 0 ? 'account_deletion_blocked' : 'account_changed')
  }
  const closed = await env.DB.prepare(`SELECT retained_financial_records FROM customer_account_deletions WHERE user_id=? AND operation_id=?`)
    .bind(userId, operation).first<{ retained_financial_records: number }>()
  return closed?.retained_financial_records === 1
}
