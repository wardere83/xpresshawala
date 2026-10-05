-- Customer recovery capabilities contain only token hashes. A redemption's
-- random claim identifies the one atomic batch allowed to change credentials.
CREATE TABLE IF NOT EXISTS customer_password_resets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  revoked_at TEXT,
  claim_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_customer_resets_user ON customer_password_resets(user_id);

-- Account closure removes the live profile while preserving references in
-- financial records. The operation id guards every dependent deletion write.
CREATE TABLE IF NOT EXISTS customer_account_deletions (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  operation_id TEXT NOT NULL UNIQUE,
  deleted_at TEXT NOT NULL,
  retained_financial_records INTEGER NOT NULL CHECK(retained_financial_records IN (0, 1))
);

-- Restricted financial/KYC identity linkage, retained only for accounts with
-- those records. Contact details are deliberately excluded. This table is not
-- returned by customer API endpoints and has no public read route.
CREATE TABLE IF NOT EXISTS customer_retained_identities (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  identity_json TEXT NOT NULL,
  retained_at TEXT NOT NULL
);
