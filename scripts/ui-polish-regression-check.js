const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const rules = fs.readFileSync(path.join(root, 'UI-POLISH-RULES.md'), 'utf8');

function fail(message) {
  throw new Error('UI polish regression: ' + message);
}

function activeFunction(name) {
  const start = app.lastIndexOf('function ' + name + '(');
  if (start < 0) fail(name + ' function is missing.');
  const open = app.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = open; index < app.length; index += 1) {
    const char = app[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return app.slice(start, index + 1);
    }
  }
  fail(name + ' function could not be parsed.');
}

const compactShellStart = app.lastIndexOf('shell=function compactAccountShell');
if (compactShellStart < 0) fail('compact account shell assignment is missing.');
const shell = app.slice(compactShellStart, app.indexOf('function auditRenderedSurface', compactShellStart));
if (shell.includes('account-actions')) fail('page headers must not render account action containers.');
if (shell.includes('reset-password')) fail('Reset password must stay inside Settings.');
if (shell.includes('/logout')) fail('Log out must stay inside Settings.');

[
  'function settingsAccountPanel()',
  "['Account','Account']",
  'data-action="reset-password"',
  'href="/logout"',
  "if(selected==='Account')body+=settingsAccountPanel()"
].forEach(text => {
  if (!app.includes(text)) fail('account settings guard is missing: ' + text);
});

[
  'function auditRenderedSurface()',
  'Duplicate tab',
  "querySelectorAll('.card .card')",
  'Horizontal page overflow',
  'requestAnimationFrame(auditRenderedSurface)'
].forEach(text => {
  if (!app.includes(text)) fail('compact surface audit is missing: ' + text);
});

[
  'No duplicate workspaces',
  'No nested cards',
  'No unnecessary cards',
  'No action walls',
  'Desktop, tablet, and phone'
].forEach(text => {
  if (!rules.includes(text)) fail('documented polish rule is missing: ' + text);
});

const focusedPayments = activeFunction('PaymentsFocused');
for (const action of ['sync-all', 'reactivate-customer', 'new-autopay']) {
  const count = (focusedPayments.match(new RegExp('data-action="' + action + '"', 'g')) || []).length;
  if (count !== 1) fail('PaymentsFocused must expose one ' + action + ' action, found ' + count + '.');
}

[
  '.main>.topbar>.account-actions{display:none!important}',
  '.account-settings-grid{display:grid',
  '.message-inbox-shell{height:calc(100dvh - 222px)',
  '.message-focused-list,.message-focused-review{height:calc(100dvh - 222px)',
  '.message-inbox-shell.message-mobile-thread-open .message-thread-list{display:none}',
  '.message-inbox-shell.message-mobile-thread-open .message-conversation-panel{display:grid}',
  'Unified website-level charcoal glass workspace.',
  '--staff-canvas:#0d0f10',
  '--staff-panel:#181b1e',
  '--staff-panel-raised:#202326',
  '--staff-accent:#d5b15f',
  'background:linear-gradient(155deg,rgba(213,177,95,.035),rgba(255,255,255,.018) 42%,rgba(255,255,255,.008)),rgba(24,27,30,.95)!important',
  'background:linear-gradient(145deg,rgba(240,217,147,.18),rgba(213,177,95,.07)),rgba(24,27,30,.94)!important',
  'background:linear-gradient(145deg,rgba(226,91,82,.18),rgba(142,45,42,.08)),rgba(27,24,25,.96)!important',
  'background:linear-gradient(145deg,rgba(83,199,132,.16),rgba(42,117,78,.07))!important',
  'background:linear-gradient(145deg,rgba(106,172,238,.15),rgba(57,101,148,.06))!important',
  'box-shadow:inset 0 1px 0 rgba(255,255,255,.11)'
].forEach(text => {
  if (!css.includes(text)) fail('responsive polish guard is missing: ' + text);
});

[
  'function actionMenu(label,buttons)',
  'function customerFileInline(name)',
  "actionMenu('More'",
  'actions customer-file-actions',
  '<button class="btn primary" data-action="new-autopay">Add autopay</button>',
  '.admin-shell>.sidebar{display:none!important}',
  '.action-menu-panel{'
].forEach(text => {
  if (!(app + css).includes(text)) fail('action hierarchy/mobile shell guard is missing: ' + text);
});

if (css.includes('--staff-accent:#6673be') || css.includes('rgba(119,131,203,.12)')) {
  fail('the retired blue-wash staff theme returned.');
}
if (css.slice(css.indexOf('Unified website-level charcoal glass workspace.')).includes('background:linear-gradient(180deg,var(--staff-accent-bright),var(--staff-accent))')) {
  fail('solid gold staff buttons returned instead of the customer-portal glass treatment.');
}

if (/background\s*:\s*(#fff|white)\b/i.test(css.slice(css.lastIndexOf('/* Account/session actions live in Settings')))) {
  fail('a literal white background was added after the account/settings polish guard.');
}

console.log('UI polish regression check passed: account actions, compact surfaces, message reachability, role settings, and dark surfaces are guarded.');
