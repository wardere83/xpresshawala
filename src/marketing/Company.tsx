import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { brand } from '../config/brand'
import { api } from '../lib/api'
import { Contents, Facts, H, Shell } from './PageShell'
import { CORRIDORS as PRICED } from './pricing'

const MARKETS = PRICED.map((corridor) => corridor.label).join(', ')
const partnershipEmail = `mailto:${brand.support.email}?subject=Partnership%20enquiry`

interface SanctionsReadiness {
  ready: boolean
  checkedAt: string | null
}

function SanctionsStatus() {
  const [status, setStatus] = useState<SanctionsReadiness | null>(null)
  const [unavailable, setUnavailable] = useState(false)

  useEffect(() => {
    let active = true
    api.get<SanctionsReadiness>('/compliance/sanctions-status')
      .then((result) => { if (active) setStatus(result) })
      .catch(() => { if (active) setUnavailable(true) })
    return () => { active = false }
  }, [])

  return (
    <div className="rounded-2xl border border-ink-200 bg-canvas p-5" role="status">
      <p className="text-xs font-semibold uppercase tracking-wider text-ink-500">
        Official sanctions data status
      </p>
      <p className="mt-2 leading-relaxed text-ink-700">
        {!status && !unavailable
          ? 'Checking the availability of the official OFAC dataset…'
          : status?.ready === true
            ? 'A current official OFAC dataset is loaded for platform screening.'
            : 'Current sanctions data availability could not be verified. Transfers require a current official dataset before they can proceed.'}
      </p>
      {status?.ready && status.checkedAt ? (
        <p className="mt-2 text-sm text-ink-500">
          Last successful source check:{' '}
          <time dateTime={status.checkedAt}>
            {new Date(status.checkedAt).toLocaleString('en-US', { timeZone: 'UTC' })} UTC
          </time>
        </p>
      ) : null}
    </div>
  )
}

function OperatingStatus() {
  return (
    <div className="rounded-2xl border border-ink-200 bg-canvas p-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-ink-500">
        Service availability
      </p>
      <p className="mt-2 leading-relaxed text-ink-700">{brand.legal.operatingStatus}</p>
    </div>
  )
}

export function Company() {
  return (
    <Shell
      title="About XpressTend"
      intro={`${brand.legalName} is a cross-border payments company based in ${brand.hq.city}, ${brand.hq.state}, focused on the connections between people and the families they support.`}
    >
      <Contents
        items={[
          { id: 'mission', label: 'Our mission' },
          { id: 'facts', label: 'Company information' },
          { id: 'markets', label: 'Market focus' },
          { id: 'approach', label: 'Our approach' },
          { id: 'contact', label: 'Contact the company' },
        ]}
      />

      <H id="mission">Connecting people across borders</H>
      <p>
        Sending money to family should be clear and easy to understand. XpressTend focuses on
        US-originated remittances, with transparent pricing, accessible digital experiences and
        clear transfer information from the first quote through the transaction record.
      </p>
      <p>
        Our multilingual experience reflects the communities we serve. Customers can review
        amounts and fees, manage recipient information and keep transfer details in one place.
      </p>

      <H id="facts">Company information</H>
      <Facts
        rows={[
          { k: 'Company name', v: brand.legalName },
          { k: 'Headquarters', v: `${brand.hq.city}, ${brand.hq.state}, ${brand.hq.country}` },
          { k: 'Business focus', v: 'Cross-border payments and remittances' },
          {
            k: 'NMLS ID',
            v: (
              <a className="underline" href={brand.nmls.verifyUrl} target="_blank" rel="noopener noreferrer">
                {brand.nmls.id} · NMLS Consumer Access
              </a>
            ),
          },
          { k: 'Product languages', v: 'English, Somali, Spanish, Portuguese and Arabic' },
          {
            k: 'Company enquiries',
            v: <a className="underline" href={`mailto:${brand.support.email}`}>{brand.support.email}</a>,
          },
        ]}
      />

      <H id="markets">Market focus</H>
      <p>
        Our current corridor focus includes {MARKETS}. We welcome discussions with institutions
        that support these markets and understand the needs of the communities connected to them.
        Service availability is subject to licensing, banking and payout arrangements.
      </p>

      <H id="approach">Clarity, accountability and collaboration</H>
      <p>
        Clear customer information, controlled access and traceable transaction records guide
        our approach. Our <Link className="underline" to="/compliance">compliance overview</Link>{' '}
        and <Link className="underline" to="/security">security overview</Link> explain the
        platform controls and service requirements relevant to institutional review.
      </p>
      <p>
        We work toward responsible cross-border service through collaboration with banking,
        fintech and payment infrastructure partners. Visit{' '}
        <Link className="underline" to="/partners">partnerships</Link> to explore areas of
        collaboration and start a discussion.
      </p>

      <H id="contact">Contact the company</H>
      <p>
        For company enquiries, email{' '}
        <a className="underline" href={`mailto:${brand.support.email}`}>{brand.support.email}</a>{' '}
        or call{' '}
        <a className="underline" href={`tel:${brand.support.phone.replace(/[^+\d]/g, '')}`}>
          {brand.support.phone}
        </a>.
      </p>
      <p>
        Financial institutions, fintech providers and other prospective partners can{' '}
        <a className="underline" href={partnershipEmail}>contact us about a partnership</a>.
      </p>
    </Shell>
  )
}

