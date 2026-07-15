const {
  parseTollImportRows,
  tollImportMatch,
  prepareTollImport,
  importTollRows,
  tollReceiptText,
  tollReceiptHtml,
  rematchSavedTollClaims
} = require('../server');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function run() {
  const data = {
    vehicles: [{
      id: 'veh-toll-1',
      year: '2016',
      make: 'Ford',
      model: 'Escape',
      vin: '1FMCU0GX1GUA00001',
      plate: 'CUR123',
      tempTag: 'OLD-999',
      tracker: 'Tracker 12',
      currentCustomer: 'New Customer',
      status: 'Rented'
    }],
    customers: [
      { id: 'cus-old', name: 'Old Customer', phone: '8565550101', email: 'old@example.com' },
      { id: 'cus-new', name: 'New Customer', phone: '8565550102', email: 'new@example.com' }
    ],
    contracts: [
      { id: 'con-old', customer: 'Old Customer', vehicleId: 'veh-toll-1', vehicle: '2016 Ford Escape', startDate: '2026-01-01', endDate: '2026-06-30', status: 'History' },
      { id: 'con-new', customer: 'New Customer', vehicleId: 'veh-toll-1', vehicle: '2016 Ford Escape', startDate: '2026-07-01', status: 'Active' }
    ],
    recurringPayments: [],
    claims: [],
    auditLogs: []
  };
  const raw = [
    'POSTING DATE,TRANSACTION DATE,TAG/PLATE NUMBER,AGENCY,DESCRIPTION,ENTRY TIME,ENTRY PLAZA,ENTRY LANE,EXIT TIME,EXIT PLAZA,EXIT LANE,VEHICLE TYPE CODE,AMOUNT,PREPAID,PLAN/RATE,FARE TYPE,BALANCE',
    '07/14/2026,07/14/2026,-,NJ E-ZPass,Prepaid Payment,,-,-,17:52:48,-,-,-,$440.00,Y,-,-,$545.54',
    '07/15/2026,06/15/2026,OLD-999-NJ,DRPA,TOLL,,-,-,22:40:02,WWB,10W,2,($6.00),Y,BUSINESS,N,$532.04',
    '07/15/2026,07/10/2026,CUR123-NJ,NJTP,TOLL,18:31:06,8A,04e,18:48:32,9,09w,1,($7.25),Y,BUSINESS,N,$105.54',
    '07/15/2026,07/10/2026,CUR123-NJ,NJTP,TOLL,19:31:06,8A,05e,19:48:32,9,10w,1,($7.25),Y,BUSINESS,N,$98.29',
    '07/15/2026,07/10/2026,CUR123-NJ,NJTP,TOLL,18:31:06,8A,04e,18:48:32,9,09w,1,($7.25),Y,BUSINESS,N,$105.54',
    '07/15/2026,07/11/2026,UNKNOWN-NJ,GSP,TOLL,,-,-,10:02:00,KEY,07s,1,($4.00),Y,BUSINESS,N,$94.29',
    '07/15/2026,07/12/2026,CUR123-NJ,NJTP,TOLL,,-,-,11:30:00,10,05w,1,not-a-number,Y,BUSINESS,N,$94.29'
  ].join('\n');

  const parsed = parseTollImportRows({ raw });
  assert(parsed.length === 7, 'The exact E-ZPass export should parse every statement row.');
  assert(parsed[1].postingdate === '07/15/2026' && parsed[1].transactiondate === '06/15/2026', 'Posting and transaction dates must remain separate.');

  const historicalMatch = tollImportMatch(data, parsed[1]);
  assert(historicalMatch.customer === 'Old Customer', 'Old temp tag and toll date should match the historical customer.');
  assert(historicalMatch.vehicle && historicalMatch.vehicle.id === 'veh-toll-1', 'Historical toll should stay linked to the exact vehicle.');

  const currentMatch = tollImportMatch(data, parsed[2]);
  assert(currentMatch.customer === 'New Customer', 'Current plate and toll date should match the current customer.');

  const preview = prepareTollImport(data, { raw }, { role: 'Owner', organizationId: 'org-wheelsonauto' });
  assert(preview.summary.received === 7, 'Preview should count every statement row.');
  assert(preview.summary.importable === 4, 'Preview should include three matched tolls plus one unmatched review row.');
  assert(preview.summary.matched === 3, 'Preview should separate historical and current-customer tolls.');
  assert(preview.summary.unmatched === 1, 'Unknown plate should enter Match Review without guessing.');
  assert(preview.summary.duplicates === 1, 'Duplicate rows inside one file should be skipped.');
  assert(preview.summary.invalid === 2, 'Funding rows and invalid amounts should be skipped with feedback.');
  assert(preview.summary.accountActivity === 1, 'E-ZPass prepaid account funding must never become a customer toll.');

  const imported = await importTollRows(data, { raw }, { name: 'Owner admin', role: 'Owner', organizationId: 'org-wheelsonauto' });
  assert(imported.claims.length === 4 && data.claims.length === 4, 'Only valid, unique toll rows should become claims.');
  assert(data.claims.some(claim => claim.customer === 'Old Customer' && claim.plate === 'OLD-999-NJ'), 'Historical customer toll should be saved with the old tag.');
  assert(data.claims.some(claim => claim.customer === 'New Customer' && claim.tracker === 'Tracker 12'), 'Current customer toll should keep vehicle and tracker context.');
  assert(data.claims.some(claim => !claim.customer && claim.customerMatchStatus === 'Needs payment/customer match'), 'Unknown plate should stay unassigned for human review.');
  const historicalClaim = data.claims.find(claim => claim.customer === 'Old Customer');
  assert(historicalClaim.transactionDate === '2026-06-15' && historicalClaim.postingDate === '2026-07-15', 'Late-posted tolls must assign the customer using transaction date while preserving posting date.');
  assert(historicalClaim.receiptUrl && historicalClaim.receiptToken, 'Every imported toll should get a private receipt link.');
  assert(tollReceiptText(historicalClaim).includes('Transaction date: 2026-06-15'), 'Customer proof should include the true transaction date.');
  assert(tollReceiptHtml(historicalClaim).includes('Posted date') && !tollReceiptHtml(historicalClaim).includes('$532.04'), 'Receipt HTML should show posting date but never expose E-ZPass account balance.');
  const currentClaims = data.claims.filter(claim => claim.customer === 'New Customer');
  assert(currentClaims.length === 2 && currentClaims[0].reference !== currentClaims[1].reference, 'Two real same-day tolls with the same amount must remain separate when their trip details differ.');
  assert(data.auditLogs.length === 1, 'One compact audit record should summarize the import.');

  data.integrations = { tolls: { tagMappings: [{ tag: 'UNKNOWN-NJ', vehicleId: 'veh-toll-1' }] } };
  const rematched = rematchSavedTollClaims(data, { name: 'Owner admin', role: 'Owner', organizationId: 'org-wheelsonauto' });
  const learnedTagClaim = data.claims.find(claim => claim.plate === 'UNKNOWN-NJ');
  assert(rematched === 1 && learnedTagClaim.customer === 'New Customer' && learnedTagClaim.vehicleId === 'veh-toll-1', 'One saved E-ZPass tag mapping should rematch all existing rows using each transaction date.');

  const duplicatePreview = prepareTollImport(data, { raw }, { role: 'Owner', organizationId: 'org-wheelsonauto' });
  assert(duplicatePreview.summary.importable === 0, 'Re-importing the same statement must not create more claims.');
  assert(duplicatePreview.summary.duplicates === 5, 'Every previously imported valid row and repeated source row should be recognized as a duplicate.');

  console.log('Toll import check passed.');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
