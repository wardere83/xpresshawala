/**
 * Persistence for ledger postings. Kept apart from ledger.ts so the posting
 * rules stay a pure, dependency-free module that can be tested directly.
 */
import { newId } from './crypto'
import { assertBalanced, type Posting } from './ledger'

export class DuplicatePostingError extends Error {}

/**
 * Prepare postings for the same transaction as a guarded transfer update.
 * Only the update that installed this operation's unique reference can create
 * the posting. Dependent evidence uses the exact entry group, so a failed
 * eligibility claim writes neither money nor a success event/audit record.
 */
export function guardedPostingStatements(
  db: D1Database,
  transferId: string,
  kind: 'funding' | 'payout',
  postings: Posting[],
  operationReference: string,
  now: string,
): { statements: D1PreparedStatement[]; guard: { sql: string; values: string[] } } {
  assertBalanced(postings)
  const group = newId('grp')
  const referenceColumn = kind === 'funding' ? 'payment_intent_id' : 'payout_reference'
  const status = kind === 'funding' ? 'compliance_hold' : 'completed'
  const guard = {
    sql: `EXISTS (SELECT 1 FROM transfer_postings p WHERE p.transfer_id = ? AND p.kind = ? AND p.entry_group = ?)`,
    values: [transferId, kind, group],
  }
  return {
    guard,
    statements: [
      db.prepare(
        `INSERT INTO transfer_postings (transfer_id, kind, entry_group, created_at)
         SELECT ?, ?, ?, ? FROM transfers t
          WHERE t.id = ? AND t.${referenceColumn} = ? AND t.status = ? AND t.paid_at IS NOT NULL`,
      ).bind(transferId, kind, group, now, transferId, operationReference, status),
      ...postings.map((posting) => db.prepare(
        `INSERT INTO ledger_entries
           (id, transfer_id, account_code, currency, amount_minor, entry_group, description, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guard.sql}`,
      ).bind(newId('le'), transferId, posting.accountCode, posting.currency, posting.amountMinor,
             group, posting.description, now, ...guard.values)),
    ],
  }
}

/**
 * Writes a balanced group for a transfer, once and only once.
 *
 * The claim row and the entries go in a single batch, so either both land or
 * neither does: a crash cannot leave a transfer marked paid with no accounting
 * behind it. The primary key on (transfer_id, kind) is what makes a second
 * attempt fail rather than double-post, whatever the caller believed about the
 * transfer's status.
 */
export async function postOnce(
  db: D1Database,
  transferId: string,
  kind: 'funding' | 'payout',
  postings: Posting[],
): Promise<string> {
  assertBalanced(postings)
  const group = newId('grp')
  const now = new Date().toISOString()

  const statements = [
    db
      .prepare(
        `INSERT INTO transfer_postings (transfer_id, kind, entry_group, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(transferId, kind, group, now),
    ...postings.map((p) =>
      db
        .prepare(
          `INSERT INTO ledger_entries
             (id, transfer_id, account_code, currency, amount_minor, entry_group, description, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(newId('le'), transferId, p.accountCode, p.currency, p.amountMinor, group, p.description, now),
    ),
  ]

  try {
    await db.batch(statements)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/UNIQUE|PRIMARY KEY/i.test(message)) {
      throw new DuplicatePostingError(`${kind} already posted for ${transferId}`)
    }
    throw err
  }
  return group
}

/** Writes a balanced group not tied to a transfer. */
export async function post(
  db: D1Database,
  transferId: string | null,
  postings: Posting[],
): Promise<string> {
  assertBalanced(postings)
  const group = newId('grp')
  const now = new Date().toISOString()
  await db.batch(
    postings.map((p) =>
      db
        .prepare(
          `INSERT INTO ledger_entries
             (id, transfer_id, account_code, currency, amount_minor, entry_group, description, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(newId('le'), transferId, p.accountCode, p.currency, p.amountMinor, group, p.description, now),
    ),
  )
  return group
}
