# iFleet Browser Source and Architecture Audit

Audit date: July 25, 2026

## Purpose

This document preserves a deep technical and functional study of the iFleet web application so the useful architectural ideas can inform WheelsonAuto without repeatedly reverse-engineering the same product.

This is an audit of code and assets that iFleet intentionally ships to a signed-in browser. It is not access to iFleet's private repository, database, server source, infrastructure secrets, or unpublished business logic. Production JavaScript is minified and no source maps were exposed, so original TypeScript filenames and names cannot always be recovered. Conclusions below distinguish direct evidence from inference.

## Audit Scope

The inspected browser payload covered:

- 28 signed-in/public route documents.
- 31 unique Next.js app route and layout bundles, totaling 1,591,166 raw bytes.
- 53 shared JavaScript chunks, totaling 1,741,881 raw bytes.
- 2 lazy-loaded Leaflet map chunks, totaling 155,425 raw bytes.
- 2 application CSS files, totaling 139,419 raw bytes.
- 2 WOFF2 font assets.
- External integration entry points for Stripe.js and Intercom.
- 345 distinct literal HTTP method/path pairs in the centralized API layer.
- All visible query keys, mutation patterns, route labels, workflow text, integration settings, responsive navigation rules, and design tokens present in those files.

Total inspected first-party JavaScript was about 3.49 MB before network compression. A fresh route loads only its route-specific subset because Next.js code-splits the application.

## High-Level Architecture

iFleet is a Next.js App Router application deployed through Vercel. It uses route groups for the main operator dashboard and the separate website builder:

```text
app/
  (dashboard)/
    layout
    dashboard
    bookings
    calendar
    fleet
    tracking
    communications
    automations
    leads
    stripe
    collections
    disputes
    maintenance
    claims
    tolls
    charging
    website
    marketing
    accounting
    reports
    community
    settings
    support
  (builder)/
    layout
    website-builder
  help
  layout
```

The strongest product-level relationship is:

```text
lead/customer -> booking -> vehicle -> payment/deposit
              -> contract/insurance/verification
              -> pickup/active rental/return
              -> maintenance/claim/toll/charging
              -> collection/dispute/accounting/reporting
```

That connected record chain is more important than any single screen. It allows activity from one workflow to appear in the other operational areas without manually re-entering customer, vehicle, or booking identity.

## Frontend Stack

Directly observed in compiled browser files:

- Next.js App Router and Webpack chunk loading.
- React function components and hooks.
- Tailwind CSS utility classes.
- CSS-variable color tokens in the style of shadcn/ui.
- Radix UI primitives for dialogs, focus management, overlays, and accessible interaction.
- Class Variance Authority-style component variants.
- `tailwind-merge` for class conflict resolution.
- Lucide icons.
- TanStack Query for server-state caching, mutations, invalidation, polling, and prefetching.
- Zustand with persistence for authentication and selected UI state.
- Axios for the centralized HTTP client.
- Socket.IO for server event delivery and query-cache invalidation.
- Sonner for toast notifications.
- Recharts for dashboard/financial charts.
- Leaflet for tracking maps.
- dnd-kit-style primitives for drag-and-drop UI.
- Stripe.js and Stripe Connect entry points.
- Plaid Link integration entry points.
- Intercom Messenger with a server-issued JWT.

No browser source maps or embedded `sourcesContent` were exposed. The shipped code is production-minified but still reveals component structure, API contracts, query keys, workflow rules, and user-facing copy.

## API Client and Data Contract

The frontend uses a central Axios client with:

- Base URL: `https://api.ifleet.tech/api/v1`.
- Default JSON content type.
- A 60-second request timeout.
- Automatic removal of `Content-Type` for `FormData` uploads.
- Bearer authorization from the active access token.
- A separate unauthenticated API client for public flows.
- Standard response unwrapping through `response.data.data`.
- A tagged timeout error used by the UI to warn that a timed-out write may still have saved.

On a 401 response, the client:

1. Excludes login, refresh, and demo-login requests from refresh handling.
2. Marks the original request to prevent an infinite retry loop.
3. Uses one shared refresh promise so simultaneous 401s do not issue duplicate refresh calls.
4. Stores the replacement access and refresh tokens.
5. Replays the original request with the new bearer token.
6. Clears authentication and returns to login if refresh fails.

This is a clean client contract. The especially useful patterns for WheelsonAuto are the single response shape, one refresh operation for concurrent failures, upload-aware headers, and an explicit timeout state that acknowledges ambiguous writes.

