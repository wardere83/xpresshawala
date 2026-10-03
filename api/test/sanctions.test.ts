import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { normalizeName, searchTerms, sortedName } from '../src/sanctions-data.ts'
import { loadFreshSanctionsDataset, sanctionsScreeningStatement, screenName, SanctionsUnavailableError } from '../src/sanctions.ts'
import { compatibilitySample, createActivationSql, createSnapshotSql, createSnapshotStatements, parseCsv, validateFeeds, verifyIndexCompatibility } from '../scripts/refresh-sanctions.mjs'
import { defaultNames, fixtureEnv, replaceFeed, seedDataset, seedParties, seedTransfer, sourceMetadata, SqliteD1, validFeedDownloads } from './sanctions-fixture.ts'

test('official CSV names retain quoted commas, escaped quotes and multiline fields, with BOM and DOS EOF', () => {
  assert.deepEqual(parseCsv('\uFEFF123,"Doe, ""Jane""",individual,"line 1\r\nline 2"\r\n\u001a\r\n'), [
    ['123', 'Doe, "Jane"', 'individual', 'line 1\r\nline 2'],
  ])
  for (const invalid of ['1,"unterminated', '1,"name"unexpected', '1,na\u0000me', '1,name\u001a']) {
    assert.throws(() => parseCsv(invalid))
  }
})

test('all four full-size official feeds are validated and aliases retain their primary entity', () => {
  const downloads = validFeedDownloads()
  replaceFeed(downloads, 'sdn.csv', (text) => text.replace('Subject 1', 'García, José "Pepe"'))
  // The CSV encoder normally escapes quotes; keep the mutated row valid here.
  replaceFeed(downloads, 'sdn.csv', (text) => text.replace('José "Pepe"', 'José ""Pepe""'))
  const snapshot = validateFeeds(downloads)
  assert.equal(snapshot.entities.size, 5100)
  assert.equal(snapshot.names.length, 10200)
  assert.match(snapshot.version, /^[a-f0-9]{64}$/)
  const alias = snapshot.names.find((name) => name.nameId === 'sdn:1:alias:1')
  assert.equal(alias.primaryName, 'García, José "Pepe"')
  assert.equal(alias.name, 'Alias 1')
  assert.ok(snapshot.entities.has('sdn:1') && snapshot.entities.has('non-sdn:1'))
  for (const source of snapshot.sourceMetadata) {
    assert.equal(source.sha256, createHash('sha256').update(downloads.get(source.file)!.bytes).digest('hex'))
  }
})

test('invalid UTF-8, missing feeds and mixed publication versions fail validation', () => {
  const invalidUtf = validFeedDownloads()
  invalidUtf.set('sdn.csv', { ...invalidUtf.get('sdn.csv')!, bytes: Buffer.from([0xc3, 0x28]) })
  assert.throws(() => validateFeeds(invalidUtf), TypeError)
  const missing = validFeedDownloads()
  missing.delete('cons_alt.csv')
  assert.throws(() => validateFeeds(missing), /empty or missing feed/)
  const mixed = validFeedDownloads()
  mixed.set('alt.csv', { ...mixed.get('alt.csv')!, publicationId: 'different-publication' })
  assert.throws(() => validateFeeds(mixed), /different publication identifiers/)
})

test('aliases cannot be empty, refer to missing entities or duplicate an alias identifier', () => {
  for (const replacement of ['"1","1","a.k.a.","","-0-"', '"999999","1","a.k.a.","Alias 1","-0-"', '"2","1","a.k.a.","Alias 2","-0-"']) {
    const downloads = validFeedDownloads()
    replaceFeed(downloads, 'alt.csv', (text) => replacement.includes('"2","1"')
      ? text.replace('"2","2","a.k.a.","Alias 2","-0-"', replacement)
      : text.replace('"1","1","a.k.a.","Alias 1","-0-"', replacement))
    assert.throws(() => validateFeeds(downloads), /invalid name|missing primary entity|duplicate record identifier/)
  }
})

