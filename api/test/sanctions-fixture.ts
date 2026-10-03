import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { normalizeName, searchTerms, sortedName } from '../src/sanctions-data.ts'
import { hashPassword, hashToken } from '../src/crypto.ts'
import { officialFeeds } from '../scripts/refresh-sanctions.mjs'

/** Runs production SQL against an isolated SQLite database, including FTS5. */
export class SqliteD1 {
  sqlite = new DatabaseSync(':memory:')
  beforeExecute?: (sql: string, parameters: unknown[]) => void
  afterBatch?: () => void

  constructor() {
    const directory = new URL('../migrations/', import.meta.url)
    for (const file of readdirSync(directory).filter((name) => name.endsWith('.sql')).sort()) {
      this.sqlite.exec(readFileSync(new URL(file, directory), 'utf8'))
    }
  }

  prepare(sql: string) { return new SqliteStatement(this, sql) }

  async batch(statements: SqliteStatement[]) {
    this.sqlite.exec('BEGIN')
    let results: ReturnType<SqliteStatement['execute']>[]
    try {
      results = statements.map((statement) => statement.execute())
      this.sqlite.exec('COMMIT')
    } catch (error) {
      this.sqlite.exec('ROLLBACK')
      throw error
    }
    this.afterBatch?.()
    return results
  }

  close() { this.sqlite.close() }
}

class SqliteStatement {
  db: SqliteD1
  sql: string
  parameters: unknown[]

  constructor(db: SqliteD1, sql: string, parameters: unknown[] = []) {
    this.db = db
    this.sql = sql
    this.parameters = parameters
  }

  bind(...parameters: unknown[]) { return new SqliteStatement(this.db, this.sql, parameters) }

  execute() {
    this.db.beforeExecute?.(this.sql, this.parameters)
    const before = Number(this.db.sqlite.prepare('SELECT total_changes() AS n').get()!.n)
    const statement = this.db.sqlite.prepare(this.sql)
    const results = statement.all(...this.parameters)
    const after = Number(this.db.sqlite.prepare('SELECT total_changes() AS n').get()!.n)
    return { success: true, results, meta: { changes: after - before, duration: 0 } }
  }

  async first(column?: string) {
    const row = this.execute().results[0]
    return column ? row?.[column] ?? null : row ?? null
  }
  async all() { return this.execute() }
  async run() { return this.execute() }
}

export const defaultNames = [
  { entityId: 'sdn:101', nameId: 'sdn:101:primary', name: 'Ivan Sergeyevich Petrov', primaryName: 'Ivan Sergeyevich Petrov', list: 'sdn' },
  { entityId: 'sdn:101', nameId: 'sdn:101:alias:201', name: 'Vladimir Romanov', primaryName: 'Ivan Sergeyevich Petrov', list: 'sdn' },
  { entityId: 'non-sdn:303', nameId: 'non-sdn:303:primary', name: 'José Ángel García', primaryName: 'José Ángel García', list: 'non-sdn' },
  { entityId: 'sdn:404', nameId: 'sdn:404:primary', name: 'Farid Nur Rahman', primaryName: 'Farid Nur Rahman', list: 'sdn' },
]

export function sourceMetadata(checkedAt = new Date().toISOString()) {
  return officialFeeds.map((feed) => ({
    file: feed.file, list: feed.list, url: feed.url, rows: feed.minimumRows,
    sha256: 'f'.repeat(64), fetchedAt: checkedAt, lastModified: checkedAt,
    publicationId: 'fixture-publication',
  }))
}

