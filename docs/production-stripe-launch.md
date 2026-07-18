# Production Stripe Launch Runbook

This runbook is for the controlled move from the current JSON/Clover setup to
transactional PostgreSQL, encrypted private document storage, and Stripe live
payments. It is intentionally conservative: `data.json` remains a rollback
artifact and must never be committed as part of a code release.

## Safety Rules

- Do not cancel a Clover plan before the matching Stripe first charge passes.
- Do not set `WOA_DATA_BACKEND=postgres` until the import, checksum, and test
  restore pass against the intended database.
- Do not set `WOA_PRODUCTION_HARDENING_REQUIRED=1` until the owner-only
  infrastructure preflight is clear.
- Before enabling production hardening, reset the owner password through
  **Settings -> Account** so the platform stores the current PBKDF2 record,
  and disable the owner PIN fallback. A legacy/plain environment password can
  still be used for recovery, but it intentionally cannot clear the live
  Stripe launch gate.
- Never store card numbers, CVVs, API secrets, or private identity documents
  in the normal state JSON.
- Keep a dated, access-controlled copy of the current `data.json` before any
  intentional data migration. Do not add that file to a commit.
- Never take a migration snapshot while the application is writable. Set
  `WOA_MIGRATION_MAINTENANCE_MODE=1`, deploy, and confirm `/healthz` reports
  `"migrationMaintenance":true` first. The mode keeps reads and staff login
  available, returns retryable `503` responses for business writes and
  provider webhooks, and does not start autopay, sync, messaging, or monitoring
  background writers.
- Run `pnpm run secret-hygiene-check` before a release. It rejects committed
  production-key signatures and private key blocks without printing the secret
  value if one is found.

## 1. Prepare a Separate Test Environment

Provision a dedicated PostgreSQL test database first. It must not be the live
database. Run the read-only source checks from the repository root:

```sh
pnpm run postgres-preflight -- data.json
pnpm run production-foundation-check
```

Run the real transactional write/snapshot/recovery check only against that
dedicated test database:

```sh
WOA_TEST_DATABASE_URL='postgresql://...' \
WOA_POSTGRES_RUNTIME_TEST_CONFIRM=1 \
pnpm run postgres-runtime-check
```

It creates a random test organization, proves write/snapshot/restore/checksum
behavior, then removes only that generated test organization. Never point
`WOA_TEST_DATABASE_URL` at the production database. This first test proves the
database behavior only; it does not record production launch evidence yet.

## 2. Configure Private Document Storage

Use a private S3-compatible bucket such as AWS S3 or Cloudflare R2. The bucket
must not allow public listing or public object reads.

Required Render environment variables:

```text
WOA_DOCUMENT_STORAGE_PROVIDER=s3
WOA_DOCUMENT_ENCRYPTION_KEY=<base64 32-byte random key>
WOA_DOCUMENT_ENCRYPTION_KEY_VERSION=v1
WOA_DOCUMENT_DECRYPTION_KEYS='{"v0":"<previous base64 32-byte key>"}' # only when older versions exist
WOA_OBJECT_STORAGE_BUCKET=<private bucket>
WOA_OBJECT_STORAGE_ENDPOINT=<S3-compatible endpoint>
WOA_OBJECT_STORAGE_REGION=<region>
WOA_OBJECT_STORAGE_ACCESS_KEY_ID=<private key id>
WOA_OBJECT_STORAGE_SECRET_ACCESS_KEY=<private secret>
WOA_OBJECT_STORAGE_PATH_STYLE=1   # only when the provider requires it
WOA_OBJECT_STORAGE_TIMEOUT_MS=15000
```

The platform encrypts each document with AES-256-GCM before it is stored. The
database receives metadata and encrypted-object references, not file bytes.
IDs, insurance, contracts, signatures, receipts, and dispute evidence should
only be downloaded through the authenticated application route. Every read
also verifies the original plaintext SHA-256 checksum and byte count after
authenticated decryption. A mismatched record or incomplete object fails
closed instead of returning questionable evidence.

