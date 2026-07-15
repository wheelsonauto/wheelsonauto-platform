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
  'Desktop, tablet, and phone'
].forEach(text => {
  if (!rules.includes(text)) fail('documented polish rule is missing: ' + text);
});

[
  '.main>.topbar>.account-actions{display:none!important}',
  '.account-settings-grid{display:grid',
  '.message-inbox-shell{height:calc(100dvh - 222px)',
  '.message-focused-list,.message-focused-review{height:calc(100dvh - 222px)',
  '.message-inbox-shell.message-mobile-thread-open .message-thread-list{display:none}',
  '.message-inbox-shell.message-mobile-thread-open .message-conversation-panel{display:grid}'
].forEach(text => {
  if (!css.includes(text)) fail('responsive polish guard is missing: ' + text);
});

if (/background\s*:\s*(#fff|white)\b/i.test(css.slice(css.lastIndexOf('/* Account/session actions live in Settings')))) {
  fail('a literal white background was added after the account/settings polish guard.');
}

console.log('UI polish regression check passed: account actions, compact surfaces, message reachability, role settings, and dark surfaces are guarded.');
