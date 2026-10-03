# XpressTend

A working web build of the XpressTend money-transfer app from the product mockups: a
voice-first remittance experience for a Seattle, WA based money transmitter serving
customers worldwide. **English is the primary language, with full translations into Somali
(Af-Soomaali), Brazilian Portuguese, Spanish and Arabic** that can be switched at any time —
the whole app, not just the marketing copy. Arabic renders right-to-left.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production bundle into dist/
npm run preview  # serve the production build
npm run lint     # oxlint
```

The build output in `dist/` is a static site — it can be dropped on any static host
(HostGator or any cPanel account, GitHub Pages, S3, Netlify, Cloudflare Pages). Routing
uses `HashRouter` and asset paths are relative, so there are no server rewrite rules to
configure and the site works just as well from a subfolder as from a domain root.

## Deploying

The site and the API are one Cloudflare Worker. A Worker route intercepts every
request to `xpresstend.com` ahead of any origin, which is what allows the
security headers a static host cannot set: CSP, X-Frame-Options,
X-Content-Type-Options, Referrer-Policy, Permissions-Policy, COOP and HSTS.

```bash
npm run deploy          # builds the site and deploys the Worker
```

GitHub Pages and the HostGator FTPS target are retired. Nothing is copied into
the repository root any more; the Worker serves `dist/` directly.

CI runs lint, the Worker type-check, the money tests and the build on every
push and pull request. It deploys only from `main`, and only once a
`CLOUDFLARE_API_TOKEN` secret exists, so a fork builds without trying to
publish.

## The platform

The site is now a marketing shopfront with a product behind a login, plus a
separate staff console — the shape WorldRemit and Remitly use.

| Route | What it is | Who gets in |
| --- | --- | --- |
| `/` | Marketing site with a live rate calculator | Everyone |
| `/login`, `/register` | Customer accounts | Everyone |
| `/app` and its screens | The send-money product | Signed-in customers |
| `/admin` | Operations console | Staff, via a separate login |

### API

`api/` is a Cloudflare Worker on D1. Run it with `npm --prefix api run dev`,
deploy with `npm --prefix api run deploy`, and test the money rules with
`npm --prefix api test`.

Secrets are never in the repository. Set them once per environment:

```bash
cd api
npx wrangler secret put SESSION_PEPPER        # any long random string
npx wrangler secret put STRIPE_SECRET_KEY     # test key for now
```

`SESSION_PEPPER` is mixed into every password hash and is not stored in the
database, so a leaked table cannot be cracked offline. **Changing it invalidates
every existing password**, so set it before the first account is created.

### The first staff account

```bash
cd api
SESSION_PEPPER='<the same value you set above>' node scripts/create-admin.mjs \
  you@xpresstend.com "Your Name" owner
