/** Shared by the official-data importer and the Worker; no network or storage. */
const latinEquivalents: Record<string, string> = {
  æ: 'ae', œ: 'oe', ø: 'o', ł: 'l', đ: 'd', ð: 'd', þ: 'th', ß: 'ss', ı: 'i',
}

const nonDistinctiveWords = new Set([
  'a', 'an', 'and', 'the', 'of', 'co', 'company', 'limited', 'ltd', 'inc', 'llc',
  'corp', 'corporation', 'plc', 'jsc', 'oao', 'pjsc', 'mr', 'mrs', 'ms', 'dr',
])

/** Keep unsupported scripts visible so they can be held rather than cleared. */
export function normalizeName(name: string): string {
  return name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\p{M}/gu, '')
    .replace(/[æœøłđðþßı]/g, (letter) => latinEquivalents[letter] ?? letter)
    .replace(/['’‘ʼ`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

export function sortedName(name: string): string {
  return normalizeName(name).split(' ').filter(Boolean).sort().join(' ')
}

function words(name: string): string[] {
  return [...new Set(normalizeName(name).split(' ').filter((word) => word.length >= 3 && !nonDistinctiveWords.has(word)))]
}

function encode(prefix: string, text: string): string {
  return prefix + Array.from(text, (letter) => letter.codePointAt(0)!.toString(16).padStart(4, '0')).join('')
}

function grams(word: string, size: number): string[] {
  const characters = Array.from(word)
  const output: string[] = []
  for (let index = 0; index <= characters.length - size; index += 1) {
    output.push(encode(`g${size}`, characters.slice(index, index + size).join('')))
  }
  return output
}

/**
 * Compact ASCII FTS vocabulary: whole words and bigrams, plus long-word
 * trigrams. Bigrams also cover typos that share no contiguous trigram.
 * Hex encoding prevents user input becoming FTS syntax.
 */
export function searchTerms(name: string): string {
  const terms = new Set<string>()
  for (const word of words(name)) {
    terms.add(encode('w', word))
    for (const gram of grams(word, 2)) terms.add(gram)
    if (word.length > 5) for (const gram of grams(word, 3)) terms.add(gram)
  }
  return [...terms].sort().join(' ')
}

function shortWordVariants(word: string): string[] {
  if (word.length > 5 || !/^[a-z0-9]+$/.test(word)) return []
  const variants = new Set<string>()
  for (let index = 0; index <= word.length; index += 1) {
    for (const letter of 'abcdefghijklmnopqrstuvwxyz0123456789') {
      variants.add(word.slice(0, index) + letter + word.slice(index))
      if (index < word.length) variants.add(word.slice(0, index) + letter + word.slice(index + 1))
    }
    if (index < word.length) variants.add(word.slice(0, index) + word.slice(index + 1))
    if (index < word.length - 1) variants.add(word.slice(0, index) + word[index + 1] + word[index] + word.slice(index + 2))
  }
  return [...variants].map((variant) => encode('w', variant))
}

export interface CandidateWordEvidence {
  terms: string[]
  broad: number
  strict: number
}

/**
 * A conservative prefilter for the edit-distance scorer. One edit can destroy
 * at most three adjacent bigrams (a transposition); two can destroy six. The
 * shorter-word bounds also account for the scorer's minimum token similarity.
 * A passing name needs two matched words and at least one token similar enough
 * to reach the overall rounded score of 82. SQL checks this before its row cap.
 */
export function candidateEvidence(name: string): CandidateWordEvidence[] {
  return words(name).map((word) => {
    if (word.length <= 5) {
      return { terms: [encode('w', word), ...shortWordVariants(word)], broad: 1, strict: 1 }
    }
    const terms = [...new Set(grams(word, 2))]
    const broadLoss = word.length === 6 ? 3 : word.length === 7 ? 4 : 6
    const strictLoss = word.length <= 9 ? 3 : word.length === 10 ? 4 : 6
    return {
      terms,
      broad: Math.max(1, terms.length - broadLoss),
      strict: Math.max(1, terms.length - strictLoss),
    }
  })
}

/** Short-word variants cover typos with no shared bigram, such as Jan/Jon. */
export function searchQuery(name: string): string {
  const groups = words(name).map((word) => {
    const terms = new Set(word.length <= 5
      ? [encode('w', word), ...shortWordVariants(word)]
      : [encode('w', word), ...grams(word, 2), ...grams(word, 3)])
    return `(${[...terms].map((term) => `"${term}"`).join(' OR ')})`
  })
  if (groups.length === 0) return ''
  if (groups.length === 1) return groups[0] ?? ''
  // Requiring evidence from two input words limits common-gram explosions.
  // Every pair is included, allowing added or omitted middle-name words.
  const pairs: string[] = []
  for (let left = 0; left < groups.length; left += 1) {
    for (let right = left + 1; right < groups.length; right += 1) {
      pairs.push(`(${groups[left]} AND ${groups[right]})`)
    }
  }
  return pairs.join(' OR ')
}

export function isUsableName(name: string): boolean {
  if (name.length > 300 || /[\u0000-\u001f\u007f-\u009f]/.test(name)) return false
  const normalized = normalizeName(name)
  const tokens = normalized.split(' ')
  return /^[a-z0-9 ]+$/.test(normalized)
    && (normalized.match(/[a-z]/g)?.length ?? 0) >= 5
    && tokens.length <= 12
    && tokens.every((token) => token.length <= 50)
    && words(normalized).length > 0
}

/** Optimal-string-alignment distance includes common adjacent transpositions. */
function editDistance(left: string, right: string): number {
  const previousPrevious = new Array<number>(right.length + 1).fill(0)
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let row = 1; row <= left.length; row += 1) {
    const current = new Array<number>(right.length + 1).fill(0)
    current[0] = row
    for (let column = 1; column <= right.length; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1
      current[column] = Math.min(
        (previous[column] ?? 0) + 1,
        (current[column - 1] ?? 0) + 1,
        (previous[column - 1] ?? 0) + cost,
      )
      if (row > 1 && column > 1 && left[row - 1] === right[column - 2] && left[row - 2] === right[column - 1]) {
        current[column] = Math.min(current[column] ?? 0, (previousPrevious[column - 2] ?? 0) + 1)
      }
    }
    for (let column = 0; column <= right.length; column += 1) previousPrevious[column] = previous[column] ?? 0
    previous = current
  }
  return previous[right.length] ?? Math.max(left.length, right.length)
}

function tokenSimilarity(left: string, right: string): number {
  if (left === right) return 1
  if (left.length > 50 || right.length > 50) return 0
  const length = Math.max(left.length, right.length)
  const minimum = Math.min(left.length, right.length)
  const allowedEdits = minimum <= 5 ? 1 : 2
  if (Math.abs(left.length - right.length) > allowedEdits) return 0
  const distance = editDistance(left, right)
  if (distance > allowedEdits) return 0
  const similarity = 1 - distance / length
  return similarity >= 0.74 ? similarity : 0
}

/**
 * A conservative candidate score, never an identity confirmation. Name order
 * and middle names can differ; one shared fragment or surname is insufficient.
 */
export function scoreName(subject: string, candidate: string): number {
  const leftNormalized = normalizeName(subject)
  const rightNormalized = normalizeName(candidate)
  if (!leftNormalized || !rightNormalized) return 0
  if (leftNormalized === rightNormalized || sortedName(leftNormalized) === sortedName(rightNormalized)) return 100
  const left = words(leftNormalized)
  const right = words(rightNormalized)
  if (left.length === 0 || right.length === 0 || left.length > 12 || right.length > 20) return 0
  const pairs: { left: number; right: number; score: number }[] = []
  for (let l = 0; l < left.length; l += 1) {
    for (let r = 0; r < right.length; r += 1) {
      const score = tokenSimilarity(left[l] ?? '', right[r] ?? '')
      if (score > 0) pairs.push({ left: l, right: r, score })
    }
  }
  pairs.sort((a, b) => b.score - a.score)
  const usedLeft = new Set<number>()
  const usedRight = new Set<number>()
  let similarity = 0
  for (const pair of pairs) {
    if (usedLeft.has(pair.left) || usedRight.has(pair.right)) continue
    usedLeft.add(pair.left)
    usedRight.add(pair.right)
    similarity += pair.score
  }
  const matched = usedLeft.size
  const smallerCount = Math.min(left.length, right.length)
  if (matched === 0 || matched < Math.min(2, smallerCount)) return 0
  if (smallerCount === 1 && (left.length !== 1 || right.length !== 1)) return 0
  if (matched < smallerCount - 1) return 0
  // An added middle name can leave the larger side unmatched. Missing words
  // on both sides reduce confidence instead of making a loose substring hit.
  const missingOnSmallerSide = smallerCount - matched
  const score = Math.round(100 * similarity / matched - missingOnSmallerSide * 12)
  return Math.max(0, Math.min(100, score))
}
