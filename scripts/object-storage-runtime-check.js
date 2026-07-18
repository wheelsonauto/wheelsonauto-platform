'use strict';

const assert = require('node:assert');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const secureDocumentStore = require('../secure-document-store');
const encryptedStateBackup = require('../encrypted-state-backup');

const MINIO_IMAGE = 'minio/minio:RELEASE.2025-09-07T16-13-09Z';
const MINIO_CLIENT_IMAGE = 'minio/mc:RELEASE.2025-08-13T08-35-41Z';
const CI_ACCESS_KEY = 'wheelsonauto_ci_access';
const CI_SECRET_KEY = 'wheelsonauto_ci_secret_2026';

let endpoint = String(process.env.WOA_TEST_OBJECT_STORAGE_ENDPOINT || '').trim();
let bucket = String(process.env.WOA_TEST_OBJECT_STORAGE_BUCKET || '').trim();
let region = String(process.env.WOA_TEST_OBJECT_STORAGE_REGION || 'us-east-1').trim() || 'us-east-1';
let accessKeyId = String(process.env.WOA_TEST_OBJECT_STORAGE_ACCESS_KEY_ID || '').trim();
let secretAccessKey = String(process.env.WOA_TEST_OBJECT_STORAGE_SECRET_ACCESS_KEY || '').trim();
let pathStyle = process.env.WOA_TEST_OBJECT_STORAGE_PATH_STYLE !== '0';
let confirmed = process.env.WOA_OBJECT_STORAGE_RUNTIME_TEST_CONFIRM === '1';
let allowHttp = process.env.WOA_TEST_OBJECT_STORAGE_ALLOW_HTTP === '1';
let ciMinioContainer = '';

function dockerCommand(args, options = {}) {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    timeout: Number(options.timeout || 180000),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (result.error) throw new Error('GitHub object-storage runtime check could not run Docker: ' + result.error.message);
  return result;
}

function stopCiMinio() {
  if (!ciMinioContainer) return;
  dockerCommand(['rm', '--force', ciMinioContainer], { timeout: 30000 });
  ciMinioContainer = '';
}

