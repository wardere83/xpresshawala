import type { Env } from './env'
import { audit } from './audit'
import { newId } from './crypto'
import {
  SanctionsUnavailableError,
  loadFreshSanctionsDataset,
  sanctionsScreeningStatement,
  screenName,
  type SanctionsDataset,
  type ScreeningResult,
} from './sanctions'

export { SanctionsUnavailableError, loadFreshSanctionsDataset, screenName } from './sanctions'
export type { SanctionsDataset, ScreeningResult } from './sanctions'

/** Transaction limits and transfer-level official sanctions screening controls. */

/** Aggregate ceilings by verification tier, in minor units. */
export interface TierLimits {
  perTransfer: number
  daily: number
  monthly: number
  /** Transfers permitted in a rolling 24 hours, regardless of value. */
  dailyCount: number
}

export const TIER_LIMITS: Record<number, TierLimits> = {
  0: { perTransfer: 0, daily: 0, monthly: 0, dailyCount: 0 },
  1: { perTransfer: 100_000, daily: 200_000, monthly: 1_000_000, dailyCount: 5 },
  2: { perTransfer: 500_000, daily: 1_000_000, monthly: 5_000_000, dailyCount: 10 },
  3: { perTransfer: 2_000_000, daily: 5_000_000, monthly: 20_000_000, dailyCount: 20 },
}

const COUNTED_TRANSFERS = `status NOT IN ('failed', 'cancelled', 'draft')`

/**
 * Repeat all allowance checks in the INSERT itself. D1 serializes writers,
 * so simultaneous requests cannot each reserve the same remaining allowance.
 * The caller also binds this tier to the current verified user in that INSERT.
 */
export function transferLimitClaimGuard(userId: string, tier: number, amountMinor: number, now: string): { sql: string; values: (string | number)[] } {
  const limits = Number.isInteger(tier) ? TIER_LIMITS[tier] ?? TIER_LIMITS[0] : TIER_LIMITS[0]
  const dayAgo = new Date(Date.parse(now) - 24 * 3600_000).toISOString()
  const monthAgo = new Date(Date.parse(now) - 30 * 24 * 3600_000).toISOString()
  return {
    sql: `
      AND ? > 0 AND ? <= ?
      AND (SELECT COUNT(*) FROM transfers WHERE user_id=? AND created_at>? AND ${COUNTED_TRANSFERS}) < ?
      AND (SELECT COALESCE(SUM(send_amount_minor),0) FROM transfers WHERE user_id=? AND created_at>? AND ${COUNTED_TRANSFERS}) + ? <= ?
      AND (SELECT COALESCE(SUM(send_amount_minor),0) FROM transfers WHERE user_id=? AND created_at>? AND ${COUNTED_TRANSFERS}) + ? <= ?`,
    values: [
      amountMinor, amountMinor, limits.perTransfer,
      userId, dayAgo, limits.dailyCount,
      userId, dayAgo, amountMinor, limits.daily,
      userId, monthAgo, amountMinor, limits.monthly,
    ],
  }
}

/** Amount-based recordkeeping and operational review flags, in USD minor units.
 * Transfer value alone does not establish a Currency Transaction Report duty;
 * currency transactions and applicable aggregation rules require separate review.
 */
export const RECORDKEEPING_THRESHOLD_MINOR = 300_000
export const HIGH_VALUE_REVIEW_THRESHOLD_MINOR = 1_000_000

export interface LimitDecision {
  allowed: boolean
  reason?: 'kyc_required' | 'over_per_transfer' | 'over_daily' | 'over_monthly' | 'over_daily_count'
  limitMinor?: number
  usedMinor?: number
}

/**
 * Checks a proposed transfer against every ceiling, not just the per-transfer
 * one. Per-transfer alone is trivially evaded by sending repeatedly, which is
 * exactly the structuring pattern the aggregate limits exist to catch.
 */
