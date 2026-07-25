const { chromium } = require('playwright');

const baseUrl = process.env.WOA_AUDIT_BASE_URL || 'http://127.0.0.1:4340';
const browserExecutable = process.env.WOA_AUDIT_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const staffUser = process.env.WOA_AUDIT_STAFF_USERNAME || 'qa-admin';
const staffPassword = process.env.WOA_AUDIT_STAFF_PASSWORD || 'WoaUi348Pass';
const customerUser = process.env.WOA_AUDIT_CUSTOMER_USERNAME || 'ui.preview.348@example.com';
const customerPassword = process.env.WOA_AUDIT_CUSTOMER_PASSWORD || 'UiPreview348!';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function firstVisible(page, selector) {
  const rows = page.locator(selector);
  for (let index = 0; index < await rows.count(); index += 1) {
    const row = rows.nth(index);
    if (await row.isVisible()) return row;
  }
  return rows.first();
}

async function loginStaff(page) {
  await page.goto(baseUrl + '/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Username').fill(staffUser);
  await page.getByLabel('Password').fill(staffPassword);
  await Promise.all([
    page.waitForURL(url => url.pathname === '/'),
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

async function openStaffView(page, name) {
  const selector = '.sidebar button[data-view="' + name + '"],.quickbar button[data-view="' + name + '"]';
  let button = await firstVisible(page, selector);
  if (!(await button.isVisible())) {
    const group = await firstVisible(page, '.sidebar details:has(button[data-view="' + name + '"])>summary,.quickbar details:has(button[data-view="' + name + '"])>summary');
    if (await group.isVisible()) await group.click();
    const more = await firstVisible(page, 'details.quickbar-more>summary');
    button = await firstVisible(page, selector);
    if (!(await button.isVisible()) && await more.isVisible()) await more.click();
    button = await firstVisible(page, selector);
  }
  assert(await button.isVisible(), 'Could not open staff view ' + name + '.');
  const started = Date.now();
  await button.click();
  await page.waitForTimeout(180);
  const metric = await page.evaluate(() => window.__woaLastRenderMetric || null);
  assert(!metric || metric.ms < 750, name + ' render exceeded 750ms: ' + JSON.stringify(metric));
  assert(Date.now() - started < 1500, name + ' navigation felt stalled.');
}

function inside(inner, outer, tolerance = 2) {
  return inner && outer && inner.x >= outer.x - tolerance && inner.y >= outer.y - tolerance && inner.x + inner.width <= outer.x + outer.width + tolerance && inner.y + inner.height <= outer.y + outer.height + tolerance;
}

async function auditStaffDesktop(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await loginStaff(page);
  await openStaffView(page, 'Payments');
  const active = await firstVisible(page, '.view-payments-customers button[data-tab="Active"]');
  if (await active.isVisible()) {
    await active.click();
    await page.waitForTimeout(150);
  }
  const menus = page.locator('.view-payments-customers details.action-menu');
  assert(await menus.count() >= 2, 'Payments Active needs at least two More menus for the exclusivity audit.');
  const viewport = { x: 0, y: 0, width: 1440, height: 900 };
  await menus.nth(0).locator(':scope>summary').click();
  assert(await page.locator('details.action-menu[open]').count() === 1, 'Opening one More menu should leave exactly one menu open.');
  const firstPanel = await menus.nth(0).locator('.action-menu-panel').boundingBox();
  assert(inside(firstPanel, viewport), 'The first customer More menu is clipped: ' + JSON.stringify(firstPanel));
  await menus.nth(1).locator(':scope>summary').click();
  assert(await page.locator('details.action-menu[open]').count() === 1, 'Opening a second More menu must close the first.');
  assert(!(await menus.nth(0).getAttribute('open')), 'The first More menu stayed open after opening another.');
  await page.keyboard.press('Escape');
  assert(await page.locator('details.action-menu[open]').count() === 0, 'Escape must close customer More menus.');

  await openStaffView(page, 'Operations');
  const edit = await firstVisible(page, '.view-operations button[data-action="open-vehicle"]');
  assert(await edit.isVisible(), 'Operations has no visible vehicle Edit action.');
  await edit.click();
  const backdrop = page.locator('#modalBackdrop');
  await backdrop.waitFor({ state: 'visible' });
  const modal = backdrop.locator('.modal');
  assert(await modal.getAttribute('role') === 'dialog', 'Opened vehicle modal is missing dialog semantics.');
  assert(await modal.getAttribute('aria-modal') === 'true', 'Opened vehicle modal is missing aria-modal.');
  assert(inside(await modal.boundingBox(), viewport), 'Vehicle modal is clipped on desktop.');
  assert(await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('modal-close')), 'Modal focus did not move to the close control.');
  await page.keyboard.press('Escape');
  await backdrop.waitFor({ state: 'hidden' });
  await page.waitForFunction(element => document.activeElement === element, await edit.elementHandle(), { timeout: 500 });
  assert(await edit.evaluate(element => document.activeElement === element), 'Closing the modal did not return focus to the vehicle action.');

  for (const destination of ['Dashboard', 'Messages', 'Operations', 'Settings']) await openStaffView(page, destination);
  await context.close();
}

async function auditCustomerPhone(browser, marker) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await loginCustomer(page);

  await page.locator('.customer-action-hub a[href="#portal-settings"]').click();
  await page.waitForTimeout(100);
  const settingsMenu = page.locator('[data-customer-settings-menu]');
  const accountRow = settingsMenu.locator('[data-customer-settings-target="account"]');
  assert(await settingsMenu.isVisible() && await accountRow.isVisible(), 'Customer Settings menu did not render.');
  await accountRow.click();
  await page.waitForTimeout(120);
  assert(!(await settingsMenu.isVisible()), 'Settings menu stayed visible over its detail screen.');
  assert(await page.locator('[data-customer-settings-panel="account"]').isVisible(), 'Account detail screen did not open.');
  await page.locator('[data-customer-settings-panel="account"] [data-customer-settings-back]').click();
  await page.waitForTimeout(120);
  assert(await settingsMenu.isVisible(), 'Settings Back did not return to the category list.');

  await page.locator('.customer-action-hub a[href="#portal-messages"]').click();
  await page.waitForTimeout(120);
  const textarea = page.locator('[data-customer-message-form] textarea');
  const send = page.locator('[data-customer-message-form] button[type="submit"]');
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await textarea.focus();
  await page.waitForTimeout(120);
  assert(await page.locator('body.customer-message-keyboard-open').count() === 1, 'Customer message focus did not enter keyboard-safe mode.');
  const scrollAfter = await page.evaluate(() => window.scrollY);
  assert(Math.abs(scrollAfter - scrollBefore) < 120, 'Focusing the customer composer moved the entire page unexpectedly.');
  await textarea.fill(marker);
  const started = Date.now();
  const [messageResponse] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith('/customer/message') && response.request().method() === 'POST', { timeout: 5000 }),
    send.click()
  ]);
  const responseMs = Date.now() - started;
  const messageResult = await messageResponse.json().catch(() => ({}));
  assert(messageResponse.ok() && messageResult.ok, 'Customer message save failed: ' + messageResponse.status() + ' ' + JSON.stringify(messageResult));
  assert(responseMs < 3000, 'Customer message save exceeded 3 seconds: ' + responseMs + 'ms.');
  await page.locator('[data-customer-message-list] .customer-chat-bubble').filter({ hasText: marker }).waitFor({ state: 'visible', timeout: 800 });
  const optimisticMs = Date.now() - started;
  assert(optimisticMs < 800, 'Customer message did not appear optimistically: ' + optimisticMs + 'ms.');
  await page.waitForFunction(() => {
    const status = document.querySelector('[data-customer-message-status]');
    return status && status.textContent.includes('Delivered to WheelsonAuto.');
  }, null, { timeout: 3000 });
  const deliveredMs = Date.now() - started;
  assert(deliveredMs < 3000, 'Customer message delivery confirmation took too long: ' + deliveredMs + 'ms.');
  await textarea.evaluate(element => element.blur());
  await page.waitForTimeout(120);
  assert(await page.locator('body.customer-message-keyboard-open').count() === 0, 'Customer keyboard-safe mode did not clear after blur.');
  await context.close();
  return { optimisticMs, responseMs, deliveredMs };
}

