import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { after, before, test, type TestContext } from 'node:test'
import { build } from 'esbuild'
import { Hono } from 'hono'
import { verifyPassword } from '../src/crypto.ts'
import { fixtureEnv, seedDataset, seedParties, seedTransfer, SqliteD1 } from './sanctions-fixture.ts'

let app: Hono
let directory: string
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'xpresstend-customer-lifecycle-'))
  const modules = await Promise.all(['routes-auth', 'routes-transfers', 'routes-admin'].map(async (name) => {
    const outfile = join(directory, `${name}.mjs`)
    await build({ entryPoints: [new URL(`../src/${name}.ts`, import.meta.url).pathname], outfile,
      bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' })
    return import(pathToFileURL(outfile).href)
  }))
  app = new Hono()
  for (const router of [modules[0].auth, modules[1].transfers, modules[2].admin]) {
    router.onError((_error, c) => c.json({ error: 'internal_error' }, 500))
  }
  app.route('/auth', modules[0].auth).route('/', modules[1].transfers).route('/admin', modules[2].admin)
})
after(async () => { if (directory) await rm(directory, { recursive: true, force: true }) })

async function setup(t: TestContext, options: { emailEnabled?: boolean; senderName?: string } = {}) {
  const db = new SqliteD1()
  t.after(() => db.close())
  seedDataset(db)
  const sessions = await seedParties(db, { senderName: options.senderName })
  const env = { ...fixtureEnv(db), ...(options.emailEnabled === false ? {} : { RESEND_API_KEY: 'isolated-test-key' }) }
  const emails: { to: string[]; text: string }[] = []
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(input), 'https://api.resend.com/emails', 'no real external request is allowed')
    emails.push(JSON.parse(String(init?.body)))
    return new Response('{"id":"isolated-email"}', { status: 200, headers: { 'content-type': 'application/json' } })
  })
  async function request(path: string, options: { body?: unknown; method?: string; cookie?: string; origin?: string } = {}) {
    const tasks: Promise<unknown>[] = []
    const response = await app.request(path, {
      method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
      headers: { cookie: options.cookie ?? sessions.userCookie, 'content-type': 'application/json',
        ...(options.origin ? { origin: options.origin } : {}) },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    }, env, { waitUntil: (promise: Promise<unknown>) => tasks.push(promise), passThroughOnException() {} })
    const result = { status: response.status, body: await response.json(), headers: response.headers }
    await Promise.all(tasks)
    return result
  }
  const forgot = (email = 'customer@example.invalid') => request('/auth/forgot-password', { body: { email }, cookie: '' })
  const reset = (token: string, password = 'NewCustomerPassword456!') => request('/auth/reset-password', { body: { token, password }, cookie: '' })
  const erase = (password = sessions.password) => request('/auth/account', { method: 'DELETE', body: { password, confirmation: 'DELETE' } })
  const create = () => request('/transfers', { body: { corridorId: 'cor_us_so', recipientId: 'recipient-1', sendAmountMinor: 10000 } })
  async function completedTransfer() {
    const created = await create()
    assert.equal(created.status, 200)
    const id = created.body.transfer.id
    assert.equal((await request(`/transfers/${id}/pay`, { body: { password: sessions.password } })).status, 200)
    assert.equal((await request(`/admin/transfers/${id}/approve`, { body: {}, cookie: sessions.staffCookies.compliance })).status, 200)
    return id
  }
  return { db, sessions, env, emails, request, forgot, reset, erase, create, completedTransfer }
}

