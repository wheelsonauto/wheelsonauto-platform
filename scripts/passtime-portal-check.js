const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

assert(app.includes("target=\"woa-passtime\""), 'PassTime links must reuse one companion tab.');
assert(app.includes("window.open(link.href,'woa-passtime')"), 'Companion-tab launcher is missing.');
assert(app.includes('OASIS companion mode'), 'Portal-mode guidance is missing.');
assert(app.includes("roleName()==='mechanic'"), 'Mechanic location launcher guard is missing.');
assert(app.includes("data-view=\"Operations\" data-tab=\"Fleet\""), 'Fleet pairing shortcut is missing.');
assert(server.includes('PassTime OASIS portal mode'), 'Tracker status must identify portal mode.');
assert(server.includes('passTimePortalMode: !config.configured'), 'Portal readiness flag is missing.');
assert(server.includes("passTimeControlCommands: false"), 'PassTime control commands must stay disabled.');
assert(styles.includes('.passtime-portal-panel'), 'WheelsonAuto portal-mode styling is missing.');
assert(styles.includes('.tracker-portal-row'), 'Fleet tracker launcher styling is missing.');
const assetVersionMatch = server.match(/const ASSET_VERSION = '([^']+)'/);
assert(assetVersionMatch && assetVersionMatch[1], 'The server frontend asset version is missing.');
const assetVersion = assetVersionMatch[1];
assert(index.includes('/styles.css?v=' + assetVersion), 'The HTML stylesheet cache version must match the server release.');
assert(index.includes('/app.js?v=' + assetVersion), 'The HTML script cache version must match the server release.');
assert(index.includes('rel="preload" href="/app.js?v=' + assetVersion), 'The HTML script preload cache version must match the server release.');
assert(!app.includes("status:'Ready - PassTime API access needed'"), 'Frontend still labels portal mode as blocked on API access.');

console.log('PassTime portal checks passed: reusable OASIS tab, themed setup, role guard, and dormant control path are enforced.');
