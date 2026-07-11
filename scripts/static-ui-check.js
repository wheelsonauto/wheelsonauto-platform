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

const staticActions = unique(app.matchAll(/data-action="([^"]+)"/g), match => {
  const value = match[1];
  if (value.includes("'+") || value.includes('"+') || value.includes('+esc') || value.includes('${')) return '';
  return value;
});

const handledActions = new Set([
  ...unique(app.matchAll(/(?:^|[^\w.])a\s*===\s*['"]([^'"]+)['"]/g), match => match[1]),
  ...unique(app.matchAll(/b\.dataset\.action\s*===\s*['"]([^'"]+)['"]/g), match => match[1])
]);

const unhandled = staticActions.filter(action => !handledActions.has(action));
if (unhandled.length) {
  fail('Unhandled data-action button(s): ' + unhandled.join(', '));
}

console.log('Static UI check passed: ' + staticActions.length + ' button actions have handlers.');
