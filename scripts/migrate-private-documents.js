'use strict';

const fsNative = require('node:fs');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const path = require('node:path');
const secureDocumentStore = require('../secure-document-store');
const migrationMaintenanceLease = require('../migration-maintenance-lease');
const { firstUserArgument } = require('./cli-arguments');

const root = path.resolve(__dirname, '..');
const dataDir = path.resolve(process.env.DATA_DIR || root);
const dataFile = path.resolve(firstUserArgument() || path.join(dataDir, 'data.json'));
const localRoot = path.resolve(process.env.WOA_DOCUMENT_LOCAL_ROOT || path.join(dataDir, 'private-documents'));

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

function rowIdentity(item) {
  return String(item.kind || 'document') + ':' + String(item.row && item.row.id || '');
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function encryptedProvider(record = {}) {
  return String(record.storageProvider || '').toLowerCase().startsWith('s3') ? 's3' : 'local';
}

function providerLabel(provider) {
  return provider === 's3' ? 's3-encrypted' : 'local-encrypted';
}

function sourceStoreFor(record = {}) {
  const provider = String(process.env.WOA_DOCUMENT_SOURCE_STORAGE_PROVIDER || encryptedProvider(record)).trim().toLowerCase();
  const sourceLocalRoot = path.resolve(process.env.WOA_DOCUMENT_SOURCE_LOCAL_ROOT || path.join(dataDir, 'private-documents'));
  return secureDocumentStore.createSecureDocumentStore({
    provider,
    localRoot: sourceLocalRoot,
    encryptionKey: process.env.WOA_DOCUMENT_SOURCE_ENCRYPTION_KEY || process.env.WOA_DOCUMENT_ENCRYPTION_KEY || '',
    keyVersion: process.env.WOA_DOCUMENT_SOURCE_ENCRYPTION_KEY_VERSION || record.encryption && record.encryption.keyVersion || 'v1',
    decryptionKeys: process.env.WOA_DOCUMENT_SOURCE_DECRYPTION_KEYS || process.env.WOA_DOCUMENT_DECRYPTION_KEYS || '',
    bucket: process.env.WOA_DOCUMENT_SOURCE_OBJECT_STORAGE_BUCKET || process.env.WOA_OBJECT_STORAGE_BUCKET || process.env.S3_BUCKET || '',
    endpoint: process.env.WOA_DOCUMENT_SOURCE_OBJECT_STORAGE_ENDPOINT || process.env.WOA_OBJECT_STORAGE_ENDPOINT || process.env.S3_ENDPOINT || '',
    region: process.env.WOA_DOCUMENT_SOURCE_OBJECT_STORAGE_REGION || process.env.WOA_OBJECT_STORAGE_REGION || process.env.S3_REGION || '',
    accessKeyId: process.env.WOA_DOCUMENT_SOURCE_OBJECT_STORAGE_ACCESS_KEY_ID || process.env.WOA_OBJECT_STORAGE_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.WOA_DOCUMENT_SOURCE_OBJECT_STORAGE_SECRET_ACCESS_KEY || process.env.WOA_OBJECT_STORAGE_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY || '',
    sessionToken: process.env.WOA_DOCUMENT_SOURCE_OBJECT_STORAGE_SESSION_TOKEN || process.env.AWS_SESSION_TOKEN || '',
    pathStyle: process.env.WOA_DOCUMENT_SOURCE_OBJECT_STORAGE_PATH_STYLE === '1' || process.env.WOA_OBJECT_STORAGE_PATH_STYLE === '1'
  });
}

function backupPathFor(dataFile) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '');
  return dataFile + '.private-document-pre-migration-' + stamp + '-' + process.pid + '.bak';
}

