import { Link } from 'react-router-dom'
import { brand } from '../config/brand'
import { Contents, H, Q, Shell } from './PageShell'

/**
 * Privacy policy and support pages.
 *
 * Apple requires a reachable Privacy Policy URL and Support URL before an app
 * can be submitted, and both must describe what the software actually does.
 * The policy below is written from the real schema: the fields the API stores,
 * why, and what never leaves the device. It is deliberately specific rather
 * than boilerplate, because a generic policy that misdescribes a money product
 * is worse than none.
 *
 * English only. This is a legal document and a mistranslation carries real
 * consequence, so it should be translated by someone qualified rather than by
 * the same process as the interface copy.
 */
const UPDATED = '3 October 2026'

export function Privacy() {
  return (
    <Shell title="Privacy Policy" updated={UPDATED}>
      <p>
        This policy explains what XpressTend collects, why, and what we do with it. It
        describes the service as it actually works today.
      </p>

      <div className="rounded-2xl border border-ink-200 bg-canvas p-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-500">Service availability</p>
        <p className="mt-2">{brand.legal.operatingStatus}</p>
      </div>

      <H>What we collect</H>
      <p><strong>When you create an account:</strong> your name, email address, and optionally a
      phone number, along with the country and language you choose.</p>
      <p><strong>When you add a recipient:</strong> their name, country, how they receive money,
      and where relevant a phone number, bank name, or your relationship to them. You are
      providing another person's details, so please only add people who expect to hear from you.</p>
      <p><strong>When you send:</strong> the amount, currencies, fee, exchange rate, and the
      status of the transfer, kept as a permanent record of the transaction.</p>
      <p><strong>Automatically:</strong> your IP address and browser or device identifier, recorded
      with sign-ins and with actions that change money or access. We keep this to detect fraud
      and to reconstruct what happened if a transfer is disputed.</p>

      <H>What never reaches us</H>
      <p>
        <strong>Your fingerprint or face.</strong> Biometric unlock is handled entirely by your
        phone. iOS and Android tell the app only whether the check passed. The biometric data
        itself never leaves your device and we never receive, store, or see it.
      </p>
      <H>Password protection</H>
      <p>
        We do not store your password in readable form. We store a slow one-way hash, combined
        with a secret held separately from the database. Your password is submitted securely
        when you create an account or sign in, and cannot be recovered from its stored hash.
      </p>

      <H>Why we keep it</H>
      <p>To operate your account and carry out transfers you ask for; to keep an accurate record
      of money movement; to meet anti-money-laundering and record-keeping obligations that apply
      to money transmission; and to investigate fraud or a disputed transfer.</p>

      <H>Who else sees it</H>
      <p>Our own staff, limited to what their role requires, with every action recorded against a
      named person. Beyond that, service providers who host the platform (Cloudflare) and, once
      the service handles real money, banking, payout, identity-verification, and sanctions-screening
      partners as required to complete a transfer and to comply with the law. We do not sell your
      information, and we do not share it for advertising.</p>

      <H>How long we keep it</H>
      <p>Transaction records and the audit trail are retained for at least five years after a
      transfer, which is the standard retention period for money-transmission records. Account
      details are kept while your account is open and for that same period afterwards.</p>

      <H>Your choices</H>
      <p>You can ask for a copy of your data, ask us to correct it, or ask us to close your
      account, by writing to <a className="underline" href={`mailto:${brand.support.email}`}>{brand.support.email}</a>.
      Records we are legally required to retain will be kept even after an account is closed.</p>

      <H>Children</H>
      <p>XpressTend is not intended for anyone under 18 and we do not knowingly collect their
      information.</p>

      <H>Changes</H>
      <p>If this policy changes materially we will say so in the app before the change takes
      effect.</p>

      <H>Contact</H>
      <p>
        {brand.name}, {brand.hq.city}, {brand.hq.state}<br />
        <a className="underline" href={`mailto:${brand.support.email}`}>{brand.support.email}</a>
      </p>
    </Shell>
  )
}

const CONTACT_ROUTES = [
  { label: 'Institutional enquiries', subject: 'Institutional enquiry', description: 'Banking, fintech and payment infrastructure collaboration.' },
  { label: 'Financial Literacy enquiries', subject: 'Financial Literacy enquiry', description: 'XpressTend Financial Literacy, our philanthropy and community programs.' },
  { label: 'Compliance enquiries', subject: 'Compliance enquiry', description: 'Institutional review, registration and compliance information.' },
  { label: 'Customer support', subject: 'Customer support', description: 'Account access, product questions and general assistance.' },
  { label: 'Security reports', subject: 'Security report', description: 'Potential vulnerabilities or suspicious account activity.' },
  { label: 'Privacy requests', subject: 'Privacy request', description: 'Access, correction and other questions about personal data.' },
  { label: 'Complaints', subject: 'Complaint', description: 'Concerns about your experience with XpressTend.' },
]