When rotating the active key, keep every historical version that still owns a
stored document in `WOA_DOCUMENT_DECRYPTION_KEYS`. The active
`WOA_DOCUMENT_ENCRYPTION_KEY` is automatically registered under
`WOA_DOCUMENT_ENCRYPTION_KEY_VERSION`; never duplicate that version with a
different value. The launch preflight inventories encrypted records and blocks
cutover if any required version is unavailable. Remove an old key only after
the controlled document migration has re-encrypted every matching object under
the new version and authenticated read-back has passed.

If legacy files exist, make a backup first and test migration with a copied
state file. Run the production migration only in a maintenance window while
application writes are paused. The document migrator creates an additional
immutable pre-migration backup, encrypts each file, reads the exact bytes back
to verify them before changing its record, and never deletes originals unless
an explicit delete flag is supplied:

```sh
WOA_PRIVATE_DOCUMENT_MIGRATION_CONFIRM=1 \
WOA_PRIVATE_DOCUMENT_MIGRATION_MAINTENANCE_CONFIRM=1 \
WOA_DOCUMENT_STORAGE_PROVIDER=s3 \
WOA_DOCUMENT_ENCRYPTION_KEY='<base64 key>' \
...provider variables... \
pnpm run migrate-private-documents -- /secure/path/to/copied-data.json
```

Verify authenticated staff downloads before setting
`WOA_PRIVATE_DOCUMENT_STORAGE_REQUIRED=1` in production.

The migration script has a repeat-safe test that proves the maintenance
guard, backup, encryption/read-back, legacy retention, and no-op rerun path:

```sh
node scripts/private-document-migration-check.js
```

Before enabling production hardening, use **Settings -> System health ->
Validate private storage** once from the deployed app. The owner-only route is:

```text
POST /api/system/infrastructure/document-storage/validate
```

It encrypts a random probe, writes it to the private bucket, reads and
authenticates it, verifies that an anonymous request cannot read the object,
then deletes it and proves an authenticated read returns not-found. A provider
that acknowledges deletion while retaining the object fails the proof.
Production readiness also rejects non-HTTPS endpoints. The
launch gate requires this proof to match the current encryption key and
object-storage configuration and refreshes it after 30 days by default. If the
bucket, access key, endpoint, region, or encryption key changes, run the
validation again before enabling `WOA_PRODUCTION_HARDENING_REQUIRED=1`.

## 3. Migrate Platform State to PostgreSQL

After the test database has passed, provision the production PostgreSQL
database. Then set `WOA_MIGRATION_MAINTENANCE_MODE=1` in Render and deploy the
current tested commit. Confirm all three conditions before copying live state:

```text
GET /healthz returns 200
migrationMaintenance is true
POST /api/state returns 503 with code migration_maintenance
```

The `503` response includes `Retry-After: 120`, so Stripe, Clover, Telnyx, and
other well-behaved providers can retry rather than losing an event. Keep this
write freeze active through the protected copy, import, checksum verification,
and backend switch. Retain that protected copy as the rollback artifact. First
run the preflight against the exact protected source copy:

```sh
pnpm run postgres-preflight -- /secure/path/to/data-backup.json
```

Record the `sourceFileChecksum` printed by preflight. It is an exact SHA-256
fingerprint of the protected JSON bytes. The importer and verifier refuse to
operate if that file changes, even if the JSON still parses.

Import only after it reports no immutable identity conflicts and only while
application writes are paused:

```sh
DATABASE_URL='postgresql://...' \
WOA_POSTGRES_MIGRATION_CONFIRM=1 \
WOA_POSTGRES_MIGRATION_MAINTENANCE_CONFIRM=1 \
WOA_POSTGRES_MIGRATION_SOURCE_SHA256='<sourceFileChecksum from preflight>' \
pnpm run migrate-json-to-postgres -- /secure/path/to/data-backup.json
```