function emailToken(emails: { text: string }[], index = emails.length - 1) {
  const match = emails[index]?.text.match(/#\/reset-password\/([a-f0-9]{64})/)
  assert.ok(match, 'the capability is delivered only through the isolated email transport')
  return match[1]
}

test('customer recovery responses do not reveal active, absent or closed accounts or capabilities', async (t) => {
  const f = await setup(t)
  const active = await f.forgot()
  const token = emailToken(f.emails)
  const absent = await f.forgot('absent@example.invalid')
  f.db.sqlite.exec("UPDATE users SET status='closed' WHERE id='customer-1'")
  const closed = await f.forgot()
  assert.equal(active.status, 200)
  assert.deepEqual(absent.body, active.body)
  assert.deepEqual(closed.body, active.body)
  assert.equal(f.emails.length, 1)
  assert.equal(active.headers.get('cache-control'), 'no-store')
  assert.ok(!JSON.stringify(active.body).includes(token))
  assert.ok(!JSON.stringify(active.body).includes('customer@example.invalid'))
  const rows = f.db.sqlite.prepare('SELECT token_hash FROM customer_password_resets').all()
  assert.equal(rows.length, 1)
  assert.match(String(rows[0].token_hash), /^[a-f0-9]{64}$/)
  assert.notEqual(rows[0].token_hash, token)
  assert.ok(!JSON.stringify(f.db.sqlite.prepare('SELECT * FROM audit_log').all()).includes(token))
})

test('unconfigured delivery revokes recovery capabilities while preserving the uniform response', async (t) => {
  const f = await setup(t, { emailEnabled: false })
  assert.equal((await f.forgot()).status, 200)
  assert.equal(f.emails.length, 0)
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM customer_password_resets WHERE revoked_at IS NULL').get()!.n, 0)
})

test('a newly requested customer reset replaces previous links and successful redemption revokes every session', async (t) => {
  const f = await setup(t)
  assert.equal((await f.request('/auth/login', { body: { email: 'customer@example.invalid', password: f.sessions.password }, cookie: '' })).status, 200)
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM sessions WHERE revoked_at IS NULL').get()!.n, 2)
  await f.forgot()
  const previous = emailToken(f.emails)
  await f.forgot()
  const current = emailToken(f.emails)
  assert.notEqual(previous, current)
  assert.equal((await f.reset(previous)).body.error, 'invalid_token')
  f.db.sqlite.exec("UPDATE users SET failed_login_count=5,locked_until='2099-01-01T00:00:00.000Z' WHERE id='customer-1'")
  assert.equal((await f.reset(current)).status, 200)
  const user = f.db.sqlite.prepare('SELECT * FROM users WHERE id=?').get('customer-1')!
  assert.equal(await verifyPassword('NewCustomerPassword456!', String(user.password_salt), Number(user.password_iterations), String(user.password_hash), 'test-pepper'), true)
  assert.equal(user.failed_login_count, 0)
  assert.equal(user.locked_until, null)
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM sessions WHERE revoked_at IS NULL').get()!.n, 0)
  assert.equal((await f.request('/auth/me')).status, 401)
  assert.equal((await f.reset(current)).body.error, 'invalid_token')
})

test('expired, malformed, weak-password and closed-account reset attempts cannot change credentials', async (t) => {
  for (const scenario of ['expired', 'malformed', 'weak-password', 'closed']) {
    await t.test(scenario, async (context) => {
      const f = await setup(context)
      await f.forgot()
      const token = emailToken(f.emails)
      const beforeHash = f.db.sqlite.prepare('SELECT password_hash FROM users').get()!.password_hash
      if (scenario === 'expired') f.db.sqlite.exec("UPDATE customer_password_resets SET expires_at='2000-01-01T00:00:00.000Z'")
      if (scenario === 'closed') f.db.sqlite.exec("UPDATE users SET status='closed' WHERE id='customer-1'")
      const response = await f.reset(scenario === 'malformed' ? 'not-a-capability' : token, scenario === 'weak-password' ? 'weak' : undefined)
      assert.equal(response.status, 400)
      assert.equal(response.body.error, scenario === 'weak-password' ? 'weak_password' : 'invalid_token')
      assert.equal(f.db.sqlite.prepare('SELECT password_hash FROM users').get()!.password_hash, beforeHash)
      assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM customer_password_resets WHERE used_at IS NOT NULL').get()!.n, 0)
    })
  }
})

test('concurrent redemption changes a customer password exactly once', async (t) => {
  const f = await setup(t)
  await f.forgot()
  const token = emailToken(f.emails)
  const responses = await Promise.all([f.reset(token, 'ConcurrentPassword123!'), f.reset(token, 'DifferentPassword456!')])
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 400])
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM customer_password_resets WHERE used_at IS NOT NULL').get()!.n, 1)
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action='user.password_reset'").get()!.n, 1)
})

