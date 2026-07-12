# WheelsonAuto Platform Roadmap

Last updated: 2026-07-12

## 2026-07-12 Build Checkpoint

Current checkpoint is focused on tightening the platform, not redesigning it.

Completed in this build pass:

- Staff and customer password help flows are wired through Messages and owner follow-up.
- Daily closeout supports owner notes, owner signoff, frozen signoff snapshot, print, and email/draft notification.
- Deep reports now include safe Messages / communications rows without exposing passwords, hashes, tokens, card sources, or payment-source secrets.
- Daily closeout notification returns structured contact rows for failed-twice and payment-not-found customers with customer, amount, phone/email, vehicle, VIN, tag, and tracker evidence.
- Messages Queue now explicitly surfaces payment-not-found customers and enriches queue items with vehicle/VIN/tag/tracker context for search and Star drafting.
- Star queue drafts preserve customer phone/email context and still require admin approval for money/account actions.
- Clover dispute and claim possible matches now show phone, email, reference, autopay, Clover customer, VIN, tag, tracker, and match reason in both UI evidence and deep reports.
- API Roadmap provider records are owner-only, task-backed, and cannot be marked Connected without env-key names, endpoint, live-test plan, and last-test result.
- Star QA and the deep report now surface API provider readiness so outside systems stay visible until credentials, endpoint, live test, and last result are recorded.
- Clover disputes can now recover customer/vehicle evidence from claim text containing a customer name, VIN, tag, or saved reference when Clover does not provide a useful payment/customer ID.
- Star direct smoke checks now prove the owner off-switch works and saved-card charge requests cannot be approved/sent as normal AI replies without the proper money-action workflow.
- Marketing leads now have local search so lead/customer/vehicle/source/status filtering works inside the lead board instead of opening a separate search flow.
- API provider setup now keeps one Dispatch task synced per incomplete provider and auto-closes that task once credentials, endpoint, live-test plan, and live-test result are recorded as connected.
- Customer portal messages now triage money/card/autopay/toll/account requests as admin-review items with customer, vehicle, VIN/tag, payment amount, next charge, and approval context.
- Customer portal message history now hides internal Star drafts, AI plans, notifications, and internal logs so customer logins only show customer-submitted messages and actual staff replies.
- Mechanic Claims & Issues now filters out toll, Clover dispute, payment, reimbursement, and recovery records so mechanics only see vehicle issue work with VIN/tag/proof context.
- Main app and server-rendered pages now use a fresh asset version (`platform-20260712-deep-tighten-3`) so new UI/role fixes do not get stuck behind stale browser cache after deploy.
- Static UI regression checks now require account, company, API provider, and Dispatch task save flows to close their modals after successful saves.
- Backend Star QA, reports, and system health now include default API provider readiness rows even before any provider records are manually created, so Clover, SMS, email, EZPass, insurance, tracker, accounting, marketing, and billing gaps stay visible.
- Live-data protection now clearly reports when `data.json` has local business-data edits that are safely unstaged, instead of silently passing.
- Star QA, system health, readiness, and deep reports now surface open card setup/change links and pending Star approvals so unfinished customer card setup and AI review work cannot hide in Messages.
- Daily closeout notifications now include open card setup/change links and pending Star approvals with customer context, so end-of-day review catches unfinished card setup and AI approval work.
- Customer portal now exposes the logged-in customer’s open card setup/change links with a direct Set up card action while still scrubbing private payment tokens and internal fields.
- Star QA manager now prepends visible action cards for open card setup/change links and pending Star approvals, so admin and manager review screens do not hide unfinished card or AI approval work behind background counts.

Checks passed at this checkpoint:

- `pnpm run check`
- `pnpm run live-data-check`
- `node scripts/frontend-render-smoke-test.js`
- `node scripts/responsive-style-check.js`
- `node scripts/static-ui-check.js`
- `node scripts/server-direct-smoke-test.js`
- `node scripts/star-safety-check.js`

Live data status:

- `data.json` was not staged or committed.
- Live-data check has 0 errors.
- Known live-data warning: `2013 BMW 528XI` is missing VIN.

Publish status:

- Local branch is ahead of GitHub with committed code changes.
- Push from this environment was blocked by DNS/network policy and then escalated push was rejected.
- To publish from the Mac terminal when ready:
  `cd "/Users/khaled/Documents/Codex/2026-07-03/browser-plugin-browser-openai-bundled/work/wheelsonauto-platform-clean" && git push origin main`
- Render should deploy from GitHub after that push.

## Product Direction

WheelsonAuto should become a mobile-first operations platform for rent-to-own fleet work. It should feel faster, clearer, and more focused than iFleet, while keeping WheelsonAuto's own workflow.

Core priorities:

- daily payment command center
- customers connected to cars, recurring payments, maintenance, claims, and notes
- fleet records imported from the vehicle sheet
- in-lot cars separated from rented cars
- recurring autopay moved into WheelsonAuto over time
- clear paid, unpaid, failed, retry, and follow-up states
- mechanic-only account workflow for maintenance
- manager account workflow for fleet/customer operations without owner-level power
- company/store/subscription accounts for future separate fleets or clients
- mobile experience that employees can use comfortably from phones

## Account Model

The app should support different accounts, not just different pages:

- owner/admin account
- manager account
- mechanic account
- future company/store admin account
- future subscription client account

Each account should land on the right workspace and only see the data and actions it is allowed to use.

Future multi-company rules:

- each company has isolated customers, fleet, staff, Clover keys, files, reports, and billing
- owner/master admin can switch between companies
- staff only see the company/location assigned to them
- no outside subscription client should use the platform until auth, data isolation, audit logs, and billing are complete