## Authentication and Session State

Observed authentication behavior:

- Zustand persists `user`, `operator`, and `isAuthenticated` under `ifleet-auth`.
- The access token is stored in a secure, SameSite Strict browser cookie for 1/96 of a day, approximately 15 minutes.
- The refresh token is stored in a secure, SameSite Strict browser cookie for 30 days.
- Authentication clear also clears TanStack Query data.
- An impersonated session does not persist the normal auth store snapshot.
- Impersonation tokens and session IDs are stored in `sessionStorage`.
- The dashboard decodes the JWT client-side to show impersonation expiration and remaining minutes.
- Super-admin users are routed to the separate admin surface unless actively impersonating an operator.
- Active impersonation shows a prominent red monitoring banner and provides an explicit server-side session-ending request.

Security note: the cookies are secure and SameSite Strict, but the tokens are set and read by JavaScript, so they are not HttpOnly. That increases the impact of a successful XSS attack. This observation does not prove an exploitable XSS exists, and server-side authorization could not be audited from browser code.

## Query and Real-Time Architecture

The root QueryClient defaults are:

- Five-minute stale time.
- One automatic retry for queries.

Pages override those defaults where needed. Examples include 30-second support/community polling and 60-second status/announcement polling.

The dashboard layout also opens a Socket.IO connection to the `/realtime` namespace using WebSocket transport, five reconnection attempts, and a two-second reconnection delay. Server events invalidate named TanStack Query caches:

| Event | Invalidated data |
| --- | --- |
| `customer:created` | CRM customers, inquiries, operator counts |
| `customer:updated` | CRM customers, inquiries |
| `customer:deleted` | CRM customers |
| `booking:created` | Bookings, inquiries, admin bookings, operator counts |
| `booking:updated` | Bookings, inquiries, admin bookings, operator counts |
| `claim:created` | Claims, operator counts |
| `claim:updated` | Claims, operator counts |
| `maintenance:created` | Maintenance, operator counts |
| `maintenance:updated` | Maintenance, operator counts |
| `operator:status_changed` | Admin operator lists/details |
| `impersonation:started` | Admin operator sessions |
| `impersonation:ended` | Admin operator sessions |

This is the mechanism that lets separate pages update without a full refresh. Not every domain is represented in this event table, so communications, support, community, and some integrations still use polling or direct query invalidation.

The sidebar prefetches key route data on hover. It preloads booking, fleet, customer, and related data with the same query keys the destination pages use. This makes navigation feel faster while preserving one cache identity.

## API Surface Summary

The central API module contains at least 345 literal method/path pairs. Dynamic suffixes make the effective route count larger.

| API area | Observed method/path pairs | Purpose |
| --- | ---: | --- |
| Operator-scoped `/operators/me/*` | 193 | Fleet, bookings, customers, settings, payments, integrations, website, accounting, contracts |
| Platform admin `/admin/*` | 50 | Operators, users, sessions, disputes, support, community, status, broadcasts, audit logs |
| Community | 24 | Channels, posts, comments, DMs, members, notifications, profile |
| Telematics | 19 | Tesla, Bouncie, One Step GPS, vehicles, trips, charging |
| Bookings/public portal | 10 | Create, verify, portal actions, updates, cancellation |
| Claims | 10 | Claims, tasks, people, contacts, bulk deletion |
| Authentication | 8 | Register, login, refresh, logout, recovery, current user |
| Collections | 7 | List, counts, create, edit, delete, collection actions |
| Automations | 7 | Rules, updates, deletion, executions, tests |
| Billing | 5 | Subscription checkout, billing portal, subscription confirmation |
| Support | 5 | Ticket creation, listing, replies, unread counts |
| Google Ads | 4 | Connect, status, campaign data, disconnect |
| Contract signing | 2 | Read and submit signed agreement |
| Marketing inquiry | 1 | Submit marketing-service inquiry |

Major backend capability groups visible in the client include:

- Vehicles, classes, photos, availability, date blocks, bulk import/update/delete, VIN decoding, Turo feeds, and soft-delete restoration.
- Bookings, estimates, deposits, contract readiness, portal links, card-on-file charges, extensions, date changes, returns, vehicle replacement, invoices, refunds, and recurring billing.
- Customers, CRM stages, notes, tags, blacklisting, imports, documents, activity, and portal access.
- Stripe Connect, payouts, recent payments, direct account connection, disconnect, charges, refunds, disputes, and wallet funding.
- Claims, tasks, contacts, damage records, collections, proof, and reimbursement.
- TollSpot registration, fleet reconciliation, plate-state repair, sync, review, held/unbilled charges, and markup.
- Tesla Supercharging sessions, fleet controls, markup, and auto-billing.
- Contract templates, previews, defaults, system templates, readiness checks, signature, and signed documents.
- License photos, identity verification, insurance prevalidation/verification/manual proof, background checks, and supporting documents.
- Gmail/custom-domain email, inbox, archive, replies, resend logs, SMS providers, templates, media, conversations, and webhooks.
- Plaid connections, accounting transactions, imports, categories, rules, owners, statements, and reports.
- Public booking site, custom pages, page builder, images, custom domain verification, publish/unpublish, and embeds.

## Route-by-Route Findings

### Dashboard

- KPI model includes total cars, rented cars, revenue, overdue balance, utilization, customers, active bookings, and maintenance cost.
- Time filters include today, 7/30/90 days, year, and previous-period comparison.
- It exposes pending-review bookings and pending deposit releases as actionable queues.
- Charts include 12-month revenue, fleet status, and overdue payments.
- It checks Stripe readiness and blocks the assumption that customers can pay before Stripe is connected.

### Reservations and Booking Lifecycle

- Manual reservation flow is a five-step wizard: dates/location, vehicle, extras, customer, review/send.
- Supports daily, weekly, and monthly billing cadence.
- Availability searches use pickup/return date and time, location, vehicle/class, and pricing estimates.
- Existing customer search is integrated into reservation creation.
- Verification links expire after seven days.
- Booking actions exposed by the API include approve/reject, cancel, pickup, return, extend, early return, replace vehicle, modify dates, resend verification, send invoices, charge, collect cash, refund, retry, and portal-link creation.
- Deposit workflows include holds, capture/refund, pending releases, and immediate release actions.
- The bundled help text says the live public checkout confirms a completed checkout automatically; it does not currently wait in a manual approval queue.
- Bonzah-bound bookings cannot move pickup earlier.
- Repricing anchors to what the renter paid for existing nights rather than repricing the complete stay at current rates.

### Calendar and Pricing

- Fleet availability calendar supports search, today navigation, date-range selection, drag-to-price, blocked dates, and class grouping.
- Dynamic pricing supports highest, lowest, and last-minute floor prices.
- Weekend surcharge applies Friday through Sunday.
- Pricing slides from highest at 30+ days out toward lowest at pickup, with optional last-minute floor behavior.
- Bulk weekend surcharge and vehicle-specific override actions are supported.

### Fleet

- Supports individual vehicles and vehicle classes.
- Core identity includes VIN, plate, plate state, odometer, color, display name, acquisition cost, location, rates, deposit, mileage limits, age, transmission, and fuel.
- Photo operations include upload, delete, and primary-photo selection.
- Bulk CSV import validates a fixed seven-column schema and reports skipped rows with reasons.
- VIN decoding uses NHTSA-backed data according to the bundled help content.
- Bulk actions cover class assignment, status, pricing, pickup locations, protection options, updates, and deletion.
- Soft-deleted vehicles can be listed and restored.
- Maintenance can delist a vehicle until all delisting service needs are resolved.
- A vehicle marked rented today can remain available for a non-overlapping future date range.
- Vehicle replacement is limited to draft, pending-review, approved, or active bookings.

### Tracking

- Provider model supports Tesla, Bouncie, and One Step GPS, with Zubie shown as not connected/coming later.
- Fleet view includes live status, location, speed, provider, last update, mileage, and trip history.
- Map rendering uses Leaflet and lazy-loads the map engine and vehicle popup code.
- Tesla provides location, state of charge, and mileage.
- Bouncie is described as an OBD-II source for GPS, trips, speed, and fault codes.
- One Step GPS is connected through an API key.

### Communications

- Unified page contains Gmail/custom-domain email and SMS/iMessage-style conversations.
- Email supports inbox, archive, read state, selected-message view, compose, reply, and resend logs.
- SMS supports conversation list, selected conversation, templates, media upload, new contact, and send.
- Composer supports Enter to send and Shift+Enter for newline.
- The page uses polling for some message queries and invalidates 16 query groups across send/update actions.
- Provider options in Settings are managed Twilio, Project Blue, or Quo.
- Quo keys are described as encrypted with AES-256-GCM, and webhook signing/configuration is part of setup.
- A2P/10DLC approval is treated as a delivery requirement, not hidden from the operator.

