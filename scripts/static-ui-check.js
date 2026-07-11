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
  const start = app.indexOf('function ' + name + '(');
  if (start < 0) return '';
  const open = app.indexOf('{', start);
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
