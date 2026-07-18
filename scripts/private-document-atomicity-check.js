'use strict';

const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const onboarding = require('../onboarding-service');
const secureDocumentStore = require('../secure-document-store');

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

    const signatureImage = await store.save({
      id: 'signature-atomic',
      bytes: pngBytes,
      contentType: 'image/png',
      originalName: 'signature.png',
      organizationId: 'org-wheelsonauto'
    });
    const signedContract = await onboarding.saveSignedContractArtifact({
      signedContract: {
        body: 'SIGNED AGREEMENT\n' + 'Contract term and customer obligations. '.repeat(40),
        documentHash: crypto.createHash('sha256').update('rendered agreement').digest('hex'),
        templateHash: crypto.createHash('sha256').update('contract template').digest('hex')
      },
      signatureImage,
      session: { id: 'session-contract-atomic', organizationId: 'org-wheelsonauto' },
      application: { id: 'application-contract-atomic', name: 'Contract Artifact Customer', organizationId: 'org-wheelsonauto' },
      typedName: 'Contract Artifact Customer',
      signedAt: '2026-07-18T12:00:00.000Z',
      signedIp: '127.0.0.1',
      signedUserAgent: 'WheelsonAuto contract artifact check',
      eSignatureId: 'esign-contract-atomic',
      templateId: 'contract-template-atomic',
      contractVersion: 1
    }, dataDir, store);
    const storedContractBytes = store.objects.get(signedContract.storageKey);
    assert(storedContractBytes && /WHEELSONAUTO SIGNED AGREEMENT/.test(storedContractBytes.toString('utf8')) && /END OF SIGNED AGREEMENT/.test(storedContractBytes.toString('utf8')), 'The immutable signed contract must be stored as a complete private artifact with its e-signature certificate.');
    await onboarding.discardPrivateDocuments([signedContract, signatureImage], dataDir, store);
    assert.strictEqual(store.objects.size, 0, 'Contract and signature rollback must remove both private artifacts together.');

    await assert.rejects(
      () => onboarding.discardPrivateDocument({ storagePath: '../outside-private-file' }, dataDir),
      /Refusing to remove/i,
      'Private document cleanup must never escape the onboarding upload directory.'
    );

    const artifactRuntimeDir = path.join(dataDir, 'artifact-runtime');
    const artifactEncryptionKey = crypto.randomBytes(32).toString('base64');
    process.env.DATA_DIR = artifactRuntimeDir;
    process.env.WOA_DATA_BACKEND = 'json';
    process.env.DATABASE_URL = '';
    process.env.WOA_DOCUMENT_STORAGE_PROVIDER = 'local';
    process.env.WOA_DOCUMENT_ENCRYPTION_KEY = artifactEncryptionKey;
    process.env.WOA_DOCUMENT_ENCRYPTION_KEY_VERSION = 'artifact-test-v1';
    process.env.WOA_SESSION_SECRET = 'private-artifact-atomicity-session-secret-2026';
    process.env.WOA_PRODUCTION_HARDENING_REQUIRED = '0';
    process.env.WOA_MESSAGING_ENABLED = '0';
    process.env.WOA_EMAIL_ENABLED = '0';
    process.env.WOA_STAR_AI_ENABLED = '0';
    const server = require('../server');
    const artifactState = {
      payments: [{
        id: 'payment-artifact-1',
        recurringPaymentId: 'recurring-artifact-1',
        paymentProvider: 'stripe',
        providerPaymentId: 'pi_artifact_1',
        stripePaymentIntentId: 'pi_artifact_1',
        customer: 'Artifact Customer',
        phone: '8565550123',
        email: 'artifact@example.com',
        vehicle: '2019 Mitsubishi Mirage',
        vehicleId: 'vehicle-artifact-1',
        vin: 'ML32A3HJ9KH000001',
        licensePlate: 'ART-101',
        amount: 229,
        method: 'Stripe saved card',
        status: 'Paid',
        source: 'Stripe signed payment webhook',
        createdAt: '2026-07-18T18:00:00.000Z'
      }],
      customerAccounts: [{ id: 'customer-account-artifact-1', recurringPaymentId: 'recurring-artifact-1', customer: 'Artifact Customer', organizationId: 'org-wheelsonauto', status: 'Active' }],
      documents: [],
      claims: []
    };
    const receiptDocument = server.ensurePaymentReceiptDocument(artifactState, artifactState.payments[0]);
    assert.strictEqual(receiptDocument.customerAccountId, 'customer-account-artifact-1', 'A generated receipt artifact must be linked to the exact customer portal account.');
    const ambiguousReceiptState = {
      payments: [{ id: 'payment-ambiguous-account', customer: 'Same Name', amount: 100, status: 'Paid', createdAt: '2026-07-18T18:30:00.000Z' }],
      customerAccounts: [{ id: 'account-same-name-1', customer: 'Same Name' }, { id: 'account-same-name-2', customer: 'Same Name' }],
      documents: []
    };
    const ambiguousReceipt = server.ensurePaymentReceiptDocument(ambiguousReceiptState, ambiguousReceiptState.payments[0]);
    assert.strictEqual(ambiguousReceipt.customerAccountId, '', 'A receipt must remain staff-only when two portal accounts match the same weak name evidence.');
    assert.strictEqual(server.privateArtifactCoverage(artifactState).ready, false, 'A receipt metadata row without its encrypted artifact must keep private artifact readiness blocked.');
    await server.storePrivateArtifactForDocument(artifactState, receiptDocument);
    const localArtifactStore = secureDocumentStore.createSecureDocumentStore({
      provider: 'local',
      localRoot: path.join(artifactRuntimeDir, 'private-documents'),
      encryptionKey: artifactEncryptionKey,
      keyVersion: 'artifact-test-v1'
    });
    const receiptBytes = await localArtifactStore.read({ ...receiptDocument, id: receiptDocument.privateArtifactId });
    const receiptText = receiptBytes.toString('utf8');
    assert.match(receiptText, /WHEELSONAUTO PAYMENT RECEIPT/, 'The encrypted receipt must retain its immutable artifact format.');
    assert.match(receiptText, /Artifact Customer/, 'The encrypted receipt must retain the linked customer.');
    assert.match(receiptText, /pi_artifact_1/, 'The encrypted receipt must retain the exact provider transaction reference.');
    assert.match(receiptText, /ML32A3HJ9KH000001/, 'The encrypted receipt must retain the linked vehicle VIN.');

    const disputeClaim = {
      id: 'claim-artifact-1',
      organizationId: 'org-wheelsonauto',
      provider: 'Stripe',
      stripeDisputeId: 'dp_artifact_1',
      stripePaymentIntentId: 'pi_artifact_1',
      paymentId: 'payment-artifact-1',
      customer: 'Artifact Customer',
      vehicle: '2019 Mitsubishi Mirage',
      vehicleId: 'vehicle-artifact-1',
      vin: 'ML32A3HJ9KH000001',
      plate: 'ART-101',
      evidencePacket: { generatedAt: '2026-07-18T19:00:00.000Z', paymentId: 'payment-artifact-1', missing: [], proof: [{ key: 'agreement', ready: true }] }
    };
    artifactState.claims.push(disputeClaim);
    const evidenceDocument = server.ensureDisputeEvidenceDocument(artifactState, disputeClaim, { name: 'Owner' });
    await server.storePrivateArtifactForDocument(artifactState, evidenceDocument);
    const evidenceBytes = await localArtifactStore.read({ ...evidenceDocument, id: evidenceDocument.privateArtifactId });
    assert.match(evidenceBytes.toString('utf8'), /WHEELSONAUTO DISPUTE EVIDENCE PACKET[\s\S]*dp_artifact_1[\s\S]*payment-artifact-1/, 'The encrypted dispute packet must preserve the owner-reviewed evidence snapshot and exact provider references.');
    assert.strictEqual(server.privateArtifactCoverage(artifactState).ready, true, 'Encrypted receipt and dispute artifacts must satisfy private artifact readiness after authenticated storage.');

    await fs.mkdir(artifactRuntimeDir, { recursive: true });
    await fs.writeFile(path.join(artifactRuntimeDir, 'data.json'), JSON.stringify({
      payments: [{
        id: 'payment-worker-1',
        recurringPaymentId: 'recurring-worker-1',
        paymentProvider: 'stripe',
        stripePaymentIntentId: 'pi_worker_1',
        providerPaymentId: 'pi_worker_1',
        customer: 'Worker Customer',
        vehicle: '2018 Toyota Camry',
        vehicleId: 'vehicle-worker-1',
        vin: '4T1B11HK0JU000001',
        licensePlate: 'WORK-18',
        amount: 229,
        status: 'Paid',
        method: 'Stripe saved card',
        source: 'Stripe signed payment webhook',
        createdAt: '2026-07-18T20:00:00.000Z'
      }],
      customerAccounts: [{ id: 'customer-account-worker-1', recurringPaymentId: 'recurring-worker-1', customer: 'Worker Customer', organizationId: 'org-wheelsonauto', status: 'Active' }],
      documents: []
    }), 'utf8');
    const workerResult = await server.runPrivateArtifactBackfill({ source: 'atomicity check', limit: 10 });
    assert.strictEqual(workerResult.createdReceiptRecords, 1, 'The durable worker must create a missing receipt record for an already-paid transaction.');
    assert.strictEqual(workerResult.stored, 1, 'The durable worker must encrypt and store the newly created receipt artifact.');
    const persistedWorkerState = JSON.parse(await fs.readFile(path.join(artifactRuntimeDir, 'data.json'), 'utf8'));
    assert.strictEqual(server.privateArtifactCoverage(persistedWorkerState).ready, true, 'The durable worker must persist a complete private-artifact state that survives a fresh file read.');

    const serverSource = await fs.readFile(path.resolve(__dirname, '..', 'server.js'), 'utf8');
    const commitRollbackTargets = [...serverSource.matchAll(/attachPrivateDocumentRollback\(error,\s*(privateArtifacts|saved|storedFile|storedEvidenceArtifact|storedArtifacts)\)/g)].map(match => match[1]).sort();
    assert.deepStrictEqual(commitRollbackTargets, ['privateArtifacts', 'saved', 'storedArtifacts', 'storedEvidenceArtifact', 'storedFile'], 'Onboarding documents, contract/signature pairs, receipts, dispute evidence, and customer portal uploads must clean up private objects when the matching state commit fails.');

    console.log('Private document atomicity check passed: partial batches roll back files and metadata, successful encrypted batches commit together, and cleanup cannot escape the private upload directory.');
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
