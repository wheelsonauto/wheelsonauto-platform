# Turo Frontend and Product Architecture Audit

Audit date: July 26, 2026

## Purpose

This document preserves a separate technical and functional study of Turo so its strongest product, interaction, and frontend architecture ideas can inform WheelsonAuto without mixing them into the iFleet audit.

The useful lesson is not to copy Turo's proprietary code or visual identity. It is to understand how a mature two-sided vehicle marketplace organizes complex work, keeps the primary screens calm, and reveals detailed actions only when a user enters the relevant trip, vehicle, conversation, invoice, or claim.

## Scope and Evidence Boundary

The audit uses four evidence levels:

1. **Confirmed frontend stack**: Current Turo engineering job descriptions identify the production web stack and design-system tooling.
2. **Confirmed shipped/browser behavior**: Public Turo pages, accessible markup, asset domains, font assets, route structure, and visible signed-in product behavior.
3. **Confirmed shipped source behavior**: Read-only inspection of the public JavaScript and CSS assets loaded by the signed-in Booked page identifies its actual runtime, route registry, state and API patterns, design primitives, and production diagnostics.
4. **Confirmed product behavior**: Turo's current Help Center and policy documentation describes the actual host and guest workflows.

Architectural conclusions derived from those signals are labeled as inferences. No private Turo repository, database, server source, customer data, browser cookies, credentials, or unpublished API contracts were accessed.

With the user's explicit permission, Chrome exposed only the public static asset URLs already loaded by the signed-in Booked page. Thirty-two first-party JavaScript files and five first-party CSS files were downloaded read-only from `resources.turo.com` for local inspection. No cookies, browser storage values, credentials, private messages, trip/customer content, request payloads, private repository, or backend source were read.

This is still not a complete Turo source inventory. The assets are minified production bundles with no `sourceMappingURL` or embedded `sourcesContent`, and the captured chunk set is limited to the shell and features loaded by one signed-in route. Route and API findings below therefore describe shipped client capability and patterns, not private server implementation.

## Executive Summary

Turo's product feels modern because it does not place every capability on every screen. It uses a small top-level information architecture, then progressively reveals the deeper workflow inside the selected record.

The central product relationship is:

```text
account -> host/guest profile -> vehicle listing -> availability and price
        -> trip reservation -> messages and notifications
        -> check-in evidence -> active trip -> trip changes
        -> checkout evidence -> invoice/claim/review
        -> earnings, tax, performance, and history
```

The important architectural principle is that a trip is the operational center of gravity. Messages, photos, receipts, driver identity, changes, reimbursements, and claims all retain the same trip context instead of becoming disconnected records.

For WheelsonAuto, the equivalent should be:

```text
customer account -> application -> approved vehicle assignment
                 -> contract, card, deposit, and pickup
                 -> recurring rental period
                 -> messages, maintenance, tolls, violations, and evidence
                 -> return, swap, claim, accounting, and history
```

## Confirmed Frontend Stack

Turo's current frontend engineering descriptions identify the broader web stack:

- React 19.x.
- TypeScript.
- Next.js 16.x.
- Next.js App Router.
- CSS-in-JS through Emotion.
- HTML and CSS foundations.
- A dedicated cross-platform design system named **Pedal**.
- Storybook for component development and documentation.
- Chromatic for visual testing and review.
- Figma on the design side.
- SwiftUI for iOS design-system alignment.
- Jetpack Compose for Android design-system alignment.
- GitHub and GitHub Actions for source control and automated workflows.
- Automated component, token, asset, documentation, release, and adoption pipelines.
- Extensive A/B testing and measurement.
- Monitoring and proactive diagnostics as production requirements.

Turo explicitly describes accessibility, responsive behavior, internationalization, and unexpected content as first-order design-system concerns. That is a stronger standard than merely making a component look correct in one screenshot.

The signed-in host application is more nuanced than a simple "everything is Next.js" description. Its loaded Booked page is a separately bundled Webpack SPA whose runtime namespace is `webpackChunk_turo_schumacher` and whose assets live under `resources.turo.com/client/v2/builds/...`. Direct production-bundle evidence confirms:

- `react-dom` 19.2.7 with `createRoot`.
- React Compiler output, including memo-cache sentinels in shipped components.
- Webpack chunk loading and route-level lazy loading through `React.lazy` and `Suspense`.
- Redux, Redux Toolkit, React Redux, Redux Form, and `connected-react-router`.
- TanStack Query behavior for cache, invalidation, retries, refetch-on-focus, and refetch-on-reconnect.
- Emotion runtime styling alongside global/BEM-style CSS classes.
- A Redux-based API and promise-phase middleware layer.
- Segment, GTM/Google Analytics, and New Relic instrumentation.

