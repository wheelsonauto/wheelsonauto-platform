'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { stateForUserRead } = require('../server');
const { firstUserArgument } = require('./cli-arguments');

const root = path.resolve(__dirname, '..');
const noteCollections = ['customers', 'contracts', 'vehicles'];
const compactNoteLimit = 12 * 1024;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function collectionRows(data = {}) {
  return noteCollections.flatMap(key => Array.isArray(data[key]) ? data[key].map(row => ({ key, row: row || {} })) : []);
}

function checkClientStateBudget(label, source) {
  const sourceBytes = Buffer.byteLength(JSON.stringify(source), 'utf8');
  const sourceLargeNotes = collectionRows(source).filter(({ row }) => String(row.notes || '').length > compactNoteLimit);
  const client = stateForUserRead(source, {
    id: 'owner',
    username: 'owner',
    name: 'Owner admin',
    role: 'Owner',
    organizationId: 'org-wheelsonauto'
  });
  const clientBytes = Buffer.byteLength(JSON.stringify(client), 'utf8');
  const clientRows = collectionRows(client);
  const omittedNotes = clientRows.filter(({ row }) => row.notesOmitted === true);
  const visibleOversizedNotes = clientRows.filter(({ row }) => String(row.notes || '').length > compactNoteLimit);
  const rowCount = Object.values(client).reduce((total, value) => total + (Array.isArray(value) ? value.length : 0), 0);
  const budgetBytes = Math.max(160 * 1024, 48 * 1024 + rowCount * 3 * 1024);

  assert.strictEqual(visibleOversizedNotes.length, 0, label + ' must never ship full oversized notes in a normal dashboard state.');
  assert(omittedNotes.length >= sourceLargeNotes.length, label + ' must preserve an omitted-note marker for every oversized source note.');
  assert(clientBytes <= budgetBytes, label + ' client state is ' + clientBytes + ' bytes, exceeding its ' + budgetBytes + '-byte response budget.');
  if (sourceLargeNotes.length) {
    assert(clientBytes < sourceBytes * 0.6, label + ' did not materially compact its oversized source notes.');
  }
  return { sourceBytes, clientBytes, rowCount, omitted: omittedNotes.length, budgetBytes };
}

function syntheticOversizedFixture(seed) {
  const fixture = clone(seed);
  fixture.customers = Array.isArray(fixture.customers) ? fixture.customers : [];
  fixture.contracts = Array.isArray(fixture.contracts) ? fixture.contracts : [];
  const note = 'Historical source note kept on the server but never sent with routine dashboard state. '.repeat(5000);
  fixture.customers.push({ id: 'client-budget-customer', organizationId: 'org-wheelsonauto', name: 'Client budget customer', status: 'Active', notes: note });
  fixture.contracts.push({ id: 'client-budget-contract', organizationId: 'org-wheelsonauto', customer: 'Client budget customer', status: 'Active', notes: note });
  return fixture;
}

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function main() {
  const targetArgument = firstUserArgument();
  const requested = targetArgument ? path.resolve(root, targetArgument) : path.join(root, 'seed.json');
  const source = loadJson(requested);
  const sourceResult = checkClientStateBudget(path.basename(requested), source);
  const syntheticResult = checkClientStateBudget('Synthetic oversized-note fixture', syntheticOversizedFixture(source));
  console.log('Client state budget check passed: ' + path.basename(requested) + ' ' + sourceResult.sourceBytes + ' -> ' + sourceResult.clientBytes + ' bytes; synthetic oversized-note fixture ' + syntheticResult.sourceBytes + ' -> ' + syntheticResult.clientBytes + ' bytes.');
}

main();
