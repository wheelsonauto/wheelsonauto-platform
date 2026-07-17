'use strict';

const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const secureDocumentStore = require('../secure-document-store');

const root = path.resolve(__dirname, '..');
const migrationScript = path.join(__dirname, 'migrate-private-documents.js');

function runMigration(dataFile, env) {
  return spawnSync(process.execPath, [migrationScript, dataFile], {
    cwd: root,
    env,
    encoding: 'utf8'
  });
}

async function main() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'woa-private-document-migration-'));
  try {
    const uploads = path.join(temp, 'onboarding-uploads');
    const dataFile = path.join(temp, 'data.json');
    const licenseBytes = Buffer.from('private driver license image bytes', 'utf8');
    const signatureBytes = Buffer.from('private customer signature bytes', 'utf8');
    await fs.mkdir(uploads, { recursive: true });
    await fs.writeFile(path.join(uploads, 'license.png'), licenseBytes);
    await fs.writeFile(path.join(uploads, 'signature.png'), signatureBytes);
    const source = {
      documents: [{
        id: 'doc-private-migration-license',
        storagePath: 'onboarding-uploads/license.png',
        contentType: 'image/png',
        originalName: 'license.png',
        organizationId: 'org-private-migration-test'
      }],
      eSignatures: [{
        id: 'signature-private-migration-1',
        signatureImagePath: 'onboarding-uploads/signature.png',
        organizationId: 'org-private-migration-test'
      }]
    };
    const originalState = JSON.stringify(source, null, 2);
    await fs.writeFile(dataFile, originalState, 'utf8');
    const key = crypto.randomBytes(32).toString('base64');
    const baseEnvironment = {
      ...process.env,
      DATA_DIR: temp,
      WOA_DOCUMENT_STORAGE_PROVIDER: 'local',
      WOA_DOCUMENT_ENCRYPTION_KEY: key,
      WOA_DOCUMENT_ENCRYPTION_KEY_VERSION: 'migration-test-v1',
      WOA_PRIVATE_DOCUMENT_MIGRATION_CONFIRM: '1'
    };

    const blocked = runMigration(dataFile, baseEnvironment);
    assert.notStrictEqual(blocked.status, 0, 'A private-document migration must refuse to run without an explicit maintenance-window confirmation.');
    assert.match(blocked.stderr, /MAINTENANCE_CONFIRM=1/i, 'The maintenance guard must explain how to run the migration safely.');
    assert.strictEqual(await fs.readFile(dataFile, 'utf8'), originalState, 'A blocked migration must not change the protected source state.');

    const completed = runMigration(dataFile, {
      ...baseEnvironment,
      WOA_PRIVATE_DOCUMENT_MIGRATION_MAINTENANCE_CONFIRM: '1'
    });
    assert.strictEqual(completed.status, 0, completed.stderr || 'The private-document migration must complete in an isolated test workspace.');
    const output = JSON.parse(completed.stdout);
    assert.strictEqual(output.ok, true, 'The completed migration must report success.');
    assert.strictEqual(output.migrated, 2, 'Every legacy document and signature must be moved to encrypted storage.');
    assert(output.backupPath, 'The migration must report an immutable pre-migration backup path.');
    assert.strictEqual(await fs.readFile(output.backupPath, 'utf8'), originalState, 'The backup must exactly match the protected source state before migration.');

    const migrated = JSON.parse(await fs.readFile(dataFile, 'utf8'));
    assert.strictEqual(migrated.documents[0].storageSecurity, 'encrypted', 'The document record must point to encrypted storage only after read-back verification.');
    assert.strictEqual(migrated.eSignatures[0].storageSecurity, 'encrypted', 'The signature record must point to encrypted storage only after read-back verification.');
    assert.strictEqual(migrated.eSignatures[0].signatureImagePath, '', 'The legacy signature path must be removed after an encrypted record is verified.');
    assert((await fs.readFile(path.join(uploads, 'license.png'))).equals(licenseBytes), 'Legacy source files must be retained by default.');
    assert((await fs.readFile(path.join(uploads, 'signature.png'))).equals(signatureBytes), 'Legacy signature files must be retained by default.');

    const store = secureDocumentStore.createSecureDocumentStore({
      provider: 'local',
      localRoot: path.join(temp, 'private-documents'),
      encryptionKey: key,
      keyVersion: 'migration-test-v1'
    });
    assert((await store.read(migrated.documents[0])).equals(licenseBytes), 'Encrypted document bytes must round-trip after migration.');
    assert((await store.read(migrated.eSignatures[0])).equals(signatureBytes), 'Encrypted signature bytes must round-trip after migration.');
    const encrypted = await fs.readFile(path.join(temp, migrated.documents[0].storagePath));
    assert(!encrypted.equals(licenseBytes), 'The encrypted storage object must not contain the original license bytes.');

    const beforeNoop = await fs.readFile(dataFile, 'utf8');
    const noop = runMigration(dataFile, {
      ...baseEnvironment,
      WOA_PRIVATE_DOCUMENT_MIGRATION_MAINTENANCE_CONFIRM: '1'
    });
    assert.strictEqual(noop.status, 0, noop.stderr || 'A repeated migration must safely no-op.');
    assert.strictEqual(JSON.parse(noop.stdout).changed, false, 'A repeated migration must report that no state changed.');
    assert.strictEqual(await fs.readFile(dataFile, 'utf8'), beforeNoop, 'A repeated migration must leave encrypted state unchanged.');

    console.log('Private document migration check passed: maintenance guard, immutable backup, encrypted read-back proof, legacy retention, and repeat-safe no-op are verified.');
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
