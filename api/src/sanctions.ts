import { newId } from './crypto.ts'
import type { Env } from './env'
import { candidateEvidence, isUsableName, normalizeName, scoreName, searchQuery, sortedName } from './sanctions-data.ts'

export const SANCTIONS_PROVIDER = 'us-treasury-ofac' as const
export const SANCTIONS_MAX_AGE_MS = 24 * 60 * 60 * 1000
export const SANCTIONS_CANDIDATE_LIMIT = 2000
export const FUZZY_MATCH_THRESHOLD = 82

const sourceRoot = 'https://sanctionslistservice.ofac.treas.gov/api/publicationpreview/exports/'
const officialSources = [
  { file: 'sdn.csv', minimumRows: 5000, primary: true },
  { file: 'alt.csv', minimumRows: 5000, primary: false },
  { file: 'cons_prim.csv', minimumRows: 100, primary: true },
  { file: 'cons_alt.csv', minimumRows: 100, primary: false },
] as const

export interface SanctionsSource {
  file: string
  url: string
  rows?: number
  sha256?: string
  lastModified?: string | null
  publicationId?: string | null
  fetchedAt?: string
}

export type SanctionsUnavailableReason = 'missing' | 'stale' | 'invalid' | 'unavailable'

export interface SanctionsStatus {
  provider: typeof SANCTIONS_PROVIDER
  ready: boolean
  reason: SanctionsUnavailableReason | null
  version: string | null
  contentSha256: string | null
  checkedAt: string | null
  entityCount: number
  nameCount: number
  sources: SanctionsSource[]
}

export interface SanctionsDataset {
  version: string
  contentSha256: string
  checkedAt: string
  entityCount: number
  nameCount: number
  sources: SanctionsSource[]
}

export class SanctionsUnavailableError extends Error {
  readonly code = 'sanctions_unavailable'
  readonly reason: SanctionsUnavailableReason

  constructor(reason: SanctionsUnavailableReason) {
    super('Current validated sanctions data is unavailable. Transfers require a fresh screening dataset.')
    this.name = 'SanctionsUnavailableError'
    this.reason = reason
  }
}

export type ScreeningStatus = 'clear' | 'potential_match' | 'confirmed_match'

export interface ScreeningMatch {
  entityId: string
  officialId: string
  list: 'sdn' | 'non-sdn'
  programs: string[]
  entityType: string
  primaryName: string
  name: string
  nameId: string
  score: number
  matchType: 'exact' | 'reordered' | 'fuzzy'
}

export interface ScreeningResult {
  status: ScreeningStatus
  provider: typeof SANCTIONS_PROVIDER
  datasetVersion: string
  datasetHash: string
  checkedAt: string
  normalizedName: string
  matches: ScreeningMatch[]
  candidateCount: number
  reason?: 'name_match' | 'candidate_limit' | 'unusable_name'
  matched?: string
  score?: number
}

interface ActiveDatasetRow {
  version: string
  content_hash: string | null
  status: string | null
  provider: string | null
  checked_at: string
  entity_count: number | null
  name_count: number | null
  source_metadata_json: string | null
}

interface NameRow {
  name_id: string
  entity_id: string
  list: 'sdn' | 'non-sdn'
  primary_name: string
  name: string
  normalized_name: string
  sorted_name: string
  entity_type: string
  programs: string
}

function baseStatus(reason: SanctionsUnavailableReason): SanctionsStatus {
  return {
    provider: SANCTIONS_PROVIDER,
    ready: false,
    reason,
    version: null,
    contentSha256: null,
    checkedAt: null,
    entityCount: 0,
    nameCount: 0,
    sources: officialSources.map(({ file }) => ({ file, url: `${sourceRoot}${file}` })),
  }
}

