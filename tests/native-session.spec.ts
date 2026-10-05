import { expect, test } from '@playwright/test'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fixtureEnv, seedDataset, seedParties, SqliteD1 } from '../api/test/sanctions-fixture'

const requireApi = createRequire(new URL('../api/package.json', import.meta.url))
const { build } = requireApi('esbuild') as typeof import('esbuild')
let directory: string
let worker: { fetch(request: Request, env: unknown, context: unknown): Promise<Response> }

test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'xpresstend-native-session-'))
  const outfile = join(directory, 'worker.mjs')
  await build({ entryPoints: [new URL('../api/src/index.ts', import.meta.url).pathname], outfile,
    bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' })
  worker = (await import(pathToFileURL(outfile).href)).default
})
test.afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }) })

test('native bridge sessions reach the real API and cancelled or background locks preserve app state', async ({ page }, testInfo) => {
  const db = new SqliteD1()
  try {
    seedDataset(db)
    const { password } = await seedParties(db)
    const env = { ...fixtureEnv(db), APP_ORIGIN: 'https://xpresstend.com' }
    // This isolated jar models the native transport boundary. OS cookie storage
    // and physical biometrics are separately covered by native device review.
    let cookie = ''
    const calls: { path: string; method: string; authenticated: boolean }[] = []
    await page.exposeBinding('__nativeRequest', async (_source, options: {
      url: string; method: string; headers: Record<string, string>; data?: unknown;
    }) => {
      expect(options.url).toMatch(/^https:\/\/xpresstend\.com\/api\//)
      calls.push({ path: new URL(options.url).pathname, method: options.method, authenticated: Boolean(cookie) })
      const tasks: Promise<unknown>[] = []
      const response = await worker.fetch(new Request(options.url, {
        method: options.method, headers: { ...options.headers, origin: 'https://localhost', cookie },
        ...(options.data === undefined ? {} : { body: JSON.stringify(options.data) }),
      }), env, { waitUntil: (task: Promise<unknown>) => tasks.push(task), passThroughOnException() {} })
      const session = response.headers.get('set-cookie')
      if (session) cookie = /Max-Age=0/i.test(session) ? '' : session.split(';')[0]
      await Promise.all(tasks)
      return { status: response.status, data: await response.json(), headers: {} }
    })
    await page.addInitScript(() => {
      const win = window as unknown as {
        androidBridge: object;
        Capacitor: object;
        __nativeRequest(options: unknown): Promise<unknown>;
        __appState(active: boolean): void;
      }
      const listeners = new Map<string, { event: string; callback: (value: unknown) => void }>()
      let authenticationCount = 0
      let listenerCount = 0
      const pluginMethods: Record<string, string[]> = {
        CapacitorHttp: ['request'], App: ['exitApp'], Network: ['getStatus'],
        BiometricAuthNative: ['checkBiometry', 'internalAuthenticate'],
        StatusBar: ['setStyle', 'setBackgroundColor'], SplashScreen: ['hide'],
        Haptics: ['impact', 'notification'], Preferences: ['get', 'set', 'remove'],
      }
      win.androidBridge = {}
      win.__appState = (active) => {
        for (const listener of listeners.values()) {
          if (listener.event === 'appStateChange') listener.callback({ isActive: active })
        }
      }
      win.Capacitor = {
        PluginHeaders: Object.entries(pluginMethods).map(([name, methods]) => ({ name, methods: [
          ...methods.map((method) => ({ name: method, rtype: 'promise' })),
          { name: 'addListener', rtype: 'callback' }, { name: 'removeListener', rtype: 'promise' },
        ] })),
        nativeCallback: (_plugin: string, _method: string, options: { eventName: string }, callback: (value: unknown) => void) => {
          const id = String(++listenerCount)
          listeners.set(id, { event: options.eventName, callback })
          return Promise.resolve(id)
        },
        nativePromise: async (plugin: string, method: string, options?: { callbackId?: string }) => {
          if (method === 'removeListener') { listeners.delete(options?.callbackId ?? ''); return }
          if (plugin === 'CapacitorHttp') return win.__nativeRequest(options)
          if (plugin === 'Network') return { connected: true, connectionType: 'wifi' }
          if (plugin === 'Preferences') return { value: null }
          if (method === 'checkBiometry') return { isAvailable: false, deviceIsSecure: true,
            strongBiometryIsAvailable: false, biometryType: 0, biometryTypes: [], reason: '', code: 0, strongReason: '', strongCode: 0 }
          if (method === 'internalAuthenticate' && ++authenticationCount === 1) throw new Error('User cancelled authentication')
          return {}
        },
      }
    })
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (url.origin !== 'https://localhost') return route.abort()
      const asset = await fetch(`${testInfo.project.use.baseURL}${url.pathname}${url.search}`)
      return route.fulfill({ status: asset.status, headers: Object.fromEntries(asset.headers), body: Buffer.from(await asset.arrayBuffer()) })
    })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('https://localhost/#/register')
    await page.getByLabel('First name', { exact: true }).fill('Zelda')
    await page.getByLabel('Last name', { exact: true }).fill('Evergreen Merritt')
    await page.getByLabel('Email', { exact: true }).fill('customer@example.invalid')
    await page.getByLabel('Password', { exact: true }).fill(password)
    await page.getByRole('button', { name: 'Create account', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('sign in or reset your password')
    await expect(page.getByRole('dialog', { name: 'App locked' })).toHaveCount(0)
    await page.getByRole('link', { name: 'Sign in', exact: true }).click()
    await page.getByLabel('Email', { exact: true }).fill('customer@example.invalid')
    await page.getByLabel('Password', { exact: true }).fill(password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    const lock = page.getByRole('dialog', { name: 'App locked' })
    await expect(lock.getByRole('alert')).toHaveText('Not recognised. Try again.')
    await lock.getByRole('button', { name: 'Unlock', exact: true }).click()
    await expect(page.locator('.product-home-greeting')).toContainText('Zelda')
    expect(cookie).toMatch(/^xt_session=/)
    expect(calls.some((call) => call.path === '/api/auth/me' && call.authenticated)).toBe(true)
    await page.locator('.product-send-card > button').click()
    const amount = page.getByLabel('You Send', { exact: true })
    await amount.fill('321.45')
    await page.clock.install()
    await page.evaluate(() => (window as unknown as { __appState(active: boolean): void }).__appState(false))
    await page.clock.fastForward(61_001)
    await page.evaluate(() => (window as unknown as { __appState(active: boolean): void }).__appState(true))
    await expect(lock).toBeVisible()
    await expect(amount).toBeHidden()
    await lock.getByRole('button', { name: 'Unlock', exact: true }).click()
    await expect(amount).toHaveValue('321.45')
    await expect(amount).toBeVisible()
    const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))
    expect(storage).not.toContain(cookie.split('=')[1])
    expect(storage).not.toContain(password)
    await page.evaluate(() => { window.location.hash = '/profile' })
    await page.getByRole('button', { name: 'Sign out', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Welcome back')
    expect(cookie).toBe('')
    const liveSessions = db.sqlite.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id='customer-1' AND revoked_at IS NULL").get()!.n
    expect(liveSessions).toBe(1) // The seeded unrelated session remains; the new native session is revoked.
  } finally { db.close() }
})
