// Read-only App Store Connect verification. The JWT and private key stay local
// to the runner; output contains only app/build/processing metadata.
import { readFileSync } from 'node:fs'
import { sign } from 'node:crypto'

const [privateKeyPath, buildNumber] = process.argv.slice(2)
if (!privateKeyPath || !buildNumber || !process.env.APPSTORE_KEY_ID || !process.env.APPSTORE_ISSUER_ID) {
  throw new Error('App Store Connect metadata verification requires the configured API key and build number.')
}
const issued = Math.floor(Date.now() / 1000)
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
const message = `${encode({ alg: 'ES256', kid: process.env.APPSTORE_KEY_ID, typ: 'JWT' })}.${encode({ iss: process.env.APPSTORE_ISSUER_ID, iat: issued, exp: issued + 1200, aud: 'appstoreconnect-v1' })}`
const signature = sign('sha256', Buffer.from(message), { key: readFileSync(privateKeyPath), dsaEncoding: 'ieee-p1363' }).toString('base64url')
const token = `${message}.${signature}`

async function get(path, params = {}) {
  const url = new URL(`https://api.appstoreconnect.apple.com/v1/${path}`)
  url.search = new URLSearchParams(params).toString()
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`App Store Connect metadata request failed with HTTP ${response.status}.`)
  return response.json()
}

const apps = await get('apps', { 'filter[bundleId]': 'com.xpresstend.app', limit: '1' })
const app = apps.data?.[0]
if (!app) throw new Error('The XpressTend App Store record was not found.')
const versions = await get(`apps/${app.id}/appStoreVersions`, { limit: '10' })
console.log(JSON.stringify({ appId: 'com.xpresstend.app', storeVersions: versions.data.map(version => ({
  version: version.attributes.versionString, state: version.attributes.appStoreState,
})) }))

let state = 'NOT_YET_VISIBLE'
const deadline = Date.now() + 15 * 60_000
while (Date.now() < deadline) {
  const builds = await get('builds', { 'filter[app]': app.id, 'filter[version]': buildNumber, limit: '5' })
  const build = builds.data?.[0]
  state = build?.attributes.processingState ?? 'NOT_YET_VISIBLE'
  if (state === 'FAILED' || state === 'INVALID') throw new Error(`Apple processing rejected build ${buildNumber}: ${state}.`)
  if (state === 'VALID') {
    console.log(JSON.stringify({ build: buildNumber, processingState: state, expired: build.attributes.expired }))
    if (build.attributes.expired) throw new Error('The uploaded build is expired.')
    process.exit(0)
  }
  await new Promise(resolve => setTimeout(resolve, Math.min(20_000, Math.max(0, deadline - Date.now()))))
}
console.log(JSON.stringify({ build: buildNumber, processingState: state }))
throw new Error('The IPA uploaded, but Apple processing did not complete within 15 minutes. Check App Store Connect before treating this as an installable release.')