function validatedSources(value: string | null): SanctionsSource[] | null {
  try {
    const parsed: unknown = JSON.parse(value ?? '')
    if (!Array.isArray(parsed) || parsed.length !== officialSources.length) return null
    const output: SanctionsSource[] = []
    for (const expected of officialSources) {
      const source = parsed.find((item: unknown) => typeof item === 'object' && item !== null && 'file' in item && item.file === expected.file)
      if (!source || source.url !== `${sourceRoot}${expected.file}`
        || !Number.isSafeInteger(source.rows) || source.rows < expected.minimumRows
        || typeof source.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(source.sha256)) return null
      if (source.fetchedAt !== undefined && (typeof source.fetchedAt !== 'string' || !Number.isFinite(Date.parse(source.fetchedAt)))) return null
      output.push({
        file: expected.file,
        url: `${sourceRoot}${expected.file}`,
        rows: source.rows,
        sha256: source.sha256,
        lastModified: typeof source.lastModified === 'string' ? source.lastModified : null,
        publicationId: typeof source.publicationId === 'string' ? source.publicationId : null,
        ...(typeof source.fetchedAt === 'string' ? { fetchedAt: source.fetchedAt } : {}),
      })
    }
    return output
  } catch {
    return null
  }
}

/** Public operational evidence; no customer names or screening decisions. */
export async function getSanctionsStatus(env: Env): Promise<SanctionsStatus> {
  let row: ActiveDatasetRow | null
  try {
    row = await env.DB.prepare(
      `SELECT a.snapshot_id AS version, a.last_success_checked_at AS checked_at,
              d.content_hash, d.status, d.provider, d.entity_count, d.name_count, d.source_metadata_json
         FROM sanctions_active a
         LEFT JOIN sanctions_datasets d ON d.snapshot_id = a.snapshot_id
        WHERE a.singleton = 1`,
    ).first<ActiveDatasetRow>()
  } catch {
    return baseStatus('unavailable')
  }
  if (!row) return baseStatus('missing')
  const status = {
    ...baseStatus('invalid'),
    version: typeof row.version === 'string' ? row.version : null,
    contentSha256: typeof row.content_hash === 'string' ? row.content_hash : null,
    checkedAt: typeof row.checked_at === 'string' ? row.checked_at : null,
    entityCount: Number(row.entity_count) || 0,
    nameCount: Number(row.name_count) || 0,
  }
  const sources = validatedSources(row.source_metadata_json)
  if (sources) status.sources = sources
  if (row.status !== 'ready' || !['US Treasury OFAC', SANCTIONS_PROVIDER].includes(row.provider ?? '')
    || !status.version || !/^[0-9a-f]{24}$/.test(status.version)
    || !status.contentSha256 || !/^[0-9a-f]{64}$/.test(status.contentSha256)
    || !status.contentSha256.startsWith(status.version)
    || !sources || !Number.isSafeInteger(status.entityCount) || !Number.isSafeInteger(status.nameCount)) return status
  const expectedNames = sources.reduce((sum, source) => sum + (source.rows ?? 0), 0)
  const expectedEntities = sources.filter((source) => source.file === 'sdn.csv' || source.file === 'cons_prim.csv')
    .reduce((sum, source) => sum + (source.rows ?? 0), 0)
  if (status.entityCount !== expectedEntities || status.nameCount !== expectedNames) return status
  const checked = Date.parse(status.checkedAt ?? '')
  const now = Date.now()
  if (!Number.isFinite(checked) || checked > now) return status
  if (now - checked > SANCTIONS_MAX_AGE_MS) return { ...status, reason: 'stale' }
  // The importer verifies table and index completeness before atomically
  // activating a ready snapshot. Do not count 41,000 rows on every transfer.
  return { ...status, ready: true, reason: null }
}

export async function loadFreshSanctionsDataset(env: Env): Promise<SanctionsDataset> {
  const status = await getSanctionsStatus(env)
  if (!status.ready || !status.version || !status.contentSha256 || !status.checkedAt) {
    throw new SanctionsUnavailableError(status.reason ?? 'unavailable')
  }
  return {
    version: status.version,
    contentSha256: status.contentSha256,
    checkedAt: status.checkedAt,
    entityCount: status.entityCount,
    nameCount: status.nameCount,
    sources: status.sources,
  }
}