test('a storage failure during reset leaves credentials, sessions and capability unchanged and retryable', async (t) => {
  const f = await setup(t)
  await f.forgot()
  const token = emailToken(f.emails)
  const oldHash = f.db.sqlite.prepare('SELECT password_hash FROM users').get()!.password_hash
  f.db.sqlite.exec("CREATE TRIGGER fail_reset_audit BEFORE INSERT ON audit_log WHEN NEW.action='user.password_reset' BEGIN SELECT RAISE(ABORT,'injected reset audit failure'); END")
  assert.equal((await f.reset(token)).status, 500)
  assert.equal(f.db.sqlite.prepare('SELECT password_hash FROM users').get()!.password_hash, oldHash)
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM sessions WHERE revoked_at IS NULL').get()!.n, 1)
  assert.equal(f.db.sqlite.prepare('SELECT used_at FROM customer_password_resets').get()!.used_at, null)
  f.db.sqlite.exec('DROP TRIGGER fail_reset_audit')
  assert.equal((await f.reset(token)).status, 200)
})

test('account deletion requires explicit confirmation and the current password, then removes the live profile', async (t) => {
  const f = await setup(t)
  assert.equal((await f.request('/auth/account', { method: 'DELETE', body: { password: f.sessions.password } })).status, 400)
  assert.equal((await f.erase('WrongCustomerPassword123!')).status, 401)
  assert.equal(f.db.sqlite.prepare('SELECT status FROM users').get()!.status, 'active')
  await f.forgot()
  const response = await f.erase()
  assert.equal(response.status, 200)
  assert.equal(response.body.retainedFinancialRecords, false)
  const user = f.db.sqlite.prepare('SELECT * FROM users').get()!
  assert.equal(user.status, 'closed')
  assert.notEqual(user.email, 'customer@example.invalid')
  assert.equal(user.phone, null)
  assert.equal(user.first_name, 'Deleted')
  assert.equal(user.last_name, 'Customer')
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM sessions').get()!.n, 0)
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM customer_password_resets').get()!.n, 0)
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM recipients').get()!.n, 0)
  assert.equal((await f.request('/auth/me')).status, 401)
  assert.equal((await f.request('/auth/login', { body: { email: 'customer@example.invalid', password: f.sessions.password }, cookie: '' })).status, 401)
})

test('abandoned unfunded quotes are cancelled atomically when the customer deletes the account', async (t) => {
  const f = await setup(t)
  const ids = ['draft', 'awaiting_payment', 'compliance_hold'].map((status) => seedTransfer(f.db, `unfunded-${status}`, status))
  f.db.sqlite.exec("CREATE TRIGGER fail_cancel_event BEFORE INSERT ON transfer_events WHEN NEW.to_status='cancelled' BEGIN SELECT RAISE(ABORT,'injected cancellation failure'); END")
  assert.equal((await f.erase()).status, 500)
  assert.equal(f.db.sqlite.prepare('SELECT status FROM users').get()!.status, 'active')
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) AS n FROM transfers WHERE status='cancelled'").get()!.n, 0)
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM customer_account_deletions').get()!.n, 0)
  f.db.sqlite.exec('DROP TRIGGER fail_cancel_event')
  assert.equal((await f.erase()).status, 200)
  assert.deepEqual(f.db.sqlite.prepare('SELECT status FROM transfers ORDER BY id').all().map((row) => row.status), ['cancelled', 'cancelled', 'cancelled'])
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) AS n FROM transfer_events WHERE to_status='cancelled'").get()!.n, 3)
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM ledger_entries').get()!.n, 0)
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM transfer_postings').get()!.n, 0)
  assert.equal((await f.request(`/transfers/${ids[1]}/pay`, { body: { password: f.sessions.password } })).status, 401)
})