```

It prints an INSERT statement and a one-time password. Run the statement with
`wrangler d1 execute` and store the password in a password manager.

Roles are `viewer`, `agent`, `compliance` and `owner`. Releasing a payout is
restricted to `compliance` and `owner`, and is always recorded against a named
person in the audit log.

### How the money is modelled

Amounts are integer minor units and BigInt arithmetic — no float ever touches
one. Balances are not stored; they are derived from `ledger_entries`, where
every posting must net to zero within each currency. `/admin/ledger/trial-balance`
re-proves this on demand and the console shows a red banner if it ever fails.

Fees round **up** and recipient amounts round **down**, so rounding never costs
the business money or promises the recipient more than the margin funds.

Quotes are re-priced server-side when a transfer is created, so a tampered
client payload cannot buy a better rate than the corridor allows.

### Before this can move real money

Payments run in **test mode**. Capturing a payment moves a transfer to
`compliance_hold` and writes the ledger, but charges nothing and releases
nothing. Going live needs, in this order:

1. FinCEN MSB registration and money transmitter licences in every state served
2. A licensed banking or payment partner, and payout partners per corridor
3. Production customer identity verification, a validated sanctions-review process,
   and the remaining AML programme controls. Official OFAC SDN and consolidated
   non-SDN name and alias data are integrated into `sanctions_screenings`; see
   [sanctions operations](docs/sanctions.md) for refresh, freshness and review controls.
4. Replacing the test handler in `api/src/routes-transfers.ts`

Until then the marketing footer says so plainly, and it should stay that way.

## Mobile apps (iOS + Android)

The apps are the same build the Worker serves, wrapped by Capacitor, so the
product only has to be written and QA'd once. Native behaviour is real platform
API, not a web imitation.

```bash
npm run build:mobile     # build the web app and sync it into both projects
npm run ios              # ...and open Xcode
npm run android          # ...and open Android Studio
```

Building and signing needs Xcode and Android Studio; neither is required to
develop the web app.

### What is native

- **Biometric app lock.** Balances, recipients and history stay hidden until the
  device confirms who is holding it, and it re-locks after a minute in the
  background. It fails *open*: a handset with no enrolled biometry is left
  unlocked rather than stranding someone outside their own money.
- **Biometric transfer confirmation.** On a device, confirming a transfer is a
  real Face ID or fingerprint prompt. Cancel it and the flow falls back to a
  PIN rather than dead-ending. In the browser a short pause stands in, because
  there is nothing to ask.
- **Haptics** on the primary action and a distinct success buzz at the moment
  the money moves.
- Native splash and status bar, Android back-button handling, and an offline
  notice driven by the real network state.

### Getting a build onto TestFlight

Two routes. Both use the App Store Connect API key from **App Store Connect →
Users and Access → Integrations → Keys**; the key is downloadable once, so keep
the `.p8` somewhere safe.

**From CI**, on every push to `main`, once these repository secrets exist:

| Secret | How to produce it |
| --- | --- |
| `APPLE_CERTIFICATE_P12` | `base64 -i Certificates.p12 \| pbcopy` — the Apple Distribution certificate exported from Keychain Access |
| `APPLE_CERTIFICATE_PASSWORD` | the password set during that export |
| `APPLE_PROVISIONING_PROFILE` | `base64 -i XpressTend_App_Store.mobileprovision \| pbcopy` |
| `APPSTORE_KEY_ID`, `APPSTORE_ISSUER_ID` | shown on the Keys page |
| `APPSTORE_PRIVATE_KEY` | `base64 -i AuthKey_XXXXXX.p8 \| pbcopy` |

Paste each with no quotes and no line breaks. The decode is tolerant of most
paste damage and names what is wrong with a value it cannot use, without
printing it.

**From a Mac that already has the build**, which does not wait on any of the
signing secrets:

```bash
export APPSTORE_KEY_ID=XXXXXXXXXX
export APPSTORE_ISSUER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
export APPSTORE_PRIVATE_KEY_PATH=~/Downloads/AuthKey_XXXXXXXXXX.p8

scripts/upload-to-testflight.sh path/to/XpressTend.ipa
```

It accepts an `.xcarchive` too and exports with the same options CI uses, so a
local upload and a CI upload cannot drift apart. It validates before uploading,
so a binary App Store Connect would reject fails with a readable reason rather
than silently during processing. Xcode's Organizer (**Distribute App → App Store
Connect**) and Transporter.app do the same job by hand.

Either way the app record has to exist first: bundle id `com.xpresstend.app`
registered under team `64H8428M8D`, and an app created in App Store Connect.
A build lands under **TestFlight → iOS Builds** about 10 to 15 minutes after
upload.

### API origin

The apps load from `capacitor://localhost`, where a relative `/api` path would
resolve against the app bundle and find nothing, so native builds use an
absolute origin. Override it for a build aimed elsewhere:

```bash
VITE_API_URL=https://staging.example.com/api npm run build:mobile
```

### Icons

The lockup is 5.39:1 and cannot be a square icon, so the X mark is extracted
from it and centred on white. Regenerate from `brand-source/` if the artwork
changes; iOS needs 1024px with no alpha, and Android needs five launcher
densities plus the adaptive foreground.

## The first staff account

`/admin` needs an account, and one cannot be inserted directly: the password
hash mixes in `SESSION_PEPPER`, which only the Worker holds. A one-time route
supplies the way in.

```bash
cd api
npx wrangler secret put ADMIN_BOOTSTRAP_SECRET     # choose any long random string

curl -X POST https://xpresstend.com/api/bootstrap/admin \
  -H 'Content-Type: application/json' \
  -H 'x-bootstrap-secret: THE_SECRET_YOU_JUST_SET' \
  -d '{"email":"you@xpresstend.com","name":"Your Name","password":"a-password-of-16-plus-characters"}'

npx wrangler secret delete ADMIN_BOOTSTRAP_SECRET  # close the route again
```

