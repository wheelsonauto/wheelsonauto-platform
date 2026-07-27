# WheelsonAuto Architecture Migration

## Objective

Move WheelsonAuto from a whole-state prototype architecture to a transactional operating platform without guessing live customer assignments or interrupting current production workflows.

## Required Invariants

- Every active rental has one immutable Rental File ID.
- One vehicle cannot have two active Rental Files.
- One customer cannot have two active Rental Files without an explicit future multi-vehicle policy.
- Payments, schedules, messages, tolls, service, claims, documents, pickup, return, and audit events reference the Rental File ID.
- Provider IDs, payment evidence, signed agreements, and historical assignments are never rewritten to resolve a display conflict.
- Money and account actions remain server-side commands with role checks, idempotency, and audit events.
- Existing `data.json` business records remain protected throughout the migration.

## Migration Sequence

1. Create Rental Files at verified physical pickup and backfill only unambiguous completed pickups.
2. Add organization-scoped Rental File list and detail APIs.
3. Replace whole-state client mutations with resource reads and typed action endpoints.
4. Publish one authenticated event stream for live message, application, payment, assignment, and notification updates.
5. Migrate Messages, Payments, Customer/Rental File, Operations, and Settings into a modular TypeScript frontend.
6. Persist normalized customers, vehicles, Rental Files, schedules, payment attempts, applications, messages, and audit events in PostgreSQL transactions.
7. Retire legacy render overrides and the generic `PUT /api/state` path after all callers have migrated.

## Release Gates

- Deterministic clock and isolated fixtures.
- Unit tests for rental lifecycle, billing schedule, identity, and assignment rules.
- API tests for permissions, idempotency, stale writes, and transaction rollback.
- Browser tests for customer onboarding, pickup, recurring billing, messages, vehicle swap, return, and reactivation.
- Responsive screenshots for phone, tablet, laptop, and wide desktop.
- Performance budgets for initial JavaScript, route data, render time, and interaction latency.
- PostgreSQL backup restoration and server restart recovery.
- Independent security review before completing the live customer migration.

## Implemented Checkpoints

- Canonical Rental Files now support organization-scoped reads, deterministic backfill of unambiguous completed pickups, and an atomic physical-return command.
- Customers, vehicles, and payments have paginated resource reads; customer contact and vehicle identity edits use optimistic locking and exact-ID propagation.
- Owner-confirmed payment results use an idempotent command that blocks duplicate billing periods, advances schedules once, records retry state, and creates linked receipt evidence.
- Transaction and claim matching use owner-only exact evidence commands; payment copies sharing one provider ID are updated together and same-name recurring plans remain distinct.
- Unassigned vehicle retirement is an assignment-safe command that blocks active Rental Files/autopay and unpublishes the exact public listing.
- The authenticated event stream now publishes targeted state topics, including message changes written by background jobs.
- The first React/TypeScript module is available at `/staff-next`; Messages uses bounded APIs and the event stream instead of bootstrapping the full platform state.
- PostgreSQL now maintains tenant-scoped, checksummed rows for critical resource payloads. Startup backfill, ordinary writes, and controlled snapshot recovery synchronize them in the same transaction as the authoritative state, snapshots, identity indexes, documents, and assignments.
- PostgreSQL readiness compares every normalized resource identity and payload checksum with authoritative state and rejects missing, changed, duplicated, or future-version rows.
- The recovery-drill contract is versioned for normalized-resource recovery; production must record a fresh passing drill from a separate test database before this checkpoint is treated as cutover-ready.

## Current Boundary

The normalized resource table is currently a transactionally verified migration projection while the full-state row remains the recovery envelope. The legacy shell still contains whole-state mutation paths for workflows that have not yet moved to typed commands. `PUT /api/state` remains a compatibility path and must not be removed until its remaining callers use scoped commands and the dedicated PostgreSQL cutover/recovery drill passes.
