import { Hono } from 'hono'
import { newId, randomHex } from './crypto'
import { audit } from './audit'
import { payoutPostings } from './ledger'
import { guardedPostingStatements } from './ledger-db'
import type { Env, Vars } from './env'
import { requireAdmin, requireRole } from './sessions'
import { staff } from './routes-staff'
import {
  auditSanctionsUnavailable,
  complianceAuditStatement,
  parseScreeningEvidence,
  screenTransferSubjects,
  screeningClaimGuard,
  screeningEvidenceKey,
  screeningFailure,
  transferScreeningStatements,
  type StoredScreening,
  type TransferScreening,
} from './compliance'

export const admin = new Hono<{ Bindings: Env; Variables: Vars }>()

admin.use('*', requireAdmin)

// Staff administration. Mounted inside the admin guard, so every route here
// already has a signed-in staff member.
admin.route('/staff', staff)

/** Operations dashboard: volumes, holds and today's activity. */
admin.get('/overview', async (c) => {
  const [counts, volume, holds] = await c.env.DB.batch<Record<string, number>>([
    c.env.DB.prepare(
      `SELECT status, COUNT(*) AS n FROM transfers GROUP BY status`,
    ),
    c.env.DB.prepare(
      `SELECT send_currency AS currency, SUM(send_amount_minor) AS sent, SUM(fee_minor) AS fees
         FROM transfers WHERE status IN ('completed','sending','compliance_hold') GROUP BY send_currency`,
    ),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM transfers WHERE status = 'compliance_hold'`,
    ),
  ])
  return c.json({
    byStatus: counts.results,
    volume: volume.results,
    awaitingReview: holds.results?.[0]?.n ?? 0,
  })
})

/** The compliance queue. Defaults to what needs a human decision. */
admin.get('/transfers', async (c) => {
  const status = c.req.query('status') ?? 'compliance_hold'
  const { results } = await c.env.DB.prepare(
    `SELECT t.id, t.reference, t.status, t.send_amount_minor, t.send_currency, t.fee_minor,
            t.receive_amount_minor, t.receive_currency, t.created_at, t.paid_at,
            u.email AS user_email, u.first_name, u.last_name, u.kyc_status,
            r.full_name AS recipient_name, r.country AS recipient_country
       FROM transfers t
       JOIN users u ON u.id = t.user_id
       JOIN recipients r ON r.id = t.recipient_id
      WHERE (? = 'all' OR t.status = ?)
      ORDER BY t.created_at DESC LIMIT 200`,
  ).bind(status, status).all()
  return c.json({ transfers: results })
})

/** Approval requires recorded funding, current customer eligibility and fresh screening. */
admin.post('/transfers/:id/approve', requireRole('compliance', 'owner'), async (c) => {
  const staff = c.get('admin')
  const id = c.req.param('id') ?? ''
  const t = await c.env.DB.prepare(`SELECT * FROM transfers WHERE id = ?`)
    .bind(id).first<Record<string, string | number>>()
  if (!t) return c.json({ error: 'not_found' }, 404)
  if (t.status !== 'compliance_hold') return c.json({ error: 'wrong_status', status: t.status }, 409)

  const funding = await c.env.DB.prepare(`SELECT transfer_id FROM transfer_postings WHERE transfer_id = ? AND kind = 'funding'`).bind(id).first()
  if (!t.paid_at || !funding) return c.json({ error: 'not_funded', message: 'A transfer must be funded before release.' }, 409)

  let screening: TransferScreening
  try {
    screening = await screenTransferSubjects(c.env, { userId: String(t.user_id), recipientId: String(t.recipient_id), transferId: id })
  } catch (error) {
    await auditSanctionsUnavailable(c.env, { transferId: id, stage: 'release', actorType: 'admin', actorId: staff.id, ip: c.req.header('cf-connecting-ip') }, error)
    const failure = screeningFailure(error)
    if (failure) return c.json({ error: failure.code, message: failure.message }, failure.status)
    throw error
  }
  const now = new Date().toISOString()
  const statements = transferScreeningStatements(c.env, id, screening, 'release')
  if (screening.blocked) {
    await c.env.DB.batch(statements)
    await audit(c.env.DB, {
      actorType: 'admin', actorId: staff.id, action: 'transfer.sanctions_release_blocked',
      entityType: 'transfer', entityId: id,
      metadata: { datasetVersion: screening.dataset.version, confirmed: screening.confirmed }, ip: c.req.header('cf-connecting-ip'),
    })
    return c.json({ error: screening.confirmed ? 'sanctions_blocked' : 'sanctions_review_required', status: 'compliance_hold', message: 'Resolve sanctions screening before release.' }, 403)
  }

  const guard = screeningClaimGuard(screening, now)
  const operationReference = `test_${randomHex(8)}`
  const posting = guardedPostingStatements(c.env.DB, id, 'payout', payoutPostings({
    receiveAmountMinor: Number(t.receive_amount_minor),
    receiveCurrency: String(t.receive_currency),
    reference: String(t.reference),
  }), operationReference, now)
  const claimIndex = statements.length
  const results = await c.env.DB.batch([
    ...statements,
    c.env.DB.prepare(
      `UPDATE transfers SET status = 'completed', completed_at = ?, updated_at = ?,
              payout_provider = 'test', payout_reference = ?
        WHERE id = ? AND status = 'compliance_hold' AND paid_at IS NOT NULL
          AND EXISTS (SELECT 1 FROM transfer_postings p WHERE p.transfer_id = transfers.id AND p.kind = 'funding')
          AND NOT EXISTS (SELECT 1 FROM transfer_postings p WHERE p.transfer_id = transfers.id AND p.kind = 'payout')
          ${guard.sql}`,
    ).bind(now, now, operationReference, id, ...guard.values),
    ...posting.statements,
    c.env.DB.prepare(
      `INSERT INTO transfer_events (id, transfer_id, from_status, to_status, actor_type, actor_id, note, created_at)
       SELECT ?, ?, 'compliance_hold', 'completed', 'admin', ?, ?, ? WHERE ${posting.guard.sql}`,
    ).bind(newId('tev'), id, staff.id, c.req.query('note') ?? 'Released by compliance', now, ...posting.guard.values),
    complianceAuditStatement(c.env, {
      actorType: 'admin', actorId: staff.id, action: 'transfer.approved',
      entityType: 'transfer', entityId: id, metadata: { reference: t.reference, role: staff.role, provider: 'test' },
      ip: c.req.header('cf-connecting-ip'),
    }, now, posting.guard),
  ])
  const claim = results[claimIndex]
  if (claim.meta.changes !== 1) return c.json({ error: 'screening_changed', message: 'Transfer details or screening data changed. Refresh screening and try again.' }, 409)
  return c.json({ ok: true, status: 'completed' })
})

/** Read-only review evidence; decisions are separate from transfer release. */
admin.get('/transfers/:id/screenings', async (c) => {
  const id = c.req.param('id') ?? ''
  const transfer = await c.env.DB.prepare(`SELECT user_id, recipient_id FROM transfers WHERE id = ?`)
    .bind(id).first<{ user_id: string; recipient_id: string }>()
  if (!transfer) return c.json({ error: 'not_found' }, 404)

  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.subject_type, s.subject_id, s.transfer_id, s.provider, s.status,
            s.match_json, s.cleared_by, s.cleared_at, s.created_at,
            a.name AS cleared_by_name, a.email AS cleared_by_email
       FROM sanctions_screenings s LEFT JOIN admins a ON a.id = s.cleared_by
      WHERE s.transfer_id = ? ORDER BY s.created_at DESC, s.rowid DESC`,
  ).bind(id).all<StoredScreening & { cleared_by_name: string | null; cleared_by_email: string | null }>()
  const records = results ?? []
  let screening: TransferScreening | null = null
  let readinessError: string | null = null
  try {
    screening = await screenTransferSubjects(c.env, { userId: transfer.user_id, recipientId: transfer.recipient_id, transferId: id, requireVerified: false })
  } catch (error) {
    const failure = screeningFailure(error)
    if (!failure) throw error
    readinessError = failure.code
  }

  const currentIds = new Set<string>()
  const effectiveClearances = new Map<string, boolean>()
  const clearanceRecords = new Map<string, typeof records[number]>()
  if (screening) {
    for (const check of screening.checks) {
      const current = records.find((record) => {
        const evidence = parseScreeningEvidence(record.match_json)
        return record.subject_type === check.subject.subjectType && record.subject_id === check.subject.subjectId &&
          !!evidence && screeningEvidenceKey(evidence.subjectName, evidence) === screeningEvidenceKey(check.subject.name, check.result)
      })
      if (current) {
        currentIds.add(current.id)
        effectiveClearances.set(current.id, check.cleared)
        if (check.cleared) {
          const clearance = records.find((record) => {
            const evidence = parseScreeningEvidence(record.match_json)
            return record.subject_type === check.subject.subjectType && record.subject_id === check.subject.subjectId &&
              !!record.cleared_by && !!record.cleared_at && !!evidence?.review?.reason &&
              evidence.review.reason.trim().length >= 20 &&
              screeningEvidenceKey(evidence.subjectName, evidence) === screeningEvidenceKey(check.subject.name, check.result)
          })
          if (clearance) clearanceRecords.set(current.id, clearance)
        }
      }
    }
  }
  const screenings = records.map((record) => {
    let evidence: Record<string, unknown> = {}
    try {
      const value: unknown = JSON.parse(record.match_json ?? '{}')
      if (value && typeof value === 'object' && !Array.isArray(value)) evidence = value as Record<string, unknown>
    } catch { /* Legacy records remain visible without usable evidence. */ }
    const review = parseScreeningEvidence(record.match_json)?.review
    const clearance = clearanceRecords.get(record.id)
    return {
      ...record,
      match_json: evidence,
      review_reason: review?.reason ?? null,
      is_current: currentIds.has(record.id),
      effective_cleared: effectiveClearances.get(record.id) ?? !!record.cleared_by,
      clearance_record_id: clearance?.id ?? (record.cleared_by ? record.id : null),
      effective_clearance: clearance ? {
        screening_id: clearance.id,
        cleared_by: clearance.cleared_by,
        cleared_by_name: clearance.cleared_by_name,
        cleared_by_email: clearance.cleared_by_email,
        cleared_at: clearance.cleared_at,
        reason: parseScreeningEvidence(clearance.match_json)?.review?.reason ?? null,
      } : null,
    }
  })
  return c.json({
    screenings,
    review_required: screening?.blocked ?? true,
    screening_ready: !!screening && currentIds.size === 2,
    current_screening_ids: [...currentIds],
    dataset_version: screening?.dataset.version ?? null,
    readiness_error: readinessError,
  })
})

/** Explicitly record refreshed checks without funding or releasing a transfer. */
admin.post('/transfers/:id/screen', requireRole('compliance', 'owner'), async (c) => {
  const id = c.req.param('id') ?? ''
  const actor = c.get('admin')
  const transfer = await c.env.DB.prepare(`SELECT user_id, recipient_id FROM transfers WHERE id = ?`)
    .bind(id).first<{ user_id: string; recipient_id: string }>()
  if (!transfer) return c.json({ error: 'not_found' }, 404)
  let screening: TransferScreening
  try {
    screening = await screenTransferSubjects(c.env, { userId: transfer.user_id, recipientId: transfer.recipient_id, transferId: id, requireVerified: false })
  } catch (error) {
    const failure = screeningFailure(error)
    if (failure) return c.json({ error: failure.code, message: failure.message }, failure.status)
    throw error
  }
  const statements = transferScreeningStatements(c.env, id, screening, 'staff_review')
  if (screening.blocked) statements.push(c.env.DB.prepare(
    `UPDATE transfers SET status = 'compliance_hold', updated_at = ? WHERE id = ? AND status = 'awaiting_payment'`,
  ).bind(new Date().toISOString(), id))
  await c.env.DB.batch(statements)
  await audit(c.env.DB, {
    actorType: 'admin', actorId: actor.id, action: 'transfer.sanctions_screened',
    entityType: 'transfer', entityId: id,
    metadata: { datasetVersion: screening.dataset.version, reviewRequired: screening.blocked }, ip: c.req.header('cf-connecting-ip'),
  })
  return c.json({ ok: true, review_required: screening.blocked, dataset_version: screening.dataset.version })
})

/** A documented false-positive decision never authorises funding or payout. */
admin.post('/screenings/:id/clear', requireRole('compliance', 'owner'), async (c) => {
  const id = c.req.param('id') ?? ''
  const actor = c.get('admin')
  const body = (await c.req.json().catch(() => ({}))) as { reason?: unknown }
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  if (reason.length < 20 || reason.length > 2000) return c.json({ error: 'reason_minimum_20_chars', message: 'Provide a documented reason between 20 and 2,000 characters.' }, 400)
  const record = await c.env.DB.prepare(
    `SELECT id, subject_type, subject_id, transfer_id, provider, status, match_json, cleared_by, cleared_at, created_at
       FROM sanctions_screenings WHERE id = ?`,
  ).bind(id).first<StoredScreening>()
  if (!record) return c.json({ error: 'not_found' }, 404)
  const evidence = parseScreeningEvidence(record.match_json)
  if (record.provider !== 'us-treasury-ofac' || record.status !== 'potential_match' || !record.transfer_id ||
      !evidence || evidence.reason !== 'name_match' || !evidence.matches.length) {
    return c.json({ error: 'screening_not_reviewable' }, 409)
  }
  if (record.cleared_by || record.cleared_at) return c.json({ error: 'already_cleared' }, 409)
  const transfer = await c.env.DB.prepare(`SELECT user_id, recipient_id FROM transfers WHERE id = ?`)
    .bind(record.transfer_id).first<{ user_id: string; recipient_id: string }>()
  if (!transfer) return c.json({ error: 'not_found' }, 404)
  let screening: TransferScreening
  try {
    screening = await screenTransferSubjects(c.env, { userId: transfer.user_id, recipientId: transfer.recipient_id, transferId: record.transfer_id, requireVerified: false })
  } catch (error) {
    const failure = screeningFailure(error)
    if (failure) return c.json({ error: failure.code, message: failure.message }, failure.status)
    throw error
  }
  const check = screening.checks.find((candidate) => candidate.subject.subjectType === record.subject_type && candidate.subject.subjectId === record.subject_id)
  if (!check || check.subject.name !== evidence.subjectName) return c.json({ error: 'screening_subject_changed' }, 409)
  if (check.confirmed || screening.confirmed) return c.json({ error: 'screening_not_reviewable' }, 409)
  if (check.result.status !== 'potential_match' || check.result.reason !== 'name_match' ||
      screeningEvidenceKey(evidence.subjectName, evidence) !== screeningEvidenceKey(check.subject.name, check.result)) {
    return c.json({ error: 'screening_outdated', message: 'Refresh screening before reviewing this match.' }, 409)
  }
  const now = new Date().toISOString()
  const guard = screeningClaimGuard(screening, now)
  const decisionId = newId('srev')
  const reviewedEvidence = JSON.stringify({ ...evidence, review: { reason, reviewerId: actor.id, reviewedAt: now, decisionId } })
  const results = await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE sanctions_screenings SET cleared_by = ?, cleared_at = ?, match_json = ?
        WHERE id = ? AND status = 'potential_match' AND cleared_by IS NULL AND cleared_at IS NULL AND match_json = ?
          AND EXISTS (SELECT 1 FROM transfers WHERE transfers.id = sanctions_screenings.transfer_id ${guard.sql})`,
    ).bind(actor.id, now, reviewedEvidence, id, record.match_json, ...guard.values),
    complianceAuditStatement(c.env, {
      actorType: 'admin', actorId: actor.id, action: 'sanctions.false_positive_cleared', entityType: 'screening', entityId: id,
      metadata: { decisionId, reason, transferId: record.transfer_id, subjectType: record.subject_type, subjectId: record.subject_id,
        subjectName: evidence.subjectName, datasetHash: evidence.datasetHash, entityIds: evidence.matches.map((match) => match.entityId) },
      ip: c.req.header('cf-connecting-ip'),
    }, now, {
      sql: `EXISTS (SELECT 1 FROM sanctions_screenings s WHERE s.id = ? AND s.cleared_by = ? AND s.cleared_at = ? AND s.match_json = ?)`,
      values: [id, actor.id, now, reviewedEvidence],
    }),
  ])
  if (results[0].meta.changes !== 1) return c.json({ error: 'screening_changed', message: 'Screening details changed. Refresh and try again.' }, 409)
  return c.json({ ok: true, screening_id: id, cleared_by: actor.id, cleared_at: now })
})

admin.post('/transfers/:id/reject', requireRole('compliance', 'owner'), async (c) => {
  const staff = c.get('admin')
  const id = c.req.param('id') ?? ''
  const body = ((await c.req.json().catch(() => ({}))) as { reason?: string })
  const reason = body.reason?.trim()
  if (!reason) return c.json({ error: 'reason_required' }, 400)

  const t = await c.env.DB.prepare(`SELECT status FROM transfers WHERE id = ?`).bind(id).first<{ status: string }>()
  if (!t) return c.json({ error: 'not_found' }, 404)
  if (t.status !== 'compliance_hold') return c.json({ error: 'wrong_status', status: t.status }, 409)

  const now = new Date().toISOString()
  const claim = await c.env.DB.prepare(
    `UPDATE transfers SET status = 'failed', failure_reason = ?, updated_at = ?
      WHERE id = ? AND status = 'compliance_hold'`,
  ).bind(reason, now, id).run()
  if (claim.meta.changes !== 1) return c.json({ error: 'already_decided' }, 409)

  await c.env.DB.prepare(
    `INSERT INTO transfer_events (id, transfer_id, from_status, to_status, actor_type, actor_id, note, created_at)
     VALUES (?, ?, 'compliance_hold', 'failed', 'admin', ?, ?, ?)`,
  ).bind(newId('tev'), id, staff.id, reason, now).run()

  await audit(c.env.DB, {
    actorType: 'admin', actorId: staff.id, action: 'transfer.rejected',
    entityType: 'transfer', entityId: id, metadata: { reason }, ip: c.req.header('cf-connecting-ip'),
  })
  return c.json({ ok: true, status: 'failed' })
})

admin.get('/users', async (c) => {
  const q = `%${(c.req.query('q') ?? '').toLowerCase()}%`
  const { results } = await c.env.DB.prepare(
    `SELECT id, email, first_name, last_name, country, status, kyc_status, kyc_tier,
            last_login_at, created_at
       FROM users
      WHERE lower(email) LIKE ? OR lower(first_name || ' ' || last_name) LIKE ?
      ORDER BY created_at DESC LIMIT 200`,
  ).bind(q, q).all()
  return c.json({ users: results })
})

/** Raises or refuses a customer's verification tier. */
admin.post('/users/:id/kyc', requireRole('compliance', 'owner'), async (c) => {
  const staff = c.get('admin')
  const id = c.req.param('id') ?? ''
  const b = ((await c.req.json().catch(() => ({}))) as { decision?: string; tier?: number; note?: string })
  if (b.decision !== 'verified' && b.decision !== 'rejected') {
    return c.json({ error: 'decision_must_be_verified_or_rejected' }, 400)
  }
  const tier = b.decision === 'verified' ? b.tier ?? 1 : 0
  if (!Number.isInteger(tier) || tier < 0 || tier > 3 || (b.decision === 'verified' && tier < 1)) {
    return c.json({ error: 'invalid_kyc_tier' }, 400)
  }
  const now = new Date().toISOString()
  const kycId = newId('kyc')

  const results = await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE users SET kyc_status = ?, kyc_tier = ?, updated_at = ? WHERE id = ? AND status='active'`)
      .bind(b.decision, tier, now, id),
    c.env.DB.prepare(
      `INSERT INTO kyc_checks (id, user_id, provider, status, result_json, reviewed_by, reviewed_at, created_at)
       SELECT ?,id,'manual',?,?,?,?,? FROM users WHERE id=? AND status='active'`,
    ).bind(kycId, b.decision === 'verified' ? 'passed' : 'failed',
           JSON.stringify({ note: b.note ?? null, tier }), staff.id, now, now, id),
    complianceAuditStatement(c.env, {
      actorType: 'admin', actorId: staff.id, action: 'user.kyc_decision',
      entityType: 'user', entityId: id, metadata: { decision: b.decision, tier },
      ip: c.req.header('cf-connecting-ip'),
    }, now, { sql: 'EXISTS (SELECT 1 FROM kyc_checks WHERE id=?)', values: [kycId] }),
  ])
  if (results[0]?.meta.changes !== 1) return c.json({ error: 'account_changed' }, 409)
  return c.json({ ok: true, kycStatus: b.decision, kycTier: tier })
})

/**
 * Trial balance. Every currency must net to zero; a non-zero row means the
 * books are broken and is the first thing to check after any incident.
 */
admin.get('/ledger/trial-balance', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT currency, account_code, SUM(amount_minor) AS balance_minor, COUNT(*) AS entries
       FROM ledger_entries GROUP BY currency, account_code ORDER BY currency, account_code`,
  ).all<{ currency: string; balance_minor: number }>()

  const totals = new Map<string, number>()
  for (const r of results ?? []) {
    totals.set(r.currency, (totals.get(r.currency) ?? 0) + Number(r.balance_minor))
  }
  const imbalances = [...totals.entries()].filter(([, v]) => v !== 0).map(([currency, off]) => ({ currency, off }))

  return c.json({ accounts: results, balanced: imbalances.length === 0, imbalances })
})

admin.get('/audit', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, actor_type, actor_id, action, entity_type, entity_id, metadata, ip, created_at
       FROM audit_log ORDER BY created_at DESC LIMIT 250`,
  ).all()
  return c.json({ entries: results })
})
