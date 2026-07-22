const crypto = require('crypto');

const LOGO_URL = 'https://www.wheelsonauto.com/cdn/shop/files/wheelsLOGO.png?v=1772299505&width=240';
const HERO_URL = 'https://www.wheelsonauto.com/cdn/shop/files/clean-luxury-car-hero-banner.png?v=1772796803&width=3840';
const CONTRACT_MONTHS = 19;
const NATIVE_SITE_ASSET_VERSION = 'native-12-guided-screening-insurance-gate';

function esc(value) {
  return String(value === undefined || value === null ? '' : value).replace(/[&<>\"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;'
  }[character]));
}

function slug(value) {
  return String(value || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'vehicle';
}

function money(value) {
  return '$' + Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function vehicleTitle(vehicle = {}) {
  return String(vehicle.title || vehicle.name || [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'WheelsonAuto vehicle').trim();
}

function publicVehicleSlug(vehicle = {}) {
  return vehicle.slug || vehicle.handle || slug(vehicleTitle(vehicle)) + '-' + String(vehicle.id || '').slice(-6);
}

function vehicleImages(vehicle = {}) {
  const saved = Array.isArray(vehicle.imageUrls) ? vehicle.imageUrls : [];
  const images = Array.from(new Set([vehicle.imageUrl, ...saved, vehicle.photoUrl].map(value => String(value || '').trim()).filter(Boolean)));
  return images.length ? images : [HERO_URL];
}

function publishedVehicles(data = {}) {
  return (data.onlineVehicles || []).filter(vehicle => vehicle && vehicle.published === true && !/unavailable|removed|rented/i.test(String(vehicle.availability || vehicle.status || 'Available')));
}

function publicSettings(data = {}) {
  const saved = data.publicSite || {};
  return {
    businessName: saved.businessName || 'WheelsonAuto',
    phone: saved.phone || '(856) 839-1385',
    email: saved.email || 'wheelsonauto@gmail.com',
    pickupAddress: saved.pickupAddress || '5150 NJ-42, Blackwood, NJ 08012',
    businessHours: saved.businessHours || 'Monday-Saturday, 11:00 AM-5:00 PM',
    defaultDownPayment: Number(saved.defaultDownPayment === undefined ? 485 : saved.defaultDownPayment),
    defaultWeeklyPayment: Number(saved.defaultWeeklyPayment || 229),
    pickupSlotMinutes: Number(saved.pickupSlotMinutes || 60),
    pickupCapacity: Number(saved.pickupCapacity || 2),
    minimumPickupDays: Number(saved.minimumPickupDays || 1),
    maximumVehicleHoldDays: Number(saved.maximumVehicleHoldDays || 7),
    contractMonths: CONTRACT_MONTHS,
    excessMileageRate: Number(saved.excessMileageRate || 0),
    dailyMileageAllowance: Number(saved.dailyMileageAllowance || 100)
  };
}

function pickupTimeSlots(settings = {}) {
  const slotMinutes = Number(settings.pickupSlotMinutes) === 30 ? 30 : 60;
  const slots = [];
  const openingMinutes = 11 * 60;
  const closingMinutes = 17 * 60;
  for (let minutes = openingMinutes; minutes + slotMinutes <= closingMinutes; minutes += slotMinutes) {
    const hour24 = Math.floor(minutes / 60);
    const minute = minutes % 60;
    const hour12 = hour24 > 12 ? hour24 - 12 : hour24;
    slots.push(hour12 + ':' + String(minute).padStart(2, '0') + (hour24 >= 12 ? ' PM' : ' AM'));
  }
  return slots;
}

function localDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: process.env.WOA_TIME_ZONE || 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return [values.year, values.month, values.day].join('-');
}

function baseHead({ title, description, canonical, image, jsonLd, noIndex = false }) {
  const safeTitle = esc(title + ' | WheelsonAuto');
  const safeDescription = esc(description);
  return '<meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
    '<title>' + safeTitle + '</title>' +
    '<meta name="description" content="' + safeDescription + '">' +
    (noIndex ? '<meta name="robots" content="noindex,nofollow">' : '') +
    '<link rel="canonical" href="' + esc(canonical) + '">' +
    '<meta property="og:type" content="website"><meta property="og:title" content="' + safeTitle + '">' +
    '<meta property="og:description" content="' + safeDescription + '"><meta property="og:url" content="' + esc(canonical) + '">' +
    '<meta property="og:image" content="' + esc(image || HERO_URL) + '">' +
    '<link rel="icon" href="' + LOGO_URL + '"><link rel="apple-touch-icon" href="' + LOGO_URL + '">' +
    '<link rel="stylesheet" href="/native-site.css?v=' + NATIVE_SITE_ASSET_VERSION + '">' +
    (jsonLd ? '<script type="application/ld+json">' + JSON.stringify(jsonLd).replace(/</g, '\\u003c') + '</script>' : '');
}

function header(active = '', homePath = '/') {
  return '<header class="site-header"><a class="site-brand" href="' + esc(homePath) + '"><img src="' + LOGO_URL + '" alt="WheelsonAuto"><span>WheelsonAuto</span></a>' +
    '<nav><a class="' + (active === 'home' ? 'active' : '') + '" href="' + esc(homePath) + '">Home</a><a class="' + (active === 'inventory' ? 'active' : '') + '" href="/inventory">Inventory</a><a href="' + esc(homePath) + '#process">How it works</a><a href="' + esc(homePath) + '#contact">Contact</a></nav>' +
    '<div class="site-header-actions"><a class="site-account" href="/customer/login">Customer login</a><a class="site-cta" href="/inventory">Find a car</a></div>' +
    '<button class="site-menu" type="button" aria-label="Open navigation" data-site-menu>Menu</button></header>';
}

function footer(settings, homePath = '/') {
  return '<footer class="site-footer"><div><a class="site-brand footer-brand" href="' + esc(homePath) + '"><img src="' + LOGO_URL + '" alt=""><span>WheelsonAuto</span></a><p>Long-term vehicle rentals with a clear path and hands-on local support.</p></div>' +
    '<div><strong>Visit</strong><span>' + esc(settings.pickupAddress) + '</span><span>' + esc(settings.businessHours) + '</span></div>' +
    '<div><strong>Contact</strong><a href="tel:+18568391385">' + esc(settings.phone) + '</a><a href="mailto:' + esc(settings.email) + '">' + esc(settings.email) + '</a></div>' +
    '<div><strong>Policies</strong><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/cancellation">Cancellation</a></div>' +
    '<small>© ' + new Date().getFullYear() + ' Wheels On Auto INC.</small></footer>';
}

function layout({ title, description, canonical, active, body, settings, image, jsonLd, pageClass = '', homePath = '/', noIndex = false }) {
  return '<!doctype html><html lang="en"><head>' + baseHead({ title, description, canonical, image, jsonLd, noIndex }) + '</head><body class="native-site ' + esc(pageClass) + '">' +
    header(active, homePath) + '<main>' + body + '</main>' + footer(settings, homePath) + '<script src="/native-site-client.js?v=' + NATIVE_SITE_ASSET_VERSION + '" defer></script></body></html>';
}

function vehicleCard(vehicle, compact = false) {
  const down = Number(vehicle.downPayment || 0);
  const image = vehicleImages(vehicle)[0];
  const href = '/vehicles/' + encodeURIComponent(publicVehicleSlug(vehicle));
  return '<article class="vehicle-card' + (compact ? ' compact' : '') + '"><a class="vehicle-photo" href="' + href + '"><img src="' + esc(image) + '" alt="' + esc(vehicleTitle(vehicle)) + '" loading="lazy"><span>' + esc(vehicle.availability || 'Available') + '</span></a>' +
    '<div class="vehicle-copy"><div><h3><a href="' + href + '">' + esc(vehicleTitle(vehicle)) + '</a></h3><p>' + esc([vehicle.color, vehicle.mileage ? Number(vehicle.mileage).toLocaleString() + ' miles' : '', vehicle.transmission].filter(Boolean).join(' · ') || 'Available for application') + '</p></div>' +
    '<div class="vehicle-pricing"><strong>' + money(vehicle.weeklyPayment) + '<small>/week</small></strong><span>' + (down > 0 ? money(down) + ' nonrefundable down payment' : 'No down payment required') + '</span></div>' +
    '<div class="vehicle-actions"><a class="button secondary" href="' + href + '">View details</a><a class="button primary" href="/apply/' + encodeURIComponent(publicVehicleSlug(vehicle)) + '">Apply</a></div></div></article>';
}

function homeHtml(data, baseUrl, options = {}) {
  const settings = publicSettings(data);
  const vehicles = publishedVehicles(data).slice(0, 6);
  const body = '<section class="home-hero" style="--hero:url(\'' + esc(HERO_URL) + '\')"><div class="hero-shade"></div><div class="hero-copy"><span class="eyebrow">South Jersey rent-to-own vehicles</span><h1>WheelsonAuto</h1><p>Choose an available car, apply online, complete your documents securely, and schedule pickup when your file is approved.</p><div class="hero-actions"><a class="button primary large" href="/inventory">Browse available cars</a><a class="button glass large" href="#process">See how it works</a></div><div class="hero-facts"><span><b>' + CONTRACT_MONTHS + ' months</b> optional purchase eligibility</span><span><b>Weekly</b> clear scheduled payments</span><span><b>Local</b> Blackwood pickup and service</span></div></div></section>' +
    '<section class="site-band inventory-preview"><div class="section-title"><div><span class="eyebrow">Available now</span><h2>Find the right vehicle</h2><p>Only cars published by WheelsonAuto appear here. Availability updates from the same fleet record staff use.</p></div><a class="text-link" href="/inventory">View all inventory →</a></div><div class="vehicle-grid">' + (vehicles.length ? vehicles.map(vehicle => vehicleCard(vehicle)).join('') : '<div class="public-empty"><strong>Inventory is being prepared</strong><p>Call ' + esc(settings.phone) + ' for current availability.</p></div>') + '</div></section>' +
    '<section class="site-band process-band" id="process"><div class="section-title"><div><span class="eyebrow">One connected process</span><h2>From application to pickup</h2></div></div><div class="process-grid">' +
    [['01', 'Choose and apply', 'Select an available vehicle and continue directly into its secure setup.'], ['02', 'Screen and sign', 'Complete the private license/selfie screening, exact agreement, and no-charge card setup.'], ['03', 'Verify and pay', 'After WheelsonAuto approval, complete one Stripe Identity check and the separate deposit and first-week payments.'], ['04', 'Insure and pick up', 'Upload full-coverage proof for the assigned VIN or request help at pickup. No vehicle is released before coverage is verified.']].map(item => '<article><span>' + item[0] + '</span><h3>' + item[1] + '</h3><p>' + item[2] + '</p></article>').join('') + '</div></section>' +
    '<section class="site-band trust-band"><div><span class="eyebrow">Straightforward terms</span><h2>Know the important details before you apply.</h2></div><div class="trust-list"><p><b>Customer-provided insurance.</b> Full coverage is required and must list Wheels On Auto INC as owner and/or loss payee.</p><p><b>Vehicle-specific pricing.</b> Weekly payment and any nonrefundable down payment are shown before the agreement is signed.</p><p><b>Thirty-day minimum.</b> After the initial period, the rental continues week to week under the signed agreement.</p></div></section>' +
    '<section class="site-band contact-band" id="contact"><div><span class="eyebrow">WheelsonAuto office</span><h2>Questions before applying?</h2><p>Same-day pickup requests and appointments more than seven days away must be arranged directly with the office. Specific vehicle availability may change.</p></div><div class="contact-actions"><a class="button primary large" href="tel:+18568391385">Call ' + esc(settings.phone) + '</a><a class="button secondary large" href="mailto:' + esc(settings.email) + '">Email the office</a><span>' + esc(settings.pickupAddress) + '<br>' + esc(settings.businessHours) + '</span></div></section>';
  return layout({
    title: 'Rent-to-own vehicles in South Jersey',
    description: 'Browse WheelsonAuto vehicles, apply online, complete secure onboarding, and schedule pickup in Blackwood, New Jersey.',
    canonical: baseUrl + '/', active: 'home', body, settings,
    jsonLd: { '@context': 'https://schema.org', '@type': 'LocalBusiness', name: 'WheelsonAuto', url: baseUrl, telephone: '+1-856-839-1385', email: settings.email, address: { '@type': 'PostalAddress', streetAddress: '5150 NJ-42', addressLocality: 'Blackwood', addressRegion: 'NJ', postalCode: '08012', addressCountry: 'US' } },
    homePath: options.homePath || '/', noIndex: !!options.noIndex
  });
}

function inventoryHtml(data, baseUrl, options = {}) {
  const settings = publicSettings(data);
  const vehicles = publishedVehicles(data);
  const body = '<section class="page-intro"><span class="eyebrow">Current inventory</span><h1>Available WheelsonAuto vehicles</h1><p>Search by year, make, or model. Only cars currently published and available for an application are shown.</p></section>' +
    '<section class="site-band inventory-page"><div class="inventory-toolbar"><label><span>Search inventory</span><input type="search" placeholder="Year, make, or model" data-inventory-search></label><span><b data-inventory-count>' + vehicles.length + '</b> available</span></div><div class="vehicle-grid" data-inventory-grid>' + (vehicles.length ? vehicles.map(vehicle => vehicleCard(vehicle)).join('') : '<div class="public-empty"><strong>No vehicles are published right now</strong><p>Call ' + esc(settings.phone) + ' for current availability.</p></div>') + '</div></section>';
  return layout({ title: 'Available vehicles', description: 'Browse currently available WheelsonAuto rent-to-own vehicles.', canonical: baseUrl + '/inventory', active: 'inventory', body, settings, pageClass: 'inventory-view', homePath: options.homePath || '/', noIndex: !!options.noIndex });
}

function vehicleHtml(data, vehicle, baseUrl, options = {}) {
  const settings = publicSettings(data);
  const title = vehicleTitle(vehicle);
  const down = Number(vehicle.downPayment || 0);
  const images = vehicleImages(vehicle);
  const image = images[0];
  const slides = images.map((source, index) => '<figure data-gallery-slide="' + index + '"><img src="' + esc(source) + '" alt="' + esc(title + ' photo ' + (index + 1)) + '" ' + (index ? 'loading="lazy"' : '') + '></figure>').join('');
  const thumbnails = images.map((source, index) => '<button type="button" class="' + (index === 0 ? 'active' : '') + '" data-gallery-thumb="' + index + '" aria-label="Show photo ' + (index + 1) + '"><img src="' + esc(source) + '" alt="" loading="lazy"></button>').join('');
  const gallery = '<div class="vehicle-detail-media vehicle-gallery" data-vehicle-gallery><div class="vehicle-gallery-track" data-gallery-track>' + slides + '</div><span>' + esc(vehicle.availability || 'Available') + '</span>' + (images.length > 1 ? '<div class="vehicle-gallery-toolbar"><small><b data-gallery-position>1</b> / ' + images.length + ' photos</small><div><button type="button" data-gallery-previous aria-label="Previous photo">‹</button><button type="button" data-gallery-next aria-label="Next photo">›</button></div></div><div class="vehicle-gallery-thumbs">' + thumbnails + '</div>' : '') + '</div>';
  const body = '<section class="vehicle-detail">' + gallery + '<div class="vehicle-detail-copy"><a class="back-link" href="/inventory">← Inventory</a><h1>' + esc(title) + '</h1><p class="vehicle-subtitle">' + esc([vehicle.color, vehicle.mileage ? Number(vehicle.mileage).toLocaleString() + ' miles' : '', vehicle.transmission].filter(Boolean).join(' · ') || 'WheelsonAuto long-term rental') + '</p><div class="price-panel"><div><span>Weekly payment</span><strong>' + money(vehicle.weeklyPayment) + '</strong></div><div><span>Nonrefundable down payment</span><strong>' + (down ? money(down) : '$0') + '</strong></div></div><div class="detail-list"><span>Customer must maintain full-coverage insurance</span><span>Minimum rental commitment: 30 days</span><span>Optional purchase eligibility after ' + esc(settings.contractMonths) + ' consecutive months in good standing</span><span>Pickup must be scheduled within seven days after onboarding</span></div><a class="button primary large full" href="/apply/' + encodeURIComponent(publicVehicleSlug(vehicle)) + '">Apply for this vehicle</a><p class="detail-disclaimer">Submitting an application does not guarantee approval or hold the vehicle. Pricing and vehicle terms are locked only when your agreement is created.</p></div></section>';
  return layout({ title, description: 'Apply for the ' + title + ' through WheelsonAuto.', canonical: baseUrl + '/vehicles/' + publicVehicleSlug(vehicle), active: 'inventory', body, settings, image, pageClass: 'vehicle-view', jsonLd: { '@context': 'https://schema.org', '@type': 'Product', name: title, image: images, offers: { '@type': 'Offer', priceCurrency: 'USD', price: Number(vehicle.weeklyPayment || 0), availability: 'https://schema.org/InStock', url: baseUrl + '/vehicles/' + publicVehicleSlug(vehicle) } }, homePath: options.homePath || '/', noIndex: !!options.noIndex });
}

function applicationHtml(data, vehicle, baseUrl, options = {}) {
  const settings = publicSettings(data);
  const title = vehicleTitle(vehicle);
  const down = Number(vehicle.downPayment || 0);
  const body = '<section class="application-shell"><div class="application-summary"><a class="back-link" href="/vehicles/' + encodeURIComponent(publicVehicleSlug(vehicle)) + '">← Vehicle details</a><span class="eyebrow">Secure application</span><h1>' + esc(title) + '</h1><img src="' + esc(vehicle.imageUrl || vehicle.photoUrl || HERO_URL) + '" alt=""><div class="application-price"><span>' + money(vehicle.weeklyPayment) + '/week</span><span>' + (down ? money(down) + ' nonrefundable down payment' : 'No down payment') + '</span></div><p>This application does not charge your card. You can complete the setup before staff makes one final decision.</p><div class="insurance-disclosure"><strong>Insurance required before vehicle release</strong><span>You may upload proof near the end or request help at pickup, but active full coverage for this exact vehicle and VIN must be verified before you receive the car.</span></div></div>' +
    '<form class="native-form application-form" id="nativeApplicationForm"><input type="hidden" name="onlineVehicleId" value="' + esc(vehicle.id) + '"><div class="form-title"><span>Secure application</span><h2>Create your application</h2><p>Use your legal information exactly as it appears on your driver license.</p></div>' +
    '<label><span>Legal first name</span><input name="firstName" required autocomplete="given-name"></label><label><span>Legal last name</span><input name="lastName" required autocomplete="family-name"></label>' +
    '<label><span>Mobile phone</span><input name="phone" required inputmode="tel" autocomplete="tel"></label><label><span>Email</span><input name="email" required type="email" autocomplete="email"></label>' +
    '<label class="wide"><span>Home address</span><input name="address" required autocomplete="street-address"></label><label><span>City</span><input name="city" required autocomplete="address-level2"></label><label><span>State</span><input name="state" required value="NJ" autocomplete="address-level1"></label><label><span>ZIP code</span><input name="postalCode" required inputmode="numeric" autocomplete="postal-code"></label><label><span>Date of birth</span><input name="dateOfBirth" required type="date"></label>' +
    '<label><span>Driver license number</span><input name="driverLicenseId" required autocomplete="off"></label><label><span>License expiration</span><input name="driverLicenseExpires" required type="date"></label>' +
    '<label><span>Employer</span><input name="employer" required></label><label><span>Monthly income</span><input name="income" required type="number" min="0" step="1" inputmode="decimal"></label>' +
    '<label><span>Create password</span><input name="password" required type="password" minlength="8" autocomplete="new-password"></label><label><span>Confirm password</span><input name="confirmPassword" required type="password" minlength="8" autocomplete="new-password"></label>' +
    '<label class="check-row wide"><input name="applicationConsent" type="checkbox" required><span>I confirm this information is accurate and authorize WheelsonAuto to review this application. I understand approval and vehicle availability are not guaranteed.</span></label>' +
    '<label class="check-row wide"><input name="insurancePickupConsent" type="checkbox" required><span>I understand I must have active full-coverage insurance for the assigned vehicle and VIN before WheelsonAuto can release the car. I may upload proof later or request help at pickup.</span></label>' +
    '<label class="check-row wide"><input name="smsConsent" type="checkbox"><span>I agree to receive customer-care and account text messages from Wheels On Auto at the mobile number provided. Message frequency varies. Message and data rates may apply. Consent is not a condition of purchase. Reply STOP to opt out or HELP for help. See the <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a> and <a href="/terms" target="_blank" rel="noopener">Terms</a>.</span></label>' +
    '<button class="button primary large wide" type="submit">Submit secure application</button><div class="form-message wide" data-form-message></div></form></section>';
  return layout({ title: 'Apply for ' + title, description: 'Submit a secure WheelsonAuto vehicle application.', canonical: baseUrl + '/apply/' + publicVehicleSlug(vehicle), active: 'inventory', body, settings, image: vehicle.imageUrl || vehicle.photoUrl, pageClass: 'apply-view', homePath: options.homePath || '/', noIndex: options.noIndex !== false });
}

function onboardingStatus(data, session, application) {
  const documents = (data.documents || []).filter(document => document.applicationId === application.id && document.onboardingSessionId === session.id);
  const signature = (data.eSignatures || []).find(item => item.applicationId === application.id && item.onboardingSessionId === session.id);
  const recurring = (data.recurringPayments || []).find(item => item.applicationId === application.id || item.onboardingSessionId === session.id) || {};
  const paymentProvider = String(session.paymentProvider || recurring.paymentProvider || recurring.provider || 'clover').trim().toLowerCase() === 'stripe' ? 'stripe' : 'clover';
  const paymentProviderLabel = paymentProvider === 'stripe' ? 'Stripe' : 'Clover';
  const requests = (data.paymentRequests || []).filter(item => (item.applicationId === application.id || item.onboardingSessionId === session.id) && String(item.paymentProvider || 'clover').trim().toLowerCase() === paymentProvider);
  const depositRequest = requests.find(item => item.paymentType === 'Nonrefundable down payment');
  const firstWeekRequest = requests.find(item => item.paymentType === 'First weekly payment');
  const pickup = (data.pickupAppointments || []).find(item => item.applicationId === application.id && !/cancel/i.test(String(item.status || '')));
  const identityProvider = String(session.identityProvider || 'manual').trim().toLowerCase() === 'stripe' ? 'stripe' : 'manual';
  const requiredDocumentKinds = ['driver_license_front', 'driver_license_back', 'identity_selfie'];
  const documentKinds = new Set(documents.map(document => document.documentKind));
  const documentCorrections = documents
    .filter(document => requiredDocumentKinds.includes(document.documentKind) && /correction/i.test(String(document.status || '')))
    .map(document => document.documentKind);
  const documentsPresent = requiredDocumentKinds.every(kind => documentKinds.has(kind));
  const insuranceDocument = documents.find(document => document.documentKind === 'insurance');
  const insuranceCorrection = !!(insuranceDocument && /correction/i.test(String(insuranceDocument.status || '')));
  const insuranceOption = String(session.insuranceOption || '').trim().toLowerCase();
  const insuranceSelected = insuranceOption === 'upload' || insuranceOption === 'help_at_pickup';
  const identityStatus = String(session.identityVerificationStatus || (identityProvider === 'stripe' ? 'not_started' : 'manual_review')).trim().toLowerCase();
  const identityVerified = identityProvider !== 'stripe' || identityStatus === 'verified';
  const cardReady = paymentProvider === 'stripe'
    ? !!(recurring.stripeCustomerId && recurring.stripePaymentMethodId && recurring.stripeLivemode === true)
    : !!(recurring.cloverPaymentSource || recurring.paymentSourceId);
  const paid = request => !!(request && /paid|success/i.test(String(request.status || '')));
  return {
    profile: !!session.profileCompletedAt,
    documents: documentsPresent && documentCorrections.length === 0,
    documentsPresent,
    documentCorrections,
    requiredDocumentKinds,
    documentsApproved: documentsPresent && documentCorrections.length === 0 && /approved/i.test(String(session.documentReviewStatus || '')),
    identityProvider,
    identityStatus,
    identityVerified,
    identityProcessing: identityStatus === 'processing',
    identityNeedsInput: ['not_started', 'requires_input', 'canceled'].includes(identityStatus),
    identityLastError: String(session.identityVerificationCustomerMessage || session.identityVerificationLastError || ''),
    signature: !!signature,
    signatureApproved: session.signatureReviewStatus === 'Approved',
    finalApproved: session.finalReviewStatus === 'Approved',
    card: cardReady,
    deposit: Number(application.pricingSnapshot && application.pricingSnapshot.downPayment || 0) <= 0 || paid(depositRequest),
    firstWeek: paid(firstWeekRequest),
    insuranceOption,
    insuranceSelected,
    insuranceDocument: insuranceDocument || null,
    insuranceUploaded: !!insuranceDocument && !insuranceCorrection,
    insuranceCorrection,
    insuranceApproved: session.insuranceReleaseStatus === 'Approved',
    insuranceHelpAtPickup: insuranceOption === 'help_at_pickup',
    pickup: !!pickup,
    paymentProvider,
    paymentProviderLabel,
    documentsList: documents,
    signatureRecord: signature,
    recurring,
    depositRequest,
    firstWeekRequest,
    pickupRecord: pickup
  };
}

function statusPill(done, label, waiting) {
  return '<span class="onboarding-pill ' + (done ? 'done' : waiting ? 'waiting' : '') + '"><i>' + (done ? '✓' : '·') + '</i>' + esc(label) + '</span>';
}

function onboardingHtml(data, session, application, vehicle, template, renderedContract, baseUrl, options = {}) {
  const settings = publicSettings(data);
  const state = onboardingStatus(data, session, application);
  const token = session.publicToken;
  const pricing = application.pricingSnapshot || {};
  const signatureReady = state.documents;
  const cardSetupReady = state.signature;
  const identityReady = state.finalApproved && state.card;
  const paymentReady = state.finalApproved && state.identityVerified;
  const paymentProviderLabel = state.paymentProviderLabel;
  const allPaid = state.card && state.deposit && state.firstWeek;
  const stripeIdentity = state.identityProvider === 'stripe';
  const documentIntro = 'Upload clear private images of the license front, license back, and a current selfie. WheelsonAuto reviews these before paying for the final Stripe Identity check.';
  const documentLabels = {
    driver_license_front: ['License front', 'image/jpeg,image/png,application/pdf', ''],
    driver_license_back: ['License back', 'image/jpeg,image/png,application/pdf', ''],
    identity_selfie: ['Identity selfie', 'image/jpeg,image/png', ' capture="user"'],
    insurance: ['Insurance proof', 'image/jpeg,image/png,application/pdf', '']
  };
  const uploadKinds = state.documentCorrections.length ? state.documentCorrections : state.requiredDocumentKinds;
  const documentInputs = uploadKinds.map(kind => {
    const field = documentLabels[kind];
    if (!field) return '';
    if (kind === 'identity_selfie') {
      return '<div class="wide selfie-capture" data-selfie-capture><span class="field-label">Live selfie with license</span><div class="selfie-guidance"><strong>How to take an acceptable selfie</strong><ul><li>Hold your physical driver license just below your chin so your full face and the license appear together.</li><li>Keep your face inside the oval and the license inside the lower guide.</li><li>Do not cover your mouth, chin, or any part of your face.</li><li>Use bright, even lighting with no heavy shadows or filters.</li><li>Remove hats, sunglasses, masks, and anything covering your face.</li><li>Make sure the photo is sharp, the license is readable, and nobody else appears.</li></ul></div><div class="selfie-camera-stage"><video data-selfie-video playsinline muted hidden></video><div class="selfie-camera-placeholder" data-selfie-placeholder><strong>Live camera required</strong><span>WheelsonAuto does not accept a gallery upload for this screening selfie.</span></div><div class="selfie-face-frame" aria-hidden="true"></div><div class="selfie-license-frame" aria-hidden="true"><span>Hold license here</span></div><img class="selfie-preview" data-selfie-preview alt="Captured selfie preview" hidden></div><input type="hidden" name="identity_selfie" data-live-selfie required><canvas data-selfie-canvas hidden></canvas><div class="selfie-camera-actions"><button class="button primary" type="button" data-selfie-open>Open live camera</button><button class="button primary" type="button" data-selfie-take hidden>Take photo</button><button class="button secondary" type="button" data-selfie-retake hidden>Retake</button></div><div class="step-alert" data-selfie-error hidden></div></div>';
    }
    return '<label><span>' + esc(field[0]) + '</span><input name="' + esc(kind) + '" type="file" accept="' + esc(field[1]) + '"' + field[2] + ' required></label>';
  }).join('');
  const correctionNotice = state.documentCorrections.length
    ? '<div class="step-alert">Correction requested for ' + esc(state.documentCorrections.map(kind => documentLabels[kind] && documentLabels[kind][0] || kind).join(', ')) + '.</div>'
    : '';
  const documentForm = '<form class="native-form compact" data-onboarding-form="documents">' + correctionNotice + documentInputs + '<button class="button primary wide" type="submit">' + (state.documentCorrections.length ? 'Upload corrected file' : 'Upload license and selfie') + '</button></form>';
  const identityStep = state.identityVerified
    ? '<div class="step-success">Stripe verified the live driver license and matching selfie</div>'
    : !identityReady
      ? '<div class="step-locked">WheelsonAuto final approval and a saved card are required first.</div>'
      : state.identityProcessing
        ? '<div class="step-waiting">Stripe is processing the identity check. This page will update when the signed result arrives.</div>'
        : '<form data-onboarding-form="identity"><p class="step-security">This is the one paid Stripe Identity check. It begins only after WheelsonAuto approves your completed file.</p>' + (state.identityLastError ? '<div class="step-alert">' + esc(state.identityLastError) + '</div>' : '') + '<button class="button primary" type="submit">' + (state.identityStatus === 'requires_input' ? 'Continue Stripe verification' : 'Verify identity with Stripe') + '</button></form>';
  const assignedVin = String(vehicle.vin || '').trim();
  const insuranceReady = state.identityVerified && allPaid;
  const insuranceUploadForm = '<form class="native-form compact insurance-choice-form" data-onboarding-form="insurance"><input type="hidden" name="insuranceOption" value="upload"><label><span>Insurance company</span><input name="insuranceProvider" required minlength="2" maxlength="160" autocomplete="organization" value="' + esc(application.insuranceProvider || '') + '"></label><label><span>Policy number</span><input name="insurancePolicyNumber" required minlength="4" maxlength="60" autocomplete="off" value="' + esc(application.insurancePolicyNumber || '') + '"></label><label class="wide"><span>Proof of insurance</span><input name="insurance" type="file" accept="image/jpeg,image/png,application/pdf" required><small>The policy must cover ' + esc(vehicleTitle(vehicle)) + ' and VIN ' + esc(assignedVin || 'shown in your agreement') + '.</small></label><label class="check-row wide"><input name="insuranceVinConfirmed" type="checkbox" required><span>I confirm this policy lists the assigned vehicle and VIN ' + esc(assignedVin || 'shown in my agreement') + '.</span></label><button class="button primary wide" type="submit">Upload insurance and confirm pickup</button></form>';
  const insuranceHelpForm = '<form class="insurance-help-form" data-onboarding-form="insurance"><input type="hidden" name="insuranceOption" value="help_at_pickup"><label class="check-row"><input name="insuranceHelpConfirmed" type="checkbox" required><span>I need help arranging insurance at pickup. I understand the appointment can be reserved, but WheelsonAuto cannot release the vehicle until staff verifies active coverage for this exact VIN.</span></label><button class="button secondary" type="submit">Request insurance help at pickup</button></form>';
  const pickupMin = new Date();
  pickupMin.setDate(pickupMin.getDate() + settings.minimumPickupDays);
  const pickupMax = new Date();
  pickupMax.setDate(pickupMax.getDate() + settings.maximumVehicleHoldDays);
  const pickupSlots = pickupTimeSlots(settings);
  const originalPickupDate = String(session.requestedPickupDate || application.requestedPickupDate || '').slice(0, 10);
  const originalPickupTime = session.requestedPickupTime || application.requestedPickupTime || '';
  const originalPickupDay = new Date(originalPickupDate + 'T12:00:00Z');
  const proposedPickupDate = originalPickupDate >= localDateKey(pickupMin) && originalPickupDate <= localDateKey(pickupMax) && !Number.isNaN(originalPickupDay.getTime()) && originalPickupDay.getUTCDay() !== 0 ? originalPickupDate : '';
  const proposedPickupTime = proposedPickupDate && pickupSlots.includes(originalPickupTime) ? originalPickupTime : '';
  const pickupOptions = pickupSlots.map(time => '<option value="' + esc(time) + '"' + (time === proposedPickupTime ? ' selected' : '') + '>' + esc(time) + '</option>').join('');
  const body = '<section class="onboarding-hero"><div><span class="eyebrow">Secure customer onboarding</span><h1>Welcome, ' + esc(application.name || 'customer') + '</h1><p>' + esc(vehicleTitle(vehicle)) + ' · ' + money(pricing.weeklyPayment) + '/week · ' + (Number(pricing.downPayment || 0) ? money(pricing.downPayment) + ' nonrefundable down payment' : 'No down payment') + '</p></div><div class="onboarding-progress">' +
    statusPill(state.profile, 'Pickup request') + statusPill(state.documents, 'Private screening') + statusPill(state.signature, 'Agreement') + statusPill(state.card, 'Card saved') + statusPill(state.finalApproved, 'WheelsonAuto approval', state.card) + statusPill(state.identityVerified, 'Stripe Identity', state.finalApproved) + statusPill(state.deposit && state.firstWeek, 'Payments', state.identityVerified) + statusPill(state.insuranceSelected, 'Insurance', allPaid) + statusPill(state.pickup, 'Pickup', state.insuranceSelected) + '</div></section>' +
    '<section class="onboarding-grid" data-onboarding-token="' + esc(token) + '">' +
    '<article class="onboarding-card ' + (state.profile ? 'complete' : 'current') + '"><div class="step-number">1</div><div class="step-copy"><h2>Confirm your profile and pickup request</h2><p>Your legal information must match your driver license. The requested pickup date becomes the rental start date in your agreement and your weekly autopay weekday.</p>' + (state.profile ? '<div class="step-success">Profile completed · requested pickup ' + esc(session.requestedPickupDate || '') + ' at ' + esc(session.requestedPickupTime || '') + '</div>' : '<form class="native-form compact" data-onboarding-form="profile" data-profile-validation><div class="profile-review wide" data-profile-review role="status" aria-live="polite"><strong>Review every field before continuing</strong><span>Your legal name and license details must match the private screening files you upload next.</span></div><label class="wide"><span>Legal address</span><input name="address" required minlength="5" maxlength="220" autocomplete="street-address" value="' + esc(application.address || '') + '"><small class="field-error" data-field-error="address"></small></label><label><span>City</span><input name="city" required minlength="2" maxlength="100" autocomplete="address-level2" value="' + esc(application.city || '') + '"><small class="field-error" data-field-error="city"></small></label><label><span>State</span><input name="state" required maxlength="2" autocomplete="address-level1" autocapitalize="characters" value="' + esc(application.state || 'NJ') + '"><small class="field-error" data-field-error="state"></small></label><label><span>ZIP</span><input name="postalCode" required maxlength="10" inputmode="numeric" autocomplete="postal-code" value="' + esc(application.postalCode || '') + '"><small class="field-error" data-field-error="postalCode"></small></label><label><span>Driver license number</span><input name="driverLicenseId" required minlength="5" maxlength="24" autocomplete="off" autocapitalize="characters" spellcheck="false" value="' + esc(application.driverLicenseId || '') + '"><small class="field-error" data-field-error="driverLicenseId">Enter the complete number exactly as shown on the license.</small></label><label><span>License expiration</span><input name="driverLicenseExpires" required type="date" value="' + esc(application.driverLicenseExpires || '') + '"><small class="field-error" data-field-error="driverLicenseExpires"></small></label><label><span>Requested pickup date</span><input name="requestedPickupDate" required type="date" min="' + localDateKey(pickupMin) + '" max="' + localDateKey(pickupMax) + '" value="' + esc(proposedPickupDate) + '"><small class="field-error" data-field-error="requestedPickupDate"></small></label><label><span>Requested pickup time</span><select name="requestedPickupTime" data-pickup-time required disabled><option value="">Choose a date first</option>' + pickupOptions + '</select><small data-pickup-availability>' + (proposedPickupDate ? 'Review the original request and confirm an available time.' : 'Select a pickup date to see current openings.') + '</small><small class="field-error" data-field-error="requestedPickupTime"></small></label><label class="check-row wide"><input name="pickupAutopayConsent" type="checkbox" required><span>I understand this specific vehicle can be held for no more than seven days and my confirmed pickup date becomes my weekly automatic-payment weekday.</span></label><small class="field-error wide" data-field-error="pickupAutopayConsent"></small><button class="button primary wide" type="submit">Save profile and pickup request</button><div class="future-appointment wide"><strong>Need a date more than seven days away?</strong><p>Call the office for a general inventory appointment. The selected vehicle will not be held and available cars may vary.</p><a class="button secondary" href="tel:+18568391385">Call the office</a></div></form>') + '</div></article>' +
    '<article class="onboarding-card ' + (state.documents ? 'complete' : state.profile ? 'current' : 'locked') + '"><div class="step-number">2</div><div class="step-copy"><h2>Upload private screening files</h2><p>' + esc(documentIntro) + '</p>' + (state.documents ? '<div class="step-success">License front, license back, and current selfie received securely</div>' : state.profile ? documentForm : '<div class="step-locked">Complete your profile first.</div>') + '</div></article>' +
    '<article class="onboarding-card ' + (state.signature ? 'complete' : signatureReady ? 'current' : 'locked') + '"><div class="step-number">3</div><div class="step-copy"><h2>Review and sign the agreement</h2><p>This is agreement version ' + esc(template.version || 1) + '. The exact vehicle, VIN, pricing, pickup request, complete text, and signature certificate are locked together.</p>' + (state.signature ? '<div class="step-success">Agreement signed ' + esc(state.signatureRecord.signedAt || '') + '</div>' : signatureReady ? '<details class="contract-review"><summary>Read the complete agreement</summary><div class="contract-paper">' + esc(renderedContract).replace(/\n/g, '<br>') + '</div></details><form class="signature-form" data-onboarding-form="signature"><label><span>Type your full legal name</span><input name="typedName" required value="' + esc(application.name || '') + '"></label><label class="check-row"><input name="electronicConsent" type="checkbox" required><span>I consent to use electronic records and signatures and confirm I can access and retain this agreement.</span></label><label class="check-row"><input name="signatureMatchConsent" type="checkbox" required><span>I confirm this is my signature and it is consistent with the signature on my driver license.</span></label><div class="signature-pad-wrap"><span>Draw signature</span><canvas width="900" height="240" data-signature-pad></canvas><button type="button" class="button text" data-clear-signature>Clear signature</button><input type="hidden" name="signatureData" data-signature-data></div><button class="button primary" type="submit">Sign agreement</button></form>' : '<div class="step-locked">Upload the three private screening files first.</div>') + '</div></article>' +
    '<article class="onboarding-card ' + (state.card ? 'complete' : cardSetupReady ? 'current' : 'locked') + '"><div class="step-number">4</div><div class="step-copy"><h2>Save your card without a charge</h2><p>Your card is tokenized and stored by ' + esc(paymentProviderLabel) + '. WheelsonAuto never stores the full card number or CVV, and this step does not collect the deposit or weekly payment.</p>' + (state.card ? '<div class="step-success">' + esc(paymentProviderLabel) + ' card is saved and authorized</div>' : cardSetupReady ? '<form data-onboarding-form="card"><label class="check-row"><input name="autopayConsent" type="checkbox" required><span>I authorize WheelsonAuto to save this card and begin weekly automatic card payments only after approval, successful onboarding payments, and physical vehicle pickup.</span></label><button class="button primary" type="submit">Open secure ' + esc(paymentProviderLabel) + ' card setup</button></form>' : '<div class="step-locked">Sign the agreement first.</div>') + '</div></article>' +
    '<article class="onboarding-card ' + (state.finalApproved ? 'complete' : state.documents && state.signature && state.card ? 'current' : 'locked') + '"><div class="step-number">5</div><div class="step-copy"><h2>WheelsonAuto final review</h2><p>Staff reviews the application, license photos, selfie, signature, exact vehicle and VIN, agreement, pickup request, and saved-card status together.</p>' + (state.finalApproved ? '<div class="step-success">File approved by ' + esc(session.finalReviewedBy || 'WheelsonAuto') + '</div>' : state.documents && state.signature && state.card ? '<div class="step-waiting">Your completed file is ready for one final WheelsonAuto review. We will email you after approval or if a specific correction is needed.</div>' : '<div class="step-locked">Complete the screening files, agreement, and no-charge card setup first.</div>') + '</div></article>' +
    '<article class="onboarding-card ' + (state.identityVerified ? 'complete' : identityReady ? 'current' : 'locked') + '"><div class="step-number">6</div><div class="step-copy"><h2>Final Stripe Identity check</h2><p>Stripe checks a live driver license and matching selfie once, after WheelsonAuto approval. No Stripe Identity fee is triggered during the earlier screening steps.</p>' + (stripeIdentity ? identityStep : '<div class="step-success">Identity review completed through the selected staff process.</div>') + '</div></article>' +
    '<article class="onboarding-card ' + (state.deposit && state.firstWeek ? 'complete' : paymentReady ? 'current' : 'locked') + '"><div class="step-number">7</div><div class="step-copy"><h2>Complete required payments</h2><p>The nonrefundable down payment and first weekly payment are separate ' + esc(paymentProviderLabel) + ' transactions with separate receipts. The first weekly payment unlocks only after the deposit succeeds.</p>' + (paymentReady ? '<div class="payment-step-grid">' + (Number(pricing.downPayment || 0) <= 0 ? '<div><strong>Down payment</strong><span>No down payment required</span></div>' : state.deposit ? '<div><strong>Down payment</strong><span>Paid ' + money(pricing.downPayment) + '</span></div>' : '<form data-onboarding-form="payment"><input type="hidden" name="paymentType" value="deposit"><strong>Nonrefundable down payment</strong><span>' + money(pricing.downPayment) + '</span><button class="button primary" type="submit">Pay deposit</button></form>') + (state.firstWeek ? '<div><strong>First weekly payment</strong><span>Paid ' + money(pricing.weeklyPayment) + '</span></div>' : '<form data-onboarding-form="payment"><input type="hidden" name="paymentType" value="first_week"><strong>First weekly payment</strong><span>' + money(pricing.weeklyPayment) + '</span><button class="button primary" type="submit" ' + (!state.deposit ? 'disabled' : '') + '>Pay first week</button></form>') + '</div>' : '<div class="step-locked">WheelsonAuto approval and successful Stripe Identity verification are required before payment.</div>') + '</div></article>' +
    '<article class="onboarding-card ' + (state.insuranceSelected ? 'complete' : insuranceReady ? 'current' : 'locked') + '"><div class="step-number">8</div><div class="step-copy"><h2>Confirm insurance for pickup</h2><p>Full coverage must apply to the assigned vehicle and VIN. Upload proof now, or request help when you arrive.</p>' + (state.insuranceSelected ? (state.insuranceHelpAtPickup ? '<div class="step-waiting">Insurance help requested for pickup. The appointment can be reserved, but the vehicle cannot be released until staff verifies active coverage.</div>' : '<div class="step-success">Insurance proof received for ' + esc(assignedVin || vehicleTitle(vehicle)) + '</div>') : insuranceReady ? '<div class="insurance-choice-grid">' + insuranceUploadForm + insuranceHelpForm + '</div>' : '<div class="step-locked">Complete Stripe Identity and both required payments first.</div>') + '</div></article>' +
    '<article class="onboarding-card ' + (state.pickup ? 'complete' : state.insuranceSelected ? 'current' : 'locked') + '"><div class="step-number">9</div><div class="step-copy"><h2>Pickup and weekly autopay</h2><p>Pickup is ' + esc(settings.businessHours) + ' at ' + esc(settings.pickupAddress) + '. Weekly autopay remains off until staff records the physical handoff and verifies insurance for this VIN.</p>' + (state.pickup ? '<div class="step-success">Pickup reserved for ' + esc(state.pickupRecord.date) + ' at ' + esc(state.pickupRecord.time) + '. Bring your license and insurance information. Weekly autopay begins only after vehicle handoff.</div>' : state.insuranceSelected ? '<form data-onboarding-form="pickup"><button class="button primary" type="submit">Confirm pickup appointment</button></form>' : '<div class="step-locked">Choose an insurance option first.</div>') + '</div></article></section><div class="form-message floating-message" data-form-message></div>';
  return layout({ title: 'Secure onboarding', description: 'Complete your WheelsonAuto customer onboarding.', canonical: baseUrl + '/onboard/' + token, active: '', body, settings, pageClass: 'onboarding-view', homePath: options.homePath || '/', noIndex: true });
}

function contractTemplateHash(body) {
  return crypto.createHash('sha256').update(String(body || ''), 'utf8').digest('hex');
}

function renderContract(templateBody, values = {}) {
  return String(templateBody || '').replace(/{{([A-Z0-9_]+)}}/g, (match, key) => values[key] === undefined || values[key] === null || values[key] === '' ? '______________________________' : String(values[key]));
}

module.exports = {
  esc,
  slug,
  money,
  vehicleTitle,
  publicVehicleSlug,
  vehicleImages,
  publishedVehicles,
  publicSettings,
  pickupTimeSlots,
  localDateKey,
  layout,
  homeHtml,
  inventoryHtml,
  vehicleHtml,
  applicationHtml,
  onboardingHtml,
  onboardingStatus,
  contractTemplateHash,
  renderContract,
  CONTRACT_MONTHS,
  NATIVE_SITE_ASSET_VERSION,
  LOGO_URL,
  HERO_URL
};