That mix shows a mature application evolving in place. Turo combines current React and compiler tooling with older but still operational Redux Form and connected-router patterns. WheelsonAuto should copy the product discipline, not the accumulated framework history.

## Design System: Pedal

Pedal is Turo's shared design system across web, iOS, and Android.

Its documented responsibilities include:

- Design foundations and reusable components.
- Cross-platform interface alignment.
- Token pipelines.
- Asset updates.
- Package publishing.
- Automated release workflows.
- Documentation.
- Testing.
- Adoption measurement.
- A contribution model for product teams.
- Accessibility requirements.
- Responsive and internationalized composition.

Turo also publicly acknowledges that coverage is not yet perfect: product teams sometimes work around the design system, and consistency can drift. That is useful evidence. A design system is not finished when buttons share colors; it is successful when product teams can build ordinary workflows without bypassing it.

### WheelsonAuto Translation

WheelsonAuto should treat its modern charcoal/gold language as a real system with named foundations:

- Page shell.
- Desktop navigation.
- Mobile bottom navigation.
- Header and compact sub-navigation.
- List row.
- Detail header.
- Surface/card.
- Status badge.
- Primary, secondary, quiet, and destructive actions.
- Form field and field group.
- Modal and mobile full-screen sheet.
- Empty, loading, saved, failed, and setup-required states.
- Conversation list, message bubble, and composer.
- Timeline event.
- Evidence/document preview.
- Money summary and transaction row.

The system should be exercised by automated viewport and visual checks. One-off CSS patches should not remain the main way the platform is styled.

## Browser and Delivery Signals

Public Turo pages expose several delivery choices:

- Locale-aware paths such as `/us/en/...`.
- Server-rendered, search-engine-readable page content.
- Next.js App Router on the current public/broader web platform, based on Turo's engineering descriptions.
- A separate Webpack SPA for the inspected signed-in host route.
- Custom `Turo Sans` font files in Regular, Medium, Bold, and Black weights.
- Subset WOFF2 fonts preloaded for faster first rendering.
- First-party media and font delivery through `resources.turo.com`.
- Additional edge assets delivered from an S3-backed resource domain.
- Cloudflare in front of the main product.
- Google Tag Manager on public pages.
- Accessible names for controls such as search, favorites, carousel navigation, menus, and location choices.

The public homepage is content-rich but still search-engine readable. Vehicle cards expose useful text to assistive technology, including vehicle identity, rating, trip count, and pricing. Carousels include Previous and Next controls rather than relying only on swiping.

### Inference

Turo appears to operate more than one frontend delivery surface. Next.js supports current public/discovery development, while the inspected authenticated host workflow is delivered by the Schumacher Webpack application. The exact ownership boundary, migration plan, server/client component split, and caching configuration are not public.

## Actual Signed-In Bundle Audit

### Captured Build Inventory

The Booked page loaded 32 first-party JavaScript files and five first-party CSS files totaling 893,360 bytes in the captured session. The main JavaScript entry was 77,236 bytes, the largest loaded JavaScript chunk was 174,517 bytes, and the main CSS file was 30,827 bytes. These are transfer artifacts from one route, not the full application size.

The runtime dynamically resolves locale bundles for:

- `en_US`
- `es_US`
- `fr_CA`
- `fr_FR`
- `pt_BR`

The page preloaded Turo Sans Regular, Medium, Bold, and Black WOFF2 subsets. Breakpoints found in shipped CSS include 480, 768, 992, and 1200 pixels.

### Application Bootstrap and Routing

The app mounts with `createRoot` into `#pageContainer-content`, wraps the tree with a Redux store, then uses `ConnectedRouter`. A client-routes loader asynchronously inserts route definitions, and feature areas load behind `React.lazy` plus `Suspense`. This lets the shell render before every feature bundle is present.

The shipped route registry contains roughly 175 unique path-like literals. Not every literal is necessarily an independently reachable page, but the families clearly expose the application shape:

- **Account and identity**: login, signup, profile, email, password, phone, two-factor/security challenge, driver address, and driver license.
- **Trips**: booked, history, calendar, reservation detail, changes to length/location/protection/extras, additional drivers, agreement, payment schedule, receipt, review, and rebooking.
- **Messages**: inbox, thread, templates, template editing, scheduling, creation, and notifications.
- **Vehicles**: list, listing creation, photos, details, pricing, protection, availability, locations, delivery, distance, guest instructions, maintenance, registration, safety inspection, toll accounts, Tesla accounts, and preferences.
- **Business**: earnings, performance, reviews, tax information, payouts, statements, and managed hosting.
- **Claims and incidents**: claims dashboard, claim/incident detail, issue reporting, smoking, cleaning, resolutions, and evidence.
- **Invoices and reimbursements**: invoice hub, unpaid invoices, evidence, disputes, photos, payment details, payment plans, schedule review, and reimbursement requests.
- **Teams and permissions**: teams, co-hosts, groups, manager/owner surfaces, invitations, vehicles, permissions, and settings.
- **Other workflows**: favorites, education, partner booking, pre-approval, search, agency onboarding, email verification, and manual review.