You choose the password, so it is never generated, logged, or passed through
anyone else. The route returns 404 unless the secret is set, refuses once any
admin exists, and requires sixteen characters because staff can release other
people's money.

## What's in it

Every screen from the mockups is implemented and connected — you can walk the whole
send-money journey end to end.

| Route | Screen |
| --- | --- |
| `/` | Home — greeting, voice hero, service grid, recent transaction, recipients, quick actions |
| `/voice` | Voice assistant — listening state, countdown, sample prompts |
| `/assistant` | AI assistant chat — scripted transfer confirmation with a quote card |
| `/send` | Send Money — amount entry, live conversion, recipient picker, payment method |
| `/review` | Review & Confirm — summary, security notice, Face ID / PIN verification |
| `/success` | Transfer complete — receipt, reference ID, share |
| `/recipients` | Recipients — search, favourites, full list |
| `/activity` | Activity — monthly total, filters, transfer history |
| `/profile` | Profile — account, language, settings, company footer |
| `/rates` | Live rates across all corridors |
| `/help` | Help Center FAQ |
| `/refer` | Refer & Earn |
| `/support` | Live Support |

On a phone the app fills the screen. On a desktop it renders inside a device frame with a
screen index in the sidebar, so every page is reachable without walking the flow.

## Structure

```
src/
  config/brand.ts        Company name, HQ address, support details, reference prefix
  i18n/                  Translation provider + en.ts / so.ts dictionaries
  data/mock.ts           Recipients, corridors & rates, payment methods, transactions
  state/TransferContext  Current transfer, live quote, transfer history
  components/            Layout shell, bottom nav, language switcher, shared UI kit
  screens/               One file per screen
  lib/format.ts          Currency, rate, date and reference-ID formatting
```

### Changing the brand

Everything user-visible about the company lives in `src/config/brand.ts` — name, assistant
name, receipt prefix, HQ address, support contacts and licence line. Change `name`
there and the logo, page copy, chat header and footers all follow.

### Adding a language

1. Copy `src/i18n/so.ts`, translate the values (the keys are typed against `en.ts`, so a
   missing key is a compile error).
2. Add the code to `Lang` and the `LANGUAGES` list in `src/i18n/langs.ts`, including its
   `dir` (`'ltr'` or `'rtl'`) and the browser tags it should match on first visit.
3. Register the dictionary in `dictionaries` in `src/i18n/index.tsx`.
4. Add the country and relationship labels to `countryI18n` / `relationI18n` in
   `src/data/mock.ts` — both fall back to English when a language is missing.

The chosen language persists in `localStorage`; a browser set to one of the supported
languages gets it on first visit, everyone else gets English.

### Right-to-left

`I18nProvider` writes `lang` and `dir` onto `<html>` whenever the language changes, so
Arabic flips the document and every other language flips it back. Layout uses logical
Tailwind utilities (`text-start`/`text-end`, `start-*`/`end-*`) rather than physical
`left`/`right` ones, so it mirrors for free. Icons that carry a direction — the back
chevron, list-row chevrons, the send arrow — take `useMirrorClass()` from `src/i18n`,
which applies `scale-x-[-1]` under RTL. Latin runs inside Arabic text (phone numbers,
reference IDs, masked wallets) are wrapped in `<bdi>` so the bidi algorithm keeps them
intact.

### Rates and fees

Corridor rates and the flat fee live in `src/data/mock.ts` and are static sample data —
swap `corridors` for a rates API call when there's a backend. Fee handling is controlled by
`FEE_MODE` in `src/state/TransferContext.tsx`: `'added'` (default) charges the sender
amount + fee and delivers the full amount to the recipient; `'deducted'` takes the fee out
of what the recipient receives.

> Note: the mockups show `Total $504.99` (amount + fee) *and* `Recipient Gets $495.01`
> (amount − fee) on the same transfer, which charges the fee twice. This build applies the
> fee once, using `FEE_MODE`.

## Stack

React 19 · TypeScript · Vite · Tailwind CSS v4 · React Router · lucide-react. No backend —
transfers are simulated in memory, so the app resets on reload.
