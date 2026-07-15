const crypto = require('crypto');

const LOGO_URL = 'https://www.wheelsonauto.com/cdn/shop/files/wheelsLOGO.png?v=1772299505&width=240';
const HERO_URL = 'https://www.wheelsonauto.com/cdn/shop/files/clean-luxury-car-hero-banner.png?v=1772796803&width=3840';
const CONTRACT_MONTHS = 19;

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
    '<link rel="stylesheet" href="/native-site.css?v=native-2-compact-hero">' +
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
    header(active, homePath) + '<main>' + body + '</main>' + footer(settings, homePath) + '<script src="/native-site-client.js?v=native-1" defer></script></body></html>';
}

function vehicleCard(vehicle, compact = false) {
  const down = Number(vehicle.downPayment || 0);
  const image = vehicle.imageUrl || vehicle.photoUrl || HERO_URL;
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
    [['01', 'Choose and apply', 'Select a currently published vehicle and create your secure application.'], ['02', 'Verify and sign', 'Upload your license and full-coverage insurance, then review and sign the exact agreement.'], ['03', 'Set up payments', 'After staff verification, save your card through Clover and complete the separate down payment and first weekly payment.'], ['04', 'Schedule pickup', 'Choose an available pickup within seven days. Your pickup date becomes your weekly autopay day.']].map(item => '<article><span>' + item[0] + '</span><h3>' + item[1] + '</h3><p>' + item[2] + '</p></article>').join('') + '</div></section>' +
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
  const image = vehicle.imageUrl || vehicle.photoUrl || HERO_URL;
  const body = '<section class="vehicle-detail"><div class="vehicle-detail-media"><img src="' + esc(image) + '" alt="' + esc(title) + '"><span>' + esc(vehicle.availability || 'Available') + '</span></div><div class="vehicle-detail-copy"><a class="back-link" href="/inventory">← Inventory</a><h1>' + esc(title) + '</h1><p class="vehicle-subtitle">' + esc([vehicle.color, vehicle.mileage ? Number(vehicle.mileage).toLocaleString() + ' miles' : '', vehicle.transmission].filter(Boolean).join(' · ') || 'WheelsonAuto long-term rental') + '</p><div class="price-panel"><div><span>Weekly payment</span><strong>' + money(vehicle.weeklyPayment) + '</strong></div><div><span>Nonrefundable down payment</span><strong>' + (down ? money(down) : '$0') + '</strong></div></div><div class="detail-list"><span>Customer must maintain full-coverage insurance</span><span>Minimum rental commitment: 30 days</span><span>Optional purchase eligibility after ' + esc(settings.contractMonths) + ' consecutive months in good standing</span><span>Pickup must be scheduled within seven days after onboarding</span></div><a class="button primary large full" href="/apply/' + encodeURIComponent(publicVehicleSlug(vehicle)) + '">Apply for this vehicle</a><p class="detail-disclaimer">Submitting an application does not guarantee approval or hold the vehicle. Pricing and vehicle terms are locked only when your agreement is created.</p></div></section>';
  return layout({ title, description: 'Apply for the ' + title + ' through WheelsonAuto.', canonical: baseUrl + '/vehicles/' + publicVehicleSlug(vehicle), active: 'inventory', body, settings, image, pageClass: 'vehicle-view', jsonLd: { '@context': 'https://schema.org', '@type': 'Product', name: title, image: [image], offers: { '@type': 'Offer', priceCurrency: 'USD', price: Number(vehicle.weeklyPayment || 0), availability: 'https://schema.org/InStock', url: baseUrl + '/vehicles/' + publicVehicleSlug(vehicle) } }, homePath: options.homePath || '/', noIndex: !!options.noIndex });
}