export async function checkLimits(
  env: Env,
  userId: string,
  tier: number,
  amountMinor: number,
): Promise<LimitDecision> {
  const limits = TIER_LIMITS[tier] ?? TIER_LIMITS[0]
  if (limits.perTransfer === 0) return { allowed: false, reason: 'kyc_required' }
  if (amountMinor > limits.perTransfer) {
    return { allowed: false, reason: 'over_per_transfer', limitMinor: limits.perTransfer }
  }

  const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString()
  const monthAgo = new Date(Date.now() - 30 * 24 * 3600_000).toISOString()

  // Cancelled and failed transfers do not consume an allowance.
  const counted = COUNTED_TRANSFERS

  const day = await env.DB.prepare(
    `SELECT COALESCE(SUM(send_amount_minor), 0) AS total, COUNT(*) AS n
       FROM transfers WHERE user_id = ? AND created_at > ? AND ${counted}`,
  ).bind(userId, dayAgo).first<{ total: number; n: number }>()

  const month = await env.DB.prepare(
    `SELECT COALESCE(SUM(send_amount_minor), 0) AS total
       FROM transfers WHERE user_id = ? AND created_at > ? AND ${counted}`,
  ).bind(userId, monthAgo).first<{ total: number }>()

  const dayTotal = Number(day?.total ?? 0)
  const dayCount = Number(day?.n ?? 0)
  const monthTotal = Number(month?.total ?? 0)

  if (dayCount >= limits.dailyCount) {
    return { allowed: false, reason: 'over_daily_count', limitMinor: limits.dailyCount, usedMinor: dayCount }
  }
  if (dayTotal + amountMinor > limits.daily) {
    return { allowed: false, reason: 'over_daily', limitMinor: limits.daily, usedMinor: dayTotal }
  }
  if (monthTotal + amountMinor > limits.monthly) {
    return { allowed: false, reason: 'over_monthly', limitMinor: limits.monthly, usedMinor: monthTotal }
  }
  return { allowed: true }
}

export interface ScreeningSubject {
  subjectType: 'user' | 'recipient'
  subjectId: string
  name: string
}

export interface ScreeningSubjects {
  sender: ScreeningSubject
  recipient: ScreeningSubject
  senderStatus: string
  kycStatus: string
  kycTier: number
  firstName: string
  lastName: string
}

export class ScreeningSubjectError extends Error {
  readonly code: 'account_suspended' | 'kyc_required' | 'unknown_recipient'
  constructor(code: 'account_suspended' | 'kyc_required' | 'unknown_recipient') {
    super(code)
    this.code = code
    this.name = 'ScreeningSubjectError'
  }
}

export interface StoredScreening {
  id: string
  subject_type: 'user' | 'recipient'
  subject_id: string
  transfer_id: string
  provider: string
  status: string
  match_json: string | null
  cleared_by: string | null
  cleared_at: string | null
  created_at: string
}

export interface ScreeningEvidence extends ScreeningResult {
  subjectName: string
  stage?: string
  review?: { reason: string; reviewerId: string; reviewedAt: string; decisionId?: string }
}

export function parseScreeningEvidence(value: string | null): ScreeningEvidence | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as ScreeningEvidence
    if (typeof parsed.subjectName !== 'string' || typeof parsed.datasetHash !== 'string' || !Array.isArray(parsed.matches)) return null
    return parsed
  } catch {
    return null
  }
}

/** A clearance is scoped to this exact subject name, snapshot and candidate set. */
export function screeningEvidenceKey(name: string, result: ScreeningResult): string {
  return JSON.stringify([
    name,
    result.datasetHash,
    result.normalizedName,
    result.reason ?? null,
    result.candidateCount,
    [...new Set(result.matches.map((match) => match.entityId))].sort(),
  ])
}

