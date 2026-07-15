const assert = require('assert');
const { mapShopifyCatalogProducts, shopifyProductVin } = require('../server');

function product(id, title, vin, image, price = '229.00') {
  return {
    id,
    title,
    handle: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    body_html: '<p>Clean vehicle</p><p>VIN#' + vin + '</p>',
    image: { src: image },
    images: [{ src: image }],
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

console.log('Shopify inventory import checks passed.');
