# XpressTend mobile release readiness

Updated: 5 October 2026. This checklist records release evidence; it is not a
statement that store approval, device validation or real-money service is complete.

## Release scope

The app identifier is `com.xpresstend.app` on both platforms. Native builds use
`https://xpresstend.com/api`. The website and native apps share product code,
but native biometric authentication, HTTP cookies, keyboard behaviour and
operating-system navigation require separate device testing.

**Customer payments remain in test mode.** Creating and capturing a transfer
can create database and ledger records, but does not charge a bank account or
card and does not deliver money. A pending test record must never be described
as a completed remittance. This release does not activate payment providers,
establish licensing, complete KYC integration or authorize customer money movement.

Explore mode is a local, visibly labelled product tour. Sample recipients,
balances, referral rewards, rates and scripted voice/assistant interactions
must remain distinct from authenticated customer data. Customer screens must
state when a service is unavailable; screenshots and store descriptions must
not present illustrative functionality as a live service.

## Evidence for the release candidate

Fill this table with the final candidate, rather than evidence from an earlier
build. Keep reviewer credentials and signing secrets out of this file.

| Evidence | Result / link |
| --- | --- |
| Commit and release version/build numbers | Pending |
| Build & deploy workflow run and deployed API verification | Pending |
| Mobile workflow run, including release quality checks | Pending |
| Verified Android APK and AAB; SHA-256 sums | Pending |
| Verified exported IPA and App Store Connect processing result | Pending |
| Android internal-test installation and device report | Pending |
| TestFlight installation and iPhone/iPad device report | Pending |
| Recovery email delivery and deletion verification | Pending |
| Store screenshots, privacy/declaration forms and review notes | Pending |

## Automated gates

[Mobile builds](../.github/workflows/mobile.yml) gates native builds on the web
and Worker checks. [Build & deploy](../.github/workflows/deploy.yml) also runs
the application checks before publishing the API. Reproduce the quality gate:

```sh
npm ci
npm ci --prefix api
npm run lint
npm run typecheck --prefix api
npm test --prefix api
npm run build
npx playwright install --with-deps chrome
npm run test:e2e
```

Browser tests exercise both the local tour and mocked authenticated-account
flows, including account-data separation, server quote failures and pending
test-transfer receipts. Passing mocked journeys does not prove native cookie
persistence, production email delivery or device behaviour.

| Native gate | Required evidence |
| --- | --- |
| Android compile, lint and unit checks | `assembleRelease bundleRelease lintRelease testReleaseUnitTest` after `npm run build:mobile`, with the production API URL |
| Android signed output | [verify-android-release.sh](../scripts/ci/verify-android-release.sh) passes for both files: expected upload certificate, package ID, candidate version code, target SDK 36, non-debuggable APK and 16 KB alignment |
| iOS compile | Simulator build passes; it is not a distributable device app |
| iOS distribution output | Signed Release archive/export succeeds with the configured Apple team and distribution profile |
| Exported IPA inspection | [verify-ios-release.py](../scripts/ci/verify-ios-release.py) passes: app ID/build, iOS 26-or-newer SDK, embedded provisioning profile, required privacy manifest, restricted transport settings and no development server URL |
| TestFlight | Upload validation, upload and App Store Connect processing succeed; availability to intended testers is confirmed separately |

Android signing must use the existing upload key; a debug-signing fallback is
not a publishable release. Store build numbers must increase from the last
uploaded candidate. Record the artifact hashes together with their commit.

The deployed Worker must have `SESSION_PEPPER`, the customer lifecycle schema
from [migration 0008](../api/migrations/0008_customer_lifecycle.sql), and a
working configured transactional-email transport. The workflow's email-secret
presence check does not prove mailbox permissions, DNS alignment or delivery.
Official OFAC data readiness and refresh operation must also be checked; see
[sanctions.md](./sanctions.md).

## Physical-device verification

Use the signed candidate installed through Android internal testing and
TestFlight. Include a supported Android phone and iPhone, devices with different
biometric capabilities, and iPad layouts because the iOS target includes iPad.
Record OS/WebView versions, candidate build, steps and results.

- Cold launch signed out reaches sign-in. Privacy, support, password recovery
  and the deletion route remain reachable without unlocking the product.
- With enrolled biometrics, test success, cancellation, failure and retry.
  With only a device passcode, test credential fallback. With no enrolled
  biometry or configured device credential, confirm the app does not strand
  users behind an unusable lock. The native splash must dismiss in every case.
- Background the authenticated product for over 60 seconds. The lock must
  conceal private content while retaining the selected recipient, amount and
  in-progress UI after successful unlock. Repeat during a pending request.
- Android hardware/gesture back navigates once, exits only at an appropriate
  root and does not double-navigate after repeated route changes.