export async function loadScreeningSubjects(env: Env, userId: string, recipientId: string): Promise<ScreeningSubjects> {
  const [sender, recipient] = await Promise.all([
    env.DB.prepare(
      `SELECT id, first_name, last_name, status, kyc_status, kyc_tier FROM users WHERE id = ?`,
    ).bind(userId).first<{ id: string; first_name: string; last_name: string; status: string; kyc_status: string; kyc_tier: number }>(),
    env.DB.prepare(
      `SELECT id, full_name FROM recipients WHERE id = ? AND user_id = ? AND archived_at IS NULL`,
    ).bind(recipientId, userId).first<{ id: string; full_name: string }>(),
  ])
  if (!sender || sender.status !== 'active') throw new ScreeningSubjectError('account_suspended')
  if (!recipient) throw new ScreeningSubjectError('unknown_recipient')
  return {
    sender: { subjectType: 'user', subjectId: sender.id, name: `${sender.first_name} ${sender.last_name}`.trim() },
    recipient: { subjectType: 'recipient', subjectId: recipient.id, name: recipient.full_name },
    senderStatus: sender.status,
    kycStatus: sender.kyc_status,
    kycTier: Number(sender.kyc_tier),
    firstName: sender.first_name,
    lastName: sender.last_name,
  }
}

export function requireVerifiedSender(subjects: ScreeningSubjects): void {
  if (subjects.kycStatus !== 'verified' || !Number.isInteger(subjects.kycTier) || subjects.kycTier < 1 || subjects.kycTier > 3) {
    throw new ScreeningSubjectError('kyc_required')
  }
}

export interface TransferScreeningCheck {
  subject: ScreeningSubject
  result: ScreeningResult
  cleared: boolean
  confirmed: boolean
}

export interface TransferScreening {
  dataset: SanctionsDataset
  subjects: ScreeningSubjects
  checks: TransferScreeningCheck[]
  blocked: boolean
  confirmed: boolean
}

export async function storedTransferScreenings(env: Env, transferId: string): Promise<StoredScreening[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, subject_type, subject_id, transfer_id, provider, status, match_json,
            cleared_by, cleared_at, created_at
       FROM sanctions_screenings WHERE transfer_id = ? ORDER BY created_at DESC, rowid DESC`,
  ).bind(transferId).all<StoredScreening>()
  return results ?? []
}

export async function screenTransferSubjects(
  env: Env,
  args: { userId: string; recipientId: string; transferId: string; requireVerified?: boolean },
): Promise<TransferScreening> {
  const subjects = await loadScreeningSubjects(env, args.userId, args.recipientId)
  if (args.requireVerified !== false) requireVerifiedSender(subjects)
  const dataset = await loadFreshSanctionsDataset(env)
  const records = await storedTransferScreenings(env, args.transferId)
  const transferConfirmed = records.some((record) => record.provider === 'us-treasury-ofac' && record.status === 'confirmed_match')
  const checks = await Promise.all([subjects.sender, subjects.recipient].map(async (subject) => {
    const result = await screenName(env, subject.name, dataset)
    const relevant = records.filter((record) => record.subject_type === subject.subjectType && record.subject_id === subject.subjectId && record.provider === result.provider)
    const confirmed = relevant.some((record) => record.status === 'confirmed_match' && parseScreeningEvidence(record.match_json)?.subjectName === subject.name)
    const cleared = result.status === 'potential_match' && result.reason === 'name_match' && result.matches.length > 0 && relevant.some((record) => {
      const evidence = parseScreeningEvidence(record.match_json)
      return record.status === 'potential_match' && !!record.cleared_by && !!record.cleared_at && !!evidence?.review?.reason &&
        evidence.review.reason.trim().length >= 20 && screeningEvidenceKey(evidence.subjectName, evidence) === screeningEvidenceKey(subject.name, result)
    })
    return { subject, result, cleared, confirmed }
  }))
  return {
    dataset,
    subjects,
    checks,
    blocked: transferConfirmed || checks.some((check) => check.confirmed || (check.result.status !== 'clear' && !check.cleared)),
    confirmed: transferConfirmed || checks.some((check) => check.confirmed || check.result.status === 'confirmed_match'),
  }
}

export function transferScreeningStatements(env: Env, transferId: string, screening: TransferScreening, stage: string, guard?: { sql: string; values: (string | number)[] }): D1PreparedStatement[] {
  return screening.checks.map(({ subject, result }) => sanctionsScreeningStatement(env, {
    subjectType: subject.subjectType,
    subjectId: subject.subjectId,
    name: subject.name,
    transferId,
    stage,
    guard,
  }, result))
}

/** Prepare append-only audit evidence in the transaction making the decision. */
export function complianceAuditStatement(
  env: Env,
  entry: Parameters<typeof audit>[1],
  now: string,
  guard: { sql: string; values: (string | number)[] },
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO audit_log
       (id, actor_type, actor_id, action, entity_type, entity_id, metadata, ip, user_agent, created_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guard.sql}`,
  ).bind(newId('aud'), entry.actorType, entry.actorId ?? null, entry.action,
         entry.entityType ?? null, entry.entityId ?? null,
         entry.metadata === undefined ? null : JSON.stringify(entry.metadata),
         entry.ip ?? null, entry.userAgent ?? null, now, ...guard.values)
}