export function Support() {
  const email = (
    <a className="underline" href={`mailto:${brand.support.email}`}>
      {brand.support.email}
    </a>
  )
  const phone = (
    <a className="underline" href={`tel:${brand.support.phone.replace(/[^+\d]/g, '')}`}>
      {brand.support.phone}
    </a>
  )

  return (
    <Shell
      title="Contact and support"
      intro="Contact XpressTend for company enquiries, community programs, account assistance and institutional review."
      updated={UPDATED}
    >
      <Contents
        items={[
          { id: 'contact', label: 'Company contact' },
          { id: 'enquiries', label: 'Enquiry options' },
          { id: 'availability', label: 'Service availability' },
          { id: 'questions', label: 'Common questions' },
          { id: 'safety', label: 'Protecting your account' },
          { id: 'complaints', label: 'Consumer resources' },
        ]}
      />

      <H id="contact">Company contact</H>
      <div className="rounded-2xl border border-ink-200 bg-canvas p-5">
        <p className="font-semibold text-ink-900">{brand.legalName}</p>
        <p className="mt-2">
          Headquarters: {brand.hq.city}, {brand.hq.state}, {brand.hq.country}<br />
          Email: {email}<br />
          Phone: {phone}
        </p>
      </div>
      <p>
        Include a brief description of your enquiry and, where relevant, the organisation you
        represent. For account assistance, include the email address associated with your account.
        Please do not email passwords, verification codes or full payment account details.
      </p>

      <H id="enquiries">Enquiry options</H>
      <p>Select an enquiry type to include the appropriate subject in your email.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {CONTACT_ROUTES.map((route) => (
          <div key={route.subject} className="rounded-2xl border border-ink-200 p-5">
            <a
              className="font-semibold text-brand-700 underline underline-offset-4"
              href={`mailto:${brand.support.email}?subject=${encodeURIComponent(route.subject)}`}
            >
              {route.label}
            </a>
            <p className="mt-2 text-sm leading-relaxed">{route.description}</p>
          </div>
        ))}
      </div>

      <H id="availability">Service availability</H>
      <p>{brand.legal.operatingStatus}</p>
      <p>
        For information about service requirements and institutional onboarding, review our{' '}
        <Link className="underline" to="/compliance">compliance overview</Link>.
      </p>

      <H id="questions">Common questions</H>
      <Q q="What is XpressTend’s NMLS number?">
        NMLS ID {brand.nmls.id}.
      </Q>
      <Q q="How can I get help with account access?">
        Use the <Link className="underline" to="/login">sign in page</Link> to access your
        account. If you have forgotten your credentials or need assistance, contact {email}.
      </Q>
      <Q q="Which languages does the product support?">
        The product interface supports English, Somali, Spanish, Portuguese and Arabic.
        Company and legal information is published in English.
      </Q>
      <Q q="How do I ask about my personal data?">
        Our <Link className="underline" to="/privacy">privacy policy</Link> explains what we
        collect, why we retain it and the choices available to you. Email{' '}
        <a className="underline" href={`mailto:${brand.support.email}?subject=Privacy%20request`}>
          {brand.support.email}
        </a>{' '}
        for access, correction or account closure requests.
      </Q>

      <H id="safety">Protecting your account</H>
      <p>
        XpressTend will never ask you to share your password or a verification code by email,
        phone or text, or ask you to send money to resolve an account problem. Contact us directly
        using the details on this page if a message appears suspicious.
      </p>
      <p>
        Be cautious of unexpected requests for money, guaranteed investment returns, prizes
        requiring an upfront payment, or pressure to act immediately and keep a payment secret.
        Verify the person and the request through a channel you trust.
      </p>
      <p>
        To report a potential platform vulnerability, use the security report option above and
        include the steps needed to reproduce the issue. Our{' '}
        <Link className="underline" to="/security">security overview</Link> provides further
        information about responsible disclosure.
      </p>

      <H id="complaints">Complaints and consumer resources</H>
      <p>
        To raise a concern with XpressTend, email{' '}
        <a className="underline" href={`mailto:${brand.support.email}?subject=Complaint`}>
          {brand.support.email}
        </a>{' '}
        with a description of the issue and the outcome you are seeking. Include any relevant
        account or reference information, without sending sensitive credentials.
      </p>
      <p>
        Independent consumer information and complaint resources are available from the{' '}
        <a className="underline" href="https://dfi.wa.gov/consumers/complaint" target="_blank" rel="noopener noreferrer">
          Washington State Department of Financial Institutions
        </a>{' '}
        and the{' '}
        <a className="underline" href="https://www.consumerfinance.gov/complaint/" target="_blank" rel="noopener noreferrer">
          Consumer Financial Protection Bureau
        </a>.
        You may contact these organisations directly.
      </p>
    </Shell>
  )
}