async function assertSameMaintenanceLease(expected) {
  const current = await migrationMaintenanceLease.assertActiveLease({ environment: process.env });
  if (current.serviceId !== expected.serviceId
    || current.renderCommit !== expected.renderCommit
    || current.instanceId !== expected.instanceId
    || current.startedAt !== expected.startedAt) {
    throw new Error('The deployed maintenance process restarted during private-document migration. No state change may be committed; retry from a fresh maintenance window.');
  }
  return current;
}

async function restoreBackupIfCommittedStateUnchanged(options = {}) {
  const target = path.resolve(options.dataFile || '');
  const backup = path.resolve(options.backupPath || '');
  const committedChecksum = String(options.committedChecksum || '').trim();
  const sourceChecksum = String(options.sourceChecksum || '').trim();
  const maintenanceAssertion = typeof options.maintenanceAssertion === 'function'
    ? options.maintenanceAssertion
    : async () => {};
  const currentBytes = await fs.readFile(target);
  if (!committedChecksum || sha256(currentBytes) !== committedChecksum) {
    throw new Error('Private-document migration rollback was safely refused because live state changed after the migration commit. The newer state and encrypted objects were retained for operator review.');
  }
  const backupBytes = await fs.readFile(backup);
  if (!sourceChecksum || sha256(backupBytes) !== sourceChecksum) {
    throw new Error('Private-document migration rollback was safely refused because the protected backup checksum is invalid. The committed state and encrypted objects were retained for operator review.');
  }
  await maintenanceAssertion('before_rollback_prepare');
  const temporary = target + '.private-document-rollback-' + process.pid + '-' + crypto.randomBytes(8).toString('hex') + '.tmp';
  try {
    await fs.writeFile(temporary, backupBytes, { flag: 'wx', mode: 0o600 });
    await maintenanceAssertion('before_rollback_replace');
    const immediatelyBeforeReplace = await fs.readFile(target);
    if (sha256(immediatelyBeforeReplace) !== committedChecksum) {
      throw new Error('Private-document migration rollback was safely refused because live state changed while rollback was being prepared. The newer state and encrypted objects were retained for operator review.');
    }
    await fs.rename(temporary, target);
    const restoredBytes = await fs.readFile(target);
    if (sha256(restoredBytes) !== sourceChecksum) {
      throw new Error('Private-document migration rollback read-back verification failed. Keep production in maintenance mode and restore from the protected backup through the controlled recovery workflow.');
    }
    return { restored: true, sourceChecksum };
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

async function resolveLegacyFile(dataDir, legacyRoot, sourcePath) {
  const absolute = path.resolve(dataDir, sourcePath);
  if (!inside(legacyRoot, absolute)) throw new Error('Refusing to migrate a document outside onboarding-uploads: ' + sourcePath);
  const realRoot = await fs.realpath(legacyRoot);
  const realSource = await fs.realpath(absolute);
  if (!inside(realRoot, realSource)) throw new Error('Refusing to migrate a document through a path outside onboarding-uploads: ' + sourcePath);
  return realSource;
}

async function main() {
  if (process.env.WOA_PRIVATE_DOCUMENT_MIGRATION_CONFIRM !== '1') {
    throw new Error('Refusing to migrate live private files without WOA_PRIVATE_DOCUMENT_MIGRATION_CONFIRM=1. Existing files are never deleted by default.');
  }
  if (process.env.WOA_PRIVATE_DOCUMENT_MIGRATION_MAINTENANCE_CONFIRM !== '1') {
    throw new Error('Refusing to migrate private files without WOA_PRIVATE_DOCUMENT_MIGRATION_MAINTENANCE_CONFIRM=1. Run this only while production writes are paused so live customer records cannot change during the migration.');
  }
  if (process.env.WOA_MIGRATION_MAINTENANCE_MODE !== '1') {
    throw new Error('WOA_MIGRATION_MAINTENANCE_MODE=1 is required for private-document migration. A command confirmation does not pause the deployed application.');
  }
  const activeMaintenanceLease = await migrationMaintenanceLease.assertActiveLease({ environment: process.env });
  const sourceBytes = await fs.readFile(dataFile);
  const sourceChecksum = sha256(sourceBytes);
  const state = JSON.parse(sourceBytes.toString('utf8'));
  const legacyRoot = path.resolve(dataDir, 'onboarding-uploads');
  const store = secureDocumentStore.createSecureDocumentStore({
    provider: process.env.WOA_DOCUMENT_STORAGE_PROVIDER || 'local',
    localRoot,
    encryptionKey: process.env.WOA_DOCUMENT_ENCRYPTION_KEY || '',
    keyVersion: process.env.WOA_DOCUMENT_ENCRYPTION_KEY_VERSION || 'v1',
    decryptionKeys: process.env.WOA_DOCUMENT_DECRYPTION_KEYS || '',
    bucket: process.env.WOA_OBJECT_STORAGE_BUCKET || process.env.S3_BUCKET || '',
    endpoint: process.env.WOA_OBJECT_STORAGE_ENDPOINT || process.env.S3_ENDPOINT || '',
    region: process.env.WOA_OBJECT_STORAGE_REGION || process.env.S3_REGION || '',
    accessKeyId: process.env.WOA_OBJECT_STORAGE_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.WOA_OBJECT_STORAGE_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY || '',
    sessionToken: process.env.AWS_SESSION_TOKEN || '',
    pathStyle: process.env.WOA_OBJECT_STORAGE_PATH_STYLE === '1'
  });
  if (!store.status().configured) throw new Error(store.status().message);
  const candidates = [];
  let skipped = 0;
  const targetProvider = providerLabel(store.provider);
  const targetKeyVersion = store.keyVersion;
  const forceReencrypt = process.env.WOA_PRIVATE_DOCUMENT_MIGRATION_FORCE === '1';
  for (const item of privateRows(state)) {
    const record = item.row;
    if (store.isEncryptedDocument(record)) {
      const alreadyOnTarget = record.storageProvider === targetProvider &&
        String(record.encryption && record.encryption.keyVersion || '') === targetKeyVersion;
      if (alreadyOnTarget && !forceReencrypt) {
        skipped += 1;
        continue;
      }
      const sourceStore = sourceStoreFor(record);
      if (!sourceStore.status().configured) {
        throw new Error('Cannot read encrypted source document ' + rowIdentity(item) + ': ' + sourceStore.status().message + ' Configure the WOA_DOCUMENT_SOURCE_* settings before retrying.');
      }
      candidates.push({
        item,
        record,
        sourceStore,
        sourceRecord: structuredClone(record),
        sourceType: 'encrypted'
      });
      continue;
    }
    const sourcePath = legacyPath(item);
    if (!sourcePath) {
      skipped += 1;
      continue;
    }
    candidates.push({
      item,
      record,
      absolute: await resolveLegacyFile(dataDir, legacyRoot, sourcePath),
      sourceType: 'legacy'
    });
  }
  if (!candidates.length) {
    console.log(JSON.stringify({
      ok: true,
      migrated: 0,
      skipped,
      changed: false,
      message: 'No legacy private documents need migration. data.json was not changed.'
    }, null, 2));
    return;
  }

  const backupPath = backupPathFor(dataFile);
  await fs.copyFile(dataFile, backupPath, fsNative.constants.COPYFILE_EXCL);
  const backupBytes = await fs.readFile(backupPath);
  if (sha256(backupBytes) !== sourceChecksum) {
    throw new Error('Private-document migration backup does not match the protected source data. data.json was not changed.');
  }

  const migratedFiles = [];
  const storedKeys = [];
  const encryptedSources = [];
  let migrated = 0;
  let stateCommitted = false;
  let stateVerified = false;
  let committedStateChecksum = '';
  try {
    for (const candidate of candidates) {
      const { item, record, absolute } = candidate;
      const bytes = candidate.sourceType === 'encrypted'
        ? await candidate.sourceStore.read(candidate.sourceRecord)
        : await fs.readFile(absolute);
      const originalChecksum = sha256(bytes);
      if (record.sha256 && record.sha256 !== originalChecksum) {
        throw new Error('Private-document checksum verification failed before migration for ' + rowIdentity(item) + '. data.json was not changed.');
      }
      const organizationId = record.organizationId || 'org-wheelsonauto';
      const sourceName = candidate.sourceType === 'encrypted'
        ? record.originalName || item.kind + '.bin'
        : path.basename(absolute);
      const stored = await store.save({
        id: record.id,
        bytes,
        contentType: record.contentType || (item.kind === 'signature' ? 'image/png' : 'application/octet-stream'),
        originalName: record.originalName || (item.kind === 'signature' ? 'signature.png' : sourceName),
        organizationId
      });
      storedKeys.push(stored.storageKey);
      const recovered = await store.read(stored);
      if (!recovered.equals(bytes) || stored.sha256 !== originalChecksum || sha256(recovered) !== originalChecksum) {
        throw new Error('Encrypted private-document read-back verification failed for ' + (absolute ? path.basename(absolute) : rowIdentity(item)) + '. data.json was not changed.');
      }
      const migratedAt = new Date().toISOString();
      const migrationHistory = Array.isArray(record.storageMigrationHistory) ? record.storageMigrationHistory.slice() : [];
      if (candidate.sourceType === 'encrypted') {
        migrationHistory.push({
          migratedAt,
          fromProvider: candidate.sourceRecord.storageProvider || providerLabel(candidate.sourceStore.provider),
          fromKeyVersion: candidate.sourceRecord.encryption && candidate.sourceRecord.encryption.keyVersion || '',
          fromStorageKey: candidate.sourceRecord.storageKey,
          toProvider: stored.storageProvider,
          toKeyVersion: stored.encryption && stored.encryption.keyVersion || '',
          sourceObjectRetained: process.env.WOA_PRIVATE_DOCUMENT_SOURCE_DELETE !== '1'
        });
        encryptedSources.push(candidate);
      }
      Object.assign(record, {
        organizationId,
        storagePath: stored.storagePath || '',
        storageKey: stored.storageKey,
        storageProvider: stored.storageProvider,
        storageSecurity: 'encrypted',
        contentType: stored.contentType,
        originalName: stored.originalName,
        size: stored.size,
        sha256: stored.sha256,
        encryption: stored.encryption,
        storageMigrationHistory: migrationHistory,
        migratedFromLegacyAt: candidate.sourceType === 'legacy' ? migratedAt : record.migratedFromLegacyAt,
        reencryptedAt: candidate.sourceType === 'encrypted' ? migratedAt : record.reencryptedAt,
        legacyFileRetained: candidate.sourceType === 'legacy' ? true : record.legacyFileRetained
      });
      if (item.kind === 'signature') record.signatureImagePath = '';
      if (absolute) migratedFiles.push(absolute);
      migrated += 1;
    }

    const currentBytes = await fs.readFile(dataFile);
    if (sha256(currentBytes) !== sourceChecksum) {
      throw new Error('Live customer data changed while private documents were being migrated. data.json was not changed; retry during a maintenance window.');
    }
    await assertSameMaintenanceLease(activeMaintenanceLease);
    const committedStateBytes = Buffer.from(JSON.stringify(state, null, 2), 'utf8');
    committedStateChecksum = sha256(committedStateBytes);
    const temporary = dataFile + '.private-document-migration-' + process.pid + '-' + crypto.randomBytes(8).toString('hex') + '.tmp';
    try {
      await fs.writeFile(temporary, committedStateBytes, { flag: 'wx', mode: 0o600 });
      await assertSameMaintenanceLease(activeMaintenanceLease);
      const immediatelyBeforeCommit = await fs.readFile(dataFile);
      if (sha256(immediatelyBeforeCommit) !== sourceChecksum) {
        throw new Error('Live customer data changed while the protected private-document update was being prepared. No migration state was committed.');
      }
      await fs.rename(temporary, dataFile);
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => {});
    }
    stateCommitted = true;
    const committedBytes = await fs.readFile(dataFile);
    if (sha256(committedBytes) !== committedStateChecksum) {
      throw new Error('Encrypted private-document state checksum verification failed after the atomic update. The protected backup will be restored only if the committed state is still unchanged.');
    }
    const committed = JSON.parse(committedBytes.toString('utf8'));
    const candidateIdentities = new Set(candidates.map(candidate => rowIdentity(candidate.item)));
    const verifiedRows = privateRows(committed).filter(entry => candidateIdentities.has(rowIdentity(entry)));
    if (verifiedRows.length !== candidates.length || verifiedRows.some(entry => !store.isEncryptedDocument(entry.row) ||
      entry.row.storageProvider !== targetProvider || String(entry.row.encryption && entry.row.encryption.keyVersion || '') !== targetKeyVersion)) {
      throw new Error('Encrypted private-document metadata verification failed after the atomic state update. The protected backup will be restored before retrying.');
    }
    await assertSameMaintenanceLease(activeMaintenanceLease);
    stateVerified = true;
    if (process.env.WOA_PRIVATE_DOCUMENT_LEGACY_DELETE === '1') {
      for (const file of migratedFiles) await fs.rm(file, { force: true });
    }
    const sourceDeleteFailures = [];
    if (process.env.WOA_PRIVATE_DOCUMENT_SOURCE_DELETE === '1') {
      for (const candidate of encryptedSources) {
        try {
          await candidate.sourceStore.deleteObject(candidate.sourceRecord.storageKey);
        } catch (error) {
          sourceDeleteFailures.push({ row: rowIdentity(candidate.item), error: error.message });
        }
      }
    }
    console.log(JSON.stringify({
      ok: true,
      migrated,
      skipped,
      changed: true,
      backupPath,
      sourceChecksum,
      maintenanceRenderServiceId: activeMaintenanceLease.serviceId,
      maintenanceRenderCommit: activeMaintenanceLease.renderCommit,
      maintenanceInstanceId: activeMaintenanceLease.instanceId,
      maintenanceStartedAt: activeMaintenanceLease.startedAt,
      maintenanceLeaseSignatureChecksum: activeMaintenanceLease.signatureChecksum,
      legacyFilesRetained: process.env.WOA_PRIVATE_DOCUMENT_LEGACY_DELETE !== '1',
      encryptedSourceObjectsRetained: process.env.WOA_PRIVATE_DOCUMENT_SOURCE_DELETE !== '1',
      sourceDeleteFailures,
      storage: store.status(),
      message: 'Encrypted document migration and key/provider re-homing completed with backup and read-back proof. Verify staff downloads before enabling WOA_PRIVATE_DOCUMENT_STORAGE_REQUIRED=1.'
    }, null, 2));
  } catch (error) {
    if (stateCommitted && !stateVerified) {
      try {
        await restoreBackupIfCommittedStateUnchanged({
          dataFile,
          backupPath,
          committedChecksum: committedStateChecksum,
          sourceChecksum,
          maintenanceAssertion: () => assertSameMaintenanceLease(activeMaintenanceLease)
        });
        stateCommitted = false;
      } catch (rollbackError) {
        error.rollbackError = String(rollbackError && rollbackError.message || rollbackError);
        error.message += ' ' + error.rollbackError;
      }
    }
    if (!stateCommitted) {
      await Promise.all(storedKeys.map(storageKey => store.deleteObject(storageKey).catch(() => {})));
    }
    throw error;
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error);
    process.exit(1);
  });
}

module.exports = {
  restoreBackupIfCommittedStateUnchanged
};
