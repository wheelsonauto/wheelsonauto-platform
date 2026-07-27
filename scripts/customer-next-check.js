'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const server = read('server.js');
const api = read('customer-ui/api.ts');
const shell = read('customer-ui/CustomerApp.tsx');
const css = read('customer-ui/customer-next.css');
const sources = [api, shell];
const dist = path.join(root, 'customer-dist');
const entryPath = path.join(dist, 'customer-next.js');
const cssPath = path.join(dist, 'customer-next.css');

assert(fs.existsSync(entryPath) && fs.existsSync(cssPath), 'Build the React customer module before running this check.');
assert(server.includes("url.pathname === '/customer-next'"), 'Authenticated customer-next route is missing.');
assert(server.includes("customerExperiencePath(req, 'payments')") && server.includes("customerExperiencePath(req, 'vehicle')") && server.includes("customerExperiencePath(req, 'settings')"), 'Customer actions must return to the active customer experience.');
assert(server.includes('customerNextHtml(account)'), 'The customer preview must receive an authenticated account shell.');
assert(server.includes('generatedCustomerChunk') && server.includes("/^customer-dist\\/customer-[a-z0-9_-]+\\.js$/i"), 'Generated customer chunks are not safely allowlisted.');
assert(api.includes("'/api/customer/portal-state'") && api.includes("'/api/customer/notifications'"), 'The portal must use customer-scoped state and notifications.');
assert(api.includes("'/customer/message'") && api.includes("'/customer/document-update'"), 'Customer message and private-document commands are missing.');
assert(shell.includes("new EventSource('/api/customer/events')"), 'Customer live updates must use the authenticated event stream.');
assert(["'home'", "'messages'", "'payments'", "'vehicle'", "'settings'"].every(tab => shell.includes(tab)), 'The five customer workspaces are incomplete.');
assert(shell.includes('customer-message-page') && shell.includes('customer-message-back') && shell.includes('settings-open'), 'Focused mobile conversation/back and settings detail flows are missing.');
assert(['/customer/card-change', '/customer/receipt-request', '/customer/statement-request', '/customer/paid-outside'].every(action => shell.includes(action)), 'Customer payment support actions are incomplete.');
assert(shell.includes('payment-support-actions') && shell.includes('<details'), 'Secondary payment actions must stay inside one compact disclosure.');
assert(sources.every(source => !source.includes('/api/state')), 'The customer app must never read or save whole platform state.');
assert(sources.every(source => !source.includes('setInterval(')), 'The customer app must not add an independent polling loop.');
assert(css.includes('env(safe-area-inset-top)') && css.includes('env(safe-area-inset-bottom)'), 'Phone safe-area guards are missing.');
assert(css.includes('height: 100dvh') && css.includes('.tab-messages .customer-bottom-nav'), 'The mobile keyboard-safe conversation layout is incomplete.');
assert(css.includes('.customer-avatar { width: 35px; height: 35px; flex: 0 0 35px;') && css.includes('header > div:not(.customer-avatar)'), 'The customer conversation identity must keep a fixed avatar and let only the copy grow.');
assert(css.includes('.settings-page.settings-open .settings-detail'), 'Mobile settings must use focused list-to-detail navigation.');
assert(!css.includes('overflow-x: auto'), 'Customer pages must not rely on horizontal scrolling.');
assert(fs.statSync(entryPath).size < 235 * 1024, 'React customer JavaScript exceeds the 235 KB uncompressed budget.');
assert(fs.statSync(cssPath).size < 30 * 1024, 'React customer CSS exceeds the 30 KB uncompressed budget.');

console.log('Customer-next check passed: five scoped workspaces, live events, private commands, safe mobile conversation, focused settings, and bundle budgets are verified.');