- Check safe areas, status-bar contrast, small-screen layouts, rotation,
  software keyboard, scrolling, 16px form text, pinch zoom, large text,
  VoiceOver and TalkBack. Controls and error messages must be reachable.
- Check English, Somali, Spanish, Brazilian Portuguese and Arabic. Confirm
  Arabic direction, amounts/reference IDs, language persistence, and which
  release-critical account notices still require translated copy. Legal
  documents published in English must keep their declared language/direction.
- Disconnect and reconnect the network during launch, login and quote loading.
  Failed or unavailable account data must not reveal sample account data or
  create a synthetic successful transfer.
- Verify the labelled local tour without credentials; tour transfers must
  produce no customer-transfer API writes. Leave the tour and create/sign in
  to a real account without keeping sample recipients, balances or history.
- Verify unverified accounts report their actual verification state and cannot
  bypass server transfer restrictions. For an authorized test account, test
  recipient selection, server quote failure/expiry, password authorization,
  pending test receipts and API error handling. No bank/card charge or delivery
  should occur.
- Check native sharing, copy, telephone and email actions where offered. Do
  not advertise microphone recording, wallet payments, referral payouts or
  push delivery unless those integrations have been separately implemented
  and verified.

### Native sessions and account lifecycle

The API client uses `CapacitorHttp` on native platforms and browser fetch on
the website. Installed Capacitor native implementations use platform cookie
storage: iOS `URLSession`/`HTTPCookieStorage`, Android WebKit `CookieManager`.
The server issues secure HttpOnly cookies with an explicit lifetime and
checks their hashed tokens, expiration, revocation and active account status.
The application must not copy session tokens into localStorage, Preferences,
URLs, app state or logs.

The native HTTP bridge returns response headers, including `Set-Cookie`, to
JavaScript. HttpOnly therefore does not establish that native bridge responses
can never expose tokens to JavaScript. The application ignores those headers;
check the signed build for logging/debugging and do not log whole responses.

On each physical platform verify:

1. Sign in, perform a protected API read, force-close and relaunch. Confirm
   the session persists for its configured lifetime without repeated login.
2. Sign out, force-close and relaunch. Protected requests must fail; stale
   native/WebView cookie synchronization must not restore authorization.
3. Deliver a real recovery email to a controlled account, open its link,
   change the password, reject token replay and verify previous sessions on
   other devices are revoked. Test expired links and unknown-address wording.
4. From Profile, delete a disposable account using fresh password confirmation.
   Verify sign-out, failed old sessions, failed old credentials, retention
   wording and a new account's separation from old records. Also test an
   account whose unresolved financial records correctly block deletion.

Use [customer-lifecycle.md](./customer-lifecycle.md) for recovery, deletion,
retention and financial eligibility details. A uniform recovery response is
not evidence that an email was delivered.

## Store submission metadata and reviewer access

- Confirm the developer organization, app name, identifiers, marketing version,
  build numbers, distribution countries, contact details and rights to branding.
  Describe the current test-mode scope and unavailable money movement accurately.
- Complete Apple App Privacy and Google Play Data safety from actual collection:
  account names/email, recipient information, transfer/compliance records and
  operational IP/device information, including purpose, linkage, sharing,
  security and retention. Biometric templates remain with the device; do not
  claim the app records audio when it does not. The iOS required-reason manifest
  does not replace either store's privacy form.
- Confirm the bundled `PrivacyInfo.xcprivacy` includes UserDefaults reason
  `CA92.1`; review SDK manifests and export-compliance answers against the actual
  signed binary. Complete age/content, financial-services and other applicable
  declarations using current company information. A plain NMLS ID is not proof
  of a money-transmitter licence.
- Provide reachable privacy and support URLs, and the public web account-deletion
  route required by the listing. Verify these from a signed-out browser/device;
  deletion must be discoverable in the authenticated app as well.
- Supply current screenshots for the required phone/tablet sizes and languages.
  Capture the signed candidate, with clearly labelled sample/test data and no
  real customer information. Avoid images implying completed payments or
  unavailable voice, wallet or rewards services.
- In store review notes explain how to enter Explore mode, its local sample
  data, the test-mode limitation, biometric/passcode prompts and how to find
  privacy/support/recovery/deletion. If review requires an authenticated test
  account, provide controlled review credentials securely in the store console;
  do not require reviewer access to company staff tools or bypass server controls.
- Confirm any provider credentials, required reviewer account state and review
  environment remain available throughout review. Track processing errors,
  reviewer feedback and fixes against the candidate build.

Public store release remains pending until the candidate evidence, physical
device results, truthful metadata and required declarations are complete.
Successful signing or a green CI run alone does not complete those steps.
