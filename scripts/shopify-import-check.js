const assert = require('assert');
const { mapShopifyCatalogProducts, shopifyProductVin } = require('../server');
const nativeSite = require('../native-site');

function product(id, title, vin, image, price = '229.00') {
  return {
    id,
    title,
    handle: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    body_html: '<p>Clean vehicle</p><p>VIN#' + vin + '</p>',
    image: { src: image },
    images: [{ src: image }, { src: image.replace(/\.jpg$/, '-interior.jpg') }, { src: image.replace(/\.jpg$/, '-rear.jpg') }],
    variants: [{ available: true, price }]
  };
}

const vinA = '1J4NT1FA0BD123456';
const vinB = '1J4NT1FA0BD654321';
assert.strictEqual(shopifyProductVin(product('a', '2014 Jeep Compass', vinA, 'https://cdn.shopify.com/a.jpg')), vinA, 'VIN should be parsed from Shopify HTML.');

const data = {
  publicSite: { defaultWeeklyPayment: 229, defaultDownPayment: 485 },
  vehicles: [
    { id: 'fleet-a', year: '2014', make: 'Jeep', model: 'Compass', vin: vinA, plate: 'A-ONE' },
    { id: 'fleet-b', year: '2014', make: 'Jeep', model: 'Compass', vin: vinB, plate: 'B-TWO' }
  ],
  onlineVehicles: [
    {
      id: 'online-old-a',
      title: '2014 Jeep Compass',
      source: 'Imported from current Shopify catalog',
      sourceProductId: 'a',
      sourceHandle: '2014-jeep-compass-a',
      platformVehicleId: 'fleet-b',
      imageUrl: '/native-media/custom.jpg',
      sourceImageUrl: 'https://cdn.shopify.com/old.jpg',
      weeklyPayment: 250,
      downPayment: 0,
      published: false,
      description: 'Owner edited description'
    },
    { id: 'native-manual', title: '2018 Ford Fiesta', source: 'Native WheelsonAuto inventory', published: true }
  ]
};

const report = mapShopifyCatalogProducts(data, [
  product('a', '2014 Jeep Compass', vinA, 'https://cdn.shopify.com/a-new.jpg'),
  product('b', '2014 Jeep Compass', vinB, 'https://cdn.shopify.com/b.jpg')
]);

assert.strictEqual(report.rows.length, 2, 'Every Shopify vehicle should import even when titles are duplicated.');
assert.strictEqual(report.created, 1, 'One new Shopify row should be created.');
assert.strictEqual(report.updated, 1, 'One existing Shopify row should be updated.');
assert.strictEqual(report.linked, 2, 'Both duplicate-title cars should link by VIN.');
assert.strictEqual(report.rows.find(row => row.sourceProductId === 'a').platformVehicleId, 'fleet-a', 'VIN identity should correct a previously wrong title-based fleet link.');
assert.strictEqual(report.rows.find(row => row.sourceProductId === 'b').platformVehicleId, 'fleet-b', 'The second duplicate-title car should link to its own VIN.');
assert.strictEqual(report.rows.find(row => row.sourceProductId === 'a').imageUrl, '/native-media/custom.jpg', 'A locally edited image should be preserved.');
assert.strictEqual(report.rows.find(row => row.sourceProductId === 'b').imageUrl, 'https://cdn.shopify.com/b.jpg', 'New imports should use the Shopify CDN directly without blocking image downloads.');
assert.deepStrictEqual(report.rows.find(row => row.sourceProductId === 'b').imageUrls, ['https://cdn.shopify.com/b.jpg', 'https://cdn.shopify.com/b-interior.jpg', 'https://cdn.shopify.com/b-rear.jpg'], 'Every Shopify product photo should be retained in source order.');
assert.deepStrictEqual(report.rows.find(row => row.sourceProductId === 'a').imageUrls, ['/native-media/custom.jpg', 'https://cdn.shopify.com/a-new.jpg', 'https://cdn.shopify.com/a-new-interior.jpg', 'https://cdn.shopify.com/a-new-rear.jpg'], 'A custom cover should stay first while retaining the complete Shopify gallery.');
const galleryHtml = nativeSite.vehicleHtml({ publicSite: {} }, report.rows.find(row => row.sourceProductId === 'b'), 'https://wheelsonauto.com');
assert.strictEqual((galleryHtml.match(/data-gallery-slide=/g) || []).length, 3, 'The public vehicle page should render every imported photo as a swipeable slide.');
assert.strictEqual((galleryHtml.match(/data-gallery-thumb=/g) || []).length, 3, 'The public vehicle page should render a thumbnail for every imported photo.');
assert(galleryHtml.includes('1</b> / 3 photos'), 'The public vehicle page should show a clear gallery photo count.');
assert(galleryHtml.includes(nativeSite.NATIVE_SITE_ASSET_VERSION), 'Gallery CSS and JavaScript should use the current native-site cache version.');
assert.strictEqual(report.rows.find(row => row.sourceProductId === 'a').weeklyPayment, 250, 'Existing per-car pricing should be preserved.');
assert.strictEqual(report.rows.find(row => row.sourceProductId === 'a').downPayment, 0, 'A deliberately waived down payment should stay zero.');
assert(report.onlineVehicles.some(row => row.id === 'native-manual'), 'Native/manual inventory must never be removed by Shopify import.');
assert.throws(() => mapShopifyCatalogProducts({ vehicles: [], onlineVehicles: [] }, []), /empty product catalog/, 'An empty Shopify response must not alter inventory.');

const legacyReport = mapShopifyCatalogProducts({
  publicSite: {},
  onlineVehicles: [],
  vehicles: [
    { id: 'mirage-short-vin', year: '2019', make: 'Mitsubishi', model: 'Mirage white', vin: 'KH002653' },
    { id: 'mirage-typo', year: '2024', make: 'Mitsubishi', model: 'Merage', vin: 'ML32AUHJ1RH034508' }
  ]
}, [
  product('c', '2019 Mitsubishi Mirage', 'ML32A5HJXKH002653', 'https://cdn.shopify.com/c.jpg'),
  { ...product('d', '2024 Mitsubishi Mirage', 'ML32AUHJ1RH034508', 'https://cdn.shopify.com/d.jpg'), body_html: '<p>2024 inventory listing</p>' }
]);
assert.strictEqual(legacyReport.rows.find(row => row.sourceProductId === 'c').platformVehicleId, 'mirage-short-vin', 'A unique legacy VIN suffix should link safely.');
assert.strictEqual(legacyReport.rows.find(row => row.sourceProductId === 'd').platformVehicleId, 'mirage-typo', 'A unique same-year/make one-letter model typo should link safely.');

const makeAliasReport = mapShopifyCatalogProducts({
  publicSite: {},
  onlineVehicles: [],
  vehicles: [
    { id: 'sonic-sedan', year: '2014', make: 'Chevy', model: 'Sonic', vin: '' },
    { id: 'sonic-hatch', year: '2014', make: 'Chevy', model: 'Sonic Hatch', vin: '' }
  ]
}, [{ ...product('e', '2014 Chevrolet Sonic', '1G1JC6SB7E4207183', 'https://cdn.shopify.com/e.jpg'), body_html: '<p>2014 inventory listing</p>' }]);
assert.strictEqual(makeAliasReport.rows[0].platformVehicleId, 'sonic-sedan', 'Chevy/Chevrolet aliases should prefer the unique exact model over a similar hatchback.');

console.log('Shopify inventory import checks passed.');