test('deleting an eligible completed account preserves accounting and restricted financial identity evidence', async (t) => {
  const f = await setup(t)
  const id = await f.completedTransfer()
  const beforeLedger = f.db.sqlite.prepare('SELECT * FROM ledger_entries ORDER BY id').all()
  const beforePostings = f.db.sqlite.prepare('SELECT * FROM transfer_postings ORDER BY kind').all()
  const beforeScreenings = f.db.sqlite.prepare('SELECT * FROM sanctions_screenings ORDER BY id').all()
  assert.equal((await f.erase()).body.retainedFinancialRecords, true)
  assert.deepEqual(f.db.sqlite.prepare('SELECT * FROM ledger_entries ORDER BY id').all(), beforeLedger)
  assert.deepEqual(f.db.sqlite.prepare('SELECT * FROM transfer_postings ORDER BY kind').all(), beforePostings)
  assert.deepEqual(f.db.sqlite.prepare('SELECT * FROM sanctions_screenings ORDER BY id').all(), beforeScreenings)
  assert.equal(f.db.sqlite.prepare('SELECT status FROM transfers WHERE id=?').get(id)!.status, 'completed')
  const recipient = f.db.sqlite.prepare('SELECT archived_at,relationship FROM recipients').get()!
  assert.ok(recipient.archived_at)
  assert.equal(recipient.relationship, null)
  const retained = JSON.parse(String(f.db.sqlite.prepare('SELECT identity_json FROM customer_retained_identities').get()!.identity_json))
  assert.deepEqual(retained, { firstName: 'Zelda', lastName: 'Evergreen Merritt', country: 'US' })
  assert.equal((await f.request('/transfers')).status, 401)
})

test('pending transfers and unresolved monetary evidence block account deletion even in terminal status', async (t) => {
  for (const scenario of ['pending', 'failed-liability', 'missing-postings', 'unbalanced', 'offsetting-liabilities']) {
    await t.test(scenario, async (context) => {
      const f = await setup(context)
      if (scenario === 'pending') seedTransfer(f.db, 'pending-transfer', 'sending')
      else if (scenario === 'missing-postings') {
        const id = seedTransfer(f.db, 'missing-postings', 'completed')
        f.db.sqlite.prepare('UPDATE transfers SET paid_at=? WHERE id=?').run(new Date().toISOString(), id)
      } else if (scenario === 'unbalanced') {
        await f.completedTransfer()
        f.db.sqlite.exec("UPDATE ledger_entries SET amount_minor=amount_minor+1 WHERE id=(SELECT id FROM ledger_entries WHERE account_code<>'payout_payable' LIMIT 1)")
      } else if (scenario === 'failed-liability') {
        const created = await f.create()
        assert.equal((await f.request(`/transfers/${created.body.transfer.id}/pay`, { body: { password: f.sessions.password } })).status, 200)
        f.db.sqlite.exec("UPDATE transfers SET status='failed'")
      } else {
        for (const [index, amount] of [[1, 10000], [2, -10000]]) {
          const id = seedTransfer(f.db, `offset-${index}`, 'failed')
          for (const [account, value] of [['payout_payable', amount], ['clearing_cash', -Number(amount)]]) {
            f.db.sqlite.prepare(`INSERT INTO ledger_entries(id,transfer_id,account_code,currency,amount_minor,entry_group,created_at)
              VALUES (?,?,?,'USD',?,?,?)`).run(`${id}-${account}`, id, account, value, id, new Date().toISOString())
          }
        }
        assert.equal(f.db.sqlite.prepare("SELECT SUM(amount_minor) AS n FROM ledger_entries WHERE account_code='payout_payable'").get()!.n, 0)
      }
      const response = await f.erase()
      assert.equal(response.status, 409)
      assert.equal(response.body.error, 'account_deletion_blocked')
      assert.equal(f.db.sqlite.prepare('SELECT status FROM users').get()!.status, 'active')
      assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM customer_account_deletions').get()!.n, 0)
    })
  }
})

test('terminal transfer status cannot discard unresolved external provider evidence', async (t) => {
  for (const [status, field] of [
    ['failed', 'payment_provider'], ['cancelled', 'payment_intent_id'],
    ['refunded', 'payout_provider'], ['failed', 'payout_reference'],
  ]) {
    await t.test(`${status} ${field}`, async (context) => {
      const f = await setup(context)
      const id = seedTransfer(f.db, 'provider-pending', status)
      f.db.sqlite.prepare(`UPDATE transfers SET ${field}='unresolved-provider-operation' WHERE id=?`).run(id)
      const response = await f.erase()
      assert.equal(response.status, 409)
      assert.equal(response.body.error, 'account_deletion_blocked')
      assert.equal(f.db.sqlite.prepare('SELECT status FROM users').get()!.status, 'active')
      assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM customer_account_deletions').get()!.n, 0)
      assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM ledger_entries').get()!.n, 0)
    })
  }
})

