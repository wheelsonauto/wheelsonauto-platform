# WheelsonAuto Platform Roadmap

Last updated: 2026-07-04

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

## Recovery Checklist

If work stops because the PC, internet, browser, or session drops:

1. Open this repo.
2. Run syntax checks for `app.js` and `server.js`.
3. Start the local preview with an admin PIN.
4. Test Dashboard, Today, Payments, Fleet, Maintenance, Mechanic Portal, Manager Portal, Messages, Companies, API Roadmap, and Settings.
5. Commit and push stable work to GitHub.
6. Let Render deploy from GitHub.
