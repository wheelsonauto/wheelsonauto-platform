'use strict';

const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const onboarding = require('../onboarding-service');

const pngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlqkAAAAASUVORK5CYII=', 'base64');

function pngFile(kind) {
  return {
    kind,
    name: kind + '.png',
    type: 'image/png',
    size: pngBytes.length,
    dataUrl: 'data:image/png;base64,' + pngBytes.toString('base64')
  };
}

function requiredFiles() {
  return ['driver_license_front', 'driver_license_back', 'identity_selfie', 'insurance'].map(pngFile);
}

function context() {
  return {
    data: {
      documents: [
        { id: 'old-front', applicationId: 'application-atomic', onboardingSessionId: 'session-atomic', documentKind: 'driver_license_front' },
        { id: 'unrelated-document', applicationId: 'another-application', onboardingSessionId: 'another-session', documentKind: 'insurance' }
      ]
    },
    session: { id: 'session-atomic', onlineVehicleId: 'online-atomic', organizationId: 'org-wheelsonauto' },
    application: { id: 'application-atomic', name: 'Atomic Upload Customer', organizationId: 'org-wheelsonauto' }
  };
}

function encryptedStore() {
  const objects = new Map();
  const deleted = [];
  return {
    objects,
    deleted,
    isConfigured() { return true; },
    async save({ id, bytes, contentType, originalName, organizationId }) {
      const storageKey = 'documents/' + organizationId + '/' + id + '.enc';
      objects.set(storageKey, Buffer.from(bytes));
      return {
        id,
        organizationId,
        originalName,
        contentType,
        size: bytes.length,
        sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
        storageKey,
        storageProvider: 's3-encrypted',
        encryption: { algorithm: 'AES-256-GCM', keyVersion: 'test-v1' }
      };
    },
    async deleteObject(storageKey) {
      deleted.push(storageKey);
      objects.delete(storageKey);
    }
  };
}

async function main() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'woa-private-document-atomicity-'));
  try {
    const failed = context();
    const originalDocuments = JSON.parse(JSON.stringify(failed.data.documents));
    const originalSession = JSON.parse(JSON.stringify(failed.session));
    const invalidFiles = requiredFiles();
    invalidFiles[1] = { ...invalidFiles[1], dataUrl: 'data:image/png;base64,' + Buffer.from('not a png').toString('base64') };

    await assert.rejects(
      () => onboarding.saveDocuments(failed.data, failed.session, failed.application, invalidFiles, dataDir, null),
      /does not match/i,
      'A later invalid file must fail the complete onboarding document batch.'
    );
    assert.deepStrictEqual(failed.data.documents, originalDocuments, 'A failed document batch must not replace any existing customer document metadata.');
    assert.deepStrictEqual(failed.session, originalSession, 'A failed document batch must not advance the onboarding session.');
    assert.deepStrictEqual(await fs.readdir(path.join(dataDir, 'onboarding-uploads')), [], 'A failed local document batch must remove every file written earlier in the batch.');

    const successful = context();
    const store = encryptedStore();
    const saved = await onboarding.saveDocuments(successful.data, successful.session, successful.application, requiredFiles(), dataDir, store);
    assert.strictEqual(saved.length, 4, 'A valid onboarding document batch must save all four required files.');
    assert.strictEqual(store.objects.size, 4, 'The encrypted provider must contain exactly the four committed batch objects.');
    assert.strictEqual(successful.data.documents.filter(row => row.applicationId === successful.application.id && row.onboardingSessionId === successful.session.id).length, 4, 'The committed state must contain one record for every required document kind.');
    assert(successful.data.documents.some(row => row.id === 'unrelated-document'), 'An atomic replacement must preserve unrelated private document records.');
    assert(!successful.data.documents.some(row => row.id === 'old-front'), 'The committed batch must replace the previous document record only after every new object succeeds.');
    assert(successful.session.documentsCompletedAt && successful.session.documentReviewStatus === 'Waiting on staff', 'The session may advance only after the complete batch succeeds.');

    const removed = await onboarding.discardPrivateDocuments(saved, dataDir, store);
    assert.strictEqual(removed, 4, 'Guarded rollback must remove every supplied encrypted object.');
    assert.strictEqual(store.objects.size, 0, 'Guarded rollback must not leave encrypted objects behind.');
    assert.strictEqual(store.deleted.length, 4, 'Every encrypted object deletion must be issued exactly once.');

    await assert.rejects(
      () => onboarding.discardPrivateDocument({ storagePath: '../outside-private-file' }, dataDir),
      /Refusing to remove/i,
      'Private document cleanup must never escape the onboarding upload directory.'
    );

    const serverSource = await fs.readFile(path.resolve(__dirname, '..', 'server.js'), 'utf8');
    const commitRollbackTargets = [...serverSource.matchAll(/attachPrivateDocumentRollback\(error,\s*(saved|signatureImage|storedFile)\)/g)].map(match => match[1]).sort();
    assert.deepStrictEqual(commitRollbackTargets, ['saved', 'signatureImage', 'storedFile'], 'Onboarding documents, signatures, and customer portal uploads must all clean up an object when the matching state commit fails.');

    console.log('Private document atomicity check passed: partial batches roll back files and metadata, successful encrypted batches commit together, and cleanup cannot escape the private upload directory.');
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
