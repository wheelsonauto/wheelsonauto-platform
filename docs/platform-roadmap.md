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
- Main app and server-rendered pages now use a fresh asset version (`platform-20260712-deep-tighten-6`) so new UI/role fixes do not get stuck behind stale browser cache after deploy.
- Static UI regression checks now require account, company, API provider, and Dispatch task save flows to close their modals after successful saves.
- Backend Star QA, reports, and system health now include default API provider readiness rows even before any provider records are manually created, so Clover, SMS, email, EZPass, insurance, tracker, accounting, marketing, and billing gaps stay visible.
- Live-data protection now clearly reports when `data.json` has local business-data edits that are safely unstaged, instead of silently passing.
- Star QA, system health, readiness, and deep reports now surface open card setup/change links and pending Star approvals so unfinished customer card setup and AI review work cannot hide in Messages.
- Daily closeout notifications now include open card setup/change links and pending Star approvals with customer context, so end-of-day review catches unfinished card setup and AI approval work.
- Customer portal now exposes the logged-in customer’s open card setup/change links with a direct Set up card action while still scrubbing private payment tokens and internal fields.
- Star QA manager now prepends visible action cards for open card setup/change links and pending Star approvals, so admin and manager review screens do not hide unfinished card or AI approval work behind background counts.
- Owner daily closeout signoff snapshots now freeze open card setup/change link counts and pending Star approval counts beside money, failed-payment, stale-link, verification, and vehicle-conflict counts.
- The visible Daily Closeout board now includes card setup link and Star approval rows plus summary reminders, so the day can be managed before signoff instead of only being audited afterward.
- Daily closeout notification messages now include those frozen card setup link and Star approval counts in the signed snapshot line, matching what the owner saw in the app at signoff time.
- Owner CSV/report exports now include Daily Closeout rows for open card setup links and pending Star approvals, keeping reports aligned with Dashboard, Messages, Star QA, and closeout signoff.
- Staff/owner and customer login now have an in-memory repeated-failure throttle with clear retry guidance, adding a basic brute-force brake without changing live account data.
- Staff/owner and customer sessions now use signed v2 cookies with a private HMAC secret, so browser-side cookie tampering cannot change a role, customer, or company identity.
- System health/readiness now flags missing `WOA_SESSION_SECRET`/`WOA_COOKIE_SECRET` so Render can be configured with a stable private signing secret for staff and customer sessions.
- Owner deep reports now include the same signed-session secret setup warning, keeping Star QA exports aligned with system health and readiness before production deploy.
- Autopay schedule updates and removals now re-run the linked profile truth layer before saving, so customer, vehicle, service, and payment context stays connected after admin changes.
- Failed saved-card charges now create named failed transaction records with customer, vehicle, VIN/tag, amount, attempt count, notes, and status, so Transactions, Closeout, Reports, and Star can track 1x/2x failures without guessing.
- Manager/mechanic reads now scope records to the assigned company before profile enrichment, preventing same-name customers across future franchise/subscription accounts from borrowing another company’s vehicle/contact/payment context.
- Customer portal payment history now strips internal Clover IDs, charge references, and raw error details while still showing a clear customer-safe failed/not-found status note.
- View-surface checks now lock that customer-portal payment privacy rule so future UI/backend edits cannot accidentally expose raw Clover IDs or decline errors to customer logins.
- Manual outbound messages and Star draft/approval rows now carry company, customer-file, recurring, vehicle, VIN/tag, tracker, amount, and frequency context, and same-name customers prefer the signed-in company before future franchise/subscription records.
- Tracker evidence now normalizes `tracker`, `gps`, and related device fields across closeout, reports, Star context, customer portal submissions, payment/card links, service, claims, and messages so imported sheet tracker names do not disappear.
- Staff direct saves now force every incoming manager/mechanic row onto the signed-in staff company, blocking spoofed `organizationId` payloads from writing into another company while preserving owner-wide data.
- Staff, customer, and account password changes now share one password policy requiring at least 8 characters plus a letter and number before any password hash is created.
- Staff PIN-only login is now disabled by default; manager/mechanic accounts require username/password while owner PIN remains the separate backup path.
- Manual customer SMS/email sends, drafts, and provider failures now create owner audit-log rows with customer, channel, status, and vehicle/VIN context so communication actions are traceable.
- Star draft creation now writes owner audit-log rows for normal replies, approval-needed drafts, human-review drafts, and safe payment/card setup link prep with customer, channel, action, and vehicle/VIN context.
- Customer portal messages, paid-outside reports, service requests, issue/toll reports, document updates, and card-change link openings now write owner audit-log rows with customer and vehicle/VIN/tag context.
- Static UI checks now block placeholder `href="#"`, `javascript:void`, and not-implemented controls so visible buttons must be wired, save a draft, or route honestly to setup.
- Staff and customer password-help requests now write owner audit-log rows showing matched/not-matched status, keeping login recovery visible without storing password material.
- Daily closeout summaries now return structured sensitive-change audit rows, not just a text section, so Star/UI/report checks can review exactly what changed today.
- Star now treats receipt requests as their own approval-required payment action instead of mixing them into toll/claim handling, and normal AI reply approval cannot send receipts without admin payment confirmation.
- System health/readiness now includes `WOA_MESSAGING_WEBHOOK_SECRET` coverage so live SMS/email inbound webhooks are flagged before provider setup goes production.
- System health/readiness now includes `CLOVER_WEBHOOK_SECRET` / `WOA_CLOVER_WEBHOOK_SECRET` coverage so Clover webhook auto-sync is not treated as production-ready without a shared secret.

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
