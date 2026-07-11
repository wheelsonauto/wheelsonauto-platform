const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const clientFiles = ['app.js', 'card-setup.js'];
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function cleanApiPath(value) {
  return String(value || '').split('?')[0].replace(/\/+$/, '') || '/';
}

function literalClientApiCalls(source) {
  const calls = [];
  const callRe = /(?:post|fetch)\(\s*(['"`])(\/api\/[^'"`?#)]*)\1/g;
  for (const match of source.matchAll(callRe)) calls.push(cleanApiPath(match[2]));
  return calls;
}

const clientCalls = unique(clientFiles.flatMap(file => {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  return literalClientApiCalls(source).map(apiPath => `${file}:${apiPath}`);
}));

const exactRoutes = new Set([...server.matchAll(/url\.pathname\s*===\s*['"`](\/api\/[^'"`]+)['"`]/g)].map(match => cleanApiPath(match[1])));
const prefixRoutes = unique([...server.matchAll(/url\.pathname\.startsWith\(\s*['"`](\/api\/[^'"`]+)['"`]/g)].map(match => cleanApiPath(match[1])));

function routeExists(apiPath) {
  if (exactRoutes.has(apiPath)) return true;
  return prefixRoutes.some(prefix => apiPath === prefix || apiPath.startsWith(prefix + '/'));
}

const missing = clientCalls
  .map(entry => {
    const [file, ...rest] = entry.split(':');
    return { file, apiPath: rest.join(':') };
  })
  .filter(entry => !routeExists(entry.apiPath));

if (missing.length) {
  const lines = missing.map(entry => `${entry.file} calls ${entry.apiPath}`);
  throw new Error('Frontend API calls without server route:\n' + lines.join('\n'));
}

console.log(
  'API route check passed: ' +
  clientCalls.length +
  ' frontend API call(s), ' +
  exactRoutes.size +
  ' exact route(s), ' +
  prefixRoutes.length +
  ' prefix route(s).'
);