test('a concurrently created transfer cannot exceed daily value, monthly value or daily count limits', async (t) => {
  for (const scenario of ['over_daily', 'over_monthly', 'over_daily_count']) {
    await t.test(scenario, async (context) => {
      const f = await setup(context)
      const earlier = new Date(Date.now() - 2 * 24 * 3600_000).toISOString()
      const existing = scenario === 'over_daily' ? 1 : scenario === 'over_monthly' ? 9 : 4
      function addCountedTransfer(id: string, date = new Date().toISOString()) {
        seedTransfer(f.db, id, 'awaiting_payment')
        f.db.sqlite.prepare('UPDATE transfers SET send_amount_minor=?,created_at=? WHERE id=?')
          .run(scenario === 'over_daily_count' ? 1000 : 100000, date, id)
      }
      for (let index = 0; index < existing; index++) {
        addCountedTransfer(`existing-${index}`, scenario === 'over_monthly' ? earlier : undefined)
      }
      let injected = false
      f.db.beforeExecute = (sql) => {
        if (!sql.startsWith('INSERT INTO transfers ')) return
        f.db.beforeExecute = undefined
        injected = true
        addCountedTransfer('concurrent-transfer')
      }
      const response = await f.create()
      assert.ok(injected, 'the competing transfer arrives after the initial limit check')
      assert.equal(response.status, 403)
      assert.equal(response.body.error, scenario)
      assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM transfers').get()!.n, existing + 1)
      assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM sanctions_screenings').get()!.n, 0)
      assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM transfer_events').get()!.n, 0)
      assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action='transfer.created'").get()!.n, 0)
    })
  }
})

test('changes between deletion authorization and claim cannot close a customer account', async (t) => {
  for (const scenario of ['new-transfer', 'revoked-session', 'changed-password']) {
    await t.test(scenario, async (context) => {
      const f = await setup(context)
      let injected = false
      f.db.beforeExecute = (sql) => {
        if (!/INSERT INTO customer_account_deletions/.test(sql)) return
        f.db.beforeExecute = undefined
        injected = true
        if (scenario === 'new-transfer') {
          seedTransfer(f.db, 'racing-transfer', 'awaiting_payment')
          f.db.sqlite.exec("UPDATE transfers SET payment_intent_id='provider-request-in-flight' WHERE id='racing-transfer'")
        }
        else if (scenario === 'revoked-session') f.db.sqlite.exec("UPDATE sessions SET revoked_at='2026-01-01T00:00:00.000Z'")
        else f.db.sqlite.exec("UPDATE users SET password_hash='changed-by-another-request'")
      }
      const response = await f.erase()
      assert.ok(injected)
      assert.equal(response.status, 409)
      assert.equal(response.body.error, scenario === 'new-transfer' ? 'account_deletion_blocked' : 'account_changed')
      assert.equal(f.db.sqlite.prepare('SELECT status FROM users').get()!.status, 'active')
      assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM customer_account_deletions').get()!.n, 0)
    })
  }
})

test('failed deletion audit rolls back profile, sessions and recipient erasure together', async (t) => {
  const f = await setup(t)
  f.db.sqlite.exec("CREATE TRIGGER fail_delete_audit BEFORE INSERT ON audit_log WHEN NEW.action='user.account_deleted' BEGIN SELECT RAISE(ABORT,'injected deletion audit failure'); END")
  assert.equal((await f.erase()).status, 500)
  assert.equal(f.db.sqlite.prepare('SELECT email,status FROM users').get()!.email, 'customer@example.invalid')
  assert.equal(f.db.sqlite.prepare('SELECT status FROM users').get()!.status, 'active')
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM sessions WHERE revoked_at IS NULL').get()!.n, 1)
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM recipients').get()!.n, 1)
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM customer_account_deletions').get()!.n, 0)
  f.db.sqlite.exec('DROP TRIGGER fail_delete_audit')
  assert.equal((await f.erase()).status, 200)
})