export function Compliance() {
  return (
    <Shell
      title="Compliance"
      intro="Company registration, service availability and platform controls for financial institutions, payment partners and regulatory reviewers."
    >
      <Contents
        items={[
          { id: 'registration', label: 'Registration' },
          { id: 'status', label: 'Service availability' },
          { id: 'identity', label: 'Customer identification' },
          { id: 'limits', label: 'Transaction controls' },
          { id: 'screening', label: 'Sanctions screening' },
          { id: 'records', label: 'Records and accountability' },
          { id: 'consumer', label: 'Customer information' },
          { id: 'contact', label: 'Compliance enquiries' },
        ]}
      />

      <H id="registration">Company registration</H>
      <p>{brand.legal.licence}</p>
      <p>
        An NMLS ID identifies a company record; it does not itself constitute a money transmitter
        licence. Please consult{' '}
        <a className="underline" href={brand.nmls.verifyUrl} target="_blank" rel="noopener noreferrer">
          NMLS Consumer Access
        </a>{' '}
        for current state-specific licensing information.
      </p>

      <H id="status">Service availability</H>
      <OperatingStatus />

      <H id="identity">Customer identification</H>
      <p>
        Customer verification status determines access to the platform's transfer workflow.
        Unverified accounts cannot create transfers. Verification results are recorded against
        each account, with transaction limits linked to the account's verification tier.
      </p>

      <H id="limits">Transaction controls</H>
      <p>
        The platform applies per-transfer, daily, monthly and transaction-frequency limits.
        These controls check account history when a transfer is created. Cancelled and failed
        transfers are excluded from the allowance calculation.
      </p>
      <p>
        Compliance review and payout authorisation are separate steps. Access to payout release
        is restricted to authorised compliance and owner roles, with the action recorded for
        review.
      </p>

      <H id="screening">Sanctions screening</H>
      <p>
        The platform integrates the US Treasury Office of Foreign Assets Control (OFAC)
        Specially Designated Nationals and Blocked Persons list and consolidated non-SDN
        sanctions lists, including listed names and aliases. Data is obtained from the official{' '}
        <a className="underline" href="https://ofac.treasury.gov/sanctions-list-service"
          target="_blank" rel="noopener noreferrer">
          OFAC Sanctions List Service
        </a>.
      </p>
      <p>
        Both senders and recipients are screened before transfer creation, payment processing
        and payout release. Potential name matches are held for review by authorised compliance
        staff. A documented false-positive decision is separate from transfer release, and an
        unresolved match cannot be bypassed by approving a transfer.
      </p>
      <p>
        Source update checks are scheduled every 15 minutes. Screening stops when the official dataset
        is unavailable or has not been successfully checked within 24 hours. Screening records
        retain the dataset version, matched official identifiers and staff review decisions.
        Sanctions screening is one platform control; it does not replace licensing, customer
        identification or other requirements applicable to a financial service.
      </p>
      <SanctionsStatus />

      <H id="records">Records and accountability</H>
      <p>
        Transfer activity, verification checks, screening results and staff actions are recorded
        in an audit trail. Staff permissions are assigned by role, and account access can be
        revoked. Double-entry ledger records support transaction reconciliation and balance
        review.
      </p>

      <H id="consumer">Clear customer information</H>
      <p>
        The transfer journey presents the fee, recipient amount and delivery method before
        confirmation, with transaction details retained on the receipt. Our{' '}
        <Link className="underline" to="/privacy">privacy policy</Link> explains the information
        collected, how it is used and how customers can contact us about their data.
      </p>

      <H id="contact">Compliance enquiries</H>
      <p>
        Regulators and partner compliance teams can email{' '}
        <a className="underline" href={`mailto:${brand.support.email}?subject=Compliance%20enquiry`}>
          {brand.support.email}
        </a>{' '}
        with the organisation they represent and the information requested. Enquiries are routed
        to the appropriate company contact.
      </p>
    </Shell>
  )
}

