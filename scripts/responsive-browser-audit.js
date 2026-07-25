const fs = require('fs');
const { chromium } = require('playwright');

const baseUrl = process.env.WOA_AUDIT_BASE_URL || 'http://127.0.0.1:4340';
const staffUser = process.env.WOA_AUDIT_STAFF_USERNAME || 'qa-admin';
const staffPassword = process.env.WOA_AUDIT_STAFF_PASSWORD || 'WoaUi348Pass';
const customerUser = process.env.WOA_AUDIT_CUSTOMER_USERNAME || 'ui.preview.348@example.com';
const customerPassword = process.env.WOA_AUDIT_CUSTOMER_PASSWORD || 'UiPreview348!';
const outputDir = process.env.WOA_AUDIT_OUTPUT_DIR || '/tmp/wheelsonauto-responsive-audit';
const browserExecutable = process.env.WOA_AUDIT_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const viewports = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 }
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function visibleLocator(page, selector) {
  const rows = page.locator(selector);
  for (let index = 0; index < await rows.count(); index += 1) {
    const row = rows.nth(index);
    if (await row.isVisible()) return row;
  }
  return rows.first();
}

async function layoutAudit(page, label) {
  const result = await page.evaluate(() => {
    const root = document.documentElement;
    const main = document.querySelector('main,.main');
    const clippedControls = [...document.querySelectorAll('button,summary,a.btn,.customer-app-tabs a')]
      .filter(element => {
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || element.getClientRects().length === 0) return false;
        return element.scrollWidth > element.clientWidth + 2 && /hidden|clip/.test(style.overflow + ' ' + style.overflowX);
      })
      .map(element => String(element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80));
    return {
      viewportWidth: root.clientWidth,
      documentWidth: root.scrollWidth,
      mainWidth: main && main.scrollWidth,
      mainClientWidth: main && main.clientWidth,
      clippedControls,
      nestedCards: document.querySelectorAll('.card .card').length
    };
  });
  assert(result.documentWidth <= result.viewportWidth + 2, label + ' has horizontal page overflow: ' + JSON.stringify(result));
  assert(!result.mainWidth || result.mainWidth <= result.mainClientWidth + 2, label + ' main workspace overflows: ' + JSON.stringify(result));
  assert(result.clippedControls.length === 0, label + ' clips controls: ' + result.clippedControls.join(', '));
  assert(result.nestedCards === 0, label + ' contains nested cards.');
  return result;
}

async function loginStaff(page) {
  await page.goto(baseUrl + '/login', { waitUntil: 'domcontentloaded' });
  if (!/\/login(?:\?|$)/.test(page.url())) return;
  await page.getByLabel('Username').fill(staffUser);
  await page.getByLabel('Password').fill(staffPassword);
  await Promise.all([
    page.waitForURL(url => !/\/login(?:\?|$)/.test(url.pathname + url.search)),
    page.getByRole('button', { name: 'Sign in' }).click()
  ]);
}

async function loginCustomer(page) {
  await page.goto(baseUrl + '/customer/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Username, email, or phone').fill(customerUser);
  await page.getByLabel('Password').fill(customerPassword);
  await Promise.all([
    page.waitForURL(url => url.pathname === '/customer'),
    page.getByRole('button', { name: 'Sign in' }).click()
  ]);
}

async function auditStaff(browser, viewport) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
  const page = await context.newPage();
  await loginStaff(page);
  await page.screenshot({ path: outputDir + '/staff-dashboard-' + viewport.name + '.png', fullPage: false });
  const dashboard = await layoutAudit(page, 'staff dashboard ' + viewport.name);
  await (await visibleLocator(page, 'button[data-view="Operations"]')).click();
  await page.waitForTimeout(80);
  await page.screenshot({ path: outputDir + '/staff-operations-' + viewport.name + '.png', fullPage: false });
  const operations = await layoutAudit(page, 'staff operations ' + viewport.name);
  await (await visibleLocator(page, 'button[data-view="Messages"]')).click();
  await page.waitForTimeout(80);
  await page.screenshot({ path: outputDir + '/staff-messages-' + viewport.name + '.png', fullPage: false });
  const messages = await layoutAudit(page, 'staff messages ' + viewport.name);
  if (viewport.name === 'phone') {
    const more = page.locator('.message-tabs-more>summary');
    assert(await more.isVisible(), 'staff messages phone is missing the compact More menu.');
    await more.click();
    const morePanel = page.locator('.message-tabs-more-panel');
    assert(await morePanel.isVisible(), 'staff messages phone More menu did not open.');
    const moreBounds = await morePanel.boundingBox();
    assert(moreBounds && moreBounds.x >= 0 && moreBounds.x + moreBounds.width <= viewport.width + 1, 'staff messages phone More menu is clipped: ' + JSON.stringify(moreBounds));
  }
  await context.close();
  return { dashboard, operations, messages };
}

async function auditCustomer(browser, viewport) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
  const page = await context.newPage();
  await loginCustomer(page);
  await page.screenshot({ path: outputDir + '/customer-home-' + viewport.name + '.png', fullPage: false });
  const home = await layoutAudit(page, 'customer home ' + viewport.name);
  await page.locator('a[href="#portal-messages"]').click();
  await page.waitForTimeout(80);
  await page.screenshot({ path: outputDir + '/customer-messages-' + viewport.name + '.png', fullPage: false });
  const messages = await layoutAudit(page, 'customer messages ' + viewport.name);
  if (viewport.name === 'phone') {
    const composer = await page.evaluate(() => {
      const nav = document.querySelector('.customer-app-tabs');
      const input = document.querySelector('#portal-messages textarea,.customer-conversation-panel textarea');
      if (!nav || !input) return { present: false };
      const navRect = nav.getBoundingClientRect();
      const inputRect = input.getBoundingClientRect();
      return { present: true, inputBottom: inputRect.bottom, navTop: navRect.top, overlap: inputRect.bottom > navRect.top + 1 };
    });
    assert(!composer.present || composer.overlap === false, 'customer phone composer is covered by bottom navigation: ' + JSON.stringify(composer));
  }
  await context.close();
  return { home, messages };
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: browserExecutable });
  const report = {};
  try {
    for (const viewport of viewports) {
      report[viewport.name] = {
        staff: await auditStaff(browser, viewport),
        customer: await auditCustomer(browser, viewport)
      };
    }
  } finally {
    await browser.close();
  }
  console.log('Responsive browser audit passed: phone, tablet, and desktop staff/customer surfaces have no horizontal overflow, clipped controls, nested cards, or covered customer composer.');
  console.log(JSON.stringify({ outputDir, viewports: Object.keys(report) }, null, 2));
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
