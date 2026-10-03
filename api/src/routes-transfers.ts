import { Hono } from 'hono'
import { newId, randomHex, verifyPassword } from './crypto'
import { audit } from './audit'
import { fundingPostings } from './ledger'
import { guardedPostingStatements } from './ledger-db'
import { QuoteError, quote, type Corridor } from './money'
import type { Env, Vars } from './env'
import { requireUser } from './sessions'
import {
  auditSanctionsUnavailable,
  checkLimits,
  complianceAuditStatement,
  reportingFlags,
  screenTransferSubjects,
  screeningClaimGuard,
  screeningFailure,
  transferScreeningStatements,
  type TransferScreening,
} from './compliance'


/** How long a quoted rate is honoured before it must be re-quoted. */
const QUOTE_TTL_MINUTES = 15

/**
 * A stored rate is only usable for so long. The newest row was previously
 * accepted whatever its age, so a rate from weeks ago could still produce a
 * freshly timestamped quote and book money at a price that no longer exists.
 */
const RATE_MAX_AGE_MINUTES = 60

function isStale(fetchedAt: string): boolean {
  const age = Date.now() - new Date(fetchedAt).getTime()
  return !Number.isFinite(age) || age > RATE_MAX_AGE_MINUTES * 60_000
}

function reference(): string {
  const block = () => String(Math.floor(Number(`0x${randomHex(2)}`) / 65536 * 9000) + 1000)
  return `XPT-${block()}-${block()}-${new Date().getUTCFullYear()}`
}

export const transfers = new Hono<{ Bindings: Env; Variables: Vars }>()

transfers.get('/corridors', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, send_country, receive_country, send_currency, receive_currency,
            fee_flat_minor, fee_percent_bps, min_send_minor, max_send_minor, fx_margin_bps
       FROM corridors WHERE enabled = 1 ORDER BY receive_country`,
  ).all()
  return c.json({ corridors: results })
})

/** Prices a transfer without creating one. Safe to call on every keystroke. */
transfers.post('/quote', async (c) => {
  const body = ((await c.req.json().catch(() => ({}))) as { corridorId?: string; sendAmountMinor?: number })
  if (!body.corridorId || typeof body.sendAmountMinor !== 'number') {
    return c.json({ error: 'corridor_and_amount_required' }, 400)
  }

  const corridor = await c.env.DB.prepare(`SELECT * FROM corridors WHERE id = ?`)
    .bind(body.corridorId).first<Corridor>()
  if (!corridor) return c.json({ error: 'unknown_corridor' }, 404)

  const rate = await c.env.DB.prepare(
    `SELECT rate_e8, fetched_at FROM fx_rates WHERE base = ? AND quote = ? ORDER BY fetched_at DESC LIMIT 1`,
  ).bind(corridor.send_currency, corridor.receive_currency).first<{ rate_e8: number; fetched_at: string }>()
  if (!rate) return c.json({ error: 'no_rate_available' }, 503)
  if (isStale(rate.fetched_at)) return c.json({ error: 'rate_stale' }, 503)

  try {
    const q = quote(corridor, rate.rate_e8, body.sendAmountMinor)
    return c.json({
      quote: { ...q, corridorId: corridor.id, expiresAt: new Date(Date.now() + QUOTE_TTL_MINUTES * 60_000).toISOString() },
    })
  } catch (err) {
    if (err instanceof QuoteError) return c.json({ error: err.code, message: err.message }, 400)
    throw err
  }
})

transfers.use('/recipients/*', requireUser)
transfers.use('/transfers/*', requireUser)
transfers.use('/transfers', requireUser)
transfers.use('/recipients', requireUser)

transfers.get('/recipients', async (c) => {
  const user = c.get('user')
  const { results } = await c.env.DB.prepare(
    `SELECT id, full_name, country, payout_method, phone, bank_name, relationship, created_at
       FROM recipients WHERE user_id = ? AND archived_at IS NULL ORDER BY created_at DESC`,
  ).bind(user.id).all()
  return c.json({ recipients: results })
})

transfers.post('/recipients', async (c) => {
  const user = c.get('user')
  const b = ((await c.req.json().catch(() => ({}))) as Record<string, string>)
  if (!b.fullName?.trim() || !b.country || !b.payoutMethod) {
    return c.json({ error: 'missing_fields' }, 400)
  }
  const id = newId('rcp')
  const now = new Date().toISOString()
  await c.env.DB.prepare(
    `INSERT INTO recipients (id, user_id, full_name, country, payout_method, phone, account_ref,
                             bank_name, relationship, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, user.id, b.fullName.trim(), b.country, b.payoutMethod, b.phone ?? null,
         b.accountRef ?? null, b.bankName ?? null, b.relationship ?? null, now, now).run()

  await audit(c.env.DB, {
    actorType: 'customer', actorId: user.id, action: 'recipient.created',
    entityType: 'recipient', entityId: id, ip: c.req.header('cf-connecting-ip'),
  })
  return c.json({ ok: true, id })
})

