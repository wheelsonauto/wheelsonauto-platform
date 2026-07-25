const fs = require('fs');
const { chromium } = require('playwright');

const baseUrl = process.env.WOA_AUDIT_BASE_URL || 'http://127.0.0.1:4340';
const staffUser = process.env.WOA_AUDIT_STAFF_USERNAME || 'qa-admin';
const staffPassword = process.env.WOA_AUDIT_STAFF_PASSWORD || 'WoaUi348Pass';
const customerUser = process.env.WOA_AUDIT_CUSTOMER_USERNAME || 'ui.preview.348@example.com';
const customerPassword = process.env.WOA_AUDIT_CUSTOMER_PASSWORD || 'UiPreview348!';
const managerUser = process.env.WOA_AUDIT_MANAGER_USERNAME || '';
const managerPassword = process.env.WOA_AUDIT_MANAGER_PASSWORD || '';
const mechanicUser = process.env.WOA_AUDIT_MECHANIC_USERNAME || '';
const mechanicPassword = process.env.WOA_AUDIT_MECHANIC_PASSWORD || '';
const outputDir = process.env.WOA_AUDIT_OUTPUT_DIR || '/tmp/wheelsonauto-responsive-audit';
const browserExecutable = process.env.WOA_AUDIT_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const allViewports = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'wide', width: 1920, height: 1080 }
];
const requestedViewports = String(process.env.WOA_AUDIT_VIEWPORTS || '').split(',').map(value => value.trim()).filter(Boolean);
const requestedRoles = String(process.env.WOA_AUDIT_ROLES || 'staff,customer,manager,mechanic').split(',').map(value => value.trim()).filter(Boolean);
const viewports = requestedViewports.length ? allViewports.filter(viewport => requestedViewports.includes(viewport.name)) : allViewports;

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

async function openStaffView(page, name) {
  const navigationSelector = '.sidebar button[data-view="' + name + '"],.quickbar button[data-view="' + name + '"]';
  let destination = await visibleLocator(page, navigationSelector);
  if (!(await destination.isVisible())) {
    const groupSelector = '.sidebar details:has(button[data-view="' + name + '"])>summary,.quickbar details:has(button[data-view="' + name + '"])>summary';
    const group = await visibleLocator(page, groupSelector);
    if (await group.isVisible()) await group.click();
    const mobileMore = page.locator('details.quickbar-more>summary').first();
    destination = await visibleLocator(page, navigationSelector);
    if (!(await destination.isVisible()) && await mobileMore.count() && await mobileMore.isVisible()) await mobileMore.click();
    destination = await visibleLocator(page, navigationSelector);
  }
  if (!(await destination.isVisible())) {
    destination = await visibleLocator(page, 'button[data-view="' + name + '"]');
  }
  assert(await destination.isVisible(), 'Could not reach staff workspace ' + name + '.');
  await destination.click();
  await page.waitForTimeout(220);
  const metric = await page.evaluate(() => window.__woaLastRenderMetric || null);
  assert(!metric || metric.ms < 750, name + ' render exceeded 750ms: ' + JSON.stringify(metric));
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
    const clippedNavigationLabels = [...document.querySelectorAll('.nav-button-main>span,.quickbar button>span:last-child,.customer-app-tabs a>span:last-child')]
      .filter(element => element.getClientRects().length && element.scrollWidth > element.clientWidth + 2)
      .map(element => String(element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80));
    const workspaceOverflow = main ? [...main.querySelectorAll('*')]
      .filter(element => {
        if (!element.getClientRects().length) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const internallyWide = element.scrollWidth > element.clientWidth + 2 && !/auto|scroll/.test(style.overflowX);
        const outsideWorkspace = rect.right > main.getBoundingClientRect().right + 2 || rect.left < main.getBoundingClientRect().left - 2;
        return internallyWide || outsideWorkspace;
      })
      .slice(0, 12)
      .map(element => ({
        node: element.tagName.toLowerCase() + (element.className ? '.' + String(element.className).trim().replace(/\s+/g, '.') : ''),
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        text: String(element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 70)
      })) : [];
    const overlappingSearchControls = [...document.querySelectorAll('.local-search')]
      .filter(search => search.getClientRects().length)
      .map(search => {
        const field = search.querySelector('.search-field');
        const button = search.querySelector('.search-all');
        if (!field || !button || !field.getClientRects().length || !button.getClientRects().length) return null;
        const fieldRect = field.getBoundingClientRect();
        const buttonRect = button.getBoundingClientRect();
        return buttonRect.left < fieldRect.right - 1 ? {
          fieldRight: Math.round(fieldRect.right),
          buttonLeft: Math.round(buttonRect.left),
          placeholder: String(search.querySelector('input') && search.querySelector('input').placeholder || '').slice(0, 80)
        } : null;
      })
      .filter(Boolean);
    return {
      viewportWidth: root.clientWidth,
      documentWidth: root.scrollWidth,
      mainWidth: main && main.scrollWidth,
      mainClientWidth: main && main.clientWidth,
      clippedControls,
      clippedNavigationLabels,
      workspaceOverflow,
      overlappingSearchControls,
      nestedCards: document.querySelectorAll('.card .card').length
    };
  });
  assert(result.documentWidth <= result.viewportWidth + 2, label + ' has horizontal page overflow: ' + JSON.stringify(result));
  assert(!result.mainWidth || result.mainWidth <= result.mainClientWidth + 2, label + ' main workspace overflows: ' + JSON.stringify(result));
  assert(result.clippedControls.length === 0, label + ' clips controls: ' + result.clippedControls.join(', '));
  assert(result.clippedNavigationLabels.length === 0, label + ' clips navigation labels: ' + result.clippedNavigationLabels.join(', '));
  assert(result.overlappingSearchControls.length === 0, label + ' overlaps search controls: ' + JSON.stringify(result.overlappingSearchControls));
  assert(result.nestedCards === 0, label + ' contains nested cards.');
  return result;
}

