'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const secureDocumentStore = require('../secure-document-store');

const root = path.resolve(__dirname, '..');
const dataDir = path.resolve(process.env.DATA_DIR || root);
const dataFile = path.resolve(process.argv[2] || path.join(dataDir, 'data.json'));
const localRoot = path.join(dataDir, 'private-documents');

function inside(parent, target) {
  const relative = path.relative(parent, target);
  return !!relative && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative);
}

function privateRows(data) {
  const docs = Array.isArray(data.documents) ? data.documents.map(row => ({ row, kind: 'document' })) : [];
  const signatures = Array.isArray(data.eSignatures) ? data.eSignatures.map(row => ({ row, kind: 'signature' })) : [];
  return docs.concat(signatures);
}

function legacyPath(item) {
  return String(item.kind === 'signature' ? item.row.signatureImagePath || item.row.storagePath : item.row.storagePath || '').trim();
}

async function main() {
  if (process.env.WOA_PRIVATE_DOCUMENT_MIGRATION_CONFIRM !== '1') {
    throw new Error('Refusing to migrate live private files without WOA_PRIVATE_DOCUMENT_MIGRATION_CONFIRM=1. Existing files are never deleted by default.');
  }
  const store = secureDocumentStore.createSecureDocumentStore({
    provider: process.env.WOA_DOCUMENT_STORAGE_PROVIDER || 'local',
    localRoot,
    encryptionKey: process.env.WOA_DOCUMENT_ENCRYPTION_KEY || '',
    keyVersion: process.env.WOA_DOCUMENT_ENCRYPTION_KEY_VERSION || 'v1',
    bucket: process.env.WOA_OBJECT_STORAGE_BUCKET || process.env.S3_BUCKET || '',
    endpoint: process.env.WOA_OBJECT_STORAGE_ENDPOINT || process.env.S3_ENDPOINT || '',
    region: process.env.WOA_OBJECT_STORAGE_REGION || process.env.S3_REGION || '',
    accessKeyId: process.env.WOA_OBJECT_STORAGE_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.WOA_OBJECT_STORAGE_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY || '',
    sessionToken: process.env.AWS_SESSION_TOKEN || '',
    pathStyle: process.env.WOA_OBJECT_STORAGE_PATH_STYLE === '1'
  });
  if (!store.status().configured) throw new Error(store.status().message);
  const state = JSON.parse(await fs.readFile(dataFile, 'utf8'));
  const legacyRoot = path.resolve(dataDir, 'onboarding-uploads');
  const migratedFiles = [];
  let migrated = 0;
  let skipped = 0;

  for (const item of privateRows(state)) {
    const record = item.row;
    if (store.isEncryptedDocument(record)) {
      skipped += 1;
      continue;
    }
    const sourcePath = legacyPath(item);
    if (!sourcePath) {
      skipped += 1;
      continue;
    }
    const absolute = path.resolve(dataDir, sourcePath);
    if (!inside(legacyRoot, absolute)) throw new Error('Refusing to migrate a document outside onboarding-uploads: ' + sourcePath);
    const bytes = await fs.readFile(absolute);
    const stored = await store.save({
      id: record.id,
      bytes,
      contentType: record.contentType || (item.kind === 'signature' ? 'image/png' : 'application/octet-stream'),
      originalName: record.originalName || (item.kind === 'signature' ? 'signature.png' : path.basename(absolute)),
      organizationId: record.organizationId || 'org-wheelsonauto'
    });
    Object.assign(record, {
      storagePath: stored.storagePath || '',
      storageKey: stored.storageKey,
      storageProvider: stored.storageProvider,
      storageSecurity: 'encrypted',
      contentType: stored.contentType,
      originalName: stored.originalName,
      size: stored.size,
      sha256: stored.sha256,
      encryption: stored.encryption,
      migratedFromLegacyAt: new Date().toISOString(),
      legacyFileRetained: true
    });
    if (item.kind === 'signature') record.signatureImagePath = '';
    migratedFiles.push(absolute);
    migrated += 1;
  }

  const temporary = dataFile + '.private-document-migration-' + process.pid + '.tmp';
  await fs.writeFile(temporary, JSON.stringify(state, null, 2), 'utf8');
  await fs.rename(temporary, dataFile);
  if (process.env.WOA_PRIVATE_DOCUMENT_LEGACY_DELETE === '1') {
    for (const file of migratedFiles) await fs.rm(file, { force: true });
  }
  console.log(JSON.stringify({
    ok: true,
    migrated,
    skipped,
    legacyFilesRetained: process.env.WOA_PRIVATE_DOCUMENT_LEGACY_DELETE !== '1',
    storage: store.status(),
    message: 'Encrypted document migration completed. Verify staff downloads before enabling WOA_PRIVATE_DOCUMENT_STORAGE_REQUIRED=1.'
  }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
