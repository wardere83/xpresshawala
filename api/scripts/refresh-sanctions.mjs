import { createHash } from 'node:crypto'
import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const apiDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = 'https://sanctionslistservice.ofac.treas.gov/api/publicationpreview/exports/'
export const officialFeeds = [
  { file: 'sdn.csv', list: 'sdn', kind: 'primary', minimumRows: 5000 },
  { file: 'alt.csv', list: 'sdn', kind: 'aliases', minimumRows: 5000 },
  { file: 'cons_prim.csv', list: 'non-sdn', kind: 'primary', minimumRows: 100 },
  { file: 'cons_alt.csv', list: 'non-sdn', kind: 'aliases', minimumRows: 100 },
].map((feed) => ({ ...feed, url: `${sourceRoot}${feed.file}` }))

const maximumBytes = 32 * 1024 * 1024
const sourceHosts = new Set([
  'sanctionslistservice.ofac.treas.gov',
  'wc2h-sls-prod-public-published.s3.us-gov-west-1.amazonaws.com',
])
const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const positiveId = (value) => /^[1-9]\d*$/.test(value)
const validValue = (value) => value !== '' && value !== '-0-'

// OFAC's CSVs use quoted commas, multiline remarks and escaped double quotes.
// There is no header row. A final standalone DOS EOF marker is not a record.
export function parseCsv(source) {
  const text = source.replace(/^\uFEFF/, '').replace(/(^|[\r\n])\u001a[\r\n]*$/, '$1')
  if (text.includes('\u0000') || text.includes('\u001a')) throw new Error('Unexpected CSV control byte')
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  let closedQuote = false
  const finishCell = () => { row.push(cell.trim()); cell = ''; closedQuote = false }
  const finishRow = () => {
    finishCell()
    if (row.some((value) => value !== '')) rows.push(row)
    row = []
  }
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') { cell += '"'; index += 1 }
        else { quoted = false; closedQuote = true }
      } else cell += character
    } else if (character === ',') finishCell()
    else if (character === '\n' || character === '\r') {
      finishRow()
      if (character === '\r' && text[index + 1] === '\n') index += 1
    } else if (character === '"' && cell.trim() === '' && !closedQuote) {
      cell = ''; quoted = true
    } else if (character === '"') throw new Error('Unexpected quote in an unquoted CSV value')
    else if (closedQuote && !/\s/.test(character)) throw new Error('Unexpected content after a CSV quote')
    else if (!closedQuote) cell += character
  }
  if (quoted) throw new Error('Unterminated CSV quoted value')
  if (cell !== '' || row.length > 0 || closedQuote) finishRow()
  return rows
}