### Automations

- Custom automation actions include email, SMS, tags, and webhooks.
- Built-in event automations include declined booking, completed-rental invoice, pickup/active notice, extension notice, early-return notice, new-lead greeting, and cancellation notice.
- Built-in automations can be toggled; custom rules can be created, updated, deleted, run, and tested.
- This is deterministic event/action automation, not an autonomous AI agent.

### CRM and Customers

- Customer table includes contact details, booking count, lifetime spend, tags, status, joined date, active state, and blacklist state.
- Lead pipeline stages are New, Called Once, Called Twice, Lost, and Converted.
- Contacts can be added manually or imported from CSV.
- Import supports first/last name, email, phone, city, state, tags, and CRM status.
- Turo historical customer import is supported through a provided script, with duplicate skipping.
- Customers are automatically created from completed booking activity.

### Payments and Stripe

- Uses Stripe Connect and supports direct payouts through an operator-owned Stripe account.
- Shows charges enabled, payouts enabled, requirements due, account status, recent reservation payments, and a Stripe Dashboard shortcut.
- Client API includes card-on-file setup, charge-now, checkout sessions, payment intents, cash payments, booking charges, refunds, payment links, plans/installments, and recurring-payment actions.
- Payment and booking identities remain connected through booking/customer/vehicle relationships.

### Collections and Disputes

- Collection categories include damage, outstanding balance, incidental, and other.
- New collections are attached to a reservation and customer/vehicle context.
- Internal notes, damage type, amount, proof, charges, retries, invoices, payment links, auto-charge, and write-off-style state changes are represented in the API.
- Stripe dispute states include inquiry needs response, inquiry under review, inquiry closed, needs response, under review, refunded, won, and lost.
- Admin and operator dispute endpoints are separate.

### Maintenance

- Service needs support open, in progress, snoozed, closed, and reopened states.
- Records link vehicle, type, reported date, vendor, clearance ETA, estimated cost, odometer, and notes.
- Actions include create, update, status changes, close/reopen, snooze, and delete.
- Maintenance records can remove a vehicle from the rentable pool.
- The documented behavior does not automatically close overdue work; it remains open until staff closes it.

### Claims

- Claim creation begins with vehicle selection and search by name, plate, or VIN.
- Captures status, detailed status, external reference, source, assigned user, damage notes, deductible, max out-of-pocket, and current location.
- Can mark a vehicle inactive on claim creation.
- Includes tasks, assignees, due dates, people, contacts, notes, documents, proof, estimates, payments, and status transitions.
- Claim status can move into collections or closed states.

### Tolls and Supercharging

- TollSpot integration reconciles the local fleet against provider registration.
- It can refresh registration, backfill plate state, sync charges, review held/unbilled items, and enable/disable vehicle toll handling.
- Markup can be applied to toll cost.
- Held tolls can be manually moved into a booking collection.
- Tesla Supercharging captures sessions per trip and supports per-vehicle auto-bill plus markup.
- The UI honestly reports missing provider configuration instead of pretending the feature is active.

### Website and Website Builder

- Public booking site can be published/unpublished and opened from the operator dashboard.
- Supports custom domains through CNAME/A records and TXT ownership verification.
- Provides an embeddable booking widget for existing sites.
- Builder has desktop/tablet/mobile preview, pages, sections, drag-and-drop, templates, undo/redo, theme colors, fonts, images, and publish state.
- Unsaved and unpublished changes are distinguished.
- Root-domain instructions reference Vercel's `76.76.21.21` A record.

### Marketing

- Google Ads OAuth connection and campaign display exist.
- Facebook/Instagram is presented in the service inquiry but not as a connected dashboard integration.
- The current marketing product includes a guided service inquiry and onboarding-call flow.

### Accounting

- Plaid connects bank accounts and imports historical transaction ranges.
- Overview metrics are revenue, expenses, net income, uncategorized transactions, fleet vehicles, owners, and accounts.
- Transaction workflow includes categorization, custom categories, automatic rules, imports, manual transactions, split/ignore-style operations, sync, and deletion.
- Fleet financials include vehicle summaries, owner assignments, owner statements, profit/loss, and vehicle profitability.
- Accounting is one of the most complex client pages: 55 query declarations and 19 mutation declarations were observed.

