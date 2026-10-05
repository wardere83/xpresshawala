import type { Page } from '@playwright/test'

export const customer = {
  id: 'customer-test', firstName: 'Taylor', lastName: 'Test', email: 'test@example.invalid',
  kycStatus: 'verified', kycTier: 1, status: 'active', createdAt: '2026-06-01T00:00:00.000Z',
}

export const savedRecipient = {
  id: 'recipient-test', full_name: 'Test Recipient', country: 'SO', payout_method: 'mobile_wallet',
  phone: '+252610000000', bank_name: null, relationship: 'Family', created_at: '2026-01-01T00:00:00.000Z',
}

const corridor = {
  id: 'cor_us_so', send_country: 'US', receive_country: 'SO', send_currency: 'USD', receive_currency: 'USD',
  fee_flat_minor: 99, fee_percent_bps: 0, min_send_minor: 100, max_send_minor: 300000, fx_margin_bps: 0,
}

/** Exact API response shapes; every write remains inside this isolated fixture. */
export async function mockAccount(page: Page, options: {
  user?: typeof customer; recipients?: typeof savedRecipient[]; quoteUnavailable?: boolean;
  recipientAfterPayment?: string; createdFeeMinor?: number;
} = {}) {
  const requests: { path: string; method: string; body: Record<string, unknown> | null }[] = []
  let paid = false
  let createdQuote: Record<string, unknown> | null = null
  const recipients = options.recipients ?? [savedRecipient]
  const quote = (amount: number, fee = 99) => ({
    sendAmountMinor: amount, feeMinor: fee, totalChargedMinor: amount + fee, receiveAmountMinor: amount,
    sendCurrency: 'USD', receiveCurrency: 'USD', effectiveRateE8: 100000000, corridorId: corridor.id,
    expiresAt: new Date(Date.now() + 900000).toISOString(),
  })
  await page.route('**/api/**', async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname
    const body = request.postData() ? request.postDataJSON() as Record<string, unknown> : null
    requests.push({ path, method: request.method(), body })
    let response: unknown
    if (path === '/api/auth/me') response = { user: options.user ?? customer }
    else if (path === '/api/recipients') response = { recipients: paid && options.recipientAfterPayment
      ? recipients.map((recipient) => ({ ...recipient, full_name: options.recipientAfterPayment })) : recipients }
    else if (path === '/api/corridors') response = { corridors: [corridor] }
    else if (path === '/api/quote') {
      if (options.quoteUnavailable) return route.fulfill({ status: 503, json: { error: 'rate_stale', message: 'A current exchange rate is unavailable.' } })
      response = { quote: quote(Number(body?.sendAmountMinor)) }
    } else if (path === '/api/transfers' && request.method() === 'POST') {
      createdQuote = quote(Number(body?.sendAmountMinor), options.createdFeeMinor ?? 99)
      response = { transfer: { ...createdQuote, id: 'transfer-test', reference: 'XPT-TEST-123', status: 'awaiting_payment' } }
    } else if (path === '/api/transfers/transfer-test/pay') {
      paid = true
      response = { ok: true, status: 'compliance_hold', testMode: true }
    } else if (path === '/api/transfers') response = { transfers: paid ? [{
      id: 'transfer-test', reference: 'XPT-TEST-123', send_amount_minor: createdQuote?.sendAmountMinor,
      send_currency: 'USD', fee_minor: createdQuote?.feeMinor, receive_amount_minor: createdQuote?.receiveAmountMinor,
      receive_currency: 'USD', status: 'compliance_hold', created_at: new Date().toISOString(), completed_at: null,
      recipient_name: options.recipientAfterPayment ?? recipients[0]?.full_name, recipient_country: 'SO',
    }] : [] }
    else return route.fulfill({ status: 404, json: { error: 'unexpected_fixture_request' } })
    return route.fulfill({ status: 200, json: response })
  })
  return requests
}
