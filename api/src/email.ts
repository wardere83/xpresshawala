import type { Env } from './env'

/**
 * Transactional email.
 *
 * Two providers, chosen by which secrets exist, and no provider at all is a
 * supported state: `send` then reports `configured: false`. Staff invites and
 * staff resets may use an authenticated owner-issued link. Customer recovery
 * has no token-return fallback and revokes a token that could not be delivered.
 *
 * Microsoft 365 is tried first, because it is what the domain is actually set
 * up for. The DNS says so plainly:
 *
 *   MX    xpresstend-com.mail.protection.outlook.com
 *   SPF   v=spf1 include:spf.protection.outlook.com -all
 *
 * That SPF record matters. It ends in `-all`, a hard fail, and it authorises
 * only Microsoft. Sending the same mail through Resend or any other relay would
 * fail SPF at the receiver and, for a password reset, quietly land in spam
 * exactly when somebody is locked out and waiting for it. So mail leaves
 * through the same service that owns the domain's MX.
 *
 * Graph rather than SMTP because Workers have no usable SMTP client: Graph is
 * plain HTTPS and needs no TCP socket.
 *
 * Resend is kept as the alternative for anyone who would rather not create an
 * Azure app registration. Choosing it means adding it to SPF and publishing its
 * DKIM records first, or the deliverability problem above applies.
 */
export interface SendResult {
  configured: boolean
  sent: boolean
  /** Which transport handled it, so a delivery complaint can be traced. */
  provider?: 'microsoft365' | 'resend'
  error?: string
}

/**
 * The mailbox that exists on the domain. Used when EMAIL_FROM is unset so the
 * common case needs one fewer secret, and it has to be a real mailbox in the
 * tenant: Graph sends as a specific user, not an arbitrary address.
 */
const DEFAULT_FROM = 'support@xpresstend.com'

/**
 * Cached client-credentials token, keyed by tenant.
 *
 * Graph tokens last an hour. A Worker isolate rarely lives that long, so this
 * saves a round trip within one isolate rather than acting as a real cache;
 * treated as a bonus, never as something to rely on. Expiry is held 60 seconds
 * early so a token cannot go stale mid-request.
 */
let graphToken: { tenant: string; token: string; expiresAt: number } | null = null

async function microsoftToken(env: Env): Promise<string | null> {
  const tenant = env.MS_TENANT_ID
  const clientId = env.MS_CLIENT_ID
  const secret = env.MS_CLIENT_SECRET
  if (!tenant || !clientId || !secret) return null

  if (graphToken && graphToken.tenant === tenant && graphToken.expiresAt > Date.now()) {
    return graphToken.token
  }

  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: secret,
      // `.default` grants whatever application permissions the app
      // registration was consented for, which must include Mail.Send.
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  })

  if (!res.ok) {
    // Provider response bodies can echo credentials or reset links.
    console.error('microsoft token failed', res.status)
    return null
  }

  const body = (await res.json()) as { access_token?: string; expires_in?: number }
  if (!body.access_token) return null

  graphToken = {
    tenant,
    token: body.access_token,
    expiresAt: Date.now() + Math.max(0, (body.expires_in ?? 3600) - 60) * 1000,
  }
  return body.access_token
}