export function validateFeeds(downloads) {
  const entities = new Map()
  const names = []
  const sourceMetadata = []
  const publicationIds = new Set()
  for (const feed of officialFeeds) {
    const download = downloads.get(feed.file)
    if (!download || download.bytes.length === 0) throw new Error(`${feed.file}: empty or missing feed`)
    const text = new TextDecoder('utf-8', { fatal: true }).decode(download.bytes)
    if (/^\s*</.test(text)) throw new Error(`${feed.file}: expected CSV, received markup`)
    const rows = parseCsv(text)
    if (rows.length < feed.minimumRows) throw new Error(`${feed.file}: unexpectedly small feed (${rows.length} rows)`)
    if (download.publicationId) publicationIds.add(download.publicationId)
    sourceMetadata.push({
      file: feed.file, list: feed.list, url: feed.url, rows: rows.length,
      sha256: sha256(download.bytes), lastModified: download.lastModified,
      publicationId: download.publicationId, fetchedAt: download.fetchedAt,
    })
    const ids = new Set()
    for (const fields of rows) {
      const expectedFields = feed.kind === 'primary' ? 12 : 5
      if (fields.length !== expectedFields) throw new Error(`${feed.file}: expected ${expectedFields} columns, received ${fields.length}`)
      if (!positiveId(fields[0])) throw new Error(`${feed.file}: invalid entity identifier`)
      const rowId = feed.kind === 'primary' ? fields[0] : fields[1]
      if (!positiveId(rowId) || ids.has(rowId)) throw new Error(`${feed.file}: invalid or duplicate record identifier`)
      ids.add(rowId)
      const name = feed.kind === 'primary' ? fields[1] : fields[3]
      if (!validValue(name) || name.length > 2000) throw new Error(`${feed.file}: invalid name`)
      const entityId = `${feed.list}:${fields[0]}`
      if (feed.kind === 'primary') {
        const entity = {
          entityId, list: feed.list, uid: fields[0], name, primaryName: name,
          type: validValue(fields[2]) ? fields[2] : 'entity',
          programs: validValue(fields[3]) ? fields[3].split(/\]\s*\[|;/).map((value) => value.replace(/^\[|\]$/g, '').trim()).filter(Boolean) : [],
        }
        entities.set(entityId, entity)
        names.push({ ...entity, nameId: `${entityId}:primary`, aliasUid: null, aliasType: null })
      } else {
        const entity = entities.get(entityId)
        if (!entity) throw new Error(`${feed.file}: alias references a missing primary entity`)
        names.push({ ...entity, name, nameId: `${entityId}:alias:${fields[1]}`, aliasUid: fields[1], aliasType: fields[2] })
      }
    }
  }
  if (publicationIds.size > 1) throw new Error('OFAC feeds have different publication identifiers; retry after publication completes')
  const contentHash = createHash('sha256')
  for (const feed of officialFeeds) contentHash.update(`${feed.file}\0`).update(downloads.get(feed.file).bytes)
  return { version: contentHash.digest('hex'), entities, names, sourceMetadata }
}

export async function downloadFeed(feed, fetcher = fetch) {
  let requestUrl = new URL(feed.url)
  let response
  for (let redirect = 0; redirect <= 4; redirect += 1) {
    if (requestUrl.protocol !== 'https:' || !sourceHosts.has(requestUrl.hostname)) {
      throw new Error(`${feed.file}: source redirected outside the approved OFAC hosts`)
    }
    response = await fetcher(requestUrl, {
      signal: AbortSignal.timeout(90_000), redirect: 'manual',
      headers: { Accept: 'text/csv', 'User-Agent': 'XpressTend official OFAC data refresh' },
    })
    if (![301, 302, 303, 307, 308].includes(response.status)) break
    const location = response.headers.get('location')
    if (!location || redirect === 4) throw new Error(`${feed.file}: invalid OFAC source redirect`)
    requestUrl = new URL(location, requestUrl)
  }
  if (!response.ok) throw new Error(`${feed.file}: OFAC HTTP ${response.status}`)
  const declaredBytes = Number(response.headers.get('content-length') || 0)
  if (declaredBytes > maximumBytes) throw new Error(`${feed.file}: feed exceeds size limit`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length === 0 || bytes.length > maximumBytes) throw new Error(`${feed.file}: empty or oversized response`)
  return {
    bytes,
    fetchedAt: new Date().toISOString(),
    lastModified: response.headers.get('last-modified'),
    publicationId: response.headers.get('x-amz-meta-publication-id'),
  }
}

async function fetchSnapshot() {
  const results = await Promise.all(officialFeeds.map(async (feed) => [feed.file, await downloadFeed(feed)]))
  const downloads = new Map(results)
  const snapshot = validateFeeds(downloads)
  // A second fetch of both primary files detects a publication that moved
  // while its aliases were being downloaded. Never activate a mixed batch.
  for (const feed of officialFeeds.filter((entry) => entry.kind === 'primary')) {
    const recheck = await downloadFeed(feed)
    if (sha256(recheck.bytes) !== sha256(downloads.get(feed.file).bytes)) {
      throw new Error(`${feed.file}: publication changed during refresh; retry without replacing the active data`)
    }
  }
  return { ...snapshot, checkedAt: new Date().toISOString() }
}

