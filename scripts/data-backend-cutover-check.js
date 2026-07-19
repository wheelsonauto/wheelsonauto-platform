'use strict';

const assert = require('node:assert');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const stateRepository = require('../state-repository');
const cutover = require('../data-backend-cutover');

function readyHealth(overrides = {}) {
  return {
    backend: 'postgres',
    connected: true,
    transactional: true,
    productionReady: true,
    stateImported: true,
    snapshotRecoveryReady: true,
    migrationProofReady: true,
    migrationSourceProvenanceReady: true,
    sourceChecksum: '1'.repeat(64),
    canonicalSourceChecksum: '2'.repeat(64),
    targetChecksum: '2'.repeat(64),
    importedVersion: 1,
    provenanceVersion: 2,
    sourceOrigin: 'render-live-disk',
    renderServiceId: 'srv-wheelsonauto-cutover-test',
    sourcePreparedAt: '2026-07-18T11:55:00.000Z',
    liveSourceFileChecksum: '4'.repeat(64),
    protectedSourceFileChecksum: '3'.repeat(64),
    sourceManifestChecksum: '5'.repeat(64),
    sourceSignatureChecksum: '6'.repeat(64),
    ...overrides
  };
}

async function main() {
  assert.strictEqual(stateRepository.normalizeBackend('json'), 'json');
  assert.strictEqual(stateRepository.normalizeBackend('postgresql'), 'postgres');
  assert.throws(
    () => stateRepository.normalizeBackend('postgress'),
    error => error && error.code === 'woa_data_backend_invalid',
    'A misspelled production backend must never silently reopen JSON.'
  );
  assert.throws(
    () => cutover.validateSentinel({ ...cutover.sentinelEvidence(readyHealth(), { organizationId: 'org-wheelsonauto' }), organizationId: '' }),
    error => error && error.code === 'woa_cutover_sentinel_invalid',
    'Cutover evidence without an owning company must fail closed.'
  );

  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'woa-backend-cutover-'));
  try {
    const jsonBeforeCutover = await cutover.assertBackendTransition({ backend: 'json', dataDir: temp });
    assert.strictEqual(jsonBeforeCutover.allowed, true, 'JSON must remain available before a controlled PostgreSQL cutover exists.');

    const repository = { health: async () => readyHealth() };
    const protectedSourceFileChecksum = '3'.repeat(64);
    const first = await cutover.assertBackendTransition({
      backend: 'postgres',
      dataDir: temp,
      repository,
      organizationId: 'org-wheelsonauto',
      protectedSourceFileChecksum,
      now: '2026-07-18T12:00:00.000Z'
    });
    assert.strictEqual(first.created, true, 'The first verified PostgreSQL cutover must create the persistent sentinel.');
    const saved = JSON.parse(await fs.readFile(cutover.sentinelPath(temp), 'utf8'));
    assert.strictEqual(saved.protectedSourceFileChecksum, protectedSourceFileChecksum, 'The sentinel must retain the exact protected source-file checksum when the importer provides it.');
    assert.strictEqual(saved.sourceManifestChecksum, '5'.repeat(64), 'The sentinel must retain the signed source-manifest fingerprint.');
    assert.strictEqual(saved.sourceSignatureChecksum, '6'.repeat(64), 'The sentinel must retain the verified provenance-signature fingerprint.');
    assert.strictEqual(saved.renderServiceId, 'srv-wheelsonauto-cutover-test', 'The sentinel must retain the Render service that captured the live source.');
    assert(!JSON.stringify(saved).includes('postgresql://') && !JSON.stringify(saved).includes('secret'), 'The cutover sentinel must not contain database credentials or secrets.');
    if (process.platform !== 'win32') {
      const mode = (await fs.stat(cutover.sentinelPath(temp))).mode & 0o777;
      assert.strictEqual(mode, 0o600, 'The cutover sentinel must be owner-readable only.');
    }

    await assert.rejects(
      () => cutover.assertBackendTransition({ backend: 'json', dataDir: temp }),
      error => error && error.code === 'woa_json_backend_retired',
      'A missing backend setting after cutover must not reopen the stale JSON file.'
    );
    await assert.rejects(
      () => cutover.assertBackendTransition({ backend: 'json', dataDir: temp, maintenanceMode: true }),
      error => error && error.code === 'woa_json_backend_retired',
      'Maintenance mode alone must not bypass the retired JSON guard.'
    );
    const review = await cutover.assertBackendTransition({
      backend: 'json',
      dataDir: temp,
      maintenanceMode: true,
      rollbackReviewConfirmation: cutover.JSON_ROLLBACK_REVIEW_CONFIRMATION
    });
    assert.strictEqual(review.maintenanceReview, true, 'The exact confirmation may expose retained JSON only while the normal maintenance write freeze remains active.');

    const restart = await cutover.assertBackendTransition({ backend: 'postgres', dataDir: temp, repository, organizationId: 'org-wheelsonauto' });
    assert.strictEqual(restart.created, false, 'A normal PostgreSQL restart must accept matching immutable migration evidence without rewriting it.');

    const unreadyDir = path.join(temp, 'unready');
    await assert.rejects(
      () => cutover.assertBackendTransition({ backend: 'postgres', dataDir: unreadyDir, repository: { health: async () => readyHealth({ snapshotRecoveryReady: false }) } }),
      error => error && error.code === 'woa_postgres_cutover_not_ready',
      'A reachable but unrecoverable PostgreSQL database must not retire JSON or start serving.'
    );
    await assert.rejects(() => fs.access(cutover.sentinelPath(unreadyDir)), error => error && error.code === 'ENOENT', 'A failed PostgreSQL validation must not leave a cutover sentinel.');
    const unsignedDir = path.join(temp, 'unsigned');
    await assert.rejects(
      () => cutover.assertBackendTransition({ backend: 'postgres', dataDir: unsignedDir, repository: { health: async () => readyHealth({ migrationSourceProvenanceReady: false, sourceManifestChecksum: '' }) } }),
      error => error && error.code === 'woa_postgres_cutover_not_ready',
      'A checksum-only migration proof without signed source provenance must not retire JSON.'
    );
    await assert.rejects(() => fs.access(cutover.sentinelPath(unsignedDir)), error => error && error.code === 'ENOENT', 'A provenance failure must not leave a cutover sentinel.');

    await assert.rejects(
      () => cutover.assertBackendTransition({ backend: 'postgres', dataDir: temp, repository: { health: async () => readyHealth({ targetChecksum: '4'.repeat(64), canonicalSourceChecksum: '4'.repeat(64) }) }, organizationId: 'org-wheelsonauto' }),
      error => error && error.code === 'woa_cutover_sentinel_conflict',
      'Different migration evidence must never overwrite the retained cutover sentinel.'
    );
    await assert.rejects(
      () => cutover.assertBackendTransition({ backend: 'postgres', dataDir: temp, repository: { health: async () => readyHealth({ sourceManifestChecksum: '7'.repeat(64) }) }, organizationId: 'org-wheelsonauto' }),
      error => error && error.code === 'woa_cutover_sentinel_conflict',
      'A different signed source manifest must not be accepted against the retained cutover sentinel.'
    );

    const corruptDir = path.join(temp, 'corrupt');
    await fs.mkdir(corruptDir, { recursive: true });
    await fs.writeFile(cutover.sentinelPath(corruptDir), '{not-json', { mode: 0o600 });
    await assert.rejects(
      () => cutover.assertBackendTransition({ backend: 'json', dataDir: corruptDir }),
      error => error && error.code === 'woa_cutover_sentinel_invalid',
      'A damaged sentinel must fail closed instead of treating JSON as safe.'
    );

    const serverSource = await fs.readFile(path.resolve(__dirname, '..', 'server.js'), 'utf8');
    const importerSource = await fs.readFile(path.resolve(__dirname, 'migrate-json-to-postgres.js'), 'utf8');
    const verifierSource = await fs.readFile(path.resolve(__dirname, 'verify-json-to-postgres.js'), 'utf8');
    assert(serverSource.includes('assertDataBackendTransition()') && serverSource.indexOf('assertDataBackendTransition()') < serverSource.lastIndexOf('server.listen('), 'Server startup must validate the persistent backend transition before listening.');
    assert(importerSource.includes('writePostgresSentinel') && importerSource.includes('protectedSourceFileChecksum: source.sourceFileChecksum'), 'The controlled importer must retire JSON with the exact protected-source checksum after verification.');
    assert(verifierSource.includes('writePostgresSentinel') && verifierSource.includes('protectedSourceFileChecksum: source.sourceFileChecksum'), 'The read-only verifier must be able to finish a missing matching sentinel without re-importing business state.');
    console.log('Data-backend cutover check passed: invalid backend values, empty databases, stale JSON fallback, mismatched migration evidence, and corrupt sentinels all fail closed while verified PostgreSQL restarts remain available.');
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