The important implementation lesson is route ownership by domain. Turo does not build one giant dashboard component containing every business workflow.

### State and Data Flow

The client uses two complementary data styles:

1. Redux handles broad application state, routing integration, analytics actions, legacy forms, and command-like API actions.
2. TanStack Query handles server-state cache freshness, invalidation, retry continuation, garbage collection, focus refetch, reconnect refetch, and query observers.

The API middleware intercepts a typed `@@api/CALL_API` action. It builds a `fetch` request, defaults credentials to `include`, supports JSON and blob/download responses, normalizes failed responses, and dispatches promise phases marked `START`, `SUCCESS`, or `FAILURE`.

The normalized error path recognizes domain cases rather than treating every failure as a generic toast. Confirmed branches include:

- Security challenge required.
- Authorization required.
- Prerequisites not met.
- Hosting-team permission denied.
- Payment requiring Strong Customer Authentication.
- Buy-now-pay-later completion required.
- Optional failure redirect.

That is a strong WheelsonAuto pattern: money, identity, permission, and prerequisite failures should produce typed next actions, not raw provider errors.

Hard-coded endpoints in the loaded shell include:

- `/api/me`, `/api/contact/me`, `/api/driver/me`, `/api/vehicles/me`, and `/api/summary/me`
- `/api/login/onetimepasscode/send` and `/api/login/onetimepasscode`
- `/api/feature_flags` and `/api/feature_flags?platform=WEB`
- `/api/properties/v2`, `/api/policies`, and `/api/license/countries`
- `/api/location`, `/api/location/google-place`, and `/api/v1/location/default`
- `/api/me/profile`, `/api/me/contact_preferences`, and `/api/me/stats/owner`
- `/api/support/kustomer/attachments`
- `/api/partners/voiceflow/refreshToken`

Only endpoints embedded in the loaded chunk set are listed. Feature chunks not requested by the Booked route can contain additional clients and endpoints.

### Design and Responsive Implementation

The shipped CSS reveals both system discipline and legacy edges:

- BEM-like global classes such as `buttonSchumi`, `tripsList`, and `fieldWithAddon` coexist with Emotion-generated styles.
- Core colors in the captured CSS are black/near-black, white, neutral grays, purple `#593cfb`, and destructive red `#df4a32`.
- Buttons have explicit size variants, loading states, disabled states, full-width behavior, text-link behavior, destructive styling, and responsive dialog sizing.
- Primary legacy buttons are square rather than highly rounded; pill rounding is opt-in.
- Text-link buttons remove the filled surface and use underline-on-hover, which helps Turo keep action-heavy pages from looking button-heavy.
- Route CSS keeps Booked/History trip lists compact on phone and adds more separation from 768 pixels upward.
- Mobile bottom sheets use `env(safe-area-inset-top)`, `env(safe-area-inset-bottom)`, left/right safe areas, contained overscroll, and touch scrolling.
- Toasts use a dark neutral baseline and switch to red only for errors.
- Chart and field components use responsive spacing and compact typography rather than decorative cards.

This supports the earlier visual conclusion: Turo's calmness comes more from hierarchy, link-like secondary actions, drill-in, and responsive behavior than from glass effects or oversized rounded cards.

### Observability and Experiments

The loaded shell contains production instrumentation for:

- New Relic error filtering, user tracking, logs, noticed errors, and chunk-cache warmth measurements.
- Segment identify, page, track, and logout events.
- Google Analytics and GTM event fan-out through analytics middleware.
- Feature flags with a web-platform query parameter.

The page also loaded integrations or pixels for consent management, analytics, advertising, fraud/risk, support, payment, and chat. Observed providers include Osano, Segment, Microsoft Clarity, Bing/UET, Facebook Pixel, Moloco, MoEngage, Kochava, Sift Science, Stripe.js, Cloudflare Insights, and Turo-hosted tag infrastructure. Their presence does not establish ownership of core product truth; they are adapters around the application.

### Source and Accessibility Limits

No source maps were advertised in the captured JS or CSS, so readable module names, TypeScript types, tests, and original source boundaries cannot be reconstructed faithfully from these files. Minified production code is sufficient to confirm runtime behavior and architecture patterns but not to reproduce proprietary implementation.