## Current Built Sections

- Dashboard
- Today
- Customers
- Payments
- Applications
- Fleet
- Maintenance
- Claims & Issues
- Mechanic Portal
- Manager Portal
- Messages
- Reports
- Companies
- API Roadmap
- Settings

## Live Platform Map

Dashboard is the owner command center. It should open with money, today's payment work, priority queue, transactions, application count, and fleet status visible without hunting through menus.

Today is the daily payment board. It tracks possible money for the day, collected money, unpaid/open customers, failed attempts, and follow-up. It should answer one question fast: who paid, who did not, and who needs a message.

Payments is the recurring and transaction center. It should show active recurring customers, today's due customers, failed/retry customers, setup-needed customers, transaction history, manual paid/failed tracking, payment links, and saved-card charge actions.

Customers is the master customer file area. It replaces the old Contracts label. A customer file should connect contact info, vehicle, current plate/temp tag, old temp tag, tracker name, recurring payment, payment history, maintenance history, claims, notes, removal status, and future documents/e-sign.

Fleet is the car command area. Ready/in-lot cars stay first, rented/assigned cars stay visible underneath, and the Fleet command board shows missing tracker, missing tag, maintenance, old temp tags, and assigned-car issues.

Maintenance is the service system. It should only focus on cars that are out with customers or assigned, not in-lot inventory. It supports repair jobs, monthly inspection/oil change reminders, mechanic updates, service history, and reset-next-month behavior after completion.

Applications handles the customer intake pipeline. It should support active review, approval, denial/removal, approval message, contract handoff, selected car from the public website, and future e-sign/autopay setup.

Claims & Issues is recovery money. It tracks tolls, violations, tickets, damage, reimbursements, unpaid balances, payment links, mark-paid, follow-up dates, and future E-ZPass/Clover dispute feeds.

Messages is the communication queue. It should give copy-ready messages for failed payments, approved applicants, maintenance reminders, and claims. Future SMS API should send from the WheelsonAuto number.

Reports is the owner accounting and operating view. It should combine daily closeout, accounting control, failed payment risk, fleet snapshot, application pipeline, open recovery, repair exposure, and collected totals.

Mechanic Portal is a limited workspace. Mechanics should see maintenance jobs, assigned vehicle/customer info, due dates, notes, and done/update actions only.

Manager Portal is a limited operations workspace. Managers should see fleet, customers, applications, maintenance, claims, messages, and reports without owner-only Clover keys, staff control, company setup, or dangerous settings.

Companies prepares future separate stores or subscription clients. It is not full tenant isolation yet. It records accounts and staff assignment now; real isolation comes in the database/auth phase.

Settings controls Clover setup, website apply path, staff accounts, role access, and account readiness.

## Data Connection Rules

- Customer name matching must connect customers, contracts/customer files, recurring payments, payments, vehicles, claims, and maintenance.
- Vehicle sheet data is important source data and should not be thrown away. It should feed fleet, customer files, tracker names, temp tags, plates, oil changes, and maintenance status.
- In-lot cars belong in Fleet as inventory. Rented/assigned cars belong in customer files and should still appear in Fleet as a separate assigned section.
- Removed customers should leave the active payment/customer work but stay in history.
- Removing a customer from Clover recurring should not delete the WheelsonAuto customer file.
- WheelsonAuto recurring should become the long-term source of truth for autopay date control when cards are saved through WheelsonAuto/Clover ecommerce tokenization.
- No button should pretend an API exists. If the provider is not connected and live-tested, mark it API phase and keep the manual workflow functional.

## Portal And Permission Rules

- Owner can control payments, Clover/API settings, staff, companies, reports, and all records.
- Manager can run daily operations, update fleet/customer/application/maintenance/claim work, and use reports without API credentials or staff/company controls.
- Mechanic can only update maintenance work, see necessary vehicle/customer info, and log service notes.
- Future store/subscription accounts need hard data isolation before outside use: separate customers, cars, payments, Clover credentials, staff, reports, files, audit logs, and billing.
- Staff accounts should be created from Settings and disabled from Settings. No random user should be able to become a mechanic or manager.

## Future API Phases

- Clover disputes
- accounting and daily closeout
- reimbursements
- E-ZPass tolls and violations
- background checks
- insurance verification
- tracker/location provider
- marketing/follow-up systems
- SMS from WheelsonAuto number

## API Build Order

1. Clover hardening: payment sync, saved-card charging, disputes, refunds, payment status reconciliation, and error logging.
2. SMS: send approval, autopay setup, failed-payment, maintenance, and claim links from the business number.
3. E-ZPass/tolls: import tolls and violations, match plate to vehicle/customer, create claim/reimbursement balance, and track paid/unpaid.
4. Insurance/background checks: attach verification results and expiration reminders to applications and customer files.
5. Tracker/location: connect tracker provider, show current vehicle status, and flag location/late-payment risk.
6. Accounting exports: closeout report, monthly P&L by car, repairs, claims recovered, unpaid balances, taxes/fees, and CSV/PDF export.
7. Multi-company isolation and billing: separate data per store/client before selling subscriptions.

## Recovery Checklist

If work stops because the PC, internet, browser, or session drops:

1. Open this repo.
2. Run syntax checks for `app.js` and `server.js`.
3. Start the local preview with an admin PIN.
4. Test Dashboard, Today, Payments, Fleet, Maintenance, Mechanic Portal, Manager Portal, Messages, Companies, API Roadmap, and Settings.
5. Commit and push stable work to GitHub.
6. Let Render deploy from GitHub.