The importer refuses to overwrite an existing PostgreSQL organization unless
`WOA_POSTGRES_MIGRATION_REPLACE=1` is supplied for a deliberate recovery
operation. It verifies the canonical checksum after import and never deletes
the JSON source. It also records source-to-target checksum, collection-count,
and import-snapshot evidence in PostgreSQL. If a proof needs to be regenerated
without rewriting either state, use the exact protected source copy:

```sh
DATABASE_URL='postgresql://...' \
WOA_POSTGRES_MIGRATION_PROOF_CONFIRM=1 \
WOA_POSTGRES_MIGRATION_SOURCE_SHA256='<same sourceFileChecksum from preflight>' \
pnpm run verify-json-to-postgres -- /secure/path/to/data-backup.json
```

The verifier refuses a source that differs from the current database and only
writes the matching migration-proof metadata. The launch preflight rejects a
reachable-but-empty database, a missing import proof, and any state or
recovery snapshot whose checksum no longer matches; recover from a verified
snapshot instead of manually editing production rows.

The importer creates a shared application write lock and releases it after
success or handled failure. If the process or host is killed and the lock is
still present after five minutes, do not delete it by hand. Verify that no
migration process remains, use the exact protected-source checksum from
preflight, and run the guarded recovery command:

```sh
WOA_POSTGRES_MIGRATION_LOCK_RECOVERY_CONFIRM='RECOVER STALE POSTGRES MIGRATION LOCK' \
WOA_POSTGRES_MIGRATION_SOURCE_SHA256='<same sourceFileChecksum from preflight>' \
pnpm run recover-postgres-migration-lock -- /secure/path/to/data-backup.json
```

Recovery refuses a fresh lock, a changed source file, a different source path,
or a checksum mismatch. It renames the original lock instead of deleting it so
the acquisition record remains available for incident review. Run preflight
again before attempting another import.

After the production import and verifier pass, run the controlled recovery
drill one more time. It runs all writes, snapshot restores, lease recovery,
and simulated restart reads in the **separate test database**. It then writes
only a small signed proof record into the already-imported production database;
it does not run the test organization against production state:

```sh
WOA_TEST_DATABASE_URL='postgresql://...dedicated-test-database...' \
WOA_POSTGRES_RUNTIME_TEST_CONFIRM=1 \
WOA_POSTGRES_RUNTIME_PROOF_RECORD=1 \
WOA_POSTGRES_RUNTIME_PROOF_CONFIRM=1 \
WOA_POSTGRES_RUNTIME_PROOF_DATABASE_URL='postgresql://...production-database...' \
WOA_SESSION_SECRET='<the same stable secret configured for Render>' \
pnpm run postgres-runtime-check
```

The command refuses to run if the test target resolves to the same database as
the production proof target. Do not bypass that refusal. The proof expires
after 30 days by default and also becomes invalid if the production database
URL, organization, or signing secret changes. Run the drill again after any of
those changes.

Then configure Render:

```text
DATABASE_URL=<production PostgreSQL URL>
WOA_DATA_BACKEND=postgres
WOA_POSTGRES_SNAPSHOT_LIMIT=180
WOA_SESSION_SECRET=<long random secret>
WOA_PRIVATE_DOCUMENT_STORAGE_REQUIRED=1
WOA_OWNER_PIN_FALLBACK_ENABLED=0
WOA_MIGRATION_MAINTENANCE_MODE=0
# Set WOA_PRODUCTION_HARDENING_REQUIRED=1 only after the full preflight is clear.
```

Apply `DATABASE_URL`, `WOA_DATA_BACKEND=postgres`, and
`WOA_MIGRATION_MAINTENANCE_MODE=0` in the same final deployment. Do not reopen
writes on the JSON backend after taking the protected source copy. If that
deployment fails its health check, restore the protected JSON configuration
with maintenance mode still enabled, investigate, and repeat the import from a
new protected snapshot; never let both stores accept writes.

Restart once and visit the owner-only endpoint:

```text
GET /api/system/infrastructure/preflight
```