export function seedDataset(db: SqliteD1, options: {
  hash?: string; checkedAt?: string; status?: string; active?: boolean;
  names?: typeof defaultNames; metadata?: ReturnType<typeof sourceMetadata>;
} = {}) {
  const hash = options.hash ?? createHash('sha256').update('trusted-fixture-snapshot').digest('hex')
  const version = hash.slice(0, 24)
  const checkedAt = options.checkedAt ?? new Date().toISOString()
  db.sqlite.prepare(`INSERT INTO sanctions_datasets
    (snapshot_id,content_hash,status,provider,checked_at,activated_at,source_metadata_json,entity_count,name_count)
    VALUES (?,?,?,'US Treasury OFAC',?,?,?,5100,10200)`)
    .run(version, hash, options.status ?? 'ready', checkedAt, checkedAt, JSON.stringify(options.metadata ?? sourceMetadata(checkedAt)))
  for (const entry of options.names ?? defaultNames) {
    const normalized = normalizeName(entry.name)
    db.sqlite.prepare(`INSERT INTO sanctions_names
      (snapshot_id,name_id,entity_id,list,primary_name,name,normalized_name,sorted_name,entity_type,programs)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(version, entry.nameId, entry.entityId, entry.list, entry.primaryName, entry.name,
        normalized, sortedName(normalized), 'individual', JSON.stringify(['TEST']))
    db.sqlite.prepare('INSERT INTO sanctions_name_search(snapshot_id,name_id,search_terms) VALUES (?,?,?)')
      .run(version, entry.nameId, searchTerms(normalized))
  }
  if (options.active !== false) {
    db.sqlite.prepare(`INSERT INTO sanctions_active(singleton,snapshot_id,last_success_checked_at) VALUES (1,?,?)
      ON CONFLICT(singleton) DO UPDATE SET snapshot_id=excluded.snapshot_id,last_success_checked_at=excluded.last_success_checked_at`)
      .run(version, checkedAt)
  }
  return { version, hash, checkedAt }
}

export function fixtureEnv(db: SqliteD1) {
  return {
    DB: db, ENVIRONMENT: 'test', APP_ORIGIN: 'https://test.invalid', SESSION_PEPPER: 'test-pepper',
    ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
  }
}

export async function seedParties(db: SqliteD1, options: { senderName?: string; recipientName?: string } = {}) {
  const now = new Date().toISOString()
  const password = 'FixturePassword123!'
  const salt = 'a'.repeat(32)
  const [firstName, ...rest] = (options.senderName ?? 'Zelda Evergreen Merritt').split(' ')
  const hash = await hashPassword(password, salt, 1000, 'test-pepper')
  db.sqlite.prepare(`INSERT INTO users
    (id,email,password_hash,password_salt,password_iterations,first_name,last_name,status,kyc_status,kyc_tier,created_at,updated_at)
    VALUES ('customer-1','customer@example.invalid',?,?,1000,?,?,'active','verified',1,?,?)`)
    .run(hash, salt, firstName, rest.join(' '), now, now)
  db.sqlite.prepare(`INSERT INTO recipients
    (id,user_id,full_name,country,payout_method,created_at,updated_at)
    VALUES ('recipient-1','customer-1',?,'SO','mobile_wallet',?,?)`)
    .run(options.recipientName ?? 'Beatrice Oakwood Sinclair', now, now)
  const userToken = 'fixture-user-session'
  db.sqlite.prepare(`INSERT INTO sessions(id,user_id,token_hash,expires_at,created_at)
    VALUES ('session-1','customer-1',?,?,?)`)
    .run(await hashToken(userToken), new Date(Date.now() + 3600_000).toISOString(), now)
  const staffCookies: Record<string, string> = {}
  for (const role of ['compliance', 'owner', 'agent']) {
    const id = `staff-${role}`
    db.sqlite.prepare(`INSERT INTO admins
      (id,email,password_hash,password_salt,password_iterations,name,role,status,created_at,updated_at)
      VALUES (?,?,?, ?,1000,?,?,'active',?,?)`)
      .run(id, `${role}@example.invalid`, hash, salt, `Fixture ${role}`, role, now, now)
    const token = `fixture-${role}-session`
    db.sqlite.prepare(`INSERT INTO admin_sessions(id,admin_id,token_hash,expires_at,created_at)
      VALUES (?,?,?,?,?)`)
      .run(`session-${role}`, id, await hashToken(token), new Date(Date.now() + 3600_000).toISOString(), now)
    staffCookies[role] = `xt_admin=${token}`
  }
  db.sqlite.prepare('UPDATE fx_rates SET fetched_at=?').run(now)
  return { password, userCookie: `xt_session=${userToken}`, staffCookies }
}

export function seedTransfer(db: SqliteD1, id = 'transfer-fixture', status = 'compliance_hold') {
  const now = new Date().toISOString()
  db.sqlite.prepare(`INSERT INTO transfers
    (id,reference,user_id,recipient_id,corridor_id,send_amount_minor,send_currency,fee_minor,
     receive_amount_minor,receive_currency,fx_rate_e8,status,quote_expires_at,created_at,updated_at)
    VALUES (?,?,'customer-1','recipient-1','cor_us_so',10000,'USD',99,10000,'USD',100000000,?,?,?,?)`)
    .run(id, `XPT-${id}`, status, new Date(Date.now() + 900_000).toISOString(), now, now)
  return id
}

const csvRow = (fields: string[]) => fields.map((field) => `"${field.replaceAll('"', '""')}"`).join(',')

/** Satisfies real production feed minimums; no parser thresholds are bypassed. */
export function validFeedDownloads() {
  return new Map(officialFeeds.map((feed) => {
    const rows = Array.from({ length: feed.minimumRows }, (_, index) => {
      const id = String(index + 1)
      return feed.kind === 'primary'
        ? [id, `Subject ${id}`, 'individual', 'TEST', ...Array(8).fill('-0-')]
        : [id, id, 'a.k.a.', `Alias ${id}`, '-0-']
    })
    return [feed.file, {
      bytes: Buffer.from(rows.map(csvRow).join('\r\n') + '\r\n\u001a\r\n'),
      fetchedAt: new Date().toISOString(), lastModified: 'Sat, 03 Oct 2026 00:00:00 GMT',
      publicationId: 'fixture-publication',
    }]
  }))
}

export function replaceFeed(downloads: ReturnType<typeof validFeedDownloads>, file: string, change: (source: string) => string) {
  const original = downloads.get(file)!
  downloads.set(file, { ...original, bytes: Buffer.from(change(original.bytes.toString('utf8'))) })
  return downloads
}