On the inspected Booked page, the DOM had a viewport declaration, a header, navigation, and footer, but no `main` landmark and no document language value. The current render also included several unnamed buttons and one image without an `alt` attribute; some may belong to third-party widgets. This page-level check reinforces an important point: even a mature design system still needs automated accessibility audits on real composed pages.

## Top-Level Host Information Architecture

Turo's host product is intentionally grouped into a small set of work domains.

### Trips

- **Booked**: Upcoming and in-progress trips.
- **History**: Completed and past trips.
- **Calendar**: Availability, pricing, and booked-trip visualization.

The trip record exposes details, messages, photos, driver information, and receipts. These are not isolated top-level apps.

### Inbox

- **Messages**: Conversation threads with guests.
- **Notifications**: Upcoming trips, required actions, plan changes, new messages, and payments.

Messages and system notifications are related but distinct. Human conversation remains a focused inbox; operational alerts remain a separate action feed.

### Vehicles

- **Listings**: Vehicle identity, content, pricing, availability, and trip preferences.
- **Claims**: Claim and incident progress.
- **Host settings**: Pickup/return hours and host resources.

### Business

- **Earnings**: Earnings, reimbursements, transactions, and tax information.
- **Performance**: Host metrics and All-Star status.
- **Reviews**: Ratings and reviews, filterable by time or vehicle.

### Locations

- **Delivery**: Point-of-interest and custom delivery locations.
- **Groupings**: Shared delivery settings for groups of vehicles.

### More

The mobile app moves lower-frequency functions into More, including mode switching, transaction history, tax information, support, legal terms, recent updates, and hosting teams.

### Why This Works

The top level answers six recurring questions:

1. What trips require attention?
2. Who is talking to me?
3. Which vehicles are available or need work?
4. How is the business performing?
5. Where can vehicles be delivered?
6. Where are infrequent account and policy tools?

Turo does not promote every report, setting, template, status, or workflow to permanent navigation.

## Record-Centered Interaction Model

Turo repeatedly uses a list-to-detail pattern:

```text
collection/list -> selected record -> contextual information and actions
```

Examples:

- Conversation list -> selected message thread.
- Booked trips -> selected trip details.
- Calendar vehicle row -> selected vehicle calendar.
- Listings -> selected vehicle settings.
- Claims list -> selected claim progress.
- Notifications -> linked trip, payment, message, or account action.

This reduces button noise. The first screen supports scanning; the second supports doing.

For WheelsonAuto mobile screens, selecting a customer, vehicle, application, transaction, or claim should open a full-screen detail view with a clear Back control. Desktop can preserve a two-pane list/detail layout where simultaneous context is useful, especially Messages.

## Account, Identity, and Trust

Turo separates account creation from progressively stronger verification.

Confirmed account and verification concepts include:

- Name, email, password, phone, and profile data.
- Driver-license details and document images.
- Identity photographs.
- Payment data through payment providers.
- Potential motor-vehicle, insurance, credit, criminal, and background checks.
- Duplicate-account prevention where identifying information matches another user.
- Ongoing screening, not only one-time onboarding screening.
- Biometric/facial verification in some cases with consent.
- Notifications for payment, password, phone, email, and payout changes.
- Strong warnings against sharing login, SMS, email, or verification codes.

Trust checks can occur during account creation, booking, and later account activity. Approval is therefore a state, not a permanent boolean.

### WheelsonAuto Translation

The customer record should have independently auditable states:

```text
account verified
identity submitted
staff identity review
Stripe Identity required
Stripe Identity passed/failed
insurance submitted/help requested
insurance approved/expired
contract signed
card saved
deposit paid
first week paid
pickup approved/completed
```

Do not compress these into one vague `approved` field.

## Vehicle Listing Workflow

Turo's documented listing flow asks a host to establish:

- Account and host eligibility.
- Vehicle eligibility.
- Valid insurance and legal permission.
- License plate.
- Make, model, and year.
- Clear, high-resolution exterior and interior photos.
- Vehicle features.
- Price.
- Protection/earnings plan.
- Availability.
- Trip preferences.
- Discounts.
- Delivery.
- Extras.
- Pickup and return hours.
- Advance notice.
- Trip buffer.
- Minimum and maximum trip duration.
- Required inspection and orientation completion.

The important design pattern is a staged setup checklist with a clear go-live gate. A vehicle can exist in the system before it is eligible to appear online.

### WheelsonAuto Translation

Native inventory should distinguish:

```text
draft -> prep/review -> ready offline -> online -> application activity
      -> paid/assigned -> active rental -> service/claim -> returned/history
```

Publishing and rental assignment must be derived from explicit business events. An application alone must not hide or rent a vehicle. Successful required payment should atomically create the assignment and remove the vehicle from online inventory.

## Search and Discovery

Turo's discovery experience combines:

- Location.
- Start and end dates/times.
- Price.
- Vehicle type.
- Make and model.
- Year.
- Seats.
- Transmission.
- Electric/hybrid.
- Deluxe classes.
- Vehicle features.
- Host quality indicators.
- Availability constraints.
- Pickup and delivery options.

Turo states that search may return the 200 highest-ranked eligible vehicles. Ranking uses search parameters, location, vehicle details, price, delivery conditions, host ratings, commitment rate, All-Star status, and listing supply. Sponsored placement is not part of that ranking.

The public listing card prioritizes:

- Primary image.
- Vehicle name and year.
- Rating and trip count.
- Daily or monthly price.
- Total price where relevant.
- Favorite action.

The full detail page then reveals seats, fuel type, MPG, transmission, location, host, features, included convenience, and booking controls.

### WheelsonAuto Translation

The public WheelsonAuto site should keep cards short. Detailed requirements, financing/rental terms, document steps, and the application timeline belong on the selected vehicle page and inside the customer account.

## Calendar, Pricing, and Availability

Turo's host calendar is a real operational tool, not a decorative date picker.

Confirmed behavior includes:

- Multiple vehicles in one calendar.
- Horizontal and vertical navigation.
- Available, blocked, and booked dates.
- Alphabetical vehicle ordering.
- Sorting by current price, plate, or booked days.
- Vehicle-specific calendar view.
- Single-date, multi-date, and date-series price updates.
- Dynamic price recommendations.
- Pickup and return availability.
- Trip details connected to calendar dates.

This is one place where dense information is justified. The user is comparing vehicles and dates, so the layout should behave more like a schedule than a collection of cards.

## Booking and Trip Lifecycle

Turo treats trip changes as formal workflow events.

Confirmed concepts include:

- Requested/accepted booking.
- Upcoming/booked trip.
- In-progress trip.
- Completed/history trip.
- Cancellation.
- Extension or shortening request.
- Pickup or return location change.
- Protection-plan change.
- Extras.
- Replacement-vehicle proposal.
- Formal acceptance or denial.

A message saying "that is okay" does not mutate the reservation. The guest submits a change request and the host accepts it. That preserves pricing, coverage, receipts, and audit history.

### WheelsonAuto Translation

Sensitive customer requests in Messages should become typed proposals:

```text
change payment day
partial payment plan
vehicle swap
pickup time change
service appointment
toll/violation payment
card change
return/end rental
```

Star may detect and draft the proposal, but the operational record should change only through the corresponding confirmed action.

## Trip Detail as the Operational Hub

Turo's trip detail keeps related information together:

- Guest and driver information.
- Vehicle.
- Dates and location.
- Messages.
- Photos.
- Pickup/check-in.
- Return/checkout.
- Receipt.
- Changes.
- Reimbursement invoices.
- Issues and claims.

This avoids the common dashboard failure where the same trip has one identity in Messages, another in Transactions, and another in Claims.

For WheelsonAuto, the customer rental file should be the equivalent hub. Every money, communication, document, maintenance, toll, and vehicle event must point to the same customer, vehicle, assignment/rental period, and source event.

## Check-In, Checkout, and Evidence

Turo uses time-bounded evidence collection.

Confirmed behavior includes:

- Check-in and checkout are app-based.
- Guest identity is confirmed during pickup.
- Pre-trip and post-trip photos.
- Exterior and interior condition photos.
- Odometer capture.
- Fuel or EV charge capture.
- Automatic reading of odometer/fuel values followed by user confirmation.
- Timestamps and metadata.
- Evidence windows before/after the trip.
- Photo requirements for reimbursement and damage disputes.

The system asks hosts for at least 15 exterior and eight interior photos in its guidance, plus focused odometer and fuel/charge photos. Similar viewpoints before and after make comparison easier.

### Important Product Pattern

Evidence is not an optional attachment added after a problem. The workflow asks for it at the moment when it becomes reliable.

### WheelsonAuto Translation

Pickup and return should generate immutable evidence checkpoints:

- Staff/customer identity confirmation.
- Agreement and consent version.
- Date, time, user, and device/session metadata.
- Starting/ending mileage.
- Fuel level.
- Plate and VIN.
- Exterior/interior photos.
- Existing damage annotations.
- Key handoff.
- Insurance state.
- Payment/autopay state.
- Staff sign-off.

## Messaging Architecture

Turo's messaging product is deliberately conversation-first.

Confirmed behavior includes:

- A conversation list remains visible beside the selected thread on desktop.
- Host and guest can see trip information while messaging.
- Drafts survive movement between conversations.
- Thread participants can include co-hosts.
- Photos can come from trip photos, the phone gallery, or a new camera capture.
- Image thumbnails appear inside the thread.
- Photos can be removed with explicit confirmation.
- Messaging is the durable written record used in disputes.
- Conversation begins from a trip or the Inbox.

