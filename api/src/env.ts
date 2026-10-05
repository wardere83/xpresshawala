export interface Env {
  DB: D1Database
  /** Static assets binding: the built frontend from dist/. */
  ASSETS: Fetcher
  ENVIRONMENT: string
  APP_ORIGIN: string
  /** Extra secret mixed into every password hash; set with `wrangler secret put`. */
  SESSION_PEPPER?: string
  /**
   * Enables the one-time first-admin bootstrap. Unset it once the first staff
   * account exists so the route disappears again.
   */
  ADMIN_BOOTSTRAP_SECRET?: string
  /**
   * Transactional email. Two transports; whichever is configured is used, and
   * Microsoft wins if both are. Staff invites/resets can use an authenticated
   * owner-issued link. Customer reset capabilities are delivered only by email.
   *
   * Microsoft 365 via Graph is the one the domain is set up for: the MX points
   * at Outlook and SPF ends in `-all` authorising only Microsoft, so mail sent
   * any other way fails SPF at the receiver. Needs an Azure app registration
   * with the Mail.Send application permission, admin-consented.
   */
  MS_TENANT_ID?: string
  MS_CLIENT_ID?: string
  MS_CLIENT_SECRET?: string
  /**
   * Alternative transport. Using it means adding Resend to the domain's SPF
   * record and publishing its DKIM keys first, or mail will be spam-filed.
   */
  RESEND_API_KEY?: string
  /** Defaults to support@xpresstend.com. Must be a real mailbox in the tenant. */
  EMAIL_FROM?: string
  STRIPE_SECRET_KEY?: string
  STRIPE_WEBHOOK_SECRET?: string
}

export interface SessionUser {
  id: string
  email: string
  firstName: string
  lastName: string
  kycStatus: string
  kycTier: number
  status: string
  createdAt: string
}

export interface SessionAdmin {
  id: string
  email: string
  name: string
  role: 'viewer' | 'agent' | 'compliance' | 'owner'
}

export type Vars = {
  user: SessionUser
  admin: SessionAdmin
}