Render should use `/healthz` as the web-service health check. The endpoint
performs a lightweight state-availability/database-connectivity query and does
not return customer records, provider settings, or database details. Deploys
also receive a 60-second shutdown window so active HTTP money actions and
queued state writes can drain before the old instance exits. Keep Render's
automatic deploy trigger set to `checksPass`; `.github/workflows/production-gate.yml`
runs the complete `npm run check` suite for `main` before Render accepts a new
release.

It must show PostgreSQL as transactional/healthy, a current import proof,
current recovery snapshot, and a fresh controlled recovery drill. It must also
show private document storage as production-ready with a current
write/read/delete validation, no identity conflicts, and no unresolved launch
blockers.

PostgreSQL also gives the background autopay worker an organization-scoped
advisory lock. A second app process will skip the same run instead of starting
a competing charge pass; the lock is released automatically if its database
session ends unexpectedly.

Every state read also carries a private, server-only merge baseline. When a
staff save, webhook, synchronization pass, or autopay result reaches the same
customer or payment record at nearly the same time, the transactional write
performs a field-level three-way merge under the PostgreSQL row lock. Changes
to different fields and concurrent history additions survive together; only
an exact same-field conflict follows the route's explicit incoming/latest
preference. The browser never receives this baseline.

Stripe webhook events are also claimed durably. A duplicate received while the
first copy is still processing gets a retry response instead of being processed
twice; an expired processing lease can be reclaimed after a crash.

## 4. Configure Stripe Without Switching Everyone

Store live keys only in Render:

```text
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
WOA_PAYMENT_PROVIDER=clover
WOA_ONBOARDING_PAYMENT_PROVIDER=stripe
WOA_IDENTITY_PROVIDER=stripe
PUBLIC_BASE_URL=https://wheelsonauto.com
```

Start with the default payment provider left on Clover. The onboarding provider
can use Stripe for new customers while existing customers migrate one at a
time. Configure Stripe webhook events for successful/failed payment intents,
refunds, disputes, setup intents, and Stripe Identity updates. The webhook
must be signed and reach the live platform before it is treated as connected.
The launch preflight records the most recent Stripe event and refuses to call
the platform live-ready until it has received a signed event with Stripe's
`livemode: true` flag. A copied secret or dashboard-only test is not enough.
That proof is bound to the active Stripe key, publishable key, webhook secret,
API base URL, public URL, identity mode, and onboarding payment provider using
a server-only fingerprint. Changing any of those Render settings intentionally
requires one fresh signed live event before the preflight is green again.
The production guard also requires `WOA_ONBOARDING_PAYMENT_PROVIDER=stripe`,
`WOA_IDENTITY_PROVIDER=stripe`, and one signed
`identity.verification_session.verified` event matched to a WheelsonAuto
onboarding file. A generic payment, refund, or unrelated Stripe event cannot
stand in for the license-and-selfie test.

Run one complete controlled test record:

1. Choose an online vehicle.
2. Submit an application.
3. Complete license/selfie verification and insurance upload.
4. Approve as admin.
5. Save a card through Stripe SetupIntent/Checkout.
6. Charge the deposit and first weekly payment as separate transactions.
7. E-sign the agreement.
8. Schedule pickup within the allowed window.
9. Confirm the weekly schedule is anchored to pickup day.
10. Check the payment, customer, vehicle, VIN/tag, receipt, contract, and
    dispute-evidence record in the admin and customer views.

Only use real customer funds after the test has a clear, written result.

## 5. Controlled Clover-to-Stripe Migration

Move one recurring customer at a time through these persisted states:

```text
Clover active
  -> Stripe setup sent
  -> Stripe card saved
  -> Cutover scheduled
  -> First Stripe charge pending
  -> First Stripe charge passed
  -> Clover disabled
  -> Stripe active
```

The app blocks automatic double charging for the same billing period. A
scheduled cutover keeps Clover active until the exact cutover date and owner
confirmation that Clover is stopped. The first successful Stripe charge is the
only event that completes the customer migration. Do not bulk-cancel Clover
plans based on name matching alone.