test('an incomplete import preserves the trusted pointer; a complete import activates with its verified hash', async (t) => {
  const db = new SqliteD1()
  t.after(() => db.close())
  const original = seedDataset(db)
  const snapshot = { ...validateFeeds(validFeedDownloads()), checkedAt: new Date().toISOString() }
  const version = snapshot.version.slice(0, 24)
  db.sqlite.exec(createSnapshotSql(snapshot, { normalizeName, sortedName, searchTerms }))
  // Retrying acknowledged insert batches must not duplicate the FTS entries.
  for (const statement of createSnapshotStatements(snapshot, { normalizeName, sortedName, searchTerms }).slice(3)) db.sqlite.exec(statement)
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM sanctions_name_search WHERE snapshot_id=?').get(version)!.n, 10200)
  const missingIndex = db.sqlite.prepare('SELECT rowid,name_id,search_terms FROM sanctions_name_search WHERE snapshot_id=? LIMIT 1').get(version)!
  db.sqlite.prepare('DELETE FROM sanctions_name_search WHERE snapshot_id=? AND name_id=?').run(version, missingIndex.name_id)
  db.sqlite.exec(createActivationSql(snapshot))
  assert.equal(db.sqlite.prepare('SELECT snapshot_id FROM sanctions_active').get()!.snapshot_id, original.version)
  assert.equal(db.sqlite.prepare('SELECT status FROM sanctions_datasets WHERE snapshot_id=?').get(version)!.status, 'loading')
  db.sqlite.prepare('INSERT INTO sanctions_name_search(rowid,snapshot_id,name_id,search_terms) VALUES (?,?,?,?)')
    .run(missingIndex.rowid, version, 'mislinked-name', missingIndex.search_terms)
  // Equal row counts do not establish that the FTS names link to real rows.
  db.sqlite.exec(createActivationSql(snapshot))
  assert.equal(db.sqlite.prepare('SELECT snapshot_id FROM sanctions_active').get()!.snapshot_id, original.version)
  db.sqlite.prepare('UPDATE sanctions_name_search SET name_id=? WHERE rowid=?').run(missingIndex.name_id, missingIndex.rowid)
  db.sqlite.exec(createActivationSql(snapshot))
  const dataset = await loadFreshSanctionsDataset(fixtureEnv(db))
  assert.equal(dataset.version, version)
  assert.equal(dataset.contentSha256, snapshot.version)
  assert.equal(dataset.nameCount, 10200)
  const activeCheckedAt = db.sqlite.prepare('SELECT last_success_checked_at FROM sanctions_active').get()!.last_success_checked_at
  db.sqlite.exec(createActivationSql({ ...snapshot, checkedAt: new Date(Date.now() - 3600_000).toISOString() }))
  assert.equal(db.sqlite.prepare('SELECT last_success_checked_at FROM sanctions_active').get()!.last_success_checked_at, activeCheckedAt)
})

for (const [name, entityId, matchType] of [
  ['Ivan Sergeyevich Petrov', 'sdn:101', 'exact'],
  ['Vladimir Romanov', 'sdn:101', 'exact'],
  ['Petrov Ivan Sergeyevich', 'sdn:101', 'reordered'],
  ['Jose Angel Garcia', 'non-sdn:303', 'exact'],
  ['Farid Nur Rhaman', 'sdn:404', 'fuzzy'],
]) {
  test(`${name} produces a potential name match with official entity evidence`, async (t) => {
    const db = new SqliteD1()
    t.after(() => db.close())
    const snapshot = seedDataset(db)
    const result = await screenName(fixtureEnv(db), name)
    assert.equal(result.status, 'potential_match', 'name-only evidence must never confirm identity')
    assert.equal(result.datasetVersion, snapshot.version)
    assert.equal(result.datasetHash, snapshot.hash)
    const match = result.matches.find((candidate) => candidate.entityId === entityId)
    assert.ok(match)
    assert.equal(match.matchType, matchType)
    assert.ok(match.officialId && match.primaryName && match.name && match.programs.length)
  })
}