async function loginStaff(page, username = staffUser, password = staffPassword) {
  await page.goto(baseUrl + '/login', { waitUntil: 'domcontentloaded' });
  if (!/\/login(?:\?|$)/.test(page.url())) return;
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await Promise.all([
    page.waitForURL(url => !/\/login(?:\?|$)/.test(url.pathname + url.search)),
    page.getByRole('button', { name: 'Sign in' }).click()
  ]);
}

async function auditRole(browser, viewport, role) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
  const page = await context.newPage();
  await loginStaff(page, role.username, role.password);
  await page.waitForTimeout(220);
  await page.screenshot({ path: outputDir + '/' + role.slug + '-home-' + viewport.name + '.png', fullPage: false });
  const views = {};
  for (const view of role.views) {
    await openStaffView(page, view);
    views[view] = await layoutAudit(page, role.slug + ' ' + view + ' ' + viewport.name);
    if (view === role.detailView) {
      await page.screenshot({ path: outputDir + '/' + role.slug + '-' + view.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + viewport.name + '.png', fullPage: false });
    }
  }
  await context.close();
  return views;
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
  await page.waitForTimeout(220);
  await page.screenshot({ path: outputDir + '/staff-dashboard-' + viewport.name + '.png', fullPage: false });
  const dashboard = await layoutAudit(page, 'staff dashboard ' + viewport.name);
  await openStaffView(page, 'Payments');
  const payments = await layoutAudit(page, 'staff payments ' + viewport.name);
  const todayTab = await visibleLocator(page, '.view-payments-customers button[data-tab="Today"]');
  assert(await todayTab.isVisible(), 'Could not reach Payments Today on ' + viewport.name + '.');
  await todayTab.click();
  await page.waitForTimeout(120);
  const paymentsToday = await layoutAudit(page, 'staff payments today ' + viewport.name);
  await openStaffView(page, 'Operations');
  await page.screenshot({ path: outputDir + '/staff-operations-' + viewport.name + '.png', fullPage: false });
  const operations = await layoutAudit(page, 'staff operations ' + viewport.name);
  await openStaffView(page, 'Messages');
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
    await more.click();
  }
  await openStaffView(page, 'Website');
  const website = await layoutAudit(page, 'staff website ' + viewport.name);
  await openStaffView(page, 'Settings');
  const settings = await layoutAudit(page, 'staff settings ' + viewport.name);
  await context.close();
  return { dashboard, payments, paymentsToday, operations, messages, website, settings };
}

async function auditCustomer(browser, viewport) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
  const page = await context.newPage();
  await loginCustomer(page);
  await page.waitForTimeout(220);
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
  const customerViews = {};
  for (const destination of ['payments', 'vehicle', 'settings']) {
    await page.locator('.customer-app-tabs a[href="#portal-' + destination + '"]').click();
    await page.waitForTimeout(120);
    assert(await page.evaluate(() => window.scrollY <= 2), 'customer ' + destination + ' ' + viewport.name + ' retained the previous tab scroll position.');
    customerViews[destination] = await layoutAudit(page, 'customer ' + destination + ' ' + viewport.name);
    await page.screenshot({ path: outputDir + '/customer-' + destination + '-' + viewport.name + '.png', fullPage: false });
  }
  await context.close();
  return { home, messages, ...customerViews };
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: browserExecutable });
  const report = {};
  try {
    for (const viewport of viewports) {
      report[viewport.name] = {};
      if (requestedRoles.includes('staff')) report[viewport.name].staff = await auditStaff(browser, viewport);
      if (requestedRoles.includes('customer')) report[viewport.name].customer = await auditCustomer(browser, viewport);
      if (requestedRoles.includes('manager') && managerUser && managerPassword) report[viewport.name].manager = await auditRole(browser, viewport, {
        slug: 'manager',
        username: managerUser,
        password: managerPassword,
        views: ['Manager Portal', 'Customers', 'Operations', 'Messages', 'Reports', 'Settings'],
        detailView: 'Customers'
      });
      if (requestedRoles.includes('mechanic') && mechanicUser && mechanicPassword) report[viewport.name].mechanic = await auditRole(browser, viewport, {
        slug: 'mechanic',
        username: mechanicUser,
        password: mechanicPassword,
        views: ['Mechanic Portal', 'Maintenance', 'Fleet', 'Claims & Issues', 'Settings'],
        detailView: 'Maintenance'
      });
    }
  } finally {
    await browser.close();
  }
  console.log('Responsive browser audit passed: phone, tablet, desktop, and wide staff/customer workspaces and configured role portals have no overflow, clipped navigation, nested cards, slow renders, or covered customer composer.');
  console.log(JSON.stringify({ outputDir, viewports: Object.keys(report) }, null, 2));
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
