import { createContext, useContext } from 'react'
import { getCorridor, getRecipient, type PaymentMethodId, type Transaction } from '../data/mock'

/**
 * How the fee is applied.
 *  - 'added'    → you are charged amount + fee, the recipient gets the full amount (default).
 *  - 'deducted' → you are charged the amount, the fee comes out of what the recipient gets.
 */
export const FEE_MODE: 'added' | 'deducted' = 'added'

export type DeliveryMethod = 'mobile' | 'bank' | 'cash' | 'airtime'

export type Quote = {
  amountUsd: number
  fee: number
  /** Charged to the sender's payment method. */
  totalUsd: number
  /** What lands with the recipient, in USD. */
  recipientUsd: number
  /** What lands with the recipient, in the destination currency. */
  recipientLocal: number
  rate: number
  currency: string
}

export type TransferReceipt = {
  transaction: Transaction
  recipient: ReturnType<typeof getRecipient>
  quote: Quote
  isDemo: boolean
  status: string
}

export type TransferValue = {
  recipientId: string
  setRecipientId: (id: string) => void
  amountUsd: number
  setAmountUsd: (value: number) => void
  paymentMethod: PaymentMethodId
  setPaymentMethod: (id: PaymentMethodId) => void
  deliveryMethod: DeliveryMethod
  setDeliveryMethod: (m: DeliveryMethod) => void
  recipient: ReturnType<typeof getRecipient>
  corridor: ReturnType<typeof getCorridor>
  quote: Quote
  history: Transaction[]
  lastTransaction: Transaction | null
  lastReceipt: TransferReceipt | null
  /**
   * Records the transfer. For a signed-in customer this creates it through the
   * API and captures the (test-mode) payment, so it lands in the compliance
   * queue; for a visitor touring the app it only appends to local history.
   */
  /** Requires the account password: the server authorises payment with it. */
  commit: (password: string) => Promise<Transaction>
  reset: () => void
  /** True when the numbers and the recipient come from the customer's account. */
  live: boolean
  /** Set when a real transfer could not be created. */
  commitError: string | null
  availableError: string | null
  quoteReady: boolean
  quoteLoading: boolean
}

export const TransferContext = createContext<TransferValue | null>(null)

export function useTransfer() {
  const ctx = useContext(TransferContext)
  if (!ctx) throw new Error('useTransfer must be used inside <TransferProvider>')
  return ctx
}