function resultBase(dataset: SanctionsDataset, name: string): ScreeningResult {
  return {
    status: 'clear',
    provider: SANCTIONS_PROVIDER,
    datasetVersion: dataset.version,
    datasetHash: dataset.contentSha256,
    checkedAt: dataset.checkedAt,
    normalizedName: normalizeName(name),
    matches: [],
    candidateCount: 0,
  }
}

function rowMatch(row: NameRow, name: string, score: number): ScreeningMatch {
  let programs: unknown
  try { programs = JSON.parse(row.programs) } catch { throw new SanctionsUnavailableError('invalid') }
  if (!Array.isArray(programs) || !programs.every((program) => typeof program === 'string')
    || !['sdn', 'non-sdn'].includes(row.list) || !/^\d+$/.test(row.entity_id.split(':').pop() ?? '')
    || !row.name || row.normalized_name !== normalizeName(row.name) || row.sorted_name !== sortedName(row.name)) {
    throw new SanctionsUnavailableError('invalid')
  }
  const normalized = normalizeName(name)
  return {
    entityId: row.entity_id,
    officialId: row.entity_id.split(':').pop() ?? '',
    list: row.list,
    programs,
    entityType: row.entity_type,
    primaryName: row.primary_name,
    name: row.name,
    nameId: row.name_id,
    score,
    matchType: row.normalized_name === normalized ? 'exact' : row.sorted_name === sortedName(normalized) ? 'reordered' : 'fuzzy',
  }
}

function scoredResult(base: ScreeningResult, candidates: NameRow[], name: string): ScreeningResult {
  if (candidates.length > SANCTIONS_CANDIDATE_LIMIT) {
    return { ...base, status: 'potential_match', reason: 'candidate_limit', candidateCount: candidates.length }
  }
  const entityMatches = new Map<string, ScreeningMatch>()
  for (const candidate of candidates) {
    const score = scoreName(name, candidate.name)
    if (score < FUZZY_MATCH_THRESHOLD) continue
    const match = rowMatch(candidate, name, score)
    const existing = entityMatches.get(match.entityId)
    if (!existing || match.score > existing.score || (match.score === existing.score && match.matchType === 'exact')) {
      entityMatches.set(match.entityId, match)
    }
  }
  // Preserve every above-threshold entity. Review cannot clear just a top-ten
  // display while silently discarding another candidate below that display.
  const matches = [...entityMatches.values()].sort((a, b) => b.score - a.score || a.entityId.localeCompare(b.entityId))
  const first = matches[0]
  return first ? {
    ...base,
    status: 'potential_match',
    reason: 'name_match',
    matches,
    candidateCount: candidates.length,
    matched: first.name,
    score: first.score,
  } : { ...base, candidateCount: candidates.length }
}

/**
 * Screen one name against an immutable fresh official-data snapshot. A name
 * match is always potential: identity and non-SDN restrictions require review.
 * Empty, unsupported or overly broad searches never silently produce clear.
 */