/** Repeat mutable eligibility checks in the same SQL statement that claims money. */
export function screeningClaimGuard(screening: TransferScreening, now: string): { sql: string; values: (string | number)[] } {
  return {
    sql: `
      AND EXISTS (
        SELECT 1 FROM sanctions_active a
        JOIN sanctions_datasets d ON d.snapshot_id = a.snapshot_id
        WHERE a.singleton = 1 AND d.status = 'ready'
          AND a.snapshot_id = ? AND d.content_hash = ?
          AND a.last_success_checked_at >= ? AND a.last_success_checked_at <= ?
      )
      AND EXISTS (
        SELECT 1 FROM users u WHERE u.id = transfers.user_id
          AND u.id = ?
          AND u.status = 'active' AND u.kyc_status = 'verified'
          AND u.kyc_tier BETWEEN 1 AND 3 AND u.kyc_tier = CAST(u.kyc_tier AS INTEGER)
          AND u.first_name = ? AND u.last_name = ? AND u.kyc_tier = ?
      )
      AND EXISTS (
        SELECT 1 FROM recipients r WHERE r.id = transfers.recipient_id
          AND r.id = ? AND r.user_id = transfers.user_id AND r.archived_at IS NULL AND r.full_name = ?
      )
      AND NOT EXISTS (
        SELECT 1 FROM sanctions_screenings s WHERE s.transfer_id = transfers.id
          AND s.provider = 'us-treasury-ofac' AND s.status = 'confirmed_match'
      )`,
    values: [
      screening.dataset.version,
      screening.dataset.contentSha256,
      new Date(new Date(now).getTime() - 24 * 3600_000).toISOString(),
      now,
      screening.subjects.sender.subjectId,
      screening.subjects.firstName,
      screening.subjects.lastName,
      screening.subjects.kycTier,
      screening.subjects.recipient.subjectId,
      screening.subjects.recipient.name,
    ],
  }
}

export function screeningFailure(error: unknown): { code: string; status: 403 | 404 | 503; message: string } | null {
  if (error instanceof SanctionsUnavailableError) {
    return { code: 'sanctions_unavailable', status: 503, message: 'Transfers are temporarily unavailable while sanctions screening is refreshed.' }
  }
  if (error instanceof ScreeningSubjectError) {
    return { code: error.code, status: error.code === 'unknown_recipient' ? 404 : 403, message: 'The account or recipient is not eligible for this transfer.' }
  }
  return null
}

/** Preserve the reason for a blocked money attempt when the audit database is available. */
export async function auditSanctionsUnavailable(
  env: Env,
  args: { transferId: string; stage: string; actorType: 'customer' | 'admin'; actorId: string; ip?: string },
  error: unknown,
): Promise<void> {
  if (!(error instanceof SanctionsUnavailableError)) return
  try {
    await audit(env.DB, {
      actorType: args.actorType, actorId: args.actorId, action: 'transfer.sanctions_unavailable',
      entityType: 'transfer', entityId: args.transferId,
      metadata: { stage: args.stage, reason: error.reason }, ip: args.ip,
    })
  } catch {
    console.error('Sanctions-unavailable audit could not be recorded')
  }
}

/** Reporting and operational review flags; no automatic filing assertion. */
export function reportingFlags(amountMinor: number): string[] {
  const flags: string[] = []
  if (amountMinor >= RECORDKEEPING_THRESHOLD_MINOR) flags.push('bsa_recordkeeping')
  if (amountMinor >= HIGH_VALUE_REVIEW_THRESHOLD_MINOR) flags.push('high_value_review')
  return flags
}