transfers.get('/transfers', async (c) => {
  const user = c.get('user')
  const { results } = await c.env.DB.prepare(
    `SELECT t.id, t.reference, t.send_amount_minor, t.send_currency, t.fee_minor,
            t.receive_amount_minor, t.receive_currency, t.status, t.created_at, t.completed_at,
            r.full_name AS recipient_name, r.country AS recipient_country
       FROM transfers t JOIN recipients r ON r.id = t.recipient_id
      WHERE t.user_id = ? ORDER BY t.created_at DESC LIMIT 100`,
  ).bind(user.id).all()
  return c.json({ transfers: results })
})

/**
 * Creates a transfer from a fresh server-side quote.
 *
 * The client's numbers are never trusted: the amount is re-priced here, so a
 * tampered payload cannot buy a better rate than the corridor allows.
 */
transfers.post('/transfers', async (c) => {
  const user = c.get('user')
  const b = ((await c.req.json().catch(() => ({}))) as { corridorId?: string; recipientId?: string; sendAmountMinor?: number })

  if (!b.corridorId || !b.recipientId || typeof b.sendAmountMinor !== 'number') {
    return c.json({ error: 'missing_fields' }, 400)
  }

  /*
   * Aggregate limits, not just a per-transfer ceiling. A per-transfer limit on
   * its own is evaded by sending repeatedly, which is the structuring pattern
   * these exist to catch, so daily value, monthly value and daily count are all
   * checked before anything is created.
   */
  if (user.kycStatus !== 'verified') return c.json({ error: 'kyc_required', message: 'Verify your identity before sending.' }, 403)
  const decision = await checkLimits(c.env, user.id, user.kycTier, b.sendAmountMinor)
  if (!decision.allowed) {
    if (decision.reason === 'kyc_required') {
      return c.json({ error: 'kyc_required', message: 'Verify your identity before sending.' }, 403)
    }
    return c.json(
      {
        error: decision.reason,
        limitMinor: decision.limitMinor,
        usedMinor: decision.usedMinor,
        message: 'This transfer would take you past your current limit.',
      },
      403,
    )
  }

  const recipient = await c.env.DB.prepare(
    `SELECT id FROM recipients WHERE id = ? AND user_id = ? AND archived_at IS NULL`,
  ).bind(b.recipientId, user.id).first()
  if (!recipient) return c.json({ error: 'unknown_recipient' }, 404)

  const corridor = await c.env.DB.prepare(`SELECT * FROM corridors WHERE id = ?`)
    .bind(b.corridorId).first<Corridor>()
  if (!corridor) return c.json({ error: 'unknown_corridor' }, 404)

  /*
   * The corridor has to match where the money is actually going. Without this a
   * tampered payload could pair a recipient in one country with a cheaper
   * corridor for another, and the server would price and book it happily.
   */
  const recipientCountry = await c.env.DB.prepare(`SELECT country FROM recipients WHERE id = ?`)
    .bind(b.recipientId).first<{ country: string }>()
  if (!recipientCountry || recipientCountry.country !== corridor.receive_country) {
    return c.json(
      { error: 'corridor_mismatch', message: 'That corridor does not serve this recipient.' },
      400,
    )
  }

  const rate = await c.env.DB.prepare(
    `SELECT rate_e8, fetched_at FROM fx_rates WHERE base = ? AND quote = ? ORDER BY fetched_at DESC LIMIT 1`,
  ).bind(corridor.send_currency, corridor.receive_currency).first<{ rate_e8: number; fetched_at: string }>()
  if (!rate) return c.json({ error: 'no_rate_available' }, 503)
  if (isStale(rate.fetched_at)) return c.json({ error: 'rate_stale' }, 503)

  let q
  try {
    q = quote(corridor, rate.rate_e8, b.sendAmountMinor)
  } catch (err) {
    if (err instanceof QuoteError) return c.json({ error: err.code, message: err.message }, 400)
    throw err
  }

  const id = newId('trf')
  const ref = reference()
  let screening: TransferScreening
  try {
    screening = await screenTransferSubjects(c.env, { userId: user.id, recipientId: b.recipientId, transferId: id })
  } catch (error) {
    await auditSanctionsUnavailable(c.env, { transferId: id, stage: 'creation', actorType: 'customer', actorId: user.id, ip: c.req.header('cf-connecting-ip') }, error)
    const failure = screeningFailure(error)
    if (failure) return c.json({ error: failure.code, message: failure.message }, failure.status)
    throw error
  }
  const now = new Date().toISOString()
  const flags = reportingFlags(q.sendAmountMinor)
  const startStatus = screening.blocked || flags.includes('high_value_review')
    ? 'compliance_hold'
    : 'awaiting_payment'

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO transfers (id, reference, user_id, recipient_id, corridor_id,
         send_amount_minor, send_currency, fee_minor, receive_amount_minor, receive_currency,
         fx_rate_e8, status, quote_expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, ref, user.id, b.recipientId, corridor.id, q.sendAmountMinor, q.sendCurrency,
           q.feeMinor, q.receiveAmountMinor, q.receiveCurrency, q.effectiveRateE8, startStatus,
           new Date(Date.now() + QUOTE_TTL_MINUTES * 60_000).toISOString(), now, now),
    ...transferScreeningStatements(c.env, id, screening, 'creation'),
    c.env.DB.prepare(
      `INSERT INTO transfer_events (id, transfer_id, from_status, to_status, actor_type, actor_id, note, created_at)
       VALUES (?, ?, NULL, ?, 'customer', ?, ?, ?)`,
    ).bind(newId('tev'), id, startStatus, user.id,
           flags.length ? `Reporting flags: ${flags.join(', ')}` : null, now),
  ])

  await audit(c.env.DB, {
    actorType: 'customer', actorId: user.id, action: 'transfer.created',
    entityType: 'transfer', entityId: id,
    metadata: {
      reference: ref, sendAmountMinor: q.sendAmountMinor, corridor: corridor.id,
      screening: screening.checks.map((check) => ({ subjectType: check.subject.subjectType, status: check.result.status })),
      sanctionsDataset: screening.dataset.version, reportingFlags: flags,
    },
    ip: c.req.header('cf-connecting-ip'),
  })

  return c.json({ ok: true, transfer: { id, reference: ref, ...q, status: startStatus }, reportingFlags: flags })
})

