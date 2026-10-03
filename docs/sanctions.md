# Official OFAC sanctions integration

XpressTend imports the U.S. Department of the Treasury's Office of Foreign
Assets Control (OFAC) public sanctions data directly from its [Sanctions List
Service](https://ofac.treasury.gov/sanctions-list-service). The integration
screens primary names and aliases from the Specially Designated Nationals
(SDN) list and the consolidated non-SDN lists. A name similarity result is a
potential match for human identity review, not a confirmed sanctioned identity.

The four official exports are:

| Export | Coverage |
| --- | --- |
| [sdn.csv](https://sanctionslistservice.ofac.treas.gov/api/publicationpreview/exports/sdn.csv) | SDN primary names, official entity identifiers, entity types and sanctions programs |
| [alt.csv](https://sanctionslistservice.ofac.treas.gov/api/publicationpreview/exports/alt.csv) | SDN aliases linked to their primary entities |
| [cons_prim.csv](https://sanctionslistservice.ofac.treas.gov/api/publicationpreview/exports/cons_prim.csv) | Consolidated non-SDN primary names and programs |
| [cons_alt.csv](https://sanctionslistservice.ofac.treas.gov/api/publicationpreview/exports/cons_alt.csv) | Consolidated non-SDN aliases linked to their primary entities |

These URLs are fixed in the importer. Official redirects are accepted only over
HTTPS to the OFAC Sanctions List Service or its specified government AWS S3
publication bucket. Do not replace the consolidated filenames with
`CONSOLIDATED.CSV` or `CON_ALT.CSV`: those unrecognized paths can return HTTP
200 with an empty body. The importer rejects empty files regardless of status.

## Refresh and readiness

[Refresh official OFAC sanctions data](../.github/workflows/sanctions.yml) runs
every 15 minutes and can also be started with GitHub Actions' **Run workflow**.
It uses the existing `CLOUDFLARE_API_TOKEN` deployment secret and production D1
database. The deployment workflow performs the same initial migration and
refresh before publishing the Worker, then verifies the public readiness
endpoint against the activated version. Both jobs share the
`sanctions-production` concurrency group.

Every refresh downloads all four feeds before changing any database rows. It
validates UTF-8, CSV structure, nonempty and plausible record counts, unique
official identifiers, alias-to-primary links, and shared publication IDs when
present. It downloads both primary files again to detect a publication that
changed during the batch. Names and candidate-search entries are staged under
a content-addressed version using bounded D1 queries; the active dataset stays
queryable during imports. Row counts, index-to-name links and a real search lookup must pass
before a single active-version pointer switches to the completed snapshot.
The current and previous completed snapshots are retained.

The full SHA-256 hash covers all four filenames and original response bytes.
The first 24 hexadecimal characters identify the database snapshot. Source
URLs, individual file hashes, row counts, publication IDs, HTTP Last-Modified
values and fetch times are recorded. Rechecking unchanged official files still
updates the last-successful-check time without rebuilding the name index.
Before accepting an unchanged snapshot, refresh also compares a deterministic
sample of 50 official names against the current normalization and search-token
helpers. The sample includes short and long aliases, both primary lists, and
Latin accented names when available. A mismatch stops refresh and deployment.
Normalization or persisted token encoding must remain compatible until an
explicit index migration and compatible snapshot rebuild have been completed;
do not bypass this check or publish helper changes against an old index.

Screening treats data as unavailable after **24 hours without a successful
check**. GitHub schedules can be delayed, so operators must monitor workflow
failures and readiness. HTTP Last-Modified represents the source publication;
it can remain old while the list is unchanged and is never used as the
successful-refresh clock. Missing, incomplete or stale data must hold transfers
instead of treating people as clear.

To validate official feeds locally without database writes:

```sh
cd api
node --experimental-strip-types scripts/refresh-sanctions.mjs --dry-run
```

For a local D1 verification:

```sh
cd api
npx wrangler d1 execute xpresstend-production --local --file=migrations/0007_ofac_sanctions.sql --yes
node --experimental-strip-types scripts/refresh-sanctions.mjs --local
```

A production refresh requires the configured token and explicit remote mode:

```sh
cd api
npx wrangler d1 execute xpresstend-production --remote --file=migrations/0007_ofac_sanctions.sql --yes
node --experimental-strip-types scripts/refresh-sanctions.mjs --remote
```

Never print the token or save it in a file. A failed download, malformed feed,
changed publication or incomplete import does not switch the active pointer.
Production queries use the token's automatically discovered account, validate
the configured database UUID before writes, and retry HTTP 429/5xx responses
with bounded delays. `CLOUDFLARE_ACCOUNT_ID` can optionally select the account.
Staging writes are idempotent, and activation cannot move the successful-check
time backwards.
Retry the workflow after correcting the reported failure; a retry discards
only the incomplete inactive candidate. The last complete active snapshot
remains available subject to the freshness limit. A code rollback must retain
the sanctions schema and the fail-closed transfer controls; do not restore the
former placeholder screening or manually declare stale data current.

## Compliance responsibilities

This integration is official-list **name screening**. It does not determine
beneficial ownership under OFAC's 50 Percent Rule, nationality, geographic
restrictions, prohibited activities, licenses, or all program-specific
limitations. Non-SDN restrictions also vary by program and activity. Reviewers
must assess the actual parties, identifying information, ownership, geography
and transaction purpose before resolving a match or authorizing a transfer.

OFAC administers U.S. sanctions. FinCEN administers separate Bank Secrecy Act
and anti-money-laundering obligations. Importing OFAC data does not establish
FinCEN registration, money-transmitter licensing, a complete AML program, KYC
verification, reporting obligations, or authorization to launch customer money
movement. Those controls and partner approvals remain separate requirements.
