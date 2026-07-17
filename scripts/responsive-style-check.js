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
requireText('Final text-fit guard', 'Final text-fit guard: cards must wrap long names, VIN/tag lines, service notes, and message previews instead of clipping.');
requireText('iPhone zoom guard', 'font-size:16px!important');
requireText('Mobile sticky modal actions', '.modal-body>.actions:last-child');
requireText('Mobile quickbar fixed position', 'position:fixed');
requireText('Mobile quickbar safe-area padding', 'safe-area-inset-bottom');
requireText('Mobile quickbar labels', '.quickbar button span');
requireText('Mobile staff logo removal', '.admin-shell>.sidebar{display:none!important}');
requireText('Progressive action menu', '.action-menu-panel{');
requireText('Mobile tabs wrap guard', 'Mobile tab fit guard: section tabs wrap instead of clipping off-screen.');
requireText('Mobile Operations tab grid', '.admin-shell .view-operations>.staff-tabs');
requireText('Mobile manager tab grid', '.admin-shell .view-manager-portal>.staff-tabs');
requireText('Mobile summary card grid', '.admin-shell .view-payments>.stats,');
requireText('Dark mobile table rows', 'background:#151b21!important');
requireText('Compact desktop Reports flow', '.admin-shell .view-reports{');
requireText('Focused Companies workspace', 'Companies is a focused workspace: one selected job, no stacked readiness walls.');
requireText('Companies phone tab grid', '.view-companies>.company-tabs{');
requireText('Companies compact overview', '.companies-overview-grid{');
requireText('Solid mobile modal footer', 'background:#111820!important');
requireText('Website command full-width guard', '.view-website>.native-site-command{grid-column:1/-1!important}');
requireText('Website inventory desktop span', '.view-website>.native-inventory-board{grid-column:1/8!important;margin:0}');
requireText('Website applications desktop span', '.view-website>.native-website-apps{grid-column:8/-1!important;margin:0}');
requireText('Applications workspace full-width guard', '.view-applications>.native-applications-board{grid-column:1/-1!important;margin:0}');
requireBlock('Mobile wrapped tabs', '.admin-shell .tabs{', ['grid-template-columns:repeat(auto-fit,minmax(72px,1fr))', 'overflow:visible!important']);

requireBlock('Dark modal surface', '.modal{', ['background:linear-gradient', 'rgba(24,27,30,.98)', 'border-color:rgba(255,255,255,.13)', '!important']);
requireBlock('Modal inner cards', '.modal .card,', ['background:rgba(255,255,255,.045)', 'filter:none']);
requireBlock('Modal hover readability', '.modal .card:hover,', ['background:rgba(255,255,255,.065)', 'filter:none', 'transform:none']);
requireBlock('Message cards readability', '.view-messages .message-thread-card,', ['background:rgba(255,255,255,.06)', 'filter:none', 'backdrop-filter:none']);
requireBlock('Message hover readability', '.view-messages .message-thread-card:hover,', ['background:rgba(240,184,58,.10)', 'filter:none', 'backdrop-filter:none']);
requireBlock('Mechanic portal cards', '.view-mechanic-portal .mechanic-card,', ['background:rgba(255,255,255,.06)', '!important']);
requireBlock('Mechanic/manager hover cards', '.view-mechanic-portal .mechanic-card:hover,', ['background:rgba(240,184,58,.10)', 'filter:none', 'transform:none']);
requireBlock('Customer pay cards', '.admin-shell .customer-pay-card{', ['background:rgba(255,255,255,.055)', '!important']);
requireBlock('Customer pay hover cards', '.admin-shell .customer-pay-card:hover{', ['background:rgba(240,184,58,.10)', '!important']);
requireBlock('Text-fit card containers', '.admin-shell .customer-pay-card,', ['min-width:0']);
requireBlock('Text-fit card text', '.admin-shell .customer-pay-card strong,', ['overflow-wrap:anywhere', 'max-width:100%', 'word-break:normal']);
requireBlock('Text-fit row children', '.admin-shell .customer-pay-top>div,', ['min-width:0']);
requireBlock('Closeout print mode', 'body.print-closeout-mode .closeout-board{', ['position:absolute!important', 'background:rgb(255,255,255)!important', 'box-shadow:none!important']);
requireBlock('Closeout print button hiding', 'body.print-closeout-mode .closeout-board .btn,', ['display:none!important']);
requireAnyBlock('Customer portal shell', '.customer-portal{', ['min-height:100vh', 'display:grid', 'gap:18px']);
requireAnyBlock('Customer portal hero', '.customer-hero{', ['width:min(1180px,100%)', 'grid-template-columns:1fr minmax(0,1.4fr) auto', 'border-radius:14px']);
requireAnyBlock('Customer portal summary grid', '.customer-summary-grid{', ['grid-template-columns:repeat(4,minmax(0,1fr))']);
requireAnyBlock('Customer portal detail grid', '.customer-grid{', ['grid-template-columns:repeat(2,minmax(0,1fr))']);
requireAnyBlock('Customer portal mobile shell', '.customer-portal{', ['padding:12px']);
requireAnyBlock('Customer portal mobile summary grid', '.customer-summary-grid{', ['grid-template-columns:repeat(2,minmax(0,1fr))']);
requireAnyBlock('Customer portal mobile detail grid', '.customer-grid{', ['grid-template-columns:1fr']);
requireAnyBlock('Customer portal compact action hub', '.customer-action-hub{', ['grid-template-columns:repeat(7,minmax(0,1fr))']);
requireText('Customer portal mobile focused workspaces', '.customer-mobile-focused .customer-grid{display:none}');
requireText('Customer portal mobile visible workspace', '.customer-mobile-focused .customer-panel.portal-mobile-visible{display:block}');
requireText('Customer portal duplicate action helper removal', '.customer-next-actions{display:none}');

const finalGuard = css.slice(css.indexOf('Final no-blur pass: every staff information surface stays sharp on hover.'));
if (finalGuard.split('\n').some(line => /^\s*filter\s*:\s*blur/i.test(line))) {
  fail('A blur filter appears after the final no-blur guard.');
}
const lateBackdropSelectors = [...finalGuard.matchAll(/([^{}]+)\{[^{}]*backdrop-filter\s*:\s*(?!none)([^;}]+)/gi)]
  .map(match => match[1].trim())
  .filter(selector => !/(?:\.admin-shell \.topbar|\.login-card|\.modal-backdrop)/.test(selector));
if (lateBackdropSelectors.length) {
  fail('Backdrop glass is limited to shell surfaces, not information cards:\n' + lateBackdropSelectors.join('\n'));
}

const lateWhiteBackgrounds = finalGuard
  .split('\n')
  .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
  .filter(item => /background\s*:\s*(#fff|white)\b/i.test(item.line))
  .filter(item => !item.line.includes('.modal-head .btn'));
if (lateWhiteBackgrounds.length) {
  fail('Late literal white background(s) after no-blur guard:\n' + lateWhiteBackgrounds.map(item => item.line).join('\n'));
}

console.log('Responsive style check passed: mobile, desktop, modal, hover, and no-blur CSS guards are present.');