async function startGitHubMinio() {
  const container = 'wheelsonauto-minio-ci-' + process.pid + '-' + crypto.randomBytes(4).toString('hex');
  const started = dockerCommand([
    'run', '--detach', '--rm', '--name', container,
    '--publish', '127.0.0.1::9000',
    '--env', 'MINIO_ROOT_USER=' + CI_ACCESS_KEY,
    '--env', 'MINIO_ROOT_PASSWORD=' + CI_SECRET_KEY,
    MINIO_IMAGE,
    'server', '/data', '--address', ':9000', '--console-address', ':9001'
  ]);
  if (started.status !== 0) throw new Error('GitHub MinIO runtime container failed to start: ' + String(started.stderr || started.stdout || '').trim());
  ciMinioContainer = container;
  try {
    const portResult = dockerCommand(['port', container, '9000/tcp'], { timeout: 30000 });
    if (portResult.status !== 0) throw new Error('GitHub MinIO runtime container did not publish its test port.');
    const match = String(portResult.stdout || '').match(/127\.0\.0\.1:(\d+)/);
    if (!match) throw new Error('GitHub MinIO runtime container returned an invalid test port.');
    endpoint = 'http://127.0.0.1:' + match[1];
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        const response = await fetch(endpoint + '/minio/health/ready');
        if (response.ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (!ready) {
      const logs = dockerCommand(['logs', '--tail', '80', container], { timeout: 30000 });
      throw new Error('GitHub MinIO runtime container did not become healthy within 30 seconds: ' + String(logs.stderr || logs.stdout || '').trim());
    }
    bucket = 'wheelsonauto-private-ci';
    region = 'us-east-1';
    accessKeyId = CI_ACCESS_KEY;
    secretAccessKey = CI_SECRET_KEY;
    pathStyle = true;
    allowHttp = true;
    confirmed = true;
    const createBucket = dockerCommand([
      'run', '--rm',
      '--network', 'container:' + container,
      '--env', 'MC_HOST_local=http://' + CI_ACCESS_KEY + ':' + CI_SECRET_KEY + '@127.0.0.1:9000',
      MINIO_CLIENT_IMAGE,
      'mb', '--ignore-existing', 'local/' + bucket
    ]);
    if (createBucket.status !== 0) throw new Error('GitHub MinIO runtime bucket could not be created: ' + String(createBucket.stderr || createBucket.stdout || '').trim());
    console.log('GitHub MinIO S3-compatible runtime container is ready for encrypted object-storage checks.');
  } catch (error) {
    stopCiMinio();
    throw error;
  }
}

function configuredFields() {
  return [endpoint, bucket, accessKeyId, secretAccessKey];
}

async function main() {
  if (!configuredFields().some(Boolean) && process.env.GITHUB_ACTIONS === 'true') await startGitHubMinio();
  const configuredCount = configuredFields().filter(Boolean).length;
  if (configuredCount > 0 && configuredCount < configuredFields().length) {
    throw new Error('Object-storage runtime check received an incomplete endpoint, bucket, access-key, or secret-key configuration.');
  }
  if (configuredCount === 0) {
    console.log('S3-compatible object-storage runtime check skipped. Set the WOA_TEST_OBJECT_STORAGE_* variables and WOA_OBJECT_STORAGE_RUNTIME_TEST_CONFIRM=1 to run it against a dedicated private test bucket.');
    return;
  }
  if (!confirmed) throw new Error('Set WOA_OBJECT_STORAGE_RUNTIME_TEST_CONFIRM=1 before writing encrypted test objects to the dedicated test bucket.');
  const parsedEndpoint = new URL(endpoint);
  const localHttp = parsedEndpoint.protocol === 'http:' && /^(127\.0\.0\.1|localhost|::1)$/.test(parsedEndpoint.hostname);
  if (parsedEndpoint.protocol !== 'https:' && !(allowHttp && localHttp)) {
    throw new Error('The object-storage runtime check requires HTTPS unless an isolated localhost container is explicitly allowed.');
  }

  const runId = Date.now() + '-' + crypto.randomBytes(5).toString('hex');
  const organizationId = 'org-object-storage-runtime-' + runId;
  const encryptionKey = crypto.randomBytes(32).toString('base64');
  const backupKey = crypto.randomBytes(32).toString('base64');
  const store = secureDocumentStore.createSecureDocumentStore({
    provider: 's3',
    encryptionKey,
    keyVersion: 'runtime-v1',
    endpoint,
    bucket,
    region,
    accessKeyId,
    secretAccessKey,
    pathStyle,
    timeoutMs: 30000
  });
  const cleanupKeys = new Set();
  try {
    assert.strictEqual(store.status().configured, true, 'The S3-compatible runtime store must recognize the complete encrypted test configuration.');
    const source = Buffer.from('WheelsonAuto encrypted object-storage runtime proof ' + runId, 'utf8');
    const document = await store.save({
      id: 'runtime-document-' + runId,
      bytes: source,
      contentType: 'application/pdf',
      originalName: 'runtime-proof.pdf',
      organizationId
    });
    cleanupKeys.add(document.storageKey);
    const encryptedBytes = await store.readObject(document.storageKey);
    assert(!encryptedBytes.equals(source), 'The S3-compatible provider must never receive the private document in plaintext.');
    assert((await store.read(document)).equals(source), 'The S3-compatible encrypted document must round-trip exactly.');

    const immutableKey = 'runtime-proofs/' + organizationId + '/immutable.bin';
    cleanupKeys.add(immutableKey);
    const original = Buffer.from('original immutable encrypted object', 'utf8');
    await store.writeObject(immutableKey, original);
    await assert.rejects(
      () => store.writeObject(immutableKey, Buffer.from('forbidden replacement', 'utf8')),
      error => error && error.code === 'private_object_already_exists' && (error.statusCode === 409 || error.statusCode === 412),
      'A real S3-compatible provider must enforce the conditional immutable-object write.'
    );
    assert((await store.readObject(immutableKey)).equals(original), 'A rejected object-key collision must preserve the original bytes.');

    const storageProbe = await store.probe({ organizationId });
    assert(storageProbe.ok && storageProbe.encrypted && storageProbe.publicReadBlocked === true && storageProbe.objectDeleted, 'The real S3-compatible probe must prove encryption, anonymous-read denial, read-back, and deletion.');

    const backups = encryptedStateBackup.createEncryptedStateBackupStore({
      objectStore: store,
      organizationId,
      encryptionKey: backupKey,
      keyVersion: 'runtime-backup-v1'
    });
    assert.strictEqual(backups.status().configured, true, 'Encrypted state backups must recognize the real S3-compatible runtime store.');
    const backup = await backups.create({
      organizations: [{ id: organizationId }],
      vehicles: [{ id: 'vehicle-runtime-proof', vin: '1WHEELSONAUTORUNTIME' }],
      payments: [{ id: 'payment-runtime-proof', amount: 229, status: 'Paid' }]
    }, { stateVersion: 'runtime-' + runId });
    cleanupKeys.add(backup.storageKey);
    cleanupKeys.add(backups.latestPointerKey());
    const verifiedBackup = await backups.verifyLatest();
    assert(backup.verified && verifiedBackup.stateChecksum === backup.stateChecksum, 'The real S3-compatible backup must publish, read, decrypt, and authenticate through its signed pointer.');

    console.log('S3-compatible object-storage runtime check passed: encrypted document round-trip, plaintext exclusion, immutable collision defense, anonymous-read denial, deletion, signed backup publication, and authenticated recovery verified.');
  } finally {
    for (const key of [...cleanupKeys].reverse()) await store.deleteObject(key).catch(() => {});
    stopCiMinio();
  }
}

main().catch(error => {
  stopCiMinio();
  console.error(error.stack || error);
  process.exit(1);
});