### Reports

- Revenue by vehicle and time period.
- Taxes collected.
- Security deposits.
- Toll transactions.
- Utilization, idle time, and revenue per available vehicle day.
- Booking volume and upcoming bookings.
- Mileage, damage claims, and maintenance downtime.
- Export actions are exposed from the reporting UI.

### Community, Help, and Support

- Community has channels, posts, comments, reactions, follow/mute, DMs, members, leaderboard, profile, notifications, and email preferences.
- Demo mode is intentionally read-only for posting and messaging.
- Help is a large in-app handbook covering every operational domain and many edge cases.
- Support has categories, priorities, ticket history, replies, unread counts, and open/completed states.
- Intercom is also initialized with a short-lived server-issued messenger JWT.

### Settings

Settings is a very large single route bundle containing general, communication, booking, pricing, wallet, insurance, renter rules, integrations, and account sections.

Observed settings capabilities include:

- Business identity, logo, email, phone, legal/compliance details, pickup locations, state/timezone mapping, and team.
- Gmail/custom-domain email and domain verification.
- SMS provider provisioning, 10DLC, Quo webhooks/signing keys, templates, media, and provider switching.
- Add-ons, vehicle classes, pickup windows, minimum booking notice, rates, deposits, discount codes, and dynamic pricing.
- Wallet card setup, top-up, auto top-up, credit ledger, and paid-integration funding.
- SambaSafety background checks and MVR/court-record selection.
- MeasureOne insurance verification.
- Bonzah, self-provided insurance, ABI Period Z, manual proof, and no-insurance modes.
- Contract templates and system contract fallback.
- Renter extension and early-return permissions.
- Turo listing IDs, calendar/webhook token, and customer-import helpers.
- Stripe connection and subscription/billing management.

The route's size and state count make it a maintenance hotspot. WheelsonAuto should preserve the clean settings categories but split each category into its own route or lazy-loaded feature module.

## Responsive and Navigation Strategy

Desktop navigation uses a 220-pixel sidebar with grouped items, expandable nested sections, counters, pinned items, right-click pin/unpin, and data prefetch on hover.

Desktop primary navigation contains:

- Dashboard
- Reservations
- Calendar
- Fleet
- Tracking
- Communications / Automations
- CRM
- Payments / Collections / Disputes
- Maintenance
- Claims
- Reimbursement / Tolls / Supercharging
- My Website
- Marketing
- Accounting
- Reports
- Community

Settings navigation adds General, Appearance, Widget, Help Center, and Support.

Mobile behavior changes at 767 pixels and uses four bottom tabs:

- Reservations
- Inbox
- Fleet
- Settings

Calendar is folded into Reservations. The desktop `/fleet` route redirects to `/fleet/mobile`. Unsupported mobile routes are redirected back to Reservations. This keeps the mobile surface compact, but it also means mobile operators cannot directly use the entire desktop feature set. WheelsonAuto should borrow the compact bottom navigation but keep critical workflows reachable through drill-down screens instead of route denial.

The mobile bottom nav includes safe-area padding. The application shell uses a fixed-height flex layout with controlled inner scrolling, avoiding whole-page layout shifts.

## Design System

The CSS token system uses HSL variables.

Light theme highlights:

- Background: `220 20% 96%`.
- Card: white.
- Primary: `145 80% 30%`.
- Destructive: `0 84.2% 60.2%`.
- Base radius: `0.5rem`.

Dark theme highlights:

- Background: `0 0% 7%`.
- Card: `0 0% 9%`.
- Popover: `0 0% 14%`.
- Secondary/muted: `0 0% 16%`.
- Border: `0 0% 15%`.
- Primary: `144 100% 50%`.

The shared Button supports default, destructive, outline, secondary, ghost, and link variants plus default, small, large, and icon sizes. It includes focus rings, disabled state, loading state, `aria-busy`, and a spinner.

Dialogs use Radix focus trapping, an 80% black overlay, centered responsive content, entrance/exit animation, and accessible close behavior. Cards generally use an 8-pixel radius, border, card token, and restrained shadow, although some feature pages introduce 12-pixel cards and modals.

The visual language is functional rather than decorative: neutral surfaces, compact navigation, small labels, status colors, restrained primary green, and consistent interaction states.

## Performance Findings

Approximate raw JavaScript loaded by a direct route visit, before Brotli/gzip compression:

