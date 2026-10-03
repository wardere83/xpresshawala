/**
 * Single source of truth for company identity.
 * Change `name` here and it updates the logo, page title copy, assistant name,
 * receipt reference prefix and footer everywhere in the app.
 */
export const brand = {
  name: 'XpressTend',
  /**
   * The registered entity, used wherever the company is named formally rather
   * than worn as a product: the corporate footer, the policies, and the
   * company, compliance and security pages.
   */
  legalName: 'XpressTend Financial Services',
  assistantName: 'Xpress Assistant',
  /** Prefix used on transfer reference IDs, e.g. XPT-8457-2391-2024 */
  referencePrefix: 'XPT',
  /** Canonical English tagline. The UI reads the translated
   *  marketing.heroTitle key instead, so this is for non-UI use. */
  tagline: 'Closer with every transfer!',
  hq: {
    city: 'Seattle',
    state: 'WA',
    country: 'USA',
    line1: '',
    zip: '',
  },
  support: {
    phone: '+1 (206) 331-9867',
    email: 'support@xpresstend.com',
    hours: '24/7',
  },
  /** Nationwide Multistate Licensing System company identifier. */
  nmls: {
    id: '2900672',
  },
  legal: {
    /** Display the identifier as plain text without a verification prompt. */
    licence: 'NMLS ID 2900672.',
    /*
     * Where the company actually is, in one sentence.
     *
     * The audience for this is a bank's onboarding team, a payout partner and a
     * state examiner, all of whom will establish the answer in minutes whatever
     * the site says. A company that states it plainly reads as one that knows
     * its own position; a company found to have implied more reads as one whose
     * other representations now need checking too. The second is the expensive
     * outcome, and it is the one that overstating buys.
     *
     * This is the only place the status is written. When transfers go live it
     * changes here and everywhere it is shown changes with it.
     */
    operatingStatus:
      'XpressTend is completing state money transmitter licensing and banking partner onboarding. Customer transfers are not yet being processed, and XpressTend does not hold or move customer funds.',
  },
  /**
   * App availability.
   *
   * `released` is the single switch the UI reads. While it is false both
   * platforms show as coming soon and neither link is rendered, so there is no
   * way to reach a build from the public site. Flip it to true when the apps
   * are genuinely ready and the buttons come back with no other change.
   *
   * The URLs are kept rather than deleted so flipping the switch is all it
   * takes. androidApk points at the rolling GitHub release; iosTestFlight is
   * the TestFlight public link, created in App Store Connect under Users and
   * Access → TestFlight → public link.
   */
  appLinks: {
    released: false,
    androidApk: 'https://github.com/wardere83/xpresstend/releases/latest/download/xpresstend.apk',
    iosTestFlight: '',
  },
} as const