test('an in-flight login cannot issue a fresh session after its password changes', async (t) => {
  const f = await setup(t)
  let injected = false
  f.db.beforeExecute = (sql) => {
    if (!/INSERT INTO sessions/.test(sql)) return
    f.db.beforeExecute = undefined
    injected = true
    f.db.sqlite.exec("UPDATE users SET password_hash='changed-by-reset'")
  }
  const response = await f.request('/auth/login', { body: { email: 'customer@example.invalid', password: f.sessions.password }, cookie: '' })
  assert.ok(injected)
  assert.equal(response.status, 401)
  assert.equal(response.headers.get('set-cookie'), null)
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM sessions').get()!.n, 1)
})

test('stale failed-login work cannot restore lock counters after credentials change', async (t) => {
  const f = await setup(t)
  f.db.sqlite.exec('UPDATE users SET failed_login_count=4')
  let injected = false
  f.db.beforeExecute = (sql) => {
    if (!/UPDATE users SET failed_login_count =/.test(sql)) return
    f.db.beforeExecute = undefined
    injected = true
    f.db.sqlite.exec("UPDATE users SET password_hash='changed-by-reset',failed_login_count=0,locked_until=NULL")
  }
  assert.equal((await f.request('/auth/login', { cookie: '', body: { email: 'customer@example.invalid', password: 'WrongPassword123!' } })).status, 401)
  assert.ok(injected)
  const user = f.db.sqlite.prepare('SELECT failed_login_count,locked_until FROM users').get()!
  assert.equal(user.failed_login_count, 0)
  assert.equal(user.locked_until, null)
})

test('recipient and transfer creation cannot outlive account closure or session revocation', async (t) => {
  for (const path of ['/recipients', '/transfers']) {
    for (const change of ['closed', 'revoked-session']) {
      await t.test(`${path} ${change}`, async (context) => {
        const f = await setup(context)
        const table = path.slice(1)
        let injected = false
        f.db.beforeExecute = (sql) => {
          if (!sql.startsWith(`INSERT INTO ${table} `)) return
          f.db.beforeExecute = undefined
          injected = true
          f.db.sqlite.exec(change === 'closed'
            ? "UPDATE users SET status='closed'"
            : "UPDATE sessions SET revoked_at='2026-01-01T00:00:00.000Z'")
        }
        const response = path === '/transfers' ? await f.create() : await f.request(path, {
          body: { fullName: 'New Recipient', country: 'SO', payoutMethod: 'mobile_wallet' },
        })
        assert.ok(injected)
        assert.equal(response.status, 409)
        assert.equal(response.body.error, 'account_changed')
        assert.equal(f.db.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n, path === '/recipients' ? 1 : 0)
        assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM ledger_entries').get()!.n, 0)
      })
    }
  }
})

test('revoking a customer session before the funding claim prevents any monetary posting', async (t) => {
  const f = await setup(t)
  const created = await f.create()
  const id = created.body.transfer.id
  let injected = false
  f.db.beforeExecute = (sql) => {
    if (!sql.startsWith("UPDATE transfers SET status = 'compliance_hold', paid_at")) return
    f.db.beforeExecute = undefined
    injected = true
    f.db.sqlite.exec("UPDATE sessions SET revoked_at='2026-01-01T00:00:00.000Z'")
  }
  assert.equal((await f.request(`/transfers/${id}/pay`, { body: { password: f.sessions.password } })).status, 409)
  assert.ok(injected)
  assert.equal(f.db.sqlite.prepare('SELECT paid_at FROM transfers').get()!.paid_at, null)
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM ledger_entries').get()!.n, 0)
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM transfer_postings').get()!.n, 0)
})

