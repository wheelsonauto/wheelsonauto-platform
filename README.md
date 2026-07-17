# WheelsonAuto Platform

Rent-to-own platform prototype with public application page and owner dashboard.

Start command: `node server.js`

Public application route: `/apply`

Quality checks:
- `npm run check` verifies the main JavaScript files parse and visible UI actions have handlers.
- `npm run ui-check` scans visible dashboard buttons for missing action handlers, checks static navigation targets, and warns about duplicate frontend helper definitions.
- `npm run data-check` checks seed data links between customers, vehicles, recurring payments, payments, and maintenance. Run `node scripts/data-consistency-check.js data.json` to inspect local/live data without editing it.
- `npm run smoke` starts a temporary local copy and checks login, staff roles, public applications, payment/card setup links, role-filtered state, messaging permissions, autopay updates/removal, payment-not-found tracking, state write guards, and payment API guards.

Production launch:
- Read [Production Stripe Launch Runbook](docs/production-stripe-launch.md) before enabling PostgreSQL, encrypted private storage, Stripe live payments, or production hardening.
- `data.json` contains live business records in this workspace. Keep it unstaged and uncommitted; use the runbook's controlled import/rollback process instead of copying it into a code release.