transfers.get('/transfers/:id', async (c) => {
  const user = c.get('user')
  const t = await c.env.DB.prepare(
    `SELECT t.*, r.full_name AS recipient_name, r.country AS recipient_country
       FROM transfers t JOIN recipients r ON r.id = t.recipient_id
      WHERE t.id = ? AND t.user_id = ?`,
  ).bind(c.req.param('id'), user.id).first()
  if (!t) return c.json({ error: 'not_found' }, 404)

  const { results: events } = await c.env.DB.prepare(
    `SELECT to_status, actor_type, note, created_at FROM transfer_events
      WHERE transfer_id = ? ORDER BY created_at`,
  ).bind(c.req.param('id')).all()

  return c.json({ transfer: t, events })
})

/**
 * Marks a transfer paid and posts the funding entries.
 *
 * Until the money transmitter licence and a payment partner are in place this
 * confirms a *test* payment: it moves the transfer into compliance review and
 * writes the ledger, but no real card is charged and no payout is released.
 * Swapping in Stripe means replacing this one handler.
 */
transfers.post('/transfers/:id/pay', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id') ?? ''

  /*
   * Re-authenticate before money moves.
   *
   * The client previously "verified" with a PIN pad that accepted any four
   * digits, and in a browser with a timer that authorised nothing at all. No
   * client-side check can be trusted, so authorisation is enforced here: a
   * valid session is not sufficient to spend from an account, the account
   * password is required at the moment of payment.
   */
  const body = ((await c.req.json().catch(() => ({}))) as { password?: string })
  const creds = await c.env.DB.prepare(
    `SELECT password_hash, password_salt, password_iterations FROM users WHERE id = ?`,
  ).bind(user.id).first<Record<string, string | number>>()
  if (!creds) return c.json({ error: 'not_authenticated' }, 401)

  const authorised = await verifyPassword(
    body.password ?? '',
    String(creds.password_salt),
    Number(creds.password_iterations),
    String(creds.password_hash),
    c.env.SESSION_PEPPER ?? '',
  )
  if (!authorised) {
    await audit(c.env.DB, {
      actorType: 'customer', actorId: user.id, action: 'transfer.authorization_failed',
      entityType: 'transfer', entityId: id, ip: c.req.header('cf-connecting-ip'),
    })
    return c.json({ error: 'authorization_failed', message: 'That password was not accepted.' }, 401)
  }

  const t = await c.env.DB.prepare(`SELECT * FROM transfers WHERE id = ? AND user_id = ?`)
    .bind(id, user.id).first<Record<string, string | number>>()
  if (!t) return c.json({ error: 'not_found' }, 404)
  if (t.status !== 'awaiting_payment' && t.status !== 'compliance_hold') return c.json({ error: 'wrong_status', status: t.status }, 409)
  if (t.paid_at) return c.json({ error: 'already_paid' }, 409)
  if (t.quote_expires_at && String(t.quote_expires_at) < new Date().toISOString()) {
    return c.json({ error: 'quote_expired' }, 409)
  }

  let screening: TransferScreening
  try {
    screening = await screenTransferSubjects(c.env, { userId: user.id, recipientId: String(t.recipient_id), transferId: id })
  } catch (error) {
    await auditSanctionsUnavailable(c.env, { transferId: id, stage: 'payment', actorType: 'customer', actorId: user.id, ip: c.req.header('cf-connecting-ip') }, error)
    const failure = screeningFailure(error)
    if (failure) return c.json({ error: failure.code, message: failure.message }, failure.status)
    throw error
  }
  const now = new Date().toISOString()
  const statements = transferScreeningStatements(c.env, id, screening, 'payment')
  if (screening.blocked) {
    await c.env.DB.batch([
      ...statements,
      c.env.DB.prepare(`UPDATE transfers SET status = 'compliance_hold', updated_at = ? WHERE id = ? AND user_id = ? AND paid_at IS NULL AND status IN ('awaiting_payment', 'compliance_hold')`)
        .bind(now, id, user.id),
      c.env.DB.prepare(`INSERT INTO transfer_events (id, transfer_id, from_status, to_status, actor_type, actor_id, note, created_at) VALUES (?, ?, ?, 'compliance_hold', 'system', NULL, 'Sanctions review required before payment', ?)`)
        .bind(newId('tev'), id, String(t.status), now),
    ])
    await audit(c.env.DB, {
      actorType: 'system', action: 'transfer.sanctions_hold', entityType: 'transfer', entityId: id,
      metadata: { stage: 'payment', datasetVersion: screening.dataset.version }, ip: c.req.header('cf-connecting-ip'),
    })
    return c.json({ error: screening.confirmed ? 'sanctions_blocked' : 'sanctions_review_required', status: 'compliance_hold', message: 'This transfer requires compliance review.' }, 403)
  }

  const guard = screeningClaimGuard(screening, now)
  const operationReference = `test_${randomHex(8)}`
  const posting = guardedPostingStatements(c.env.DB, id, 'funding', fundingPostings({
    sendAmountMinor: Number(t.send_amount_minor),
    feeMinor: Number(t.fee_minor),
    receiveAmountMinor: Number(t.receive_amount_minor),
    sendCurrency: String(t.send_currency),
    receiveCurrency: String(t.receive_currency),
    reference: String(t.reference),
  }), operationReference, now)
  const claimIndex = statements.length
  const results = await c.env.DB.batch([
    ...statements,
    c.env.DB.prepare(
      `UPDATE transfers SET status = 'compliance_hold', paid_at = ?, updated_at = ?,
              payment_provider = 'test', payment_intent_id = ?
        WHERE id = ? AND user_id = ? AND status = ? AND paid_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM transfer_postings p WHERE p.transfer_id = transfers.id AND p.kind = 'funding')
          ${guard.sql}`,
    ).bind(now, now, operationReference, id, user.id, String(t.status), ...guard.values),
    ...posting.statements,
    c.env.DB.prepare(
      `INSERT INTO transfer_events (id, transfer_id, from_status, to_status, actor_type, actor_id, note, created_at)
       SELECT ?, ?, ?, 'compliance_hold', 'system', NULL, 'Test payment captured', ? WHERE ${posting.guard.sql}`,
    ).bind(newId('tev'), id, String(t.status), now, ...posting.guard.values),
    complianceAuditStatement(c.env, {
      actorType: 'customer', actorId: user.id, action: 'transfer.paid',
      entityType: 'transfer', entityId: id, metadata: { provider: 'test' },
      ip: c.req.header('cf-connecting-ip'),
    }, now, posting.guard),
  ])
  const claim = results[claimIndex]
  if (claim.meta.changes !== 1) return c.json({ error: 'screening_changed', message: 'Transfer details or screening data changed. Please try again.' }, 409)

  return c.json({ ok: true, status: 'compliance_hold', testMode: true })
})