function applicationHtml(data, vehicle, baseUrl, options = {}) {
  const settings = publicSettings(data);
  const title = vehicleTitle(vehicle);
  const down = Number(vehicle.downPayment || 0);
  const body = '<section class="application-shell"><div class="application-summary"><a class="back-link" href="/vehicles/' + encodeURIComponent(publicVehicleSlug(vehicle)) + '">← Vehicle details</a><span class="eyebrow">Secure application</span><h1>' + esc(title) + '</h1><img src="' + esc(vehicle.imageUrl || vehicle.photoUrl || HERO_URL) + '" alt=""><div class="application-price"><span>' + money(vehicle.weeklyPayment) + '/week</span><span>' + (down ? money(down) + ' nonrefundable down payment' : 'No down payment') + '</span></div><p>This application does not charge your card. Payment and card setup unlock only after staff approval, document review, and signature verification.</p></div>' +
    '<form class="native-form application-form" id="nativeApplicationForm"><input type="hidden" name="onlineVehicleId" value="' + esc(vehicle.id) + '"><div class="form-title"><span>Secure application</span><h2>Create your application</h2><p>Use your legal information exactly as it appears on your driver license.</p></div>' +
    '<label><span>Legal first name</span><input name="firstName" required autocomplete="given-name"></label><label><span>Legal last name</span><input name="lastName" required autocomplete="family-name"></label>' +
    '<label><span>Mobile phone</span><input name="phone" required inputmode="tel" autocomplete="tel"></label><label><span>Email</span><input name="email" required type="email" autocomplete="email"></label>' +
    '<label class="wide"><span>Home address</span><input name="address" required autocomplete="street-address"></label><label><span>City</span><input name="city" required autocomplete="address-level2"></label><label><span>State</span><input name="state" required value="NJ" autocomplete="address-level1"></label><label><span>ZIP code</span><input name="postalCode" required inputmode="numeric" autocomplete="postal-code"></label><label><span>Date of birth</span><input name="dateOfBirth" required type="date"></label>' +
    '<label><span>Driver license number</span><input name="driverLicenseId" required autocomplete="off"></label><label><span>License expiration</span><input name="driverLicenseExpires" required type="date"></label>' +
    '<label><span>Employer</span><input name="employer" required></label><label><span>Monthly income</span><input name="income" required type="number" min="0" step="1" inputmode="decimal"></label>' +
    '<label><span>Create password</span><input name="password" required type="password" minlength="8" autocomplete="new-password"></label><label><span>Confirm password</span><input name="confirmPassword" required type="password" minlength="8" autocomplete="new-password"></label>' +
    '<label class="check-row wide"><input name="applicationConsent" type="checkbox" required><span>I confirm this information is accurate and authorize WheelsonAuto to review this application. I understand approval and vehicle availability are not guaranteed.</span></label>' +
    '<button class="button primary large wide" type="submit">Submit secure application</button><div class="form-message wide" data-form-message></div></form></section>';
  return layout({ title: 'Apply for ' + title, description: 'Submit a secure WheelsonAuto vehicle application.', canonical: baseUrl + '/apply/' + publicVehicleSlug(vehicle), active: 'inventory', body, settings, image: vehicle.imageUrl || vehicle.photoUrl, pageClass: 'apply-view', homePath: options.homePath || '/', noIndex: options.noIndex !== false });
}