Sending the Stripe setup link and saving the Stripe card are preparation only:
they must never pause an existing Clover schedule. If a cutover is scheduled
ahead of time, Clover remains eligible for billing periods before that date,
then both providers are locked for the cutover period until the owner confirms
the Clover schedule was stopped. This prevents both an accidental missed week
and a same-period duplicate charge. The same lock applies to staff manual
saved-card charges: a manual Clover charge cannot bypass the cutover date, and
a blocked migration action must not count as a failed customer card attempt.

The Clover recurring roster uses the documented `/recurring/v1/plans` and
`/recurring/v1/plans/{planId}/subscriptions` endpoints with the merchant ID in
the `X-Clover-Merchant-Id` header. If Clover returns `401`, `403`, or `404`
while a verified roster already exists, WheelsonAuto preserves that roster and
continues customer/payment synchronization, but records a degraded recurring
warning. Treat the preserved roster as read-only evidence until the Clover
merchant API token is corrected; do not schedule a customer cutover from a
stale roster alone.

The owner **Live launch preflight** enforces this rule as a separate Clover
cutover-roster gate. A current `401`, `403`, `404`, incomplete-count warning,
or roster older than six hours keeps that gate blocked even if older job
errors are marked reviewed. `WOA_CLOVER_RECURRING_VALIDATION_MAX_AGE_MS` may
make the window stricter, but it must not be used to bypass a degraded sync.

## 6. Provider Settings

### Star AI

```text
OPENAI_API_KEY=<project key>
WOA_AI_MODEL=<approved Responses API model>
WOA_AI_MAX_REQUESTS_PER_DAY=250
WOA_AI_MAX_REQUESTS_PER_MONTH=2500
WOA_AI_TIMEOUT_MS=15000
```

Star reserves a request before every model call. The PostgreSQL quota is
atomic, so concurrent calls cannot exceed the configured cap. If a cap, credit,
or credential problem occurs, it falls back to safe rules drafts. Money,
autopay, card, removal, dispute, refund, receipt, and unclear requests still
require owner approval.

The request caps are a platform safety rail, not a dollar-denominated billing
ceiling because model/token pricing can change. Set the separate monthly budget
and usage alerts in the OpenAI project before enabling live model replies.
Before the hardened Stripe launch, use the owner-only **Star provider health
test** once after the current Render settings are deployed. The successful
Responses API result is bound to the active key, model, endpoint, limits, and
Star settings and expires after 30 days by default. Changing any of those
settings requires a fresh health test; a dashboard key alone does not clear the
launch gate.

### Telnyx

```text
WOA_MESSAGING_PROVIDER=telnyx
TELNYX_API_KEY=<private API key>
TELNYX_PUBLIC_KEY=<webhook public key>
TELNYX_MESSAGING_PROFILE_ID=<profile id>
WOA_MESSAGING_FROM_NUMBER=+1...
WOA_MESSAGING_WEBHOOK_SECRET=<shared secret when used>
```

Do not turn on automatic customer messaging until 10DLC approval, number
assignment, inbound signing, and one carrier-delivered outbound test are all
confirmed. For the hardened Stripe launch, send a fresh test text and reply to
it from a phone after the current Render settings are deployed. The platform
requires both the carrier delivery receipt and the signed inbound reply to
match the active Telnyx configuration, and refreshes that proof after 30 days
by default.

### Resend

```text
WOA_EMAIL_PROVIDER=resend
RESEND_API_KEY=<private key>
WOA_EMAIL_FROM=WheelsonAuto <notifications@notify.wheelsonauto.com>
WOA_EMAIL_REPLY_TO=wheelsonauto@gmail.com
RESEND_WEBHOOK_SECRET=<webhook signing secret>
```

Verify the `wheelsonauto.com` sending domain, complete an outbound receipt
test, and then verify an inbound reply webhook before relying on email as a
two-way inbox. The hardened Stripe launch requires those fresh outbound and
inbound records to match the active Resend configuration. A test sent from an
old sender, key, or webhook secret cannot clear the launch gate.