export async function screenName(env: Env, name: string, snapshot?: SanctionsDataset): Promise<ScreeningResult> {
  const dataset = snapshot ?? await loadFreshSanctionsDataset(env)
  const checked = Date.parse(dataset.checkedAt)
  if (!Number.isFinite(checked) || checked > Date.now() || Date.now() - checked > SANCTIONS_MAX_AGE_MS) {
    throw new SanctionsUnavailableError('stale')
  }
  const base = resultBase(dataset, name)
  if (!isUsableName(name)) return { ...base, status: 'potential_match', reason: 'unusable_name' }
  try {
    const exact = await env.DB.prepare(
      `SELECT name_id, entity_id, list, primary_name, name, normalized_name, sorted_name, entity_type, programs
         FROM sanctions_names
        WHERE snapshot_id = ? AND (normalized_name = ? OR sorted_name = ?)
        LIMIT ?`,
    ).bind(dataset.version, base.normalizedName, sortedName(name), SANCTIONS_CANDIDATE_LIMIT + 1).all<NameRow>()
    if (!exact.success) throw new SanctionsUnavailableError('unavailable')
    if (exact.results.length > SANCTIONS_CANDIDATE_LIMIT) return scoredResult(base, exact.results, name)
    const query = searchQuery(name)
    if (!query) return { ...base, status: 'potential_match', reason: 'unusable_name' }
    const evidence = candidateEvidence(name)
    const candidates = await env.DB.prepare(
      `WITH candidates AS (
         SELECT rowid, search_terms
           FROM sanctions_name_search
          WHERE sanctions_name_search MATCH ? AND snapshot_id = ?
       ), long_evidence AS MATERIALIZED (
         SELECT c.rowid, json_extract(s.value, '$.broad') AS broad,
                json_extract(s.value, '$.strict') AS strict,
                (SELECT COUNT(*) FROM json_each(json_extract(s.value, '$.terms')) t
                  WHERE instr(' ' || c.search_terms || ' ', ' ' || t.value || ' ') > 0) AS hits
           FROM candidates c JOIN json_each(?) s
       ), short_evidence AS MATERIALIZED (
         SELECT sanctions_name_search.rowid, 1 AS broad, 1 AS strict, 1 AS hits
           FROM json_each(?) s
           JOIN sanctions_name_search
             ON sanctions_name_search MATCH json_extract(s.value, '$.wholeWordQuery')
          WHERE sanctions_name_search.snapshot_id = ?
       ), passing AS (
         SELECT rowid FROM (
           SELECT * FROM long_evidence
           UNION ALL
           SELECT * FROM short_evidence
         ) GROUP BY rowid
         HAVING SUM(hits >= broad) >= ? AND MAX(hits >= strict) >= 1
       )
       SELECT n.name_id, n.entity_id, n.list, n.primary_name, n.name,
              n.normalized_name, n.sorted_name, n.entity_type, n.programs
         FROM passing p
         JOIN sanctions_name_search f ON f.rowid = p.rowid
         JOIN sanctions_names n
           ON n.snapshot_id = f.snapshot_id AND n.name_id = f.name_id
        LIMIT ?`,
    ).bind(
      query, dataset.version,
      JSON.stringify(evidence.filter((word) => !word.wholeWordQuery)),
      JSON.stringify(evidence.filter((word) => word.wholeWordQuery)),
      dataset.version, Math.min(2, evidence.length), SANCTIONS_CANDIDATE_LIMIT + 1,
    ).all<NameRow>()
    if (!candidates.success) throw new SanctionsUnavailableError('unavailable')
    if (candidates.results.length > SANCTIONS_CANDIDATE_LIMIT) return scoredResult(base, candidates.results, name)
    // An exact name can coexist with other entities' close aliases. Keep those
    // candidates too so a false-positive decision covers every possible hit.
    const combined = new Map(exact.results.map((row) => [row.name_id, row]))
    for (const row of candidates.results) combined.set(row.name_id, row)
    return scoredResult(base, [...combined.values()], name)
  } catch (error) {
    if (error instanceof SanctionsUnavailableError) throw error
    throw new SanctionsUnavailableError('unavailable')
  }
}

/** Build an insert for the caller's atomic transaction; this does not execute. */
export function sanctionsScreeningStatement(
  env: Env,
  args: { id?: string; subjectType: 'user' | 'recipient'; subjectId: string; name: string; transferId?: string; stage?: string },
  result: ScreeningResult,
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO sanctions_screenings
       (id, subject_type, subject_id, transfer_id, provider, status, match_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    args.id ?? newId('scr'),
    args.subjectType,
    args.subjectId,
    args.transferId ?? null,
    SANCTIONS_PROVIDER,
    result.status,
    JSON.stringify({ subjectName: args.name, stage: args.stage ?? null, ...result }),
    new Date().toISOString(),
  )
}
