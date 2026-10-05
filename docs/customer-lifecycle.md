# Customer account lifecycle

Apply `api/migrations/0008_customer_lifecycle.sql` before deploying these routes.

## Password recovery

`POST /api/auth/forgot-password` accepts `{ "email": "..." }`. Its response is
always the same, including for unknown, closed, suspended, invalid or limited
addresses. Account lookup and mail delivery run through the Worker's
`waitUntil`, so mail latency and account existence do not change the HTTP
response. Limits apply to both the caller and a hash of the address; rate-limit
storage failures stop recovery rather than allowing unrestricted requests.

The existing Microsoft 365 or Resend transport must be configured. A reset link
is delivered only to the active account's email. It is never returned by the
API, included in audit metadata, or logged. Provider errors log only a status
code. Failed delivery revokes the reset capability; there is no unauthenticated
manual-link fallback. Operators should verify delivery configuration before
advertising the flow as available.

The link uses `/#/reset-password/<token>`, keeping its capability out of server
URL logs. The browser submits `{ "token": "...", "password": "..." } to
`POST /api/auth/reset-password`. Database storage contains only the SHA-256
hash of the random 256-bit token. Tokens expire in 60 minutes; a new request
revokes prior outstanding links. Closed and suspended accounts cannot redeem
links. Passwords require 12–128 characters, upper and lower case, and a number.

Redemption conditionally claims one unused token and changes the salted,
peppered password hash in one database transaction. The same transaction
revokes all existing sessions and other recovery links. A replay or competing
redemption cannot change credentials again. Resetting does not sign anyone in.
Login's session insertion rechecks the current password hash and active status,
so an earlier login check cannot mint a session after the reset or deletion.

## Account deletion

`DELETE /api/auth/account` requires a current customer session, JSON from an
allowed origin, and `{ "password": "...", "confirmation": "DELETE" }`.
The password is freshly verified. The final database claim rechecks the same
credential hash, active account, and unrevoked, unexpired session, together with
financial eligibility. The account is deleted through an atomic batch, rather
than converted into a support request.

The eligibility policy cancels provably unfunded `draft`, `awaiting_payment`,
and `compliance_hold` quotes in the deletion transaction, with an event for each.
This requires no payment/payout provider or reference, paid timestamp, posting
marker, or ledger entry. Other open transfers and any inconsistent or
unsettled monetary record block deletion. In particular, a funded transfer marked `failed`
still blocks deletion when funds have not been reconciled: a terminal label is
not evidence of a refund. Any provider/payment/payout reference without a paid timestamp blocks
deletion, including on a `failed`, `cancelled` or `refunded` transfer, until the
provider operation is reconciled. Payable balances are checked per transfer and currency
so unrelated balances cannot offset one another. Posting markers must link to
ledger records, ledger groups must balance, and paid transfers require funding
and payout evidence. No refund mechanism is claimed by these checks.

Deletion removes profile email, phone, names, language and country preferences,
password credentials, sessions, email tokens, and customer reset records. The
user row becomes a non-login `closed` tombstone, preserving foreign-key integrity.
Unreferenced recipient contacts are removed. Recipients referenced by historical
transfers are archived because they are the existing beneficiary payment records;
their optional relationship field is removed.

Transaction amounts, rates, provider references, events, postings, ledger entries,
KYC checks, sanctions evidence, and append-only audit history remain. Existing
compliance and audit records can contain personal information. For accounts with
transaction or KYC history, a restricted identity table preserves only the sender
name and country needed to identify those records, without email or phone.
This is legally retained financial/compliance evidence, not a recoverable live
profile, and it is not returned by customer API routes. Retention and eventual
disposal must follow the company's applicable legal retention policy; the code
does not invent a universal retention period.

The UI must explain retention before confirmation, offer access to current
activity before deleting, and say that an account cannot be restored. After
successful deletion, the former email can register a new account; the new
account does not regain the old account's records. Pending funds must be
resolved before deletion is permitted. Transfer and recipient creation also
check the current active account and live session inside their database writes,
preventing earlier requests from repopulating a deleted account.
