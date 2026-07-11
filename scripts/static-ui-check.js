const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

function fail(message) {
  throw new Error(message);
}

function unique(matches, map) {
  return [...new Set([...matches].map(map).filter(Boolean))].sort();
}

function functionSlice(name) {
  let start = -1;
  let cursor = 0;
  while (true) {
    const next = app.indexOf('function ' + name + '(', cursor);
    if (next < 0) break;
    start = next;
    cursor = next + 1;
  }
  if (start < 0) return '';
  const argsClose = app.indexOf(')', start);
  const open = app.indexOf('{', argsClose > -1 ? argsClose : start);
  if (open < 0) return '';
  let depth = 0;
  for (let index = open; index < app.length; index += 1) {
    const char = app[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return app.slice(start, index + 1);
    }
  }
  return '';
}

function actionSlice(action) {
  const needles = [
    "a==='" + action + "'",
    'a==="' + action + '"',
    "b.dataset.action==='" + action + "'",
    'b.dataset.action==="' + action + '"',
    "b.dataset.action!=='" + action + "'",
    'b.dataset.action!=="' + action + '"'
  ];
  let index = -1;
  for (const needle of needles) index = Math.max(index, app.lastIndexOf(needle));
  if (index < 0) return '';
  return app.slice(Math.max(0, index - 2200), Math.min(app.length, index + 5200));
}

function assertIncludes(label, source, required) {
  if (!source) fail(label + ' block was not found.');
  const missing = required.filter(text => !source.includes(text));
  if (missing.length) fail(label + ' is missing: ' + missing.join(', '));
}

const staticActions = unique(app.matchAll(/data-action="([^"]+)"/g), match => {
  const value = match[1];
  if (value.includes("'+") || value.includes('"+') || value.includes('+esc') || value.includes('${')) return '';
  return value;
});

const handledActions = new Set([
  ...unique(app.matchAll(/(?:^|[^\w.])a\s*===\s*['"]([^'"]+)['"]/g), match => match[1]),
  ...unique(app.matchAll(/b\.dataset\.action\s*===\s*['"]([^'"]+)['"]/g), match => match[1])
]);
for (const block of app.matchAll(/\[((?:\s*['"][^'"]+['"]\s*,?)+)\]\.indexOf\((?:a|b\.dataset\.action)\)/g)) {
  for (const action of block[1].matchAll(/['"]([^'"]+)['"]/g)) handledActions.add(action[1]);
}

const unhandled = staticActions.filter(action => !handledActions.has(action));
if (unhandled.length) {
  fail('Unhandled data-action button(s): ' + unhandled.join(', '));
}

assertIncludes('Open modal active definition', functionSlice('openModal'), ['aria-hidden', "style.display='grid'"]);
assertIncludes('Close modal active definition', functionSlice('closeModal'), ['aria-hidden', "textContent=''", "innerHTML=''"]);
assertIncludes('Auto refresh modal guard', app, ["if(modal&&modal.style.display==='grid')return"]);
assertIncludes('Post-save refresh wrapper', app, ['var __wheelsonBaseSave=save', 'reconcileFleetCustomerLinks()', 'if(ok)await refreshData(true)']);

const criticalActionRequirements = [
  ['Vehicle save flow', 'save-vehicle', ['clearVehicleFromCustomerRecords', 'syncVehicleCustomerAssignment', 'await save()', 'closeModal()', "view='Operations'"]],
  ['Customer file save flow', 'save-contract-file', ['resolveCustomerFileVehicle', 'transferVehicleToCustomer', 'updateRecurringState', 'await save()', 'closeModal()', "tab=removed?'History':'Active'"]],
  ['Message send flow', 'send-message-now', ['/api/messages/send', 'channel:val', 'await refreshData(true)', 'closeModal()', "view='Messages'"]],
  ['Saved-card charge flow', 'charge-saved-card', ['/api/integrations/clover/manual-charge', 'Payment paid', 'Payment not found', 'await refreshData(true)']],
  ['Maintenance completion flow', 'confirm-complete-maintenance', ['isMonthlyMaintenance', 'addMonthsKey', 'await save()', 'closeModal()', 'Maintenance()']]
];
criticalActionRequirements.forEach(([label, action, required]) => assertIncludes(label, actionSlice(action), required));

const functionNames = new Set(unique(app.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g), match => match[1]));
const renderSlice = functionSlice('render');
if (!renderSlice) fail('Could not find render function.');
const renderMapMatch = renderSlice.match(/\(\{([^}]+)\}\[view\]\|\|Dashboard\)\(\)/);
const renderViews = new Map();
if (!renderMapMatch) fail('Could not find render view map.');
for (const match of renderMapMatch[1].matchAll(/'([^']+)'\s*:\s*([A-Za-z_$][\w$]*)/g)) {
  renderViews.set(match[1], match[2]);
}
renderViews.set('Apply', 'Apply');

const missingViewFunctions = [...renderViews.entries()].filter(([, fn]) => !functionNames.has(fn));
if (missingViewFunctions.length) {
  fail('Render view(s) point to missing function(s): ' + missingViewFunctions.map(([view, fn]) => `${view}->${fn}`).join(', '));
}

const staticViews = unique(app.matchAll(/data-view="([^"]+)"/g), match => {
  const value = match[1];
  if (value.includes("'+") || value.includes('"+') || value.includes('+esc') || value.includes('${')) return '';
  return value;
});
const missingStaticViews = staticViews.filter(view => !renderViews.has(view));
if (missingStaticViews.length) {
  fail('Static data-view target(s) do not render: ' + missingStaticViews.join(', '));
}

const navSlice = functionSlice('navForRole');
if (!navSlice) fail('Could not find navForRole function.');
const navArrayViews = unique(navSlice.matchAll(/'([^']+)'/g), match => {
  const value = match[1];
  if (['Owner', 'Manager', 'Mechanic'].includes(value)) return '';
  return /^[A-Z]/.test(value) ? value : '';
});
const missingNavViews = navArrayViews.filter(view => !renderViews.has(view));
if (missingNavViews.length) {
  fail('Navigation view(s) do not render: ' + missingNavViews.join(', '));
}

const duplicateFunctionNames = unique(app.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g), match => match[1])
  .filter(name => [...app.matchAll(new RegExp('function\\s+' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\(', 'g'))].length > 1);

console.log('Static UI check passed: ' + staticActions.length + ' button actions, ' + staticViews.length + ' static view links, and ' + renderViews.size + ' render views are wired.');
if (duplicateFunctionNames.length) console.log('Static UI check warning: duplicate function definitions present: ' + duplicateFunctionNames.join(', '));
