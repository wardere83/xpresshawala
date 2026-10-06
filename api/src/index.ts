import { Hono } from 'hono'
import type { Env, Vars } from './env'
import { withSecurityHeaders } from './headers'
import { adminAuth, auth } from './routes-auth'
import { admin } from './routes-admin'
import { bootstrap } from './routes-bootstrap'
import { invite } from './routes-invite'
import { recovery } from './routes-recovery'
import { transfers } from './routes-transfers'
import { refreshRates } from './rates'
import { getSanctionsStatus } from './sanctions.ts'

/**
 * One Worker serves both the site and its API.
 *
 * The frontend used to sit on GitHub Pages, which cannot set response headers,
 * so the sign-in page shipped with no CSP and nothing stopping it being framed.
 * Serving the built assets from here fixes that.
 *
 * Collapsing the two origins into one also removes CORS entirely: the browser
 * now treats the API as same-origin, so the session cookie travels without a
 * cross-site exemption and can be tightened to SameSite=Strict later.
 */
const api = new Hono<{ Bindings: Env; Variables: Vars }>()

api.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store')
  await next()
})

api.get('/health', async (c) => {
  const row = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM corridors WHERE enabled = 1`)
    .first<{ n: number }>()
  return c.json({ ok: true, environment: c.env.ENVIRONMENT, corridors: row?.n ?? 0 })
})

/** Dataset readiness only: no customer names or individual screening results. */
api.get('/compliance/sanctions-status', async (c) => {
  c.header('Cache-Control', 'no-store')
  return c.json(await getSanctionsStatus(c.env))
})

api.route('/auth', auth)
api.route('/bootstrap', bootstrap)
api.route('/invite', invite)
api.route('/admin/auth', adminAuth)
/*
 * Recovery sits on the same prefix but is mounted separately, and before the
 * guarded `/admin` router, because it has to stay public: someone who cannot
 * sign in has no session to authenticate with. Paths do not overlap with
 * adminAuth's, so the two coexist on /admin/auth.
 */
api.route('/admin/auth', recovery)
api.route('/admin', admin)
api.route('/', transfers)

api.notFound((c) => c.json({ error: 'not_found' }, 404))
api.onError((err, c) => {
  // Never leak internals to the caller; the detail goes to the Worker log.
  console.error('unhandled', err)
  return c.json({ error: 'internal_error' }, 500)
})

const app = new Hono<{ Bindings: Env; Variables: Vars }>()
app.route('/api', api)

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

    /*
     * Upgrade plaintext before anything else looks at the request.
     *
     * HSTS is preloaded, so a browser that has already seen the site never
     * sends http — but a genuinely first-time visitor, or a link opened by
     * something that ignores the preload list, was being served over http and
     * answered 200. The redirect carries the security headers too, so the
     * HSTS entry is picked up on that first hop rather than the second.
     *
     * The scheme comes from cf-visitor, not from url.protocol. Behind the edge
     * that header is the only honest record of what the browser actually used,
     * and locally url.protocol is meaningless anyway: `wrangler dev` rewrites
     * the request URL to the custom domain from wrangler.toml, so every local
     * request looks like plaintext xpresstend.com and would redirect forever.
     *
     * No header means this is not running behind the edge, so there is nothing
     * to upgrade and nothing happens. That failure direction is deliberate: it
     * degrades to today's behaviour rather than to a redirect loop on a live
     * money site.
     */
    const visitor = request.headers.get('cf-visitor')
    if (visitor) {
      let scheme: string | undefined
      try {
        scheme = (JSON.parse(visitor) as { scheme?: string }).scheme
      } catch {
        scheme = undefined
      }
      if (scheme === 'http') {
        // Built by hand: assigning to url.protocol is a no-op in this runtime.
        const target = `https://${url.host}${url.pathname}${url.search}`
        return withSecurityHeaders(
          new Response(null, { status: 301, headers: { location: target } }),
        )
      }
    }

    const { pathname } = url

    /*
     * Refuse to serve without the pepper in production.
     *
     * It was optional, so a deployment missing it would hash every password
     * with an empty value and carry on creating accounts. Adding it later then
     * invalidates every password and session already stored, which is only
     * discovered when customers cannot sign in.
     */
    if (env.ENVIRONMENT === 'production' && !env.SESSION_PEPPER) {
      console.error('SESSION_PEPPER is not set; refusing to serve')
      return new Response(
        JSON.stringify({ error: 'misconfigured' }),
        { status: 503, headers: { 'content-type': 'application/json' } },
      )
    }

    if (pathname === '/api' || pathname.startsWith('/api/')) {
      /*
       * The native apps load from capacitor://localhost (iOS) and
       * https://localhost (Android), so their API calls are cross-origin.
       * Without CORS the browser in the WebView drops the response, and
       * without SameSite=None the session cookie is never sent back, so
       * sign-in appears to succeed and then every later call is anonymous.
       *
       * The allowlist is exact: the app origins and the site itself. It is not
       * a wildcard, because credentialed requests must name a single origin
       * and reflecting an arbitrary Origin would let any site call this API
       * with the customer's cookie.
       */
      const origin = request.headers.get('origin') ?? ''
      const allowed = new Set([
        env.APP_ORIGIN,
        'https://www.xpresstend.com',
        'capacitor://localhost',
        'https://localhost',
        'http://localhost',
      ])
      if (env.ENVIRONMENT === 'development') allowed.add('http://localhost:5173')

      const corsHeaders: Record<string, string> = {}
      if (origin && allowed.has(origin)) {
        corsHeaders['access-control-allow-origin'] = origin
        corsHeaders['access-control-allow-credentials'] = 'true'
        corsHeaders['vary'] = 'Origin'
      }

      if (request.method === 'OPTIONS') {
        return withSecurityHeaders(
          new Response(null, {
            status: 204,
            headers: {
              ...corsHeaders,
              'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
              'access-control-allow-headers': 'Content-Type, x-bootstrap-secret',
              'access-control-max-age': '86400',
            },
          }),
        )
      }

      const res = await app.fetch(request, env, ctx)
      const merged = new Headers(res.headers)
      for (const [k, v] of Object.entries(corsHeaders)) merged.set(k, v)
      return withSecurityHeaders(
        new Response(res.body, { status: res.status, statusText: res.statusText, headers: merged }),
      )
    }

    /*
     * Clean URLs for the pages Apple and Google need to reach.
     *
     * The app is hash-routed, so /privacy would otherwise serve index.html and
     * land on the home page with the fragment empty. App Store review requires
     * a plain URL that actually shows the policy, so these redirect into the
     * route rather than relying on the reviewer to type a fragment.
     */
    const CLEAN_ROUTES: Record<string, string> = {
      '/privacy': '/#/privacy',
      '/privacy-policy': '/#/privacy',
      '/support': '/#/support',
      '/help': '/#/support',
      '/admin': '/#/admin',
      '/app': '/#/app',
      '/login': '/#/login',
      '/register': '/#/register',
      '/forgot-password': '/#/forgot-password',
      '/delete-account': '/#/delete-account',
      // Addresses people type or print, and the retired partnerships page.
      '/philanthropy': '/#/philanthropy',
      '/financial-literacy': '/#/philanthropy',
      '/partners': '/#/philanthropy',
    }
    const target = CLEAN_ROUTES[pathname.replace(/\/$/, '')]
    if (target) {
      return withSecurityHeaders(
        new Response(null, { status: 302, headers: { location: target } }),
      )
    }

    // Everything else is the site. The assets binding falls back to index.html
    // for unknown paths, which is what a client-routed app needs on a cold URL.
    return withSecurityHeaders(await env.ASSETS.fetch(request))
  },

  /*
   * The rate feed. Quotes refuse anything older than an hour, so without a
   * scheduled write every corridor stops quoting once the seeded rows age out
   * — which is exactly what had happened. The cron lives in wrangler.toml.
   */
  async scheduled(_event: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    await refreshRates(env)
  },
}