This explains the visual behavior the user highlighted earlier: mobile begins with the conversation list; selecting a person opens a dedicated thread; Back returns to the list. Desktop can display list and thread simultaneously.

### What Turo Does Not Put in the Composer

Turo does not need to repeat a large customer file inside every message bubble. Context remains available in the trip surface while the thread itself stays readable.

### WheelsonAuto Translation

The default conversation view should show:

- Customer name.
- Small vehicle label when useful.
- Message content.
- Timestamp.
- Sender.
- Delivery/read/failure status.
- Attachments.
- A compact contextual actions menu.

VIN, tag, tracker, balance breakdown, card status, and every Star intent field should not be printed into the conversation. They belong in the linked customer/rental context panel.

## Scheduled Messages and Automation

Turo separates ordinary conversations from automation management.

Confirmed capabilities include:

- Message templates.
- Trigger points around booking, check-in, trip start, and trip end.
- Templates tab.
- Automations tab.
- Chronological upcoming-message list.
- Per-template on/off control.
- Send now.
- Skip one.
- Skip all remaining.
- Trip-time-zone display.
- Failed-send retry.
- Scheduled-message access from the trip conversation.

### WheelsonAuto Translation

Star automation should follow the same separation:

- Inbox is for people.
- Automation settings are for rules.
- Queue is for pending sends.
- Approval is for sensitive actions.
- Failed delivery is an explicit retryable state.

Do not stack the rule builder, provider setup, Star controls, queue, templates, and active conversation into one page.

## Notifications and Activity Feed

Turo distinguishes messages from notifications.

Host notifications can include:

- Upcoming trip reminders.
- Actions required.
- New messages.
- Payments.
- Earnings-plan changes.
- Product or policy updates.
- Hosting-team invitation status.
- Claim events.

Notifications link to the record requiring action. They are not merely toast messages that disappear.

### WheelsonAuto Translation

Use a persisted event model:

```text
event type
actor
company/store
customer
vehicle
rental/application/payment/claim reference
created time
read time
action URL
severity
deduplication key
```

Web push and app badges should render from this event feed rather than becoming a second source of truth.

## Reimbursements, Tolls, Fuel, and Incidental Charges

Turo's post-trip charge model uses a formal invoice with evidence and deadlines.

Confirmed invoice examples include:

- Fuel replacement.
- EV charging.
- Additional distance.
- Tolls.
- Tickets.
- Cleaning.
- Smoking.
- Other eligible incidental costs.

The guest receives the invoice through an in-app notification, email, and the completed trip. The guest can accept/pay or dispute. Evidence, deadlines, status, and payment are connected to the same trip.

### WheelsonAuto Translation

Each toll or violation should become a typed reimbursement item with:

- Original source row/file.
- Posted date.
- Transaction date.
- Plate/transponder.
- Matched vehicle.
- Matched customer and rental period.
- Amount and optional fee.
- Evidence file.
- Match confidence and reviewer.
- Draft/sent/viewed/paid/disputed/waived status.
- Payment and receipt references.

Star can perform matching and draft the customer explanation. Ambiguous matches stay in Missing/Review instead of being guessed.

## Claims and Damage

Turo separates an incident report from the decision to pursue a claim.

Confirmed host options after a damage report include:

- File a claim for Turo handling.
- Settle directly with the guest.
- Close the report.

The claims dashboard tracks progress and status. Pre- and post-trip evidence, timestamps, metadata, invoices, payment proof, and third-party reports can affect eligibility.

### WheelsonAuto Translation

WheelsonAuto should model:

```text
incident -> evidence review -> resolution route
         -> internal/direct customer settlement
         -> insurer/third-party claim
         -> payment request and recovery
         -> closed/denied/paid
```

Closing a report should require a reason and an audit event because it may eliminate recovery rights.

## Earnings, Transactions, Tax, and Performance

Turo's business section separates money truth from operating quality.

### Earnings

- Calendar-year earnings.
- Historical years.
- Per-vehicle view.
- Adjustments.
- Transactions and payouts.
- Tax information.
- CSV export.

### Performance

- Host metrics.
- All-Star status.
- Operational quality signals.

### Reviews

- Guest ratings and written reviews.
- Time-period filters.
- Per-vehicle filters.

### WheelsonAuto Translation

Accounting should own canonical money reporting. Dashboard should summarize, then deep-link to Accounting, Payments, or the exact transaction. It should not independently recompute another version of paid, due, failed, or collected totals.

## Teams and Permissions

Turo's hosting teams avoid credential sharing and private financial exposure.

Confirmed behavior includes:

- Multiple teams.
- Team names.
- Vehicle assignment to teams.
- Invitation flow.
- Pending, approved, declined, and not-approved states.
- Default trip-management permission bundle.
- Optional pricing-and-availability bundle.
- Notifications for status changes.

Co-host trip-management capabilities can include:

- Add photos.
- Perform check-in/checkout in the app.
- Message guests.
- Propose replacement vehicles.
- Receive notifications.
- Respond to booking/trip-change requests.
- Submit incidental invoices.
- View activity, trips, history, and details.

Restricted areas include claims filing, scheduled messages, vehicle/host settings, business performance, receipts, earnings, and tax information.

### WheelsonAuto Translation

Roles should be capability-based and company-scoped. A manager or mechanic must never gain access merely because a button is hidden. The server must enforce every permission.

## Responsive and Mobile Strategy

Turo's public requirements and documented behavior show a mobile-first product that still has purpose-built desktop layouts.

Confirmed patterns include:

- Bottom navigation in the mobile app.
- Lower-frequency functions moved to More.
- Full-screen drill-in behavior on mobile.
- Sidebar/list plus selected content on desktop where useful.
- Mobile-only workflows where device camera and live evidence are required.
- Responsive components designed for internationalized and unexpected content.
- Web routes that remain search-engine readable.

### WheelsonAuto Translation

Do not create mobile by stacking all desktop panels vertically.

Use these transformations:

```text
desktop list + detail     -> mobile list, then full-screen detail
desktop side navigation  -> mobile bottom navigation + More
desktop data table       -> mobile summary row + drill-in
desktop context panel    -> mobile secondary screen or sheet
desktop modal            -> mobile full-height sheet with fixed actions
desktop sub-tabs         -> mobile swipeable/scrollable compact tabs
```

Keyboard opening must preserve the conversation header and composer. Safe-area insets must protect both the top sensor area and bottom home indicator.

## Why Turo Feels Less Button-Heavy

Turo uses several techniques WheelsonAuto should adopt:

- The list row itself is the main navigation target.
- Secondary actions are quiet text links or menu items.
- Destructive actions remain visually distinct.
- Detailed actions appear only after selecting a record.
- A trip or vehicle detail screen supplies context once instead of repeating it on every card.
- Low-frequency tools live under More or Settings.
- Notifications link directly to the required action.
- Formal change requests replace clusters of ambiguous edit buttons.

The result is not fewer capabilities. It is better sequencing.

## Quality and Engineering Practices

Turo's current engineering descriptions emphasize:

- End-to-end feature ownership.
- Daily shipping.
- A/B testing and measurement.
- Critical code review, including AI-generated code.
- Technical design and documentation.
- Automated tests.
- Web-platform tooling.
- Monitoring and proactive diagnostics.
- Shared release and token pipelines.
- CI automation.
- Accessibility.
- Responsive behavior.
- Internationalization.
- Production observability.

For WheelsonAuto, "tested" should mean more than a route returning 200. Each workflow needs browser actions, persisted-state verification, role checks, event/audit verification, and responsive screenshots.

## What WheelsonAuto Should Adopt First

### 1. Canonical Domain Records

Create or preserve relational records for:

- Company/store.
- Staff account and capabilities.
- Customer account and identity.
- Vehicle.
- Application.
- Rental/assignment period.
- Payment schedule.
- Transaction.
- Conversation/thread/message.
- Document/evidence.
- Maintenance job.
- Toll/violation/reimbursement.
- Incident/claim.
- Notification/event.

Every secondary record should reference the relevant customer, vehicle, and rental/application period.

### 2. Calm Top-Level Navigation

Recommended staff navigation:

```text
Dashboard
Payments
Customers
Operations
Inbox
Accounting
Settings / More
```

Operations can own fleet, applications, pickup, service, inspections, tolls, and claims through internal views and filters. Accounting can own closeout, transactions, tax, reports, and exports. Avoid restoring every sub-area as a permanent sidebar item.

### 3. Record Drill-In

- Customer row -> customer/rental file.
- Vehicle row -> vehicle file and lifecycle.
- Application row -> application workflow.
- Transaction row -> payment detail and evidence.
- Message row -> conversation.
- Claim row -> claim timeline.

### 4. Formal Actions From Messages

Star drafts and classifies. The platform executes typed, validated actions with approval and audit history.

### 5. Persisted Notification Feed

New messages, applications, payments, failures, pickup readiness, maintenance, insurance expiration, and claims should update live and remain visible until read or resolved.

### 6. One Design System

Use one component vocabulary across admin, manager, mechanic, customer, and franchise portals. Role differences should change accessible functions, not create entirely different visual systems.

## What WheelsonAuto Should Not Copy

