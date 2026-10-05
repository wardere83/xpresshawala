import type { Env } from './env'

/**
 * Rate limiting for the expensive authentication paths.
 *
 * Password hashing is deliberately slow, which makes it a cheap way to burn
 * Worker CPU: a flood of random emails costs an attacker nothing and costs the
 * account a great deal. Account lockout alone does not help, because it is
 * per-account and itself a denial of service against a known customer.
 *
 * Counts are kept in D1 rather than memory, since Workers are per-isolate and
 * an in-memory counter would reset constantly and enforce nothing.
 */
export interface Limit {
  /** Requests permitted inside the window. */
  max: number
  windowSeconds: number
}

export const LOGIN_IP_LIMIT: Limit = { max: 20, windowSeconds: 600 }
export const REGISTER_IP_LIMIT: Limit = { max: 10, windowSeconds: 3600 }
export const PAY_IP_LIMIT: Limit = { max: 30, windowSeconds: 600 }

/**
 * Staff account recovery, limited on two axes at once.
 *
 * Per caller, to stop one source walking a list of addresses looking for which
 * ones have console access. Per address, because that is the limit a botnet
 * cannot dodge by spreading out: without it, many IPs could bury someone's
 * inbox in reset mail, which is harassment and also a way to hide a genuine
 * security notice among the noise.
 *
 * Deliberately tight. A real person needs one or two of these a year, so five
 * an hour is generous and anything above it is not a person.
 */
export const FORGOT_IP_LIMIT: Limit = { max: 10, windowSeconds: 3600 }
export const FORGOT_ACCOUNT_LIMIT: Limit = { max: 5, windowSeconds: 3600 }

/**
 * Records one hit and reports whether the caller is over the limit.
 *
 * Fails open on a storage error: a rate limiter that takes the whole service
 * down when its own table misbehaves is worse than the abuse it prevents.
 */
export async function overLimit(env: Env, bucket: string, key: string, limit: Limit, failClosed = false): Promise<boolean> {
  const now = Date.now()
  const windowStart = new Date(now - limit.windowSeconds * 1000).toISOString()
  const id = `${bucket}:${key}`

  try {
    await env.DB.prepare(
      `INSERT INTO rate_hits (id, bucket, key, created_at) VALUES (?, ?, ?, ?)`,
    ).bind(`${id}:${now}:${Math.random().toString(36).slice(2, 8)}`, bucket, key, new Date(now).toISOString()).run()

    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM rate_hits WHERE bucket = ? AND key = ? AND created_at > ?`,
    ).bind(bucket, key, windowStart).first<{ n: number }>()

    // Opportunistic cleanup; the table is otherwise unbounded.
    if ((row?.n ?? 0) % 25 === 0) {
      await env.DB.prepare(`DELETE FROM rate_hits WHERE created_at < ?`)
        .bind(new Date(now - 24 * 3600 * 1000).toISOString()).run()
    }

    return (row?.n ?? 0) > limit.max
  } catch (err) {
    console.error('rate limit check failed', err)
    return failClosed
  }
}

/** The caller's address, or a constant when Cloudflare did not supply one. */
export function callerKey(req: Request): string {
  return req.headers.get('cf-connecting-ip') ?? 'unknown'
}