test('an exact primary match also retains other above-threshold fuzzy entity candidates', async (t) => {
  const db = new SqliteD1()
  t.after(() => db.close())
  seedDataset(db, { names: [...defaultNames, {
    entityId: 'sdn:505', nameId: 'sdn:505:primary', name: 'Ivan Sergeyevich Petrova',
    primaryName: 'Ivan Sergeyevich Petrova', list: 'sdn',
  }] })
  const result = await screenName(fixtureEnv(db), 'Ivan Sergeyevich Petrov')
  assert.equal(result.status, 'potential_match')
  assert.deepEqual(new Set(result.matches.map((match) => match.entityId)), new Set(['sdn:101', 'sdn:505']))
  assert.equal(result.matches.find((match) => match.entityId === 'sdn:101')!.matchType, 'exact')
  assert.equal(result.matches.find((match) => match.entityId === 'sdn:505')!.matchType, 'fuzzy')
})

test('usable unrelated names can clear, but empty, non-Latin and short names require review', async (t) => {
  const db = new SqliteD1()
  t.after(() => db.close())
  seedDataset(db)
  assert.equal((await screenName(fixtureEnv(db), 'Zelda Evergreen Merritt')).status, 'clear')
  for (const name of ['', '   ', 'محمد عبد الله', '李明', 'Ali']) {
    const result = await screenName(fixtureEnv(db), name)
    assert.equal(result.status, 'potential_match')
    assert.equal(result.reason, 'unusable_name')
  }
})

test('missing, stale, future, loading and invalid source snapshots fail closed', async (t) => {
  for (const situation of ['missing', 'stale', 'future', 'loading', 'source', 'hash']) {
    await t.test(situation, async (context) => {
      const db = new SqliteD1()
      context.after(() => db.close())
      if (situation !== 'missing') {
        seedDataset(db, {
          checkedAt: situation === 'stale' ? new Date(Date.now() - 25 * 3600_000).toISOString()
            : situation === 'future' ? new Date(Date.now() + 3600_000).toISOString() : undefined,
          status: situation === 'loading' ? 'loading' : 'ready',
          metadata: situation === 'source' ? sourceMetadata().slice(0, 3) : undefined,
        })
        if (situation === 'hash') db.sqlite.prepare('UPDATE sanctions_datasets SET content_hash=?').run('b'.repeat(64))
      }
      await assert.rejects(() => screenName(fixtureEnv(db), 'Zelda Evergreen Merritt'), (error) =>
        error instanceof SanctionsUnavailableError && error.code === 'sanctions_unavailable')
    })
  }
})

test('a successful unchanged-source recheck can be fresh while original source dates are older', async (t) => {
  const db = new SqliteD1()
  t.after(() => db.close())
  const snapshot = seedDataset(db, { metadata: sourceMetadata(new Date(Date.now() - 7 * 86400_000).toISOString()) })
  assert.equal((await loadFreshSanctionsDataset(fixtureEnv(db))).version, snapshot.version)
})

test('candidate exhaustion requires review rather than clearing an incompletely searched name', async (t) => {
  const db = new SqliteD1()
  t.after(() => db.close())
  const names = Array.from({ length: 2001 }, (_, index) => ({
    entityId: `sdn:${10000 + index}`, nameId: `sdn:${10000 + index}:primary`,
    name: `Martin Holden Wilder Additional${index}`, primaryName: `Martin Holden Wilder Additional${index}`, list: 'sdn',
  }))
  seedDataset(db, { names })
  const result = await screenName(fixtureEnv(db), 'Martin Holden Wilder')
  assert.equal(result.status, 'potential_match')
  assert.equal(result.reason, 'candidate_limit')
})

test('index compatibility samples are stable and include varied official names and aliases', () => {
  const names = compatibilityNames()
  const sample = compatibilitySample({ names }, 12)
  assert.equal(sample.length, 12)
  assert.deepEqual(sample.map((entry) => entry.nameId), compatibilitySample({ names: [...names].reverse() }, 12).map((entry) => entry.nameId))
  assert.ok(sample.some((entry) => entry.name === 'José Ángel García'))
  assert.ok(sample.some((entry) => entry.aliasUid !== null && entry.name.length <= 20))
  assert.ok(sample.some((entry) => entry.aliasUid !== null && entry.name.length >= 50))
  assert.ok(sample.some((entry) => entry.aliasUid === null && entry.list === 'sdn'))
  assert.ok(sample.some((entry) => entry.aliasUid === null && entry.list === 'non-sdn'))
})

