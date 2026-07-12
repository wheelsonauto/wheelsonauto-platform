const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

function fail(message) {
  throw new Error(message);
}

function requireText(label, text) {
  if (!css.includes(text)) fail(label + ' is missing.');
}

function requireBlock(label, selector, required) {
  const index = css.lastIndexOf(selector);
  if (index < 0) fail(label + ' selector is missing: ' + selector);
  const block = css.slice(index, css.indexOf('}', index) + 1);
  required.forEach(text => {
    if (!block.includes(text)) fail(label + ' is missing "' + text + '".');
  });
}

function requireAnyBlock(label, selector, required) {
  const blocks = [];
  let index = -1;
  while (true) {
    index = css.indexOf(selector, index + 1);
    if (index < 0) break;
    blocks.push(css.slice(index, css.indexOf('}', index) + 1));
  }
  if (!blocks.length) fail(label + ' selector is missing: ' + selector);
  const found = blocks.some(block => required.every(text => block.includes(text)));
  if (!found) fail(label + ' is missing one block containing: ' + required.join(', '));
}

requireText('Phone breakpoint', '@media(max-width:760px)');
requireText('Tablet/dashboard breakpoint', '@media(max-width:920px)');
requireText('Desktop layout breakpoint', '@media(min-width:921px)');
requireText('Wide-screen layout guard', '@media(min-width:1500px)');
requireText('Ultra-wide layout guard', '@media(min-width:1900px)');
requireText('Fast tab switch guard', 'body.fast-tab-switch');
requireText('Final no-blur guard', 'Final no-blur pass: every staff information surface stays sharp on hover.');
requireText('Fleet/service no-white-hover guard', 'Fleet/service rows: keep hover readable. These rows were washing white on hover.');
requireText('Final modal polish guard', 'Final modal polish: keep every popup readable across admin, manager, mechanic, and public flows.');
requireText('iPhone zoom guard', 'font-size:16px!important');
requireText('Mobile sticky modal actions', '.modal-body>.actions:last-child');
requireText('Mobile quickbar fixed position', 'position:fixed');
requireText('Mobile quickbar safe-area padding', 'safe-area-inset-bottom');
requireText('Mobile quickbar labels', '.quickbar button span');
requireText('Mobile tabs wrap guard', 'Mobile tab fit guard: section tabs wrap instead of clipping off-screen.');
requireBlock('Mobile wrapped tabs', '.admin-shell .tabs{', ['grid-template-columns:repeat(auto-fit,minmax(72px,1fr))', 'overflow:visible!important']);

requireBlock('Dark modal surface', '.modal{', ['background:linear-gradient', '#111820', 'border-color:rgba(240,184,58,.42)', '!important']);
requireBlock('Modal inner cards', '.modal .card,', ['background:rgba(255,255,255,.055)', 'filter:none']);
requireBlock('Modal hover readability', '.modal .card:hover,', ['background:rgba(240,184,58,.10)', 'filter:none', 'transform:none']);
requireBlock('Message cards readability', '.view-messages .message-thread-card,', ['background:rgba(255,255,255,.06)', 'filter:none', 'backdrop-filter:none']);
requireBlock('Message hover readability', '.view-messages .message-thread-card:hover,', ['background:rgba(240,184,58,.10)', 'filter:none', 'backdrop-filter:none']);
requireBlock('Mechanic portal cards', '.view-mechanic-portal .mechanic-card,', ['background:rgba(255,255,255,.06)', '!important']);
requireBlock('Mechanic/manager hover cards', '.view-mechanic-portal .mechanic-card:hover,', ['background:rgba(240,184,58,.10)', 'filter:none', 'transform:none']);
requireBlock('Customer pay cards', '.admin-shell .customer-pay-card{', ['background:rgba(255,255,255,.055)', '!important']);
requireBlock('Customer pay hover cards', '.admin-shell .customer-pay-card:hover{', ['background:rgba(240,184,58,.10)', '!important']);
requireAnyBlock('Customer portal shell', '.customer-portal{', ['min-height:100vh', 'display:grid', 'gap:18px']);
requireAnyBlock('Customer portal hero', '.customer-hero{', ['width:min(1180px,100%)', 'grid-template-columns:1fr minmax(0,1.4fr) auto', 'border-radius:14px']);
requireAnyBlock('Customer portal summary grid', '.customer-summary-grid{', ['grid-template-columns:repeat(4,minmax(0,1fr))']);
requireAnyBlock('Customer portal detail grid', '.customer-grid{', ['grid-template-columns:repeat(2,minmax(0,1fr))']);
requireAnyBlock('Customer portal mobile shell', '.customer-portal{', ['padding:12px']);
requireAnyBlock('Customer portal mobile summary grid', '.customer-summary-grid{', ['grid-template-columns:repeat(2,minmax(0,1fr))']);
requireAnyBlock('Customer portal mobile detail grid', '.customer-grid{', ['grid-template-columns:1fr']);

const finalGuard = css.slice(css.indexOf('Final no-blur pass: every staff information surface stays sharp on hover.'));
if (/filter\s*:\s*blur/i.test(finalGuard)) fail('A blur filter appears after the final no-blur guard.');
if (/backdrop-filter\s*:\s*(?!none)/i.test(finalGuard)) fail('A non-none backdrop-filter appears after the final no-blur guard.');

const lateWhiteBackgrounds = finalGuard
  .split('\n')
  .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
  .filter(item => /background\s*:\s*(#fff|white)\b/i.test(item.line))
  .filter(item => !item.line.includes('.modal-head .btn'));
if (lateWhiteBackgrounds.length) {
  fail('Late literal white background(s) after no-blur guard:\n' + lateWhiteBackgrounds.map(item => item.line).join('\n'));
}

console.log('Responsive style check passed: mobile, desktop, modal, hover, and no-blur CSS guards are present.');