- Turo branding, assets, copy, proprietary components, or code.
- Marketplace protection-plan complexity that does not apply to WheelsonAuto.
- App-only restrictions where a secure responsive web flow is sufficient.
- Deep navigation for a small operation merely because Turo supports millions of users.
- A design-system rollout so rigid that product work requires constant one-off overrides.
- Any assumption that a message alone is legal authorization for a money or account change.

## Known Risks in Turo's Model

These are product tradeoffs, not accusations of defects:

- Cross-platform design-system coverage can drift; Turo itself is hiring to improve Pedal adoption.
- A large two-sided marketplace naturally creates complex policy and navigation layers.
- App-only check-in improves device evidence but increases dependence on the native app.
- Dynamic pricing and ranking can be difficult for hosts to understand without strong explanation.
- Evidence deadlines protect disputes but can punish users who miss a workflow step.
- Message, notification, automation, and trip-change systems require careful event consistency.

WheelsonAuto can stay simpler because it owns the fleet, business rules, and customer relationship directly.

## Proposed WheelsonAuto Reference Architecture

```text
Next.js/React or current compatible frontend shell
  -> shared design-system components and tokens
  -> route-level list/detail workspaces
  -> typed API client
  -> server-enforced roles and company scope
  -> PostgreSQL transactions and constraints
  -> object storage for private evidence
  -> event/outbox jobs for notifications and integrations
  -> Stripe, email, and Star provider adapters
  -> monitoring, audit logs, and recovery jobs
```

The provider adapters should not own business truth. For example, Stripe confirms a payment event, but WheelsonAuto's transaction and rental records determine what that payment means for the customer, vehicle, schedule, receipt, and next charge.

## Suggested Test Matrix Inspired by Turo

### Navigation

- Every top-level tab on desktop and mobile.
- List-to-detail and Back behavior.
- Browser reload restores the same safe state.
- Deep links open the correct customer, vehicle, payment, or thread.

### Messages

- New inbound update without refresh.
- Send, retry, failure, draft retention, attachment, and deletion confirmation.
- Desktop list/detail and mobile list/thread transitions.
- Keyboard and safe-area behavior.
- Star draft and admin-approved action.

### Vehicle and Rental

- Draft, publish, apply, pay, assign, pickup, swap, return, service, and history.
- Multiple applicants for one online vehicle.
- Only successful payment removes vehicle availability.
- One canonical assignment reflected everywhere.

### Evidence

- Live camera capture.
- Metadata and timestamps.
- Private access authorization.
- Signed-contract rendering.
- Pre/post condition comparison.
- Cross-customer file access rejection.

### Money

- Deposit and first week as separate transactions.
- Card setup without charge.
- Weekly off-session charge.
- Decline, retry, timeout, duplicate webhook, refund, and dispute.
- Toll/violation invoice and evidence.
- Accounting and customer receipt consistency.

### Roles

- Admin, manager, mechanic, customer, and franchise/company boundaries.
- Direct URL access attempts.
- Hidden UI plus server denial.
- Notification privacy.

### Responsive

- Phone with keyboard closed/open.
- Phone safe-area top/bottom.
- Tablet portrait/landscape.
- Laptop.
- Wide desktop.
- Long names, long vehicle labels, and translated-like text expansion.

## Source Notes

Primary Turo materials used for this audit:

- Turo public website: `https://turo.com/`
- Public static assets loaded by the signed-in Booked page from `https://resources.turo.com/client/v2/builds/...` (32 JavaScript and five CSS files captured read-only on July 26, 2026).
- Turo Careers: `https://turo.com/us/en/careers`
- Current Senior Software Engineer, Front-end posting: React, TypeScript, and Next.js.
- Current Senior Software Engineer, Frontend posting: React 19, TypeScript, Next.js 16 App Router, and Emotion.
- Current Senior Software Engineer, Front-End, Design Systems posting: Pedal, Storybook, Chromatic, Figma, SwiftUI, Jetpack Compose, token/release pipelines, accessibility, responsive behavior, and internationalization.
- Turo Help Center Host Mode documentation.
- Turo Help Center messaging and scheduled-message documentation.
- Turo Help Center listing, calendar, earnings, team-permission, trip-photo, invoice, and claim documentation.
- Turo privacy, trust, vehicle tracking, and terms pages.

## Final Assessment

Turo's strongest lesson is structural discipline. It keeps the top level small, uses the trip as a connected operating record, preserves evidence at the moment it matters, distinguishes conversations from notifications and automations, and makes complex actions formal and auditable.

WheelsonAuto should borrow that discipline while remaining more direct. Its platform does not need Turo's marketplace scale or protection-plan complexity. It needs one trustworthy customer/vehicle/rental truth layer, a calm list-to-detail interface, live notifications, formal money and schedule actions, private evidence, and a design system that behaves consistently across every role and viewport.
