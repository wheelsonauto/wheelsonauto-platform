# WheelsonAuto Platform

Rent-to-own platform prototype with public application page and owner dashboard.

Start command: `node server.js`

Public application route: `/apply`

Quality checks:
- `npm run check` verifies the main JavaScript files parse.
- `npm run smoke` starts a temporary local copy and checks login, staff roles, public applications, payment/card setup links, role-filtered state, messaging permissions, autopay updates/removal, payment-not-found tracking, state write guards, and payment API guards.
