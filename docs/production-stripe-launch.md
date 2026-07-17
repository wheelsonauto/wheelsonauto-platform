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
- Never store card numbers, CVVs, API secrets, or private identity documents
  in the normal state JSON.
- Keep a dated, access-controlled copy of the current `data.json` before any
  intentional data migration. Do not add that file to a commit.

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
`WOA_TEST_DATABASE_URL` at the production database.

## 2. Configure Private Document Storage

Use a private S3-compatible bucket such as AWS S3 or Cloudflare R2. The bucket
must not allow public listing or public object reads.

Required Render environment variables:

```text
WOA_DOCUMENT_STORAGE_PROVIDER=s3
WOA_DOCUMENT_ENCRYPTION_KEY=<base64 32-byte random key>
WOA_DOCUMENT_ENCRYPTION_KEY_VERSION=v1
WOA_OBJECT_STORAGE_BUCKET=<private bucket>
WOA_OBJECT_STORAGE_ENDPOINT=<S3-compatible endpoint>
WOA_OBJECT_STORAGE_REGION=<region>
WOA_OBJECT_STORAGE_ACCESS_KEY_ID=<private key id>
WOA_OBJECT_STORAGE_SECRET_ACCESS_KEY=<private secret>
WOA_OBJECT_STORAGE_PATH_STYLE=1   # only when the provider requires it
```

The platform encrypts each document with AES-256-GCM before it is stored. The
database receives metadata and encrypted-object references, not file bytes.
IDs, insurance, contracts, signatures, receipts, and dispute evidence should
only be downloaded through the authenticated application route.

If legacy files exist, make a backup first and test migration with a copied
state file. The document migrator never deletes originals unless an explicit
delete flag is supplied:

```sh
WOA_PRIVATE_DOCUMENT_MIGRATION_CONFIRM=1 \
WOA_DOCUMENT_STORAGE_PROVIDER=s3 \
WOA_DOCUMENT_ENCRYPTION_KEY='<base64 key>' \
...provider variables... \
pnpm run migrate-private-documents -- /secure/path/to/copied-data.json
```

Verify authenticated staff downloads before setting
`WOA_PRIVATE_DOCUMENT_STORAGE_REQUIRED=1` in production.

## 3. Migrate Platform State to PostgreSQL

After the test database has passed, provision the production PostgreSQL
database and retain a protected rollback copy of the live state. First run the
preflight again against the exact source copy:

```sh
pnpm run postgres-preflight -- /secure/path/to/data-backup.json
```

Import only after it reports no immutable identity conflicts:

```sh
DATABASE_URL='postgresql://...' \
WOA_POSTGRES_MIGRATION_CONFIRM=1 \
pnpm run migrate-json-to-postgres -- /secure/path/to/data-backup.json
```

The importer refuses to overwrite an existing PostgreSQL organization unless
`WOA_POSTGRES_MIGRATION_REPLACE=1` is supplied for a deliberate recovery
operation. It verifies the canonical checksum after import and never deletes
the JSON source.

Then configure Render:

```text
DATABASE_URL=<production PostgreSQL URL>
WOA_DATA_BACKEND=postgres
WOA_POSTGRES_SNAPSHOT_LIMIT=180
WOA_SESSION_SECRET=<long random secret>
WOA_PRIVATE_DOCUMENT_STORAGE_REQUIRED=1
```

Restart once and visit the owner-only endpoint:

```text
GET /api/system/infrastructure/preflight
```

It must show PostgreSQL as transactional/healthy, private document storage as
production-ready, no identity conflicts, and no unresolved launch blockers.

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
confirmed.

### Resend

```text
WOA_EMAIL_PROVIDER=resend
RESEND_API_KEY=<private key>
WOA_EMAIL_FROM=WheelsonAuto <support@wheelsonauto.com>
WOA_EMAIL_REPLY_TO=wheelsonauto@gmail.com
RESEND_WEBHOOK_SECRET=<webhook signing secret>
```

Verify the `wheelsonauto.com` sending domain, complete an outbound receipt
test, and then verify an inbound reply webhook before relying on email as a
two-way inbox.

## 7. Enable the Launch Guard Last

After all the above checks are green, set:

```text
WOA_PRODUCTION_HARDENING_REQUIRED=1
```

On a future restart the service will refuse to start if transactional
PostgreSQL, encrypted private storage, Stripe live/webhook settings, a stable
session secret, or HTTPS public URL are missing. This is deliberate: it keeps a
partial configuration from quietly processing live money or private documents.

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
