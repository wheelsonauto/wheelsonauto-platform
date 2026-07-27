'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const server = read('server.js');
const api = read('staff-ui/api.ts');
const shell = read('staff-ui/StaffApp.tsx');
const messages = read('staff-ui/messages/MessagesPage.tsx');
const dispatch = read('staff-ui/dispatch/DispatchPage.tsx');
const maintenance = read('staff-ui/maintenance/MaintenancePage.tsx');
const dashboard = read('staff-ui/dashboard/DashboardPage.tsx');
const serviceDashboard = read('staff-ui/dashboard/ServiceDashboardPage.tsx');
const fleet = read('staff-ui/fleet/FleetPage.tsx');
const customers = read('staff-ui/customers/CustomersPage.tsx');
const payments = read('staff-ui/payments/PaymentsPage.tsx');
const applications = read('staff-ui/applications/ApplicationsPage.tsx');
const rentals = read('staff-ui/rentals/RentalFilePage.tsx');
const systems = read('staff-ui/systems/SystemsPage.tsx');
const css = read('staff-ui/staff-next.css');
const sourceFiles = [api, shell, messages, dispatch, maintenance, dashboard, serviceDashboard, fleet, customers, payments, applications, rentals, systems];
const dist = path.join(root, 'staff-dist');
const entryPath = path.join(dist, 'staff-next.js');
const cssPath = path.join(dist, 'staff-next.css');

assert(fs.existsSync(entryPath) && fs.existsSync(cssPath), 'Build the React staff module before running this check.');
assert(server.includes("(url.pathname === '/' || url.pathname === '/staff-next')") && server.includes('staffNextHtml(user)'), 'The authenticated staff root is not cut over to the new role workspace.');
assert(server.includes("url.pathname === '/staff-legacy'") && server.includes('Only the owner can open the emergency legacy workspace.'), 'The guarded owner-only emergency legacy route is missing.');
assert(server.includes('WOA_LOCAL_STAFF_PREVIEW_ROLE') && server.includes("requestedRole === 'mechanic'"), 'Isolated role preview support is missing.');
assert(!server.slice(server.indexOf("url.pathname === '/staff-next'"), server.indexOf("url.pathname.startsWith('/api/')", server.indexOf("url.pathname === '/staff-next'"))).includes('mechanic'), 'The shared staff shell must not block mechanic accounts.');
assert(shell.includes("roleWorkspaceAccess"), 'Role-scoped navigation is missing from the staff app.');
assert(shell.includes("ServiceDashboardPage") && serviceDashboard.includes('Mechanic workspace'), 'Mechanic service dashboard is missing from the staff app.');
assert(server.includes('generatedStaffChunk') && server.includes("/^staff-dist\\/staff-[a-z0-9_-]+\\.js$/i"), 'Generated React workspace chunks are not safely allowlisted by the server.');
assert(!server.includes('/staff-dist/staff-next.js?v='), 'The staff entry must have one canonical module URL so lazy chunks do not initialize a second React runtime.');
assert(shell.includes("id: 'dashboard'") && shell.includes("id: 'fleet'") && shell.includes("id: 'customers'") && shell.includes("id: 'messages'") && shell.includes("id: 'more'"), 'The five-item mobile information architecture is incomplete.');
assert(shell.includes('DesktopNavigation') && shell.includes('MobileNavigation'), 'Desktop rail and mobile bottom navigation must be separate responsive controls.');
assert(api.includes("'/api/messages/feed?limit=800'") && api.includes("'/api/messages/send'") && api.includes("'/api/messages/ai-reply'"), 'Messages is not using its scoped feed/send/Star commands.');
assert(api.includes("'/api/tasks?limit=200'") && api.includes("'/api/maintenance?limit=200'") && api.includes("'/api/vehicles?limit=200'"), 'Operations workspaces are not using scoped feeds.');
assert(api.includes("'/api/customers?limit=200'") && api.includes("'/api/payments?limit=200'") && api.includes("'/api/applications/live-feed'"), 'Business workspaces are not using scoped feeds.');
assert(api.includes("'/api/api-providers'") && systems.includes('Provider status is evidence-based and never guessed.'), 'Owner Systems must expose honest provider evidence.');
assert(server.includes('providers: apiProviderRows(data)'), 'Systems must receive computed provider truth instead of only manually saved setup rows.');
assert(api.includes('/api/rentals/${encodeURIComponent(id)}') && api.includes('RETURN_RENTAL_VEHICLE') && rentals.includes('completeRentalReturn'), 'The canonical Rental File detail and physical-return workflow are incomplete.');
assert(shell.includes("next === 'rental'") && shell.includes('onOpenRental={openRental}'), 'Rental File focused routing is not connected from staff resources.');
assert(api.includes("method: 'PATCH'") && fleet.includes('updateVehicle') && customers.includes('updateCustomer'), 'Exact customer and vehicle edit commands are missing.');
assert(dispatch.includes("new EventSource('/api/events')") && maintenance.includes("new EventSource('/api/events')") && messages.includes("new EventSource('/api/events')"), 'Live operation refreshes must share the authenticated event stream.');
assert(sourceFiles.every(source => !source.includes('/api/state')), 'The new React platform must not read or save whole platform state.');
assert(sourceFiles.every(source => !source.includes('setInterval(')), 'The new React platform must not add independent polling loops.');
assert(css.includes('@media(max-width:720px)') && css.includes('.detail-back') && css.includes('.staff-mobile-nav'), 'Full-screen mobile detail/back and bottom navigation are missing.');
assert(css.includes('env(safe-area-inset-top)') && css.includes('env(safe-area-inset-bottom)'), 'Phone safe-area guards are missing.');
assert(css.includes('body:has(.next-messages.has-thread) .staff-mobile-nav'), 'The mobile keyboard/message layout does not remove the bottom nav from an open conversation.');
assert(css.includes('.rental-file-workspace') && css.includes('.rental-overview-grid'), 'Rental File desktop/mobile presentation is missing.');

const jsFiles = fs.readdirSync(dist).filter(file => file.endsWith('.js'));
const chunkFiles = jsFiles.filter(file => file !== 'staff-next.js');
const totalJs = jsFiles.reduce((sum, file) => sum + fs.statSync(path.join(dist, file)).size, 0);
assert(chunkFiles.length >= 9, 'Expected lazy workspace chunks were not generated.');
assert(fs.statSync(entryPath).size < 230 * 1024, 'React staff entry exceeds the 230 KB uncompressed shell budget.');
assert(chunkFiles.every(file => fs.statSync(path.join(dist, file)).size < 20 * 1024), 'A lazy workspace exceeds the 20 KB uncompressed module budget.');
assert(totalJs < 320 * 1024, 'Total React staff JavaScript exceeds the 320 KB uncompressed product budget.');
assert(fs.statSync(cssPath).size < 36 * 1024, 'React staff CSS exceeds the 36 KB uncompressed multi-workspace budget.');

console.log('Staff-next check passed: 12-workspace shell, scoped APIs, live events, exact edits, mobile detail flow, safe generated assets, and product bundle budgets are verified.');