| Route | Scripts | Raw JS |
| --- | ---: | ---: |
| Dashboard | 25 | 1,286 KiB |
| Settings | 27 | 1,131 KiB |
| Accounting | 27 | 1,065 KiB |
| Bookings | 27 | 1,039 KiB |
| Fleet | 28 | 1,019 KiB |
| Community | 29 | 993 KiB |
| Claims | 26 | 952 KiB |
| Collections | 27 | 947 KiB |
| Maintenance | 26 | 945 KiB |
| Leads | 26 | 943 KiB |
| Communications | 24 | 922 KiB |
| Support | 25 | 911 KiB |
| Tolls | 25 | 901 KiB |
| Charging | 26 | 900 KiB |
| Calendar | 23 | 896 KiB |
| Stripe | 24 | 894 KiB |
| Tracking | 26 | 894 KiB |
| Website | 26 | 885 KiB |
| Reports | 23 | 864 KiB |
| Marketing | 23 | 859 KiB |
| Automations | 23 | 859 KiB |
| Disputes | 23 | 856 KiB |
| Widget | 24 | 853 KiB |
| Tracking Connect | 22 | 854 KiB |
| Customers | 22 | 840 KiB |
| Appearance | 22 | 839 KiB |
| Website Builder | 18 | 806 KiB |
| Help | 13 | 784 KiB |

Positive performance choices:

- Route-level code splitting.
- Lazy-loaded Leaflet map code.
- Five-minute default server-state freshness.
- Hover prefetch using destination query keys.
- WebSocket cache invalidation instead of full-page refresh.
- Query cache clearing on logout/account change.

Potential hotspots:

- Recharts shared chunk is about 380 KB raw.
- Settings is about 243 KB as a route bundle and contains many independent feature panels.
- Help is about 256 KB because the handbook content ships in the client bundle.
- Accounting, Bookings, Fleet, and Communications are large stateful pages.
- Some data uses polling even when a real-time transport exists.

## Engineering Strengths

- One centralized API client and consistent response unwrapping.
- Domain-specific API objects instead of scattered raw fetch calls.
- Shared query keys across prefetch, screen reads, and invalidation.
- Explicit status queues rather than one generic list.
- Workflow actions stay attached to booking/customer/vehicle identity.
- Real-time updates are event-driven and narrowly invalidate affected data.
- Provider-not-configured states are visible and honest.
- Bulk imports report row-specific errors and skip reasons.
- Soft deletion and restoration exist for important fleet records.
- Admin impersonation is visually obvious and monitored.
- Accessibility primitives, focus rings, aria labels, and keyboard shortcuts are built into shared controls.
- The in-app help describes edge cases, not only happy paths.

## Engineering Weaknesses and Risks

- Authentication tokens are JavaScript-readable cookies. HttpOnly server-set cookies would reduce XSS impact.
- Settings is a monolithic feature bundle with 82 query declarations and 54 mutation declarations.
- Several pages are also large, highly stateful client components instead of smaller route/subfeature modules.
- The mobile app hides or redirects many desktop workflows rather than exposing a complete drill-down path.
- The real-time event table covers only part of the product; messaging and community still rely on polling/direct invalidation.
- The 60-second write timeout can leave an ambiguous save state; the UI warns about it, but idempotency and operation-status endpoints are still required server-side.
- Help content is compiled into a very large browser bundle instead of fetched article-by-article.
- Provider breadth increases operational complexity and failure modes.
- No source map means this audit cannot verify TypeScript types, test coverage, database transactions, authorization middleware, queue guarantees, webhook idempotency, or secret handling beyond visible client behavior.

## Patterns WheelsonAuto Should Adopt

1. Use one canonical customer, vehicle, agreement, and payment identity across every module.
2. Put API calls in domain clients, not inside view code.
3. Use stable query keys and invalidate the exact affected records after every mutation.
4. Add server events for customer, assignment, payment, message, document, maintenance, claim, toll, and application updates.
5. Prefetch likely destination data on hover/touch intent.
6. Give writes idempotency keys and operation-status records so a timeout can be resolved without duplicate action.
7. Keep visible queues for new applications, scheduled pickups, failed payments, document review, maintenance, claims, and messages.
8. Use soft deletion, recovery history, audit events, and assignment history for business records.
9. Keep provider setup states honest and separate from working in-app drafts/manual workflows.
10. Use a compact mobile bottom navigation with full drill-down access, safe-area handling, keyboard-aware composers, and no hidden critical work.
11. Split settings and other high-complexity pages into route-level feature modules.
12. Keep dangerous actions explicit, monitored, and visually distinct.