async function verifyPaymentLosesToDeletion(f: Awaited<ReturnType<typeof setup>>, id: string) {
  let injected = false
  let recordsAfterDeletion: unknown
  const records = () => ({
    screenings: f.db.sqlite.prepare('SELECT * FROM sanctions_screenings ORDER BY id').all(),
    events: f.db.sqlite.prepare('SELECT * FROM transfer_events ORDER BY id').all(),
    audit: f.db.sqlite.prepare('SELECT * FROM audit_log ORDER BY id').all(),
  })
  const originalBatch = f.db.batch.bind(f.db)
  f.db.batch = async (statements) => {
    if (statements.some((statement) => statement.sql.startsWith("UPDATE transfers SET status = 'compliance_hold'"))) {
      // The payment has read and screened the active account, but its write
      // transaction has not started. Complete a real deletion in this window.
      f.db.batch = originalBatch
      injected = true
      assert.equal((await f.erase()).status, 200)
      recordsAfterDeletion = records()
    }
    return originalBatch(statements)
  }
  const response = await f.request(`/transfers/${id}/pay`, { body: { password: f.sessions.password } })
  assert.ok(injected)
  assert.equal(response.status, 409)
  assert.equal(response.body.error, 'screening_changed')
  assert.equal(f.db.sqlite.prepare('SELECT status FROM users').get()!.status, 'closed')
  assert.equal(f.db.sqlite.prepare('SELECT status FROM transfers WHERE id=?').get(id)!.status, 'cancelled')
  assert.deepEqual(records(), recordsAfterDeletion)
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM ledger_entries').get()!.n, 0)
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM transfer_postings').get()!.n, 0)
}

test('a blocked sanctions payment cannot write screening or hold records after concurrent account deletion', async (t) => {
  const f = await setup(t, { senderName: 'Ivan Sergeyevich Petrov' })
  const created = await f.create()
  assert.equal(created.status, 200)
  const id = created.body.transfer.id
  assert.equal(created.body.transfer.status, 'compliance_hold')
  const heldRecords = () => ({
    events: f.db.sqlite.prepare("SELECT COUNT(*) AS n FROM transfer_events WHERE note='Sanctions review required before payment'").get()!.n,
    audit: f.db.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action='transfer.sanctions_hold'").get()!.n,
  })
  assert.equal((await f.request(`/transfers/${id}/pay`, { body: { password: f.sessions.password } })).status, 403)
  const alreadyHeld = heldRecords()
  assert.equal((await f.request(`/transfers/${id}/pay`, { body: { password: f.sessions.password } })).status, 403)
  assert.deepEqual(heldRecords(), alreadyHeld, 'an already-held retry adds no duplicate hold event or audit')
  await verifyPaymentLosesToDeletion(f, id)
})

test('a clear sanctions payment cannot add screening or funding records after concurrent account deletion', async (t) => {
  const f = await setup(t)
  const created = await f.create()
  assert.equal(created.status, 200)
  assert.equal(created.body.transfer.status, 'awaiting_payment')
  await verifyPaymentLosesToDeletion(f, created.body.transfer.id)
})

test('staff cannot verify closed accounts or write invalid verification tiers', async (t) => {
  const f = await setup(t)
  const cookie = f.sessions.staffCookies.compliance
  for (const tier of [0, 1.5, 4]) {
    const response = await f.request('/admin/users/customer-1/kyc', { body: { decision: 'verified', tier }, cookie })
    assert.equal(response.status, 400)
    assert.equal(response.body.error, 'invalid_kyc_tier')
  }
  f.db.sqlite.exec("UPDATE users SET status='closed',kyc_status='unverified',kyc_tier=0")
  const response = await f.request('/admin/users/customer-1/kyc', { body: { decision: 'verified', tier: 1 }, cookie })
  assert.equal(response.status, 409)
  assert.equal(response.body.error, 'account_changed')
  assert.equal(f.db.sqlite.prepare('SELECT kyc_tier FROM users').get()!.kyc_tier, 0)
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM kyc_checks').get()!.n, 0)
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action='user.kyc_decision'").get()!.n, 0)
})

test('untrusted origins cannot erase accounts or redeem customer reset capabilities', async (t) => {
  const f = await setup(t)
  await f.forgot()
  const token = emailToken(f.emails)
  assert.equal((await f.request('/auth/reset-password', { body: { token, password: 'AttackerPassword123!' }, origin: 'https://untrusted.invalid' })).status, 400)
  assert.equal((await f.request('/auth/account', { method: 'DELETE', body: { password: f.sessions.password, confirmation: 'DELETE' }, origin: 'https://untrusted.invalid' })).status, 400)
  assert.equal(f.db.sqlite.prepare('SELECT used_at FROM customer_password_resets').get()!.used_at, null)
  assert.equal(f.db.sqlite.prepare('SELECT status FROM users').get()!.status, 'active')
})