async function auditStaffPhoneConversation(browser, marker) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await loginStaff(page);
  await openStaffView(page, 'Messages');
  const thread = page.locator('.message-thread-row').filter({ hasText: marker }).first();
  await thread.waitFor({ state: 'visible', timeout: 6500 });
  await thread.click();
  await page.locator('.message-inbox-shell.message-mobile-thread-open').waitFor({ state: 'visible' });
  assert(!(await page.locator('.view-messages>.message-focused-tabs').isVisible()), 'Message workspace tabs stayed visible inside a phone conversation.');
  const reply = page.locator('.message-reply-box');
  assert(await reply.isVisible(), 'Admin phone conversation has no reply composer.');
  const quickbar = page.locator('.quickbar');
  if (await quickbar.isVisible()) {
    const replyBounds = await reply.boundingBox();
    const navBounds = await quickbar.boundingBox();
    assert(replyBounds.bottom <= navBounds.y + 2, 'Admin reply composer is covered by phone navigation.');
  }
  await page.locator('button[data-action="message-mobile-back"]').click();
  await page.waitForTimeout(120);
  assert(await page.locator('.message-thread-list').isVisible(), 'Message Back did not restore the phone conversation list.');

  const bell = page.locator('.app-notification-bell');
  if (await bell.isVisible()) {
    await bell.click();
    const panel = page.locator('.app-notification-panel');
    await panel.waitFor({ state: 'visible' });
    assert(inside(await panel.boundingBox(), { x: 0, y: 0, width: 390, height: 844 }), 'Phone notification panel is clipped.');
    await page.locator('.app-notification-close').click();
  }
  await context.close();
}

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: browserExecutable });
  const marker = 'Interface audit ' + Date.now();
  try {
    await auditStaffDesktop(browser);
    const timing = await auditCustomerPhone(browser, marker);
    await auditStaffPhoneConversation(browser, marker);
    console.log('Interface interaction audit passed: exclusive menus, modal focus, fast navigation, customer Settings drill-down, optimistic message delivery, live staff inbox, compact mobile conversation, and notification bounds are verified.');
    console.log(JSON.stringify(timing));
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
