// Save approved draft metadata and attach an existing build. Never submit for review.
import { readFileSync, appendFileSync } from 'node:fs'
import { sign } from 'node:crypto'

const [keyPath, metadataPath] = process.argv.slice(2)
if (!keyPath || !metadataPath) throw new Error('Provide private key path and metadata JSON path.')
const config = JSON.parse(readFileSync(metadataPath, 'utf8'))
const fields = ['description', 'promotionalText', 'keywords', 'supportUrl', 'marketingUrl']
for (const key of ['bundleId', 'version', 'build', 'locale', 'copyright', ...fields]) {
  if (typeof config[key] !== 'string' || !config[key].trim()) throw new Error('Missing metadata: ' + key)
}
if ([...config.promotionalText].length > 170 || [...config.description].length > 4000 || Buffer.byteLength(config.keywords) > 100) throw new Error('Listing metadata exceeds Apple field limits.')
for (const key of ['supportUrl', 'marketingUrl']) {
  if (new URL(config[key]).protocol !== 'https:') throw new Error('Expected HTTPS URL: ' + key)
}
if (!process.env.APPSTORE_KEY_ID || !process.env.APPSTORE_ISSUER_ID) throw new Error('App Store API credentials are missing.')
const issued = Math.floor(Date.now() / 1000)
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
const message = encode({ alg: 'ES256', kid: process.env.APPSTORE_KEY_ID, typ: 'JWT' }) + '.' +
  encode({ iss: process.env.APPSTORE_ISSUER_ID, iat: issued, exp: issued + 1200, aud: 'appstoreconnect-v1' })
const signature = sign('sha256', Buffer.from(message), { key: readFileSync(keyPath), dsaEncoding: 'ieee-p1363' }).toString('base64url')
const token = message + '.' + signature

async function api(path, method = 'GET', body, params = {}) {
  const url = new URL('https://api.appstoreconnect.apple.com/v1/' + path)
  url.search = new URLSearchParams(params).toString()
  const response = await fetch(url, {
    method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(method + ' ' + path + ': HTTP ' + response.status + ' ' + (data.errors ?? []).map(error => error.code).join(', '))
  }
  return response.status === 204 ? null : response.json()
}
const apps = await api('apps', 'GET', undefined, { 'filter[bundleId]': config.bundleId, limit: '2' })
if (apps.data.length !== 1) throw new Error('Expected one app matching the bundle ID.')
const app = apps.data[0]
const versions = await api('apps/' + app.id + '/appStoreVersions', 'GET', undefined, {
  'filter[platform]': 'IOS', 'filter[versionString]': config.version, limit: '200',
})
const matches = versions.data.filter(item => item.attributes.versionString === config.version && item.attributes.platform === 'IOS')
if (matches.length !== 1) throw new Error('Expected one existing iOS store version.')
const version = matches[0]
if (!['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED'].includes(version.attributes.appStoreState)) throw new Error('Store version is not in an editable draft state.')
const builds = await api('builds', 'GET', undefined, {
  'filter[app]': app.id, 'filter[version]': config.build, include: 'preReleaseVersion', limit: '200',
})
const compatible = builds.data.filter(build => {
  const releaseId = build.relationships?.preReleaseVersion?.data?.id
  const release = builds.included?.find(item => item.type === 'preReleaseVersions' && item.id === releaseId)
  return build.attributes.version === config.build && build.attributes.processingState === 'VALID' &&
    !build.attributes.expired && release?.attributes.version === config.version && release?.attributes.platform === 'IOS'
})
if (compatible.length !== 1) throw new Error('Expected one valid, unexpired iOS build for this marketing version.')
const build = compatible[0]
const localizations = await api('appStoreVersions/' + version.id + '/appStoreVersionLocalizations', 'GET', undefined, { limit: '200' })
let localization = localizations.data.find(item => item.attributes.locale === config.locale)
const attributes = Object.fromEntries(fields.map(key => [key, config[key]]))
console.log('Verified target: ' + config.bundleId + ', version ' + config.version + ', build ' + config.build)
if (localization) {
  await api('appStoreVersionLocalizations/' + localization.id, 'PATCH', {
    data: { type: 'appStoreVersionLocalizations', id: localization.id, attributes },
  })
} else {
  const created = await api('appStoreVersionLocalizations', 'POST', {
    data: { type: 'appStoreVersionLocalizations', attributes: { ...attributes, locale: config.locale },
      relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: version.id } } } },
  })
  localization = created.data
}
console.log('Saved English (US) listing text and URLs.')
await api('appStoreVersions/' + version.id, 'PATCH', {
  data: { type: 'appStoreVersions', id: version.id, attributes: { copyright: config.copyright } },
})
console.log('Saved copyright.')
await api('appStoreVersions/' + version.id + '/relationships/build', 'PATCH', {
  data: { type: 'builds', id: build.id },
})
console.log('Attached existing build ' + config.build + '.')
const saved = await api('appStoreVersionLocalizations/' + localization.id)
for (const field of fields) {
  if (saved.data.attributes[field] !== config[field]) throw new Error('Read-back mismatch: ' + field)
}
const savedVersion = await api('appStoreVersions/' + version.id)
const savedBuild = await api('appStoreVersions/' + version.id + '/relationships/build')
if (savedVersion.data.attributes.copyright !== config.copyright || savedBuild.data?.id !== build.id) throw new Error('Version or build relationship read-back mismatch.')
if (savedVersion.data.attributes.appStoreState !== version.attributes.appStoreState) throw new Error('Store version state changed during update; inspect App Store Connect.')
console.log('Verified all saved fields and build selection. No review submission or public release was performed.')
const summary = [
  '# XpressTend App Store metadata saved', '',
  '- Version: ' + config.version, '- Build: ' + config.build, '- Locale: ' + config.locale,
  '- Promotional text, description, keywords, support URL and marketing URL: verified',
  '- Copyright: ' + config.copyright, '- Build attachment: verified',
  '- Review submission: not performed', '- Screenshots and promotional images: still require assets', '',
].join('\n')
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary)