function compatibilityNames() {
  return [
    ...defaultNames,
    { entityId: 'sdn:101', nameId: 'sdn:101:alias:209', name: 'An intentionally long official alias for the international payment holding company', primaryName: 'Ivan Sergeyevich Petrov', list: 'sdn' },
    ...Array.from({ length: 60 }, (_, index) => ({
      entityId: `sdn:${10000 + index}`, nameId: `sdn:${10000 + index}:primary`, name: `Fixture Entity ${index}`,
      primaryName: `Fixture Entity ${index}`, list: 'sdn',
    })),
  ].map((entry) => ({ ...entry, type: 'individual', programs: ['TEST'], aliasUid: entry.nameId.includes(':alias:') ? entry.nameId.split(':').pop() : null }))
}

test('persisted index compatibility rejects changed helpers or corrupted name encodings', async (t) => {
  const db = new SqliteD1()
  t.after(() => db.close())
  const names = compatibilityNames()
  const snapshot = {
    version: createHash('sha256').update('index-compatibility-fixture').digest('hex'), checkedAt: new Date().toISOString(),
    names, entities: new Map(names.map((entry) => [entry.entityId, entry])), sourceMetadata: sourceMetadata(),
  }
  const helpers = { normalizeName, sortedName, searchTerms }
  db.sqlite.exec(createSnapshotSql(snapshot, helpers))
  const execute = async (args: string[]) => db.sqlite.prepare(args[1]).all()
  await verifyIndexCompatibility(execute, snapshot, helpers)
  await assert.rejects(() => verifyIndexCompatibility(execute, snapshot, {
    ...helpers, searchTerms: (name: string) => `${searchTerms(name)} incompatibleencoding`,
  }), /incompatible/)

  const entry = compatibilitySample(snapshot)[0]
  for (const column of ['name', 'normalized_name', 'sorted_name', 'search_terms']) {
    const table = column === 'search_terms' ? 'sanctions_name_search' : 'sanctions_names'
    const original = db.sqlite.prepare(`SELECT ${column} AS value FROM ${table} WHERE name_id=?`).get(entry.nameId)!.value
    db.sqlite.prepare(`UPDATE ${table} SET ${column}=? WHERE name_id=?`).run('corrupted-but-present', entry.nameId)
    await assert.rejects(() => verifyIndexCompatibility(execute, snapshot, helpers), /incompatible/)
    db.sqlite.prepare(`UPDATE ${table} SET ${column}=? WHERE name_id=?`).run(original, entry.nameId)
  }
  await verifyIndexCompatibility(execute, snapshot, helpers)
})

test('screening records retain dataset evidence, subject and stage, and the actual transfer link', async (t) => {
  const db = new SqliteD1()
  t.after(() => db.close())
  const snapshot = seedDataset(db)
  await seedParties(db)
  const transferId = seedTransfer(db)
  const name = defaultNames[0].name
  const result = await screenName(fixtureEnv(db), name)
  await sanctionsScreeningStatement(fixtureEnv(db), {
    subjectType: 'recipient', subjectId: 'recipient-1', name, transferId, stage: 'creation',
  }, result).run()
  const record = db.sqlite.prepare('SELECT * FROM sanctions_screenings WHERE transfer_id=?').get(transferId)!
  const evidence = JSON.parse(String(record.match_json))
  assert.equal(record.subject_type, 'recipient')
  assert.equal(record.subject_id, 'recipient-1')
  assert.equal(record.provider, 'us-treasury-ofac')
  assert.equal(record.status, 'potential_match')
  assert.equal(evidence.subjectName, name)
  assert.equal(evidence.stage, 'creation')
  assert.equal(evidence.datasetVersion, snapshot.version)
  assert.equal(evidence.datasetHash, snapshot.hash)
  assert.equal(evidence.matches[0].entityId, 'sdn:101')
})