function onboardingStatus(data, session, application) {
  const documents = (data.documents || []).filter(document => document.applicationId === application.id && document.onboardingSessionId === session.id);
  const signature = (data.eSignatures || []).find(item => item.applicationId === application.id && item.onboardingSessionId === session.id);
  const recurring = (data.recurringPayments || []).find(item => item.applicationId === application.id || item.onboardingSessionId === session.id) || {};
  const requests = (data.paymentRequests || []).filter(item => item.applicationId === application.id || item.onboardingSessionId === session.id);
  const depositRequest = requests.find(item => item.paymentType === 'Nonrefundable down payment');
  const firstWeekRequest = requests.find(item => item.paymentType === 'First weekly payment');
  const pickup = (data.pickupAppointments || []).find(item => item.applicationId === application.id && !/cancel/i.test(String(item.status || '')));
  const documentKinds = new Set(documents.map(document => document.documentKind));
  const cardReady = !!(recurring.cloverPaymentSource || recurring.paymentSourceId || recurring.cardLinkedAt || /chargeable|active|linked/i.test(String(recurring.status || recurring.paymentSetup || '')));
  const paid = request => !!(request && /paid|success/i.test(String(request.status || '')));
  return {
    profile: !!session.profileCompletedAt,
    documents: ['driver_license_front', 'driver_license_back', 'insurance'].every(kind => documentKinds.has(kind)),
    documentsApproved: session.documentReviewStatus === 'Approved',
    signature: !!signature,
    signatureApproved: session.signatureReviewStatus === 'Approved' && session.reviewStatus === 'Approved',
    card: cardReady,
    deposit: Number(application.pricingSnapshot && application.pricingSnapshot.downPayment || 0) <= 0 || paid(depositRequest),
    firstWeek: paid(firstWeekRequest),
    pickup: !!pickup,
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
  const signatureReady = state.documentsApproved;
  const paymentReady = state.signatureApproved;
  const allPaid = state.card && state.deposit && state.firstWeek;
  const pickupMin = new Date();
  pickupMin.setDate(pickupMin.getDate() + settings.minimumPickupDays);
  const pickupMax = new Date();
  pickupMax.setDate(pickupMax.getDate() + settings.maximumVehicleHoldDays);
  const dateKey = date => date.toISOString().slice(0, 10);
  const body = '<section class="onboarding-hero"><div><span class="eyebrow">Secure customer onboarding</span><h1>Welcome, ' + esc(application.name || 'customer') + '</h1><p>' + esc(vehicleTitle(vehicle)) + ' · ' + money(pricing.weeklyPayment) + '/week · ' + (Number(pricing.downPayment || 0) ? money(pricing.downPayment) + ' nonrefundable down payment' : 'No down payment') + '</p></div><div class="onboarding-progress">' +
    statusPill(state.profile, 'Profile + pickup') + statusPill(state.documents, 'Documents') + statusPill(state.documentsApproved, 'Document review', state.documents) + statusPill(state.signature, 'Agreement') + statusPill(state.signatureApproved, 'Signature review', state.signature) + statusPill(state.card, 'Card') + statusPill(state.deposit && state.firstWeek, 'Payments') + statusPill(state.pickup, 'Pickup') + '</div></section>' +
    '<section class="onboarding-grid" data-onboarding-token="' + esc(token) + '">' +
    '<article class="onboarding-card ' + (state.profile ? 'complete' : 'current') + '"><div class="step-number">1</div><div class="step-copy"><h2>Confirm your profile and pickup request</h2><p>Your legal information must match your driver license. The requested pickup date becomes the rental start date in your agreement and your weekly autopay weekday.</p>' + (state.profile ? '<div class="step-success">Profile completed · requested pickup ' + esc(session.requestedPickupDate || '') + ' at ' + esc(session.requestedPickupTime || '') + '</div>' : '<form class="native-form compact" data-onboarding-form="profile"><label class="wide"><span>Legal address</span><input name="address" required value="' + esc(application.address || '') + '"></label><label><span>City</span><input name="city" required value="' + esc(application.city || '') + '"></label><label><span>State</span><input name="state" required value="' + esc(application.state || 'NJ') + '"></label><label><span>ZIP</span><input name="postalCode" required value="' + esc(application.postalCode || '') + '"></label><label><span>Driver license number</span><input name="driverLicenseId" required value="' + esc(application.driverLicenseId || '') + '"></label><label><span>License expiration</span><input name="driverLicenseExpires" required type="date" value="' + esc(application.driverLicenseExpires || '') + '"></label><label><span>Insurance provider</span><input name="insuranceProvider" required value="' + esc(application.insuranceProvider || '') + '"></label><label><span>Policy number</span><input name="insurancePolicyNumber" required value="' + esc(application.insurancePolicyNumber || '') + '"></label><label><span>Requested pickup date</span><input name="requestedPickupDate" required type="date" min="' + dateKey(pickupMin) + '" max="' + dateKey(pickupMax) + '" value="' + esc(session.requestedPickupDate || '') + '"></label><label><span>Requested pickup time</span><select name="requestedPickupTime" required><option value="">Choose time</option><option>11:00 AM</option><option>12:00 PM</option><option>1:00 PM</option><option>2:00 PM</option><option>3:00 PM</option><option>4:00 PM</option></select></label><label class="check-row wide"><input name="pickupAutopayConsent" type="checkbox" required><span>I understand this specific vehicle can be held for no more than seven days and my confirmed pickup date becomes my weekly automatic-payment weekday.</span></label><button class="button primary wide" type="submit">Save profile and pickup request</button><div class="future-appointment wide"><strong>Need a date more than seven days away?</strong><p>Call the office for a general inventory appointment. The selected vehicle will not be held and available cars may vary.</p><a class="button secondary" href="tel:+18568391385">Call the office</a></div></form>') + '</div></article>' +
    '<article class="onboarding-card ' + (state.documents ? 'complete' : state.profile ? 'current' : 'locked') + '"><div class="step-number">2</div><div class="step-copy"><h2>Upload license and insurance</h2><p>Upload clear images. Full coverage must include liability, collision, and comprehensive coverage and list Wheels On Auto INC as owner and/or loss payee.</p>' + (state.documents ? '<div class="step-success">License front, license back, and insurance received</div>' : state.profile ? '<form class="native-form compact" data-onboarding-form="documents"><label><span>License front</span><input name="driver_license_front" type="file" accept="image/jpeg,image/png,application/pdf" required></label><label><span>License back</span><input name="driver_license_back" type="file" accept="image/jpeg,image/png,application/pdf" required></label><label class="wide"><span>Insurance proof</span><input name="insurance" type="file" accept="image/jpeg,image/png,application/pdf" required></label><button class="button primary wide" type="submit">Upload documents</button></form>' : '<div class="step-locked">Complete your profile first.</div>') + '</div></article>' +
    '<article class="onboarding-card ' + (state.documentsApproved ? 'complete' : state.documents ? 'current' : 'locked') + '"><div class="step-number">3</div><div class="step-copy"><h2>Document verification</h2><p>An owner or manager checks identity, license expiration, and full-coverage insurance before the agreement unlocks.</p>' + (state.documentsApproved ? '<div class="step-success">Documents approved by ' + esc(session.documentsReviewedBy || 'WheelsonAuto') + '</div>' : state.documents ? '<div class="step-waiting">Your documents are waiting for staff review. We will contact you if anything needs correction.</div>' : '<div class="step-locked">Upload all required documents first.</div>') + '</div></article>' +
    '<article class="onboarding-card ' + (state.signature ? 'complete' : signatureReady ? 'current' : 'locked') + '"><div class="step-number">4</div><div class="step-copy"><h2>Review and sign the agreement</h2><p>This is agreement version ' + esc(template.version || 1) + '. The pricing, pickup date, complete text, and signature certificate are permanently locked together.</p>' + (state.signature ? '<div class="step-success">Agreement signed ' + esc(state.signatureRecord.signedAt || '') + '</div>' : signatureReady ? '<details class="contract-review"><summary>Read the complete agreement</summary><div class="contract-paper">' + esc(renderedContract).replace(/\n/g, '<br>') + '</div></details><form class="signature-form" data-onboarding-form="signature"><label><span>Type your full legal name</span><input name="typedName" required value="' + esc(application.name || '') + '"></label><label class="check-row"><input name="electronicConsent" type="checkbox" required><span>I consent to use electronic records and signatures and confirm I can access and retain this agreement.</span></label><label class="check-row"><input name="signatureMatchConsent" type="checkbox" required><span>I confirm this is my signature and it is consistent with the signature on my driver license. WheelsonAuto will manually compare them before accepting it.</span></label><div class="signature-pad-wrap"><span>Draw signature</span><canvas width="900" height="240" data-signature-pad></canvas><button type="button" class="button text" data-clear-signature>Clear signature</button><input type="hidden" name="signatureData" data-signature-data></div><button class="button primary" type="submit">Sign agreement</button></form>' : '<div class="step-locked">Staff must approve the license and insurance first.</div>') + '</div></article>' +
    '<article class="onboarding-card ' + (state.signatureApproved ? 'complete' : state.signature ? 'current' : 'locked') + '"><div class="step-number">5</div><div class="step-copy"><h2>Signature verification</h2><p>An owner or manager manually compares the drawn signature with the driver-license signature and accepts the exact signed document hash.</p>' + (state.signatureApproved ? '<div class="step-success">Signature accepted by ' + esc(session.signatureReviewedBy || 'WheelsonAuto') + '</div>' : state.signature ? '<div class="step-waiting">Your signed agreement is waiting for staff comparison.</div>' : '<div class="step-locked">Sign the agreement first.</div>') + '</div></article>' +
    '<article class="onboarding-card ' + (state.card ? 'complete' : paymentReady ? 'current' : 'locked') + '"><div class="step-number">6</div><div class="step-copy"><h2>Save your card with Clover</h2><p>Your card is tokenized and stored by Clover. WheelsonAuto never stores the full card number or CVV.</p>' + (state.card ? '<div class="step-success">Card on file is linked and authorized</div>' : paymentReady ? '<form data-onboarding-form="card"><label class="check-row"><input name="autopayConsent" type="checkbox" required><span>I authorize WheelsonAuto to save this card with Clover. My first ' + money(pricing.weeklyPayment) + ' weekly payment is charged during onboarding and covers the week beginning on pickup; automatic weekly charges then continue every ' + esc(session.requestedPickupWeekday || 'pickup weekday') + ' under the signed agreement.</span></label><button class="button primary" type="submit">Open secure Clover card setup</button></form>' : '<div class="step-locked">Staff signature approval is required first.</div>') + '</div></article>' +
    '<article class="onboarding-card ' + (state.deposit && state.firstWeek ? 'complete' : state.card ? 'current' : 'locked') + '"><div class="step-number">7</div><div class="step-copy"><h2>Complete required payments</h2><p>The nonrefundable down payment and first weekly payment are separate Clover transactions with separate receipts. The first weekly payment unlocks only after the deposit succeeds.</p>' + (state.card ? '<div class="payment-step-grid">' + (Number(pricing.downPayment || 0) <= 0 ? '<div><strong>Down payment</strong><span>No down payment required</span></div>' : state.deposit ? '<div><strong>Down payment</strong><span>Paid ' + money(pricing.downPayment) + '</span></div>' : '<form data-onboarding-form="payment"><input type="hidden" name="paymentType" value="deposit"><strong>Nonrefundable down payment</strong><span>' + money(pricing.downPayment) + '</span><button class="button primary" type="submit">Pay deposit</button></form>') + (state.firstWeek ? '<div><strong>First weekly payment</strong><span>Paid ' + money(pricing.weeklyPayment) + '</span></div>' : '<form data-onboarding-form="payment"><input type="hidden" name="paymentType" value="first_week"><strong>First weekly payment</strong><span>' + money(pricing.weeklyPayment) + '</span><button class="button primary" type="submit" ' + (!state.deposit ? 'disabled' : '') + '>Pay first week</button></form>') + '</div>' : '<div class="step-locked">Save and authorize your card first.</div>') + '</div></article>' +
    '<article class="onboarding-card ' + (state.pickup ? 'complete' : allPaid ? 'current' : 'locked') + '"><div class="step-number">8</div><div class="step-copy"><h2>Pickup and weekly autopay</h2><p>Pickup is ' + esc(settings.businessHours) + ' at ' + esc(settings.pickupAddress) + '. Once both payments succeed, WheelsonAuto automatically confirms the requested appointment and writes its weekday into autopay.</p>' + (state.pickup ? '<div class="step-success">Pickup confirmed for ' + esc(state.pickupRecord.date) + ' at ' + esc(state.pickupRecord.time) + '. Weekly autopay runs every ' + esc(state.pickupRecord.weekday || session.autopayWeekday || '') + '.</div>' : allPaid ? '<div class="step-waiting">Payments are complete. Refresh this page once if the automatic appointment confirmation is still finishing.</div>' : '<div class="step-locked">Complete card setup and both required payments first.</div>') + '</div></article></section><div class="form-message floating-message" data-form-message></div>';
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
  publishedVehicles,
  publicSettings,
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
  LOGO_URL,
  HERO_URL
};
