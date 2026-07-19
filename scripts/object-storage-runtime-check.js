'use strict';

const assert = require('node:assert');
const crypto = require('node:crypto');
const http = require('node:http');
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
let isolatedS3Server = null;
let isolatedS3Metrics = null;

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

async function stopIsolatedS3() {
  if (!isolatedS3Server) return;
  const server = isolatedS3Server;
  isolatedS3Server = null;
  await new Promise(resolve => server.close(resolve));
}

async function startIsolatedS3() {
  const objects = new Map();
  isolatedS3Metrics = { authenticatedRequests: 0, anonymousReadBlocks: 0, immutableWriteBlocks: 0, deletedObjects: 0 };
  isolatedS3Server = http.createServer(async (request, response) => {
    const authorization = String(request.headers.authorization || '');
    const signed = /^AWS4-HMAC-SHA256 Credential=/.test(authorization) &&
      /^\d{8}T\d{6}Z$/.test(String(request.headers['x-amz-date'] || '')) &&
      /^[a-f0-9]{64}$/.test(String(request.headers['x-amz-content-sha256'] || ''));
    if (!signed) {
      if (request.method === 'GET') isolatedS3Metrics.anonymousReadBlocks += 1;
      response.writeHead(403, { 'content-type': 'application/xml' });
      response.end('<Error><Code>AccessDenied</Code></Error>');
      return;
    }
    isolatedS3Metrics.authenticatedRequests += 1;
    const objectKey = decodeURIComponent(String(request.url || '').split('?')[0].replace(/^\/+/, ''));
    if (!objectKey.startsWith('wheelsonauto-private-local/')) {
      response.writeHead(404);
      response.end();
      return;
    }
    if (request.method === 'PUT') {
      const chunks = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const bytes = Buffer.concat(chunks);
      const actualHash = crypto.createHash('sha256').update(bytes).digest('hex');
      if (actualHash !== String(request.headers['x-amz-content-sha256'] || '')) {
        response.writeHead(400, { 'content-type': 'application/xml' });
        response.end('<Error><Code>XAmzContentSHA256Mismatch</Code></Error>');
        return;
      }
      if (request.headers['if-none-match'] === '*' && objects.has(objectKey)) {
        isolatedS3Metrics.immutableWriteBlocks += 1;
        response.writeHead(412, { 'content-type': 'application/xml' });
        response.end('<Error><Code>PreconditionFailed</Code></Error>');
        return;
      }
      objects.set(objectKey, bytes);
      response.writeHead(200, { etag: '"' + crypto.createHash('md5').update(bytes).digest('hex') + '"' });
      response.end();
      return;
    }
    if (request.method === 'GET') {
      if (!objects.has(objectKey)) {
        response.writeHead(404);
        response.end();
        return;
      }
      const bytes = objects.get(objectKey);
      response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(bytes.length) });
      response.end(bytes);
      return;
    }
    if (request.method === 'DELETE') {
      if (objects.delete(objectKey)) isolatedS3Metrics.deletedObjects += 1;
      response.writeHead(204);
      response.end();
      return;
    }
    response.writeHead(405);
    response.end();
  });
  await new Promise((resolve, reject) => {
    isolatedS3Server.once('error', reject);
    isolatedS3Server.listen(0, '127.0.0.1', resolve);
  });
  const address = isolatedS3Server.address();
  endpoint = 'http://127.0.0.1:' + address.port;
  bucket = 'wheelsonauto-private-local';
  region = 'us-east-1';
  accessKeyId = 'wheelsonauto_local_access';
  secretAccessKey = 'wheelsonauto_local_secret_2026';
  pathStyle = true;
  allowHttp = true;
  confirmed = true;
  console.log('Isolated local S3-compatible service is ready for encrypted object-storage checks.');
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
  if (!configuredFields().some(Boolean)) await startIsolatedS3();
  const configuredCount = configuredFields().filter(Boolean).length;
  if (configuredCount > 0 && configuredCount < configuredFields().length) {
    throw new Error('Object-storage runtime check received an incomplete endpoint, bucket, access-key, or secret-key configuration.');
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
    assert(storageProbe.ok && storageProbe.encrypted && storageProbe.immutableWriteProtected === true && storageProbe.publicReadBlocked === true && storageProbe.objectDeleted, 'The real S3-compatible probe must prove encryption, immutable-write protection, original-byte preservation, anonymous-read denial, read-back, and deletion.');

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

    if (isolatedS3Metrics) {
      assert(isolatedS3Metrics.authenticatedRequests >= 10, 'The isolated S3 check must exercise signed read, write, replacement, and delete requests.');
      assert(isolatedS3Metrics.anonymousReadBlocks >= 1, 'The isolated S3 check must prove anonymous object reads are denied.');
      assert(isolatedS3Metrics.immutableWriteBlocks >= 2, 'The isolated S3 check must reject immutable document and probe overwrites.');
      assert(isolatedS3Metrics.deletedObjects >= 1, 'The isolated S3 check must prove encrypted objects can be removed during controlled cleanup.');
    }

    console.log('S3-compatible object-storage runtime check passed: encrypted document round-trip, plaintext exclusion, immutable collision defense, anonymous-read denial, deletion, signed backup publication, and authenticated recovery verified.');
  } finally {
    for (const key of [...cleanupKeys].reverse()) await store.deleteObject(key).catch(() => {});
    stopCiMinio();
    await stopIsolatedS3();
  }
}

main().catch(async error => {
  stopCiMinio();
  await stopIsolatedS3();
  console.error(error.stack || error);
  process.exit(1);
});