export { fetchSnapshot }

const sqlValue = (value) => value == null ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`
const snapshotId = (snapshot) => snapshot.version.slice(0, 24)

function insertRows(table, columns, rows) {
  const statements = []
  let batch = []
  let batchBytes = 0
  const flush = () => {
    if (batch.length) statements.push(`INSERT OR IGNORE INTO ${table} (${columns.join(',')}) VALUES ${batch.join(',')};`)
    batch = []; batchBytes = 0
  }
  for (const row of rows) {
    const encoded = `(${row.map(sqlValue).join(',')})`
    const bytes = Buffer.byteLength(encoded)
    if (bytes > 75_000) throw new Error('An OFAC record exceeds the D1 statement size limit')
    if (batchBytes + bytes > 75_000 || batch.length >= 200) flush()
    batch.push(encoded); batchBytes += bytes
  }
  flush()
  return statements
}

function insertSearchRows(id, rows) {
  const statements = []
  let batch = []
  let bytes = 0
  const flush = () => {
    if (batch.length) statements.push(`INSERT OR REPLACE INTO sanctions_name_search (rowid,snapshot_id,name_id,search_terms)
      SELECT n.rowid,n.snapshot_id,n.name_id,v.column2 FROM sanctions_names AS n
      JOIN (VALUES ${batch.join(',')}) AS v ON v.column1=n.name_id WHERE n.snapshot_id=${sqlValue(id)};`)
    batch = []; bytes = 0
  }
  for (const [, nameId, terms] of rows) {
    const value = `(${sqlValue(nameId)},${sqlValue(terms)})`
    const size = Buffer.byteLength(value)
    if (size > 74_000) throw new Error('An OFAC search entry exceeds the D1 statement size limit')
    if (bytes + size > 74_000 || batch.length >= 100) flush()
    batch.push(value); bytes += size + 1
  }
  flush()
  return statements
}

export function createSnapshotStatements(snapshot, helpers) {
  const id = snapshotId(snapshot)
  const names = []
  const index = []
  for (const entry of snapshot.names) {
    const normalized = helpers.normalizeName(entry.name)
    if (!normalized) throw new Error('An official sanctions name could not be normalized safely')
    names.push([
      id, entry.nameId, entry.entityId, entry.list, entry.primaryName, entry.name,
      normalized, helpers.sortedName(normalized), entry.type, JSON.stringify(entry.programs),
    ])
    index.push([id, entry.nameId, helpers.searchTerms(normalized)])
  }
  // A previous incomplete candidate may be discarded. The active snapshot is
  // excluded from every staging delete, even if a refresh is interrupted.
  const inactive = `${sqlValue(id)} NOT IN (SELECT snapshot_id FROM sanctions_active)`
  return [
    `DELETE FROM sanctions_name_search WHERE snapshot_id=${sqlValue(id)} AND ${inactive};`,
    `DELETE FROM sanctions_names WHERE snapshot_id=${sqlValue(id)} AND ${inactive};`,
    `DELETE FROM sanctions_datasets WHERE snapshot_id=${sqlValue(id)} AND ${inactive};`,
    `INSERT OR IGNORE INTO sanctions_datasets (snapshot_id,content_hash,status,provider,checked_at,source_metadata_json,entity_count,name_count) VALUES (${[
      id, snapshot.version, 'loading', 'US Treasury OFAC', snapshot.checkedAt,
      JSON.stringify(snapshot.sourceMetadata), snapshot.entities.size, snapshot.names.length,
    ].map(sqlValue).join(',')});`,
    ...insertRows('sanctions_names', [
      'snapshot_id', 'name_id', 'entity_id', 'list', 'primary_name', 'name',
      'normalized_name', 'sorted_name', 'entity_type', 'programs',
    ], names),
    ...insertSearchRows(id, index),
  ]
}

export function createSnapshotSql(snapshot, helpers) {
  return createSnapshotStatements(snapshot, helpers).join('\n')
}

export function createActivationSql(snapshot) {
  const id = sqlValue(snapshotId(snapshot))
  const checked = sqlValue(snapshot.checkedAt)
  const complete = `(SELECT COUNT(*) FROM sanctions_names WHERE snapshot_id=${id})=${snapshot.names.length}
    AND (SELECT COUNT(*) FROM sanctions_names WHERE snapshot_id=${id} AND name_id LIKE '%:primary')=${snapshot.entities.size}
    AND (SELECT COUNT(*) FROM sanctions_name_search WHERE snapshot_id=${id})=${snapshot.names.length}
    AND (SELECT COUNT(*) FROM sanctions_names n JOIN sanctions_name_search f
      ON f.rowid=n.rowid AND f.snapshot_id=n.snapshot_id AND f.name_id=n.name_id
      WHERE n.snapshot_id=${id})=${snapshot.names.length}`
  return `
    UPDATE sanctions_datasets SET status='ready',checked_at=${checked},activated_at=COALESCE(activated_at,${checked}),
      source_metadata_json=${sqlValue(JSON.stringify(snapshot.sourceMetadata))}
      WHERE snapshot_id=${id} AND content_hash=${sqlValue(snapshot.version)} AND checked_at<=${checked} AND ${complete};
    INSERT INTO sanctions_active (singleton,snapshot_id,last_success_checked_at)
      SELECT 1,snapshot_id,${checked} FROM sanctions_datasets
      WHERE snapshot_id=${id} AND status='ready' AND checked_at=${checked} AND ${complete}
      ON CONFLICT(singleton) DO UPDATE SET snapshot_id=excluded.snapshot_id,last_success_checked_at=excluded.last_success_checked_at
      WHERE excluded.last_success_checked_at>=sanctions_active.last_success_checked_at;
  `
}

function d1(database, mode, options) {
  const wrangler = join(apiDirectory, 'node_modules', 'wrangler', 'bin', 'wrangler.js')
  const result = spawnSync(process.execPath, [
    wrangler, 'd1', 'execute', database, mode, '--yes', '--json', ...options,
  ], { cwd: apiDirectory, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  if (result.error || result.status !== 0) {
    // Never forward arbitrary process output containing credential material.
    // Wrangler's own log can be inspected by the operator if a call fails.
    throw new Error(`D1 ${options.includes('--file') ? 'import' : 'query'} failed; active sanctions data was not replaced`)
  }
  let output
  try { output = JSON.parse(result.stdout.trim()) }
  catch { throw new Error('D1 returned invalid JSON; active sanctions data was not replaced') }
  if (!Array.isArray(output) || output.some((entry) => entry.success === false)) throw new Error('D1 did not complete the sanctions operation')
  return output.flatMap((entry) => entry.results || [])
}

async function verifySnapshot(execute, snapshot) {
  const id = sqlValue(snapshotId(snapshot))
  const [counts] = await execute(['--command', `SELECT
    (SELECT COUNT(*) FROM sanctions_names WHERE snapshot_id=${id}) AS name_count,
    (SELECT COUNT(*) FROM sanctions_names WHERE snapshot_id=${id} AND name_id LIKE '%:primary') AS entity_count,
    (SELECT COUNT(*) FROM sanctions_name_search WHERE snapshot_id=${id}) AS index_count,
    (SELECT COUNT(*) FROM sanctions_names n JOIN sanctions_name_search f
      ON f.rowid=n.rowid AND f.snapshot_id=n.snapshot_id AND f.name_id=n.name_id
      WHERE n.snapshot_id=${id}) AS indexed_name_count;`])
  if (!counts || counts.name_count !== snapshot.names.length || counts.entity_count !== snapshot.entities.size || counts.index_count !== snapshot.names.length || counts.indexed_name_count !== snapshot.names.length) {
    throw new Error('Staged OFAC row/index counts failed verification; active sanctions data was not replaced')
  }
  // Read one actual FTS entry as well as counting its rows. A broken search
  // index must not be advertised as usable screening data.
  const [probe] = await execute(['--command', `SELECT name_id,search_terms FROM sanctions_name_search WHERE snapshot_id=${id} LIMIT 1;`])
  if (!probe?.name_id || !probe?.search_terms) throw new Error('The OFAC search index is not usable')
  const token = String(probe.search_terms).split(' ')[0]
  if (!/^[a-zA-Z0-9]+$/.test(token)) throw new Error('The OFAC search index contains invalid encoded tokens')
  const matches = await execute(['--command', `SELECT name_id FROM sanctions_name_search
    WHERE sanctions_name_search MATCH ${sqlValue(token)} AND snapshot_id=${id} AND name_id=${sqlValue(probe.name_id)} LIMIT 1;`])
  if (matches.length === 0) throw new Error('The OFAC search index failed its candidate lookup check')
}

export function compatibilitySample(snapshot, limit = 50) {
  const ordered = snapshot.names.map((entry) => ({ entry, key: sha256(entry.nameId) }))
    .sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0)
    .map(({ entry }) => entry)
  const selected = new Map()
  const categories = [
    (entry) => /[\u00c0-\u024f]/u.test(entry.name),
    (entry) => entry.aliasUid !== null && entry.name.length <= 20,
    (entry) => entry.aliasUid !== null && entry.name.length >= 50,
    (entry) => entry.aliasUid === null && entry.list === 'sdn',
    (entry) => entry.aliasUid === null && entry.list === 'non-sdn',
  ]
  for (const accepts of categories) {
    for (const entry of ordered.filter(accepts).slice(0, 2)) {
      if (selected.size < limit) selected.set(entry.nameId, entry)
    }
  }
  for (const entry of ordered) {
    if (selected.size >= limit) break
    selected.set(entry.nameId, entry)
  }
  return [...selected.values()]
}

export async function verifyIndexCompatibility(execute, snapshot, helpers) {
  const sample = compatibilitySample(snapshot)
  if (sample.length === 0) throw new Error('An empty OFAC snapshot cannot establish index compatibility')
  const rows = await execute(['--command', `SELECT n.name_id,n.name,n.normalized_name,n.sorted_name,f.search_terms
    FROM sanctions_names n JOIN sanctions_name_search f
      ON f.rowid=n.rowid AND f.snapshot_id=n.snapshot_id AND f.name_id=n.name_id
    WHERE n.snapshot_id=${sqlValue(snapshotId(snapshot))}
      AND n.name_id IN (${sample.map((entry) => sqlValue(entry.nameId)).join(',')});`])
  const stored = new Map(rows.map((row) => [row.name_id, row]))
  for (const entry of sample) {
    const row = stored.get(entry.nameId)
    const normalized = helpers.normalizeName(entry.name)
    if (!row || row.name !== entry.name || row.normalized_name !== normalized
      || row.sorted_name !== helpers.sortedName(normalized)
      || row.search_terms !== helpers.searchTerms(normalized)) {
      throw new Error('Stored OFAC name/index encoding is incompatible with the current helpers; refresh and deployment refused')
    }
  }
}

async function cloudflareRequest(path, options = {}) {
  let response
  for (let attempt = 0; attempt < 3; attempt += 1) {
    response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
      ...options,
      signal: AbortSignal.timeout(90_000),
      headers: {
        Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
    })
    if (response.status !== 429 && response.status < 500) break
    if (attempt === 2) break
    await response.body?.cancel()
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000 * (attempt + 1)))
  }
  if (!response.ok) throw new Error(`Cloudflare D1 request failed (HTTP ${response.status}); active sanctions data preserved`)
  const body = await response.json()
  if (body.success !== true || body.errors?.length || (Array.isArray(body.result) && body.result.some((entry) => entry.success === false))) {
    throw new Error('Cloudflare D1 rejected a staged operation; active sanctions data preserved')
  }
  return body.result
}

async function remoteDatabasePath(database) {
  const configuration = await readFile(join(apiDirectory, 'wrangler.toml'), 'utf8')
  const sections = configuration.match(/\[\[d1_databases\]\][\s\S]*?(?=\n\[|$)/g) || []
  const section = sections.find((entry) => [
    entry.match(/database_name\s*=\s*"([^"]+)"/)?.[1],
    entry.match(/binding\s*=\s*"([^"]+)"/)?.[1],
  ].includes(database))
  const databaseId = section?.match(/database_id\s*=\s*"([a-f0-9-]+)"/)?.[1]
  if (!databaseId) throw new Error('The configured production D1 database could not be found')
  let accountId = process.env.CLOUDFLARE_ACCOUNT_ID
  if (accountId && !/^[a-f0-9]{32}$/.test(accountId)) throw new Error('CLOUDFLARE_ACCOUNT_ID has an invalid format')
  if (!accountId) {
    const accounts = await cloudflareRequest('/accounts?per_page=50')
    if (!Array.isArray(accounts) || accounts.length === 0) throw new Error('The deployment token could not identify its Cloudflare account')
    if (accounts.length === 1) accountId = accounts[0].id
    else {
      for (const account of accounts) {
        try {
          await cloudflareRequest(`/accounts/${account.id}/d1/database/${databaseId}`)
          accountId = account.id; break
        } catch { /* The token may cover another account, which is not this DB. */ }
      }
    }
  }
  if (!accountId || !/^[a-f0-9]{32}$/.test(accountId)) throw new Error('The production database account could not be selected safely')
  const metadata = await cloudflareRequest(`/accounts/${accountId}/d1/database/${databaseId}`)
  if (metadata?.uuid !== databaseId) throw new Error('Cloudflare returned an unexpected D1 database identity')
  return `/accounts/${accountId}/d1/database/${databaseId}/query`
}

async function stageRemoteSnapshot(execute, statements) {
  // Ordinary bounded queries keep the existing active data queryable. D1's
  // bulk-file import would temporarily take the entire production DB offline.
  for (let index = 0; index < statements.length; index += 1) {
    await execute(['--command', statements[index]])
    if ((index + 1) % 100 === 0) console.log(`[OFAC refresh] Staged ${index + 1}/${statements.length} bounded statements`)
  }
}

async function refreshDatabase(snapshot, database, mode) {
  const path = mode === '--remote' ? await remoteDatabasePath(database) : null
  const execute = path ? async (options) => {
    const result = await cloudflareRequest(path, { method: 'POST', body: JSON.stringify({ sql: options[1] }) })
    if (!Array.isArray(result)) throw new Error('D1 returned invalid query results')
    return result.flatMap((entry) => entry.results || [])
  } : async (options) => d1(database, mode, options)
  const helpers = await import('../src/sanctions-data.ts')
  const id = sqlValue(snapshotId(snapshot))
  const [existing] = await execute(['--command', `SELECT snapshot_id,content_hash,status FROM sanctions_datasets WHERE snapshot_id=${id};`])
  if (existing && existing.content_hash !== snapshot.version) throw new Error('Snapshot identifier collision; active data preserved')
  if (existing?.status === 'ready') {
    await verifySnapshot(execute, snapshot)
    await verifyIndexCompatibility(execute, snapshot, helpers)
    await execute(['--command', createActivationSql(snapshot)])
    const [active] = await execute(['--command', 'SELECT snapshot_id,last_success_checked_at FROM sanctions_active WHERE singleton=1;'])
    if (active?.snapshot_id !== snapshotId(snapshot) || active.last_success_checked_at !== snapshot.checkedAt) throw new Error('OFAC refresh freshness update could not be activated')
    return 'unchanged'
  }
  const directory = await mkdtemp(join(tmpdir(), 'xpresstend-ofac-'))
  try {
    const statements = createSnapshotStatements(snapshot, helpers)
    if (mode === '--remote') await stageRemoteSnapshot(execute, statements)
    else {
      const path = join(directory, 'snapshot.sql')
      await writeFile(path, statements.join('\n'), { mode: 0o600 })
      await execute(['--file', path])
    }
    await verifySnapshot(execute, snapshot)
    await verifyIndexCompatibility(execute, snapshot, helpers)
    await execute(['--command', createActivationSql(snapshot)])
    const [active] = await execute(['--command', 'SELECT snapshot_id,last_success_checked_at FROM sanctions_active WHERE singleton=1;'])
    if (active?.snapshot_id !== snapshotId(snapshot) || active.last_success_checked_at !== snapshot.checkedAt) {
      throw new Error('Verified OFAC snapshot could not be activated')
    }
    // Keep the active and previous completed snapshots. Screening history
    // stores its match evidence separately; transient failed candidates can go.
    const retired = `SELECT snapshot_id FROM sanctions_datasets
      WHERE snapshot_id NOT IN (SELECT snapshot_id FROM sanctions_active)
      AND snapshot_id NOT IN (SELECT snapshot_id FROM sanctions_datasets WHERE status='ready' ORDER BY activated_at DESC LIMIT 2)`
    await execute(['--command', `DELETE FROM sanctions_name_search WHERE snapshot_id IN (${retired});
      DELETE FROM sanctions_names WHERE snapshot_id IN (${retired});
      DELETE FROM sanctions_datasets WHERE snapshot_id IN (${retired});`])
    return 'activated'
  } finally { await rm(directory, { recursive: true, force: true }) }
}

async function main() {
  const arguments_ = process.argv.slice(2)
  const allowed = new Set(['--dry-run', '--remote', '--local'])
  const databaseArgument = arguments_.find((argument) => argument.startsWith('--database='))
  if (arguments_.some((argument) => !allowed.has(argument) && argument !== databaseArgument)) throw new Error('Use --dry-run, --remote, --local, or --database=NAME')
  if (arguments_.includes('--local') && arguments_.includes('--remote')) throw new Error('Choose either --local or --remote')
  const database = databaseArgument?.slice('--database='.length) || 'xpresstend-production'
  if (!/^[a-zA-Z0-9_-]+$/.test(database)) throw new Error('Invalid D1 database name')
  const mode = arguments_.includes('--local') ? '--local' : '--remote'
  const dryRun = arguments_.includes('--dry-run')
  if (!dryRun && mode === '--remote' && !process.env.CLOUDFLARE_API_TOKEN) throw new Error('CLOUDFLARE_API_TOKEN is required for a production refresh')
  // No D1 operations occur before every source has downloaded and passed
  // structural, entity/alias and stable-publication checks.
  const snapshot = await fetchSnapshot()
  const result = dryRun ? 'validated-dry-run' : await refreshDatabase(snapshot, database, mode)
  if (!dryRun && process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `version=${snapshotId(snapshot)}\ncontent_sha256=${snapshot.version}\n`)
  }
  console.log(JSON.stringify({
    event: result, provider: 'US Treasury OFAC', snapshotId: snapshotId(snapshot),
    contentHash: snapshot.version, entities: snapshot.entities.size, names: snapshot.names.length,
    lastSuccessCheckedAt: snapshot.checkedAt,
    sources: snapshot.sourceMetadata.map(({ file, rows, lastModified, publicationId }) => ({ file, rows, lastModified, publicationId })),
  }, null, 2))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(`[OFAC refresh] ${error.message}`); process.exitCode = 1 })
}