async function sendViaMicrosoft(
  env: Env,
  from: string,
  msg: { to: string; subject: string; text: string; html?: string },
): Promise<SendResult> {
  const token = await microsoftToken(env)
  if (!token) return { configured: true, sent: false, provider: 'microsoft365', error: 'auth' }

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(from)}/sendMail`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          subject: msg.subject,
          body: msg.html
            ? { contentType: 'HTML', content: msg.html }
            : { contentType: 'Text', content: msg.text },
          toRecipients: [{ emailAddress: { address: msg.to } }],
          // Replies reach a person rather than vanishing. The mailbox is
          // monitored, so someone who did not request a reset can say so.
          replyTo: [{ emailAddress: { address: from } }],
        },
        // Reset links are credentials and do not belong in a shared Sent
        // Items folder where anyone with mailbox access could read them.
        saveToSentItems: false,
      }),
    },
  )

  if (!res.ok) {
    console.error('microsoft send failed', res.status)
    return { configured: true, sent: false, provider: 'microsoft365', error: `graph_${res.status}` }
  }
  return { configured: true, sent: true, provider: 'microsoft365' }
}

async function sendViaResend(
  key: string,
  from: string,
  msg: { to: string; subject: string; text: string; html?: string },
): Promise<SendResult> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [msg.to],
      reply_to: from,
      subject: msg.subject,
      text: msg.text,
      ...(msg.html ? { html: msg.html } : {}),
    }),
  })
  if (!res.ok) {
    console.error('email send failed', res.status)
    return { configured: true, sent: false, provider: 'resend', error: `provider_${res.status}` }
  }
  return { configured: true, sent: true, provider: 'resend' }
}

export async function sendEmail(
  env: Env,
  msg: { to: string; subject: string; text: string; html?: string },
): Promise<SendResult> {
  const from = env.EMAIL_FROM || DEFAULT_FROM
  const hasMicrosoft = Boolean(env.MS_TENANT_ID && env.MS_CLIENT_ID && env.MS_CLIENT_SECRET)
  const resendKey = env.RESEND_API_KEY

  if (!hasMicrosoft && !resendKey) return { configured: false, sent: false }

  try {
    return hasMicrosoft
      ? await sendViaMicrosoft(env, from, msg)
      : await sendViaResend(resendKey as string, from, msg)
  } catch {
    console.error('email send threw')
    return { configured: true, sent: false, error: 'network' }
  }
}

/** Plain text and HTML for a staff invitation. */
export function staffInviteEmail(args: { name: string; inviterName: string; link: string; hours: number }) {
  const { name, inviterName, link, hours } = args
  return {
    subject: 'Your XpressTend staff account',
    text: [
      `Hi ${name},`,
      '',
      `${inviterName} has given you access to the XpressTend operations console.`,
      '',
      'Set your password here:',
      link,
      '',
      `This link expires in ${hours} hours and can only be used once.`,
      'If you were not expecting this, you can ignore it.',
    ].join('\n'),
    html: `
      <div style="font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;max-width:520px;color:#14121f">
        <p style="font-size:15px">Hi ${escapeHtml(name)},</p>
        <p style="font-size:15px;line-height:1.6">
          ${escapeHtml(inviterName)} has given you access to the XpressTend operations console.
        </p>
        <p style="margin:28px 0">
          <a href="${escapeHtml(link)}"
             style="background:#074FDF;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:600;font-size:14px">
            Set your password
          </a>
        </p>
        <p style="font-size:12px;color:#6b6880;line-height:1.6">
          This link expires in ${hours} hours and can only be used once.
          If you were not expecting this, you can ignore it.
        </p>
      </div>`,
  }
}

/** Plain text and HTML for a staff password reset. */
export function passwordResetEmail(args: { name: string; link: string; minutes: number }) {
  const { name, link, minutes } = args
  return {
    subject: 'Reset your XpressTend staff password',
    text: [
      `Hi ${name},`,
      '',
      'Someone asked to reset the password on your XpressTend operations console account.',
      '',
      'Choose a new password here:',
      link,
      '',
      `This link expires in ${minutes} minutes and can only be used once.`,
      '',
      'If you did not ask for this, you can ignore this email. Your password has',
      'not changed and nobody can use this link without opening it themselves.',
    ].join('\n'),
    html: `
      <div style="font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;max-width:520px;color:#18313B">
        <p style="font-size:15px">Hi ${escapeHtml(name)},</p>
        <p style="font-size:15px;line-height:1.6">
          Someone asked to reset the password on your XpressTend operations console account.
        </p>
        <p style="margin:28px 0">
          <a href="${escapeHtml(link)}"
             style="background:#0B252F;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:600;font-size:14px">
            Choose a new password
          </a>
        </p>
        <p style="font-size:12px;color:#627780;line-height:1.6">
          This link expires in ${minutes} minutes and can only be used once.
          If you did not ask for this you can ignore this email: your password has not
          changed, and nobody can use this link without opening it themselves.
        </p>
      </div>`,
  }
}

/**
 * Confirms which address an account is under.
 *
 * Note what this deliberately cannot do: it cannot tell someone an address they
 * do not already have, because it can only be delivered to the address itself.
 * That is the point. An endpoint that reveals account addresses is an account
 * enumeration tool. This exists so that someone who is unsure which of their
 * addresses they registered can try each one and get a reply on the right one.
 */
export function signInEmailReminderEmail(args: { name: string; email: string; link: string }) {
  const { name, email, link } = args
  return {
    subject: 'Your XpressTend staff sign-in address',
    text: [
      `Hi ${name},`,
      '',
      'You asked which address your XpressTend operations console account uses.',
      '',
      `It is: ${email}`,
      '',
      `Sign in here: ${link}`,
      '',
      'If you did not ask for this, you can ignore this email.',
    ].join('\n'),
    html: `
      <div style="font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;max-width:520px;color:#18313B">
        <p style="font-size:15px">Hi ${escapeHtml(name)},</p>
        <p style="font-size:15px;line-height:1.6">
          You asked which address your XpressTend operations console account uses.
        </p>
        <p style="font-size:17px;font-weight:600;margin:20px 0">${escapeHtml(email)}</p>
        <p style="margin:24px 0">
          <a href="${escapeHtml(link)}"
             style="background:#0B252F;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:600;font-size:14px">
            Sign in
          </a>
        </p>
        <p style="font-size:12px;color:#627780;line-height:1.6">
          If you did not ask for this, you can ignore this email.
        </p>
      </div>`,
  }
}

/** Customer reset capabilities are delivered exclusively to the account email. */
export function customerPasswordResetEmail(args: { name: string; link: string; minutes: number }) {
  const { name, link, minutes } = args
  return {
    subject: 'Reset your XpressTend password',
    text: [`Hi ${name},`, '', 'Choose a new XpressTend password:', link, '',
      `This link expires in ${minutes} minutes and can only be used once.`,
      'After resetting, sign in again on your devices. Your existing sessions will be signed out.',
      'If you did not request this, ignore this email. Your password has not changed.'].join('\n'),
    html: `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;color:#18313B">
      <p>Hi ${escapeHtml(name)},</p><p>Choose a new XpressTend password.</p>
      <p><a href="${escapeHtml(link)}" style="background:#0B252F;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none">Reset password</a></p>
      <p>This link expires in ${minutes} minutes and can only be used once. Your existing sessions will be signed out after resetting.</p>
      <p>If you did not request this, ignore this email. Your password has not changed.</p></div>`,
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string)
}