### Record Live Provider Evidence From WheelsonAuto

After the current Render settings are deployed, use an owner-controlled test
inbox and phone. Do not test a new provider by contacting a customer first.
Each check leaves an audit record and is tied to the current Render
configuration, so changing a key, sender, webhook secret, or provider setting
requires a new proof.

1. In **Settings -> System health**, use **Validate private storage**. It must
   complete an encrypted write/read/delete probe against the private bucket.
2. In **Messages -> Setup**, connect the Telnyx inbox. Then use **API Roadmap
   -> SMS** to check 10DLC/number assignment. Send one harmless test text from
   a WheelsonAuto message thread and reply to it from the controlled phone.
   Confirm the carrier delivery status and signed reply both appear in the
   same thread before enabling automatic SMS.
3. In **Messages**, send one harmless email to the controlled inbox and reply
   to it. The outbound record and signed inbound webhook must both appear in
   Messages before email is considered two-way.
4. In **Messages -> Star**, use **Test Star provider**. It only runs a safe
   Responses API health prompt; it does not message a customer, charge a card,
   or change an account.
5. In **Settings -> System health**, use **Test failure alerts** and verify
   the owner email receives it.
6. Open **Live launch preflight** from System health. It must show each gate
   as verified. A provider showing `Blocked` has not passed the live evidence
   requirement yet, even if its keys are saved in Render.

For Stripe, the final evidence comes from the controlled onboarding record:
complete the test application, Stripe Identity verification, card setup,
separate deposit and first-week charges, e-sign, and pickup scheduling. Keep
the record clearly labeled as a controlled test and do not use a real customer
until its receipts, vehicle context, and webhook evidence are all visible.

## 7. Enable the Launch Guard Last

After all the above checks are green, set:

```text
WOA_PRODUCTION_HARDENING_REQUIRED=1
```

On a future restart the service will refuse to start if transactional
PostgreSQL, encrypted private storage, Stripe live/webhook settings, Stripe
onboarding and Identity, verified Telnyx SMS delivery/reply, verified Resend
two-way email, a fresh OpenAI Star health proof, verified operational alerts,
a stable session secret, or HTTPS public URL are missing. This is deliberate: it keeps a partial
configuration from quietly processing live money or private documents.

Before each deployment rehearsal, run the guard test as well:

```sh
pnpm run production-startup-gate-check
pnpm run provider-launch-proof-check
```

It launches a clean temporary process with hardened mode on but no provider
credentials, PostgreSQL database, or private object store. The test passes only
when that process exits before opening an HTTP listener and names the missing
launch safeguards. It never reads or changes the live `data.json` file.

## 8. Recovery and Monitoring

The owner can list PostgreSQL snapshots with:

```text
GET /api/system/recovery/snapshots
```

A restore requires both `confirmed: true` and the exact phrase
`RESTORE SNAPSHOT <id>`. Restore creates a new audited version; it does not
erase historical snapshots or the retained JSON rollback artifact.

Set `WOA_ERROR_ALERTS_ENABLED=1` only after the owner notification email is
verified. The server records durable PostgreSQL job errors for webhook, sync,
autopay, and provider failures. Monitor these before and after every live
provider cutover.

## 9. Final Launch Matrix

Before moving more customers, explicitly verify:

- successful, declined, timed-out, duplicate, and delayed Stripe charges
- duplicate/out-of-order Stripe webhook handling
- one-hour retry and failed-twice follow-up behavior
- weekly schedule edits and pickup-day anchoring
- card setup/change/deletion, refund, dispute, receipt, and evidence paths
- vehicle swap, return, end, history, and reactivation paths
- customer, manager, mechanic, and owner permissions
- phone, tablet, laptop, and wide desktop layouts
- private document access cannot cross customer/company boundaries
- backup restoration and server restart recovery

Keep EZPass CSV matching, manual insurance review, manual accounting exports,
and PassTime companion access separate from the Stripe go-live. They should not
block a safe payment migration.