export function Security() {
  return (
    <Shell
      title="Security and platform"
      intro="An overview of account protection, access control and transaction integrity for technical and institutional reviewers."
    >
      <Contents
        items={[
          { id: 'accounts', label: 'Account protection' },
          { id: 'money', label: 'Transaction integrity' },
          { id: 'access', label: 'Staff access' },
          { id: 'privacy', label: 'Data and privacy' },
          { id: 'review', label: 'Technical review' },
          { id: 'disclosure', label: 'Report a security issue' },
        ]}
      />

      <H id="accounts">Account protection</H>
      <p>
        Account protections include one-way password hashing, revocable sessions,
        authentication rate limits and single-use account recovery tokens. Mobile biometric
        checks are handled by the device; XpressTend does not receive biometric data.
      </p>

      <H id="money">Transaction integrity</H>
      <p>
        Transaction amounts use integer minor units, with defined rounding rules for fees and
        recipient amounts. Quotes are recalculated when a transfer is created. Double-entry
        ledger postings provide a traceable basis for balances and reconciliation.
      </p>

      <H id="access">Staff access</H>
      <p>
        Staff access is role-based across viewer, agent, compliance and owner permissions.
        Payout release is limited to compliance and owner roles. Invitations allow staff to
        set their own credentials, and administrative controls protect the last active owner
        account from removal.
      </p>

      <H id="privacy">Data and privacy</H>
      <p>
        Platform access and transaction activity are recorded for operational review.
        Our <Link className="underline" to="/privacy">privacy policy</Link> describes the
        information collected, retention practices and routes for data enquiries.
      </p>

      <H id="review">Technical review</H>
      <p>
        Prospective partners can request a review of the platform architecture, authentication,
        ledger model, audit trail and integration requirements. Detailed technical discussions
        and supporting documentation can be coordinated through our{' '}
        <Link className="underline" to="/partners">partnerships contact</Link>.
      </p>

      <H id="disclosure">Report a security issue</H>
      <p>
        Email{' '}
        <a className="underline" href={`mailto:${brand.support.email}?subject=Security%20report`}>
          {brand.support.email}
        </a>{' '}
        with a description of the issue and the steps needed to reproduce it. We will
        acknowledge the report and keep you informed during investigation. Please allow a
        reasonable opportunity for remediation before public disclosure.
      </p>
    </Shell>
  )
}

export function Partners() {
  return (
    <Shell
      title="Partner with XpressTend"
      intro="We welcome discussions with financial institutions, fintech companies and payment infrastructure providers that share our focus on clear, accessible cross-border payments."
    >
      <Contents
        items={[
          { id: 'focus', label: 'Our partnership focus' },
          { id: 'areas', label: 'Areas of collaboration' },
          { id: 'diligence', label: 'Institutional review' },
          { id: 'contact', label: 'Start a conversation' },
        ]}
      />

      <H id="focus">Our partnership focus</H>
      <p>
        XpressTend brings a multilingual digital remittance experience together with transaction
        workflows, role-based operations and traceable ledger records. Our focus is
        US-originated transfers and the communities connected to {MARKETS}.
      </p>
      <p>
        Partnership discussions cover the regulated payment services, payout reach and
        compliance integrations required for each corridor. Scope, responsibilities and service
        availability are established through onboarding and institutional review.
      </p>

      <H id="areas">Areas of collaboration</H>
      <ul className="list-disc space-y-3 pl-5">
        <li>
          <strong className="text-ink-900">Banking and regulated payment services.</strong>{' '}
          Sponsor banking and licensed payment partnerships for US-originated remittances.
        </li>
        <li>
          <strong className="text-ink-900">Payout infrastructure.</strong>{' '}
          Mobile wallet, bank deposit and cash pickup capabilities in our focus markets.
        </li>
        <li>
          <strong className="text-ink-900">Identity and financial crime controls.</strong>{' '}
          Customer verification and production sanctions screening integrations.
        </li>
        <li>
          <strong className="text-ink-900">Account funding and payment acceptance.</strong>{' '}
          Card acquiring and funding services for the sending side.
        </li>
      </ul>

      <H id="diligence">Institutional review</H>
      <p>
        Our <Link className="underline" to="/company">company information</Link>,{' '}
        <Link className="underline" to="/compliance">compliance overview</Link> and{' '}
        <Link className="underline" to="/security">security overview</Link> provide an initial
        reference for due diligence. We welcome technical and compliance discussions covering
        the customer journey, transaction controls, ledger and audit records, integration scope
        and operating requirements.
      </p>
      <p>
        Further documentation and platform walkthroughs can be coordinated on request,
        including confidential discussions under NDA where appropriate.
      </p>

      <H id="contact">Start a conversation</H>
      <div className="rounded-2xl border border-ink-200 bg-canvas p-5 sm:p-6">
        <p className="font-semibold text-ink-900">Partnership and institutional enquiries</p>
        <p className="mt-2">
          Email <a className="underline" href={partnershipEmail}>{brand.support.email}</a> with
          your organisation, the area of collaboration and any initial diligence requirements.
        </p>
        <p className="mt-4 text-sm">
          {brand.legalName}<br />
          {brand.hq.city}, {brand.hq.state}, {brand.hq.country}<br />
          <a className="underline" href={`tel:${brand.support.phone.replace(/[^+\d]/g, '')}`}>
            {brand.support.phone}
          </a>
        </p>
      </div>
    </Shell>
  )
}
