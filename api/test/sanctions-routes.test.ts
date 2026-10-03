import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { after, before, test } from 'node:test'
import { build } from 'esbuild'
import { Hono } from 'hono'
import { fixtureEnv, seedDataset, seedParties, seedTransfer, SqliteD1 } from './sanctions-fixture.ts'

let app: Hono
let bundleDirectory: string

before(async () => {
  // Bundle the actual route graph rather than rewriting production imports or
  // replacing auth, SQL, screening, or ledger code with test doubles.
  bundleDirectory = await mkdtemp(join(tmpdir(), 'xpresstend-sanctions-routes-'))
  const routes = await Promise.all(['routes-transfers', 'routes-admin'].map(async (name) => {
    const outfile = join(bundleDirectory, `${name}.mjs`)
    await build({ entryPoints: [new URL(`../src/${name}.ts`, import.meta.url).pathname], outfile,
      bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' })
    return import(pathToFileURL(outfile).href)
  }))
  app = new Hono()
  // Each bundle contains Hono's default error handler. Supply the same JSON
  // failure contract as the application so injected SQL failures stay testable.
  routes[0].transfers.onError((_error, c) => c.json({ error: 'internal_error' }, 500))
  routes[1].admin.onError((_error, c) => c.json({ error: 'internal_error' }, 500))
  app.route('/', routes[0].transfers)
  app.route('/admin', routes[1].admin)
})

after(async () => { if (bundleDirectory) await rm(bundleDirectory, { recursive: true, force: true }) })

async function setup(context: { after: (callback: () => void) => void }, options: { senderName?: string; recipientName?: string; dataset?: boolean } = {}) {
  const db = new SqliteD1()
  context.after(() => db.close())
  const snapshot = options.dataset === false ? null : seedDataset(db)
  const sessions = await seedParties(db, options)
  const env = fixtureEnv(db)
  async function request(path: string, body?: unknown, cookie = sessions.userCookie) {
    const response = await app.request(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, env)
    return { status: response.status, body: await response.json() }
  }
  const create = () => request('/transfers', { corridorId: 'cor_us_so', recipientId: 'recipient-1', sendAmountMinor: 10000 })
  const pay = (id: string) => request(`/transfers/${id}/pay`, { password: sessions.password })
  const approve = (id: string) => request(`/admin/transfers/${id}/approve`, {}, sessions.staffCookies.compliance)
  return { db, snapshot, sessions, env, request, create, pay, approve }
}

function postingCount(db: SqliteD1, kind?: string) {
  return Number(kind
    ? db.sqlite.prepare('SELECT COUNT(*) AS n FROM transfer_postings WHERE kind=?').get(kind)!.n
    : db.sqlite.prepare('SELECT COUNT(*) AS n FROM transfer_postings').get()!.n)
}

test('creation screens both parties and links their official dataset evidence to the transfer', async (t) => {
  const fixture = await setup(t)
  const response = await fixture.create()
  assert.equal(response.status, 200)
  assert.equal(response.body.transfer.status, 'awaiting_payment')
  const records = fixture.db.sqlite.prepare('SELECT * FROM sanctions_screenings WHERE transfer_id=?').all(response.body.transfer.id)
  assert.equal(records.length, 2)
  assert.deepEqual(new Set(records.map((row) => row.subject_type)), new Set(['user', 'recipient']))
  for (const row of records) {
    const evidence = JSON.parse(String(row.match_json))
    assert.equal(row.status, 'clear')
    assert.equal(evidence.datasetVersion, fixture.snapshot!.version)
    assert.equal(evidence.datasetHash, fixture.snapshot!.hash)
  }
  assert.equal(postingCount(fixture.db), 0)
})

test('either a sender or recipient name match holds creation for human review', async (t) => {
  for (const subject of ['sender', 'recipient']) {
    await t.test(subject, async (context) => {
      const fixture = await setup(context, subject === 'sender'
        ? { senderName: 'Ivan Sergeyevich Petrov' } : { recipientName: 'Ivan Sergeyevich Petrov' })
      const response = await fixture.create()
      assert.equal(response.status, 200)
      assert.equal(response.body.transfer.status, 'compliance_hold')
      const match = fixture.db.sqlite.prepare(`SELECT subject_type FROM sanctions_screenings
        WHERE transfer_id=? AND status='potential_match'`).get(response.body.transfer.id)!
      assert.equal(match.subject_type, subject === 'sender' ? 'user' : 'recipient')
      assert.equal(postingCount(fixture.db), 0)
    })
  }
})

test('missing or stale sanctions data cannot create a transfer', async (t) => {
  for (const situation of ['missing', 'stale']) {
    await t.test(situation, async (context) => {
      const fixture = await setup(context, { dataset: false })
      if (situation === 'stale') seedDataset(fixture.db, { checkedAt: new Date(Date.now() - 25 * 3600_000).toISOString() })
      const response = await fixture.create()
      assert.equal(response.status, 503)
      assert.equal(response.body.error, 'sanctions_unavailable')
      assert.equal(fixture.db.sqlite.prepare('SELECT COUNT(*) AS n FROM transfers').get()!.n, 0)
      assert.equal(postingCount(fixture.db), 0)
    })
  }
})

test('payment refreshes both parties and books no funding for a newly unresolved name match', async (t) => {
  for (const subject of ['sender', 'recipient']) {
    await t.test(subject, async (context) => {
      const fixture = await setup(context)
      const created = await fixture.create()
      const id = created.body.transfer.id
      if (subject === 'sender') fixture.db.sqlite.prepare('UPDATE users SET first_name=?,last_name=?').run('Ivan', 'Sergeyevich Petrov')
      else fixture.db.sqlite.prepare('UPDATE recipients SET full_name=?').run('Ivan Sergeyevich Petrov')
      const response = await fixture.pay(id)
      assert.equal(response.status, 403)
      assert.equal(response.body.error, 'sanctions_review_required')
      const row = fixture.db.sqlite.prepare('SELECT status,paid_at FROM transfers WHERE id=?').get(id)!
      assert.equal(row.status, 'compliance_hold')
      assert.equal(row.paid_at, null)
      assert.equal(postingCount(fixture.db), 0)
      assert.equal(fixture.db.sqlite.prepare('SELECT COUNT(*) AS n FROM ledger_entries').get()!.n, 0)
    })
  }
})

test('an unavailable snapshot at payment time prevents funding despite an earlier clear result', async (t) => {
  const fixture = await setup(t)
  const created = await fixture.create()
  fixture.db.sqlite.exec('DELETE FROM sanctions_active')
  const response = await fixture.pay(created.body.transfer.id)
  assert.equal(response.status, 503)
  assert.equal(response.body.error, 'sanctions_unavailable')
  assert.equal(postingCount(fixture.db), 0)
})

test('a compliance hold without both a paid timestamp and funding posting cannot release money', async (t) => {
  for (const inconsistentState of ['neither', 'timestamp-only', 'posting-only']) {
    await t.test(inconsistentState, async (context) => {
      const fixture = await setup(context)
      const id = seedTransfer(fixture.db)
      if (inconsistentState === 'timestamp-only') fixture.db.sqlite.prepare('UPDATE transfers SET paid_at=? WHERE id=?').run(new Date().toISOString(), id)
      if (inconsistentState === 'posting-only') fixture.db.sqlite.prepare(`INSERT INTO transfer_postings
        (transfer_id,kind,entry_group,created_at) VALUES (?,'funding','fixture-group',?)`).run(id, new Date().toISOString())
      const response = await fixture.approve(id)
      assert.equal(response.status, 409)
      assert.equal(response.body.error, 'not_funded')
      assert.equal(postingCount(fixture.db, 'payout'), 0)
      assert.equal(fixture.db.sqlite.prepare('SELECT status FROM transfers WHERE id=?').get(id)!.status, 'compliance_hold')
    })
  }
})

test('payout rescreens the parties and blocks unresolved matches after a funded clear payment', async (t) => {
  const fixture = await setup(t)
  const created = await fixture.create()
  const id = created.body.transfer.id
  assert.equal((await fixture.pay(id)).status, 200)
  assert.equal(postingCount(fixture.db, 'funding'), 1)
  fixture.db.sqlite.prepare('UPDATE recipients SET full_name=?').run('Ivan Sergeyevich Petrov')
  const response = await fixture.approve(id)
  assert.equal(response.status, 403)
  assert.equal(response.body.error, 'sanctions_review_required')
  assert.equal(postingCount(fixture.db, 'payout'), 0)
  assert.equal(fixture.db.sqlite.prepare('SELECT status FROM transfers WHERE id=?').get(id)!.status, 'compliance_hold')
})

test('a fresh clear funded transfer releases once with balanced payout postings', async (t) => {
  const fixture = await setup(t)
  const created = await fixture.create()
  const id = created.body.transfer.id
  assert.equal((await fixture.pay(id)).status, 200)
  const released = await fixture.approve(id)
  assert.equal(released.status, 200)
  assert.equal(released.body.status, 'completed')
  assert.equal(postingCount(fixture.db, 'funding'), 1)
  assert.equal(postingCount(fixture.db, 'payout'), 1)
  const payout = fixture.db.sqlite.prepare(`SELECT SUM(e.amount_minor) AS total FROM ledger_entries e
    JOIN transfer_postings p ON p.entry_group=e.entry_group WHERE p.transfer_id=? AND p.kind='payout'`).get(id)!
  assert.equal(payout.total, 0)
  assert.equal((await fixture.approve(id)).status, 409)
  assert.equal(postingCount(fixture.db, 'payout'), 1)
})

test('stale data at release time cannot use the clear screening from payment', async (t) => {
  const fixture = await setup(t)
  const created = await fixture.create()
  const id = created.body.transfer.id
  assert.equal((await fixture.pay(id)).status, 200)
  fixture.db.sqlite.prepare('UPDATE sanctions_active SET last_success_checked_at=?')
    .run(new Date(Date.now() - 25 * 3600_000).toISOString())
  const response = await fixture.approve(id)
  assert.equal(response.status, 503)
  assert.equal(response.body.error, 'sanctions_unavailable')
  assert.equal(postingCount(fixture.db, 'funding'), 1)
  assert.equal(postingCount(fixture.db, 'payout'), 0)
})

test('a recorded confirmed match blocks payment even when the current name search would clear', async (t) => {
  const fixture = await setup(t)
  const created = await fixture.create()
  const id = created.body.transfer.id
  fixture.db.sqlite.prepare(`UPDATE sanctions_screenings SET status='confirmed_match'
    WHERE transfer_id=? AND subject_type='recipient'`).run(id)
  const response = await fixture.pay(id)
  assert.equal(response.status, 403)
  assert.equal(response.body.error, 'sanctions_blocked')
  assert.equal(postingCount(fixture.db), 0)
})

test('only authorised staff can record a reasoned false-positive decision, and it remains auditable', async (t) => {
  const fixture = await setup(t, { recipientName: 'Ivan Sergeyevich Petrov' })
  const created = await fixture.create()
  const id = created.body.transfer.id
  const record = fixture.db.sqlite.prepare(`SELECT id FROM sanctions_screenings
    WHERE transfer_id=? AND status='potential_match'`).get(id)!
  const reason = 'Reviewed separate identity documents; the shared name belongs to a different person.'
  const path = `/admin/screenings/${record.id}/clear`
  const before = await fixture.request(`/admin/transfers/${id}/screenings`, undefined, fixture.sessions.staffCookies.compliance)
  assert.equal(before.body.screening_ready, true)
  assert.equal(before.body.review_required, true)
  assert.equal((await fixture.request(path, { reason }, fixture.sessions.staffCookies.agent)).status, 403)
  assert.equal((await fixture.request(path, { reason: 'too short' }, fixture.sessions.staffCookies.compliance)).status, 400)
  assert.equal((await fixture.request(path, { reason }, fixture.sessions.staffCookies.compliance)).status, 200)
  const cleared = fixture.db.sqlite.prepare('SELECT cleared_by,cleared_at FROM sanctions_screenings WHERE id=?').get(record.id)!
  assert.equal(cleared.cleared_by, 'staff-compliance')
  assert.ok(cleared.cleared_at)
  const audit = fixture.db.sqlite.prepare(`SELECT actor_id,metadata FROM audit_log WHERE entity_id=? AND actor_type='admin'`).get(record.id)!
  assert.equal(audit.actor_id, 'staff-compliance')
  assert.ok(String(audit.metadata).includes(reason))
  assert.equal(postingCount(fixture.db), 0, 'a review decision must not itself fund or release the transfer')
  const after = await fixture.request(`/admin/transfers/${id}/screenings`, undefined, fixture.sessions.staffCookies.compliance)
  assert.equal(after.body.screening_ready, true)
  assert.equal(after.body.review_required, false)
  assert.equal(after.body.screenings.find((row) => row.id === record.id).review_reason, reason)
  assert.equal((await fixture.pay(id)).status, 200)
  assert.equal(postingCount(fixture.db, 'funding'), 1)
})

test('a prior false-positive decision cannot clear a changed dataset or changed subject name', async (t) => {
  for (const change of ['dataset', 'name']) {
    await t.test(change, async (context) => {
      const fixture = await setup(context, { recipientName: 'Ivan Sergeyevich Petrov' })
      const created = await fixture.create()
      const id = created.body.transfer.id
      const record = fixture.db.sqlite.prepare(`SELECT id FROM sanctions_screenings
        WHERE transfer_id=? AND status='potential_match'`).get(id)!
      const cleared = await fixture.request(`/admin/screenings/${record.id}/clear`, {
        reason: 'Reviewed separate identity documents and recorded this as a false positive.',
      }, fixture.sessions.staffCookies.compliance)
      assert.equal(cleared.status, 200)
      if (change === 'dataset') seedDataset(fixture.db, { hash: createHash('sha256').update('changed-official-snapshot').digest('hex') })
      else fixture.db.sqlite.prepare('UPDATE recipients SET full_name=?').run('Petrov Ivan Sergeyevich')
      const response = await fixture.pay(id)
      assert.equal(response.status, 403)
      assert.equal(response.body.error, 'sanctions_review_required')
      assert.equal(postingCount(fixture.db), 0)
    })
  }
})

test('a party, KYC or dataset change between payment screening and claim cannot fund the transfer', async (t) => {
  for (const change of ['name', 'kyc', 'valid-tier', 'recipient-id', 'dataset']) {
    await t.test(change, async (context) => {
      const fixture = await setup(context)
      const created = await fixture.create()
      if (change === 'valid-tier') fixture.db.sqlite.exec('UPDATE users SET kyc_tier=2')
      let intercepted = false
      fixture.db.beforeExecute = (sql) => {
        if (!/UPDATE transfers/.test(sql) || !/paid_at\s*=\s*\?/.test(sql)) return
        fixture.db.beforeExecute = undefined
        intercepted = true
        if (change === 'name') fixture.db.sqlite.prepare('UPDATE users SET first_name=?').run('Ivan')
        else if (change === 'kyc') fixture.db.sqlite.exec("UPDATE users SET kyc_status='unverified',kyc_tier=0")
        else if (change === 'valid-tier') fixture.db.sqlite.exec('UPDATE users SET kyc_tier=1')
        else if (change === 'recipient-id') {
          fixture.db.sqlite.exec(`INSERT INTO recipients (id,user_id,full_name,country,payout_method,created_at,updated_at)
            SELECT 'recipient-2',user_id,full_name,country,payout_method,created_at,updated_at FROM recipients WHERE id='recipient-1'`)
          fixture.db.sqlite.prepare('UPDATE transfers SET recipient_id=? WHERE id=?').run('recipient-2', created.body.transfer.id)
        }
        else seedDataset(fixture.db, { hash: createHash('sha256').update('new-dataset-during-claim').digest('hex') })
      }
      const response = await fixture.pay(created.body.transfer.id)
      assert.equal(intercepted, true, 'race must occur at the actual funding claim')
      assert.equal(response.status, 409)
      assert.equal(response.body.error, 'screening_changed')
      assert.equal(postingCount(fixture.db), 0)
    })
  }
})

test('a changed party or snapshot between release screening and claim cannot book payout', async (t) => {
  for (const change of ['name', 'recipient-id', 'dataset']) {
    await t.test(change, async (context) => {
      const fixture = await setup(context)
      const created = await fixture.create()
      const id = created.body.transfer.id
      assert.equal((await fixture.pay(id)).status, 200)
      let intercepted = false
      fixture.db.beforeExecute = (sql) => {
        if (!/UPDATE transfers/.test(sql) || !/completed_at\s*=\s*\?/.test(sql)) return
        fixture.db.beforeExecute = undefined
        intercepted = true
        if (change === 'name') fixture.db.sqlite.prepare('UPDATE recipients SET full_name=?').run('Ivan Sergeyevich Petrov')
        else if (change === 'recipient-id') {
          fixture.db.sqlite.exec(`INSERT INTO recipients (id,user_id,full_name,country,payout_method,created_at,updated_at)
            SELECT 'recipient-2',user_id,full_name,country,payout_method,created_at,updated_at FROM recipients WHERE id='recipient-1'`)
          fixture.db.sqlite.prepare('UPDATE transfers SET recipient_id=? WHERE id=?').run('recipient-2', id)
        }
        else seedDataset(fixture.db, { hash: createHash('sha256').update('new-dataset-during-release').digest('hex') })
      }
      const response = await fixture.approve(id)
      assert.equal(intercepted, true, 'race must occur at the actual payout claim')
      assert.equal(response.status, 409)
      assert.equal(response.body.error, 'screening_changed')
      assert.equal(postingCount(fixture.db, 'funding'), 1)
      assert.equal(postingCount(fixture.db, 'payout'), 0)
    })
  }
})

test('failed funding bookkeeping rolls back payment, accounting, events and audit together', async (t) => {
  for (const table of ['ledger_entries', 'transfer_events', 'audit_log']) {
    await t.test(table, async (context) => {
      const fixture = await setup(context)
      const created = await fixture.create()
      const id = created.body.transfer.id
      const beforeEvents = fixture.db.sqlite.prepare('SELECT COUNT(*) AS n FROM transfer_events WHERE transfer_id=?').get(id)!.n
      const beforeAudit = fixture.db.sqlite.prepare('SELECT COUNT(*) AS n FROM audit_log WHERE entity_id=?').get(id)!.n
      // A real SQL failure after the money claim must undo the entire operation.
      fixture.db.sqlite.exec(`CREATE TRIGGER fail_bookkeeping BEFORE INSERT ON ${table}
        BEGIN SELECT RAISE(ABORT, 'injected storage failure'); END`)
      assert.equal((await fixture.pay(id)).status, 500)
      const transfer = fixture.db.sqlite.prepare('SELECT status,paid_at,payment_intent_id FROM transfers WHERE id=?').get(id)!
      assert.equal(transfer.status, 'awaiting_payment')
      assert.equal(transfer.paid_at, null)
      assert.equal(transfer.payment_intent_id, null)
      assert.equal(postingCount(fixture.db), 0)
      assert.equal(fixture.db.sqlite.prepare('SELECT COUNT(*) AS n FROM ledger_entries').get()!.n, 0)
      assert.equal(fixture.db.sqlite.prepare('SELECT COUNT(*) AS n FROM transfer_events WHERE transfer_id=?').get(id)!.n, beforeEvents)
      assert.equal(fixture.db.sqlite.prepare('SELECT COUNT(*) AS n FROM audit_log WHERE entity_id=?').get(id)!.n, beforeAudit)
      fixture.db.sqlite.exec('DROP TRIGGER fail_bookkeeping')
      assert.equal((await fixture.pay(id)).status, 200, 'a failed atomic operation must remain safely retryable')
      assert.equal(postingCount(fixture.db, 'funding'), 1)
    })
  }
})

test('failed payout bookkeeping preserves funded hold and rolls back release evidence together', async (t) => {
  for (const table of ['ledger_entries', 'transfer_events', 'audit_log']) {
    await t.test(table, async (context) => {
      const fixture = await setup(context)
      const created = await fixture.create()
      const id = created.body.transfer.id
      assert.equal((await fixture.pay(id)).status, 200)
      const baseline = {
        ledger: fixture.db.sqlite.prepare('SELECT COUNT(*) AS n FROM ledger_entries').get()!.n,
        events: fixture.db.sqlite.prepare('SELECT COUNT(*) AS n FROM transfer_events WHERE transfer_id=?').get(id)!.n,
        audit: fixture.db.sqlite.prepare('SELECT COUNT(*) AS n FROM audit_log WHERE entity_id=?').get(id)!.n,
      }
      fixture.db.sqlite.exec(`CREATE TRIGGER fail_bookkeeping BEFORE INSERT ON ${table}
        BEGIN SELECT RAISE(ABORT, 'injected storage failure'); END`)
      assert.equal((await fixture.approve(id)).status, 500)
      const transfer = fixture.db.sqlite.prepare('SELECT status,paid_at,completed_at,payout_reference FROM transfers WHERE id=?').get(id)!
      assert.equal(transfer.status, 'compliance_hold')
      assert.ok(transfer.paid_at)
      assert.equal(transfer.completed_at, null)
      assert.equal(transfer.payout_reference, null)
      assert.equal(postingCount(fixture.db, 'funding'), 1)
      assert.equal(postingCount(fixture.db, 'payout'), 0)
      assert.equal(fixture.db.sqlite.prepare('SELECT COUNT(*) AS n FROM ledger_entries').get()!.n, baseline.ledger)
      assert.equal(fixture.db.sqlite.prepare('SELECT COUNT(*) AS n FROM transfer_events WHERE transfer_id=?').get(id)!.n, baseline.events)
      assert.equal(fixture.db.sqlite.prepare('SELECT COUNT(*) AS n FROM audit_log WHERE entity_id=?').get(id)!.n, baseline.audit)
      fixture.db.sqlite.exec('DROP TRIGGER fail_bookkeeping')
      assert.equal((await fixture.approve(id)).status, 200)
      assert.equal(postingCount(fixture.db, 'payout'), 1)
    })
  }
})

test('a failed false-positive audit leaves the match unresolved and retryable', async (t) => {
  const fixture = await setup(t, { recipientName: 'Ivan Sergeyevich Petrov' })
  const created = await fixture.create()
  const id = created.body.transfer.id
  const record = fixture.db.sqlite.prepare(`SELECT id,match_json FROM sanctions_screenings
    WHERE transfer_id=? AND status='potential_match'`).get(id)!
  const reason = 'Reviewed identity documents and verified this customer is a different person.'
  fixture.db.sqlite.exec(`CREATE TRIGGER fail_review_audit BEFORE INSERT ON audit_log
    BEGIN SELECT RAISE(ABORT, 'injected audit failure'); END`)
  const path = `/admin/screenings/${record.id}/clear`
  assert.equal((await fixture.request(path, { reason }, fixture.sessions.staffCookies.compliance)).status, 500)
  const row = fixture.db.sqlite.prepare('SELECT cleared_by,cleared_at,match_json FROM sanctions_screenings WHERE id=?').get(record.id)!
  assert.equal(row.cleared_by, null)
  assert.equal(row.cleared_at, null)
  assert.equal(row.match_json, record.match_json)
  const review = await fixture.request(`/admin/transfers/${id}/screenings`, undefined, fixture.sessions.staffCookies.compliance)
  assert.equal(review.body.review_required, true)
  assert.equal(postingCount(fixture.db), 0)
  fixture.db.sqlite.exec('DROP TRIGGER fail_review_audit')
  assert.equal((await fixture.request(path, { reason }, fixture.sessions.staffCookies.compliance)).status, 200)
  assert.equal((await fixture.request(`/admin/transfers/${id}/screenings`, undefined, fixture.sessions.staffCookies.compliance)).body.review_required, false)
})

test('observable payment and release commits always include their matching accounting and audit evidence', async (t) => {
  const fixture = await setup(t)
  const created = await fixture.create()
  const id = created.body.transfer.id
  const observations: {
    status: string; paid: boolean; funding: number; payout: number; paidAudit: number; releaseAudit: number;
    paidEvents: number; releaseEvents: number;
    ledger: { kind: string; entries: number; total: number | null }[];
  }[] = []
  fixture.db.afterBatch = () => {
    const row = fixture.db.sqlite.prepare('SELECT status,paid_at FROM transfers WHERE id=?').get(id)!
    observations.push({
      status: String(row.status), paid: !!row.paid_at,
      funding: postingCount(fixture.db, 'funding'), payout: postingCount(fixture.db, 'payout'),
      paidAudit: Number(fixture.db.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_id=? AND action='transfer.paid'").get(id)!.n),
      releaseAudit: Number(fixture.db.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_id=? AND action='transfer.approved'").get(id)!.n),
      paidEvents: Number(fixture.db.sqlite.prepare("SELECT COUNT(*) AS n FROM transfer_events WHERE transfer_id=? AND to_status='compliance_hold'").get(id)!.n),
      releaseEvents: Number(fixture.db.sqlite.prepare("SELECT COUNT(*) AS n FROM transfer_events WHERE transfer_id=? AND to_status='completed'").get(id)!.n),
      ledger: fixture.db.sqlite.prepare(`SELECT p.kind,COUNT(e.id) AS entries,SUM(e.amount_minor) AS total
        FROM transfer_postings p LEFT JOIN ledger_entries e ON e.entry_group=p.entry_group AND e.transfer_id=p.transfer_id
        WHERE p.transfer_id=? GROUP BY p.kind,e.currency`).all(id).map((entry) => ({
        kind: String(entry.kind), entries: Number(entry.entries), total: entry.total === null ? null : Number(entry.total),
      })),
    })
  }
  assert.equal((await fixture.pay(id)).status, 200)
  assert.equal((await fixture.approve(id)).status, 200)
  assert.ok(observations.some((row) => row.paid), 'observe a committed payment')
  assert.ok(observations.some((row) => row.status === 'completed'), 'observe a committed release')
  for (const row of observations) {
    if (row.paid) {
      assert.equal(row.funding, 1, 'another request cannot observe paid without funding evidence')
      assert.equal(row.paidAudit, 1)
      assert.equal(row.paidEvents, 1)
      const groups = row.ledger.filter((entry) => entry.kind === 'funding')
      assert.ok(groups.length)
      for (const group of groups) {
        assert.ok(group.entries > 0, 'a posting claim cannot stand in for actual accounting entries')
        assert.equal(group.total, 0, 'committed funding entries balance within each currency')
      }
    }
    if (row.status === 'completed') {
      assert.equal(row.payout, 1, 'another request cannot observe completed before payout evidence')
      assert.equal(row.releaseAudit, 1)
      assert.equal(row.releaseEvents, 1)
      const groups = row.ledger.filter((entry) => entry.kind === 'payout')
      assert.ok(groups.length)
      for (const group of groups) {
        assert.ok(group.entries > 0)
        assert.equal(group.total, 0, 'committed payout entries balance within each currency')
      }
    }
  }
})