## Patterns WheelsonAuto Should Avoid

- Copying the full iFleet sidebar or exposing every integration as a top-level tab.
- Storing payment/customer truth separately in multiple screens.
- Using route redirects to make mobile features disappear.
- Building one giant Settings or Operations component.
- Polling every page when server events can invalidate the affected cache.
- Treating a client timeout as a confirmed failure and repeating a money action.
- Storing long-lived credentials where browser JavaScript can read them.
- Making external provider setup a prerequisite for internal drafts, review, and manual operations.
- Shipping large help/reference content in the initial application bundle.

## Recommended WheelsonAuto Target Architecture

```text
PostgreSQL truth layer
  customers
  customer_accounts
  vehicles
  vehicle_assignments
  applications
  agreements/signatures
  payment_schedules
  payment_attempts
  transactions/refunds/disputes
  messages/threads
  documents/evidence
  maintenance/inspections
  claims/tolls/violations
  audit_events/outbox_events

Domain services
  customer service
  fleet/assignment service
  onboarding service
  payment service
  messaging service
  document service
  operations service

Provider adapters
  Stripe
  Resend
  OpenAI/Star
  private object storage
  optional SMS/GPS/background-check providers

Realtime/event layer
  database transaction -> outbox event -> WebSocket/SSE -> exact cache invalidation

Clients
  admin
  manager
  mechanic
  customer
```

The important difference is that provider adapters remain replaceable. Stripe, Resend, GPS, SMS, and AI should not own WheelsonAuto's customer, vehicle, schedule, or transaction truth.

## Public Bundle Manifest

### App route and layout bundles reviewed

- Accounting
- Appearance
- Automations
- Bookings
- Builder layout
- Calendar
- Charging
- Claims
- Collections
- Communications
- Community
- Customers
- Dashboard layout
- Dashboard
- Disputes
- Fleet
- Help
- Leads
- Maintenance
- Marketing
- Reports
- Root layout
- Settings
- Stripe
- Support
- Tolls
- Tracking connect
- Tracking
- Website builder
- Website
- Widget

### Shared chunks reviewed

The 53 shared files included these chunk identifiers:

```text
199, 2117, 2414, 2972, 3145, 3341, 3409, 3825, 3927, 4043,
4438, 4528, 4586, 4747, 4906, 5021, 5700, 5710, 5883, 5981,
6137, 6147, 6413, 6427, 6452, 6566, 6631, 6915, 6962, 724,
7502, 7514, 7676, 7697, 781, 7935, 8237, 825, 8324, 8352,
8528, 9032, 9485, 9984, 1113, 1188, 1200, 1561,
fd9d1056, main-app, polyfills, webpack
```

Major identified ownership:

- `fd9d1056`: React runtime.
- `2117`: React/Next runtime.
- `8237`: Axios and cookie utility.
- `8528`: central API client and domain API methods.
- `5021` and `7502`: TanStack Query core/runtime.
- `5883`: Zustand and persistence middleware.
- `6147`: Socket.IO and Intercom support.
- `4438`: Sonner toasts.
- `6137`: Tailwind class merging.
- `7514`, `9485`, `6413`, `825`, `1561`: Radix/accessibility primitives.
- `7697`, `4586`, `724`: Lucide icon modules and supporting UI.
- `6427`: Recharts/charting implementation.
- `6915`: drag-and-drop and UI primitives.
- `3927`: date utility functions.
- `webpack`, `main-app`, `polyfills`: Next/Webpack bootstrap and compatibility runtime.

### Additional assets reviewed

- Two global CSS bundles and their light/dark design tokens.
- Two WOFF2 font files as binary font assets.
- Leaflet core lazy chunk.
- Leaflet vehicle-map UI lazy chunk.
- External Stripe.js loader reference.
- External Intercom widget loader reference.

## Final Boundary

This audit is sufficient to learn iFleet's browser architecture, coding conventions, route structure, UI system, query strategy, API contract shape, and visible workflow design. It cannot prove the safety or correctness of iFleet's private backend implementation. WheelsonAuto should use these findings as product and architecture reference, then implement its own database constraints, authorization, audit logs, idempotency, webhook verification, encrypted storage, backups, and recovery tests.
