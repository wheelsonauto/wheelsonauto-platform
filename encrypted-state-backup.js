'use strict';

const crypto = require('crypto');
const zlib = require('zlib');
const stateRepository = require('./state-repository');
const secureDocumentStore = require('./secure-document-store');

const BACKUP_FORMAT = 'wheelsonauto-encrypted-state-backup';
const POINTER_FORMAT = 'wheelsonauto-encrypted-state-backup-pointer';
const BACKUP_VERSION = 1;
const MAX_ENVELOPE_BYTES = 100 * 1024 * 1024;
const MAX_STATE_BYTES = 250 * 1024 * 1024;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function safeOrganizationId(value) {
  const result = String(value || '').trim().replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  if (!result) throw new Error('State backup organization is required.');
  return result;
}

function validSha256(value) {
  return /^[a-f0-9]{64}$/i.test(String(value || ''));
}

function parseJsonObject(bytes, label, maxBytes = MAX_ENVELOPE_BYTES) {
  if (!Buffer.isBuffer(bytes) || !bytes.length) throw new Error(label + ' is empty.');
  if (bytes.length > maxBytes) throw new Error(label + ' exceeds the maximum supported size.');
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error(label + ' is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(label + ' is invalid.');
  return parsed;
}

function byteLimit(value, fallback, maximum) {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1024 || parsed > maximum) throw new Error('State backup byte limit is invalid.');
  return parsed;
}

function decodeCanonicalBase64(value, label) {
  const encoded = String(value || '');
  if (!encoded || encoded.length % 4 !== 0 || !/^[a-zA-Z0-9+/]+={0,2}$/.test(encoded)) throw new Error(label + ' is invalid.');
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length || bytes.toString('base64') !== encoded) throw new Error(label + ' is invalid.');
  return bytes;
}

function pointerSigningValue(pointer = {}) {
  const unsigned = { ...pointer };
  delete unsigned.signature;
  return stateRepository.stableJson(unsigned);
}

function pointerSignature(pointer, key) {
  return crypto.createHmac('sha256', key).update(pointerSigningValue(pointer), 'utf8').digest('hex');
}

function timingSafeHexEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'hex');
  const b = Buffer.from(String(right || ''), 'hex');
  return a.length === 32 && b.length === 32 && crypto.timingSafeEqual(a, b);
}

function backupAad(metadata = {}) {
  return Buffer.from([
    BACKUP_FORMAT,
    BACKUP_VERSION,
    metadata.organizationId,
    metadata.createdAt,
    metadata.stateVersion,
    metadata.stateChecksum,
    metadata.keyVersion
  ].join('|'), 'utf8');
}

class EncryptedStateBackupStore {
  constructor(options = {}) {
    this.objectStore = options.objectStore;
    this.organizationId = safeOrganizationId(options.organizationId || 'org-wheelsonauto');
    this.key = secureDocumentStore.decodeEncryptionKey(options.encryptionKey || process.env.WOA_STATE_BACKUP_ENCRYPTION_KEY || process.env.WOA_DOCUMENT_ENCRYPTION_KEY || '');
    this.keyVersion = String(options.keyVersion || process.env.WOA_STATE_BACKUP_KEY_VERSION || process.env.WOA_DOCUMENT_ENCRYPTION_KEY_VERSION || 'v1').trim() || 'v1';
    if (!/^[a-zA-Z0-9._-]{1,80}$/.test(this.keyVersion)) throw new Error('WOA_STATE_BACKUP_KEY_VERSION contains unsupported characters.');
    this.decryptionKeys = secureDocumentStore.parseDecryptionKeys(options.decryptionKeys || process.env.WOA_STATE_BACKUP_DECRYPTION_KEYS || process.env.WOA_DOCUMENT_DECRYPTION_KEYS || '');
    this.maxEnvelopeBytes = byteLimit(options.maxEnvelopeBytes, MAX_ENVELOPE_BYTES, MAX_ENVELOPE_BYTES);
    this.maxStateBytes = byteLimit(options.maxStateBytes, MAX_STATE_BYTES, MAX_STATE_BYTES);
    if (this.key) {
      const configured = this.decryptionKeys.get(this.keyVersion);
      if (configured && !configured.equals(this.key)) throw new Error('The active state-backup key conflicts with the configured decryption key for ' + this.keyVersion + '.');
      this.decryptionKeys.set(this.keyVersion, this.key);
    }
  }

  backupPrefix() {
    return 'state-backups/' + this.organizationId + '/';
  }

  latestPointerKey() {
    return this.backupPrefix() + 'latest.json';
  }

  status() {
    const objectStatus = this.objectStore && typeof this.objectStore.status === 'function'
      ? this.objectStore.status()
      : { configured: false, productionReady: false, message: 'Private object storage is unavailable.' };
    const encryptionConfigured = !!this.key;
    return {
      configured: !!(encryptionConfigured && objectStatus.configured && this.objectStore && typeof this.objectStore.replaceObject === 'function'),
      productionReady: !!(encryptionConfigured && objectStatus.productionReady),
      encryptionConfigured,
      keyVersion: encryptionConfigured ? this.keyVersion : '',
      availableKeyVersions: [...this.decryptionKeys.keys()].sort(),
      storage: objectStatus,
      message: !encryptionConfigured
        ? 'Set WOA_STATE_BACKUP_ENCRYPTION_KEY or WOA_DOCUMENT_ENCRYPTION_KEY before creating encrypted state backups.'
        : !objectStatus.configured
          ? objectStatus.message
          : 'Encrypted offsite state backups are configured.'
    };
  }

  assertConfigured() {
    const status = this.status();
    if (!status.configured) throw new Error(status.message);
  }

  keyForVersion(version) {
    const key = this.decryptionKeys.get(String(version || '').trim());
    if (!key) throw new Error('State backup encryption key version ' + (version || '(missing)') + ' is not configured.');
    return key;
  }

  createEnvelope(state, options = {}) {
    this.assertConfigured();
    if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('State backup data must be an object.');
    const createdAt = String(options.createdAt || new Date().toISOString());
    if (!Number.isFinite(Date.parse(createdAt))) throw new Error('State backup timestamp is invalid.');
    const stateVersion = String(options.stateVersion == null ? '' : options.stateVersion).slice(0, 80);
    const stateChecksum = stateRepository.checksum(state);
    const plaintext = Buffer.from(stateRepository.stableJson(state), 'utf8');
    if (!plaintext.length || plaintext.length > this.maxStateBytes) throw new Error('State backup data exceeds the maximum supported size.');
    const compressed = zlib.gzipSync(plaintext, { level: 9 });
    const metadata = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      organizationId: this.organizationId,
      createdAt,
      stateVersion,
      stateChecksum,
      stateSize: plaintext.length,
      compression: 'gzip',
      encryption: 'AES-256-GCM',
      keyVersion: this.keyVersion
    };
    const nonce = crypto.randomBytes(12);
    const aad = backupAad(metadata);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, nonce);
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()]);
    const envelope = {
      ...metadata,
      nonce: nonce.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      ciphertextSha256: sha256(ciphertext),
      ciphertext: ciphertext.toString('base64')
    };
    const bytes = Buffer.from(stateRepository.stableJson(envelope), 'utf8');
    if (bytes.length > this.maxEnvelopeBytes) throw new Error('Encrypted state backup exceeds the maximum supported size.');
    return { envelope, bytes, stateChecksum, stateSize: plaintext.length };
  }

  decryptEnvelope(bytes, expected = {}) {
    const envelope = parseJsonObject(bytes, 'Encrypted state backup', this.maxEnvelopeBytes);
    if (envelope.format !== BACKUP_FORMAT || Number(envelope.version) !== BACKUP_VERSION) throw new Error('Encrypted state backup format is unsupported.');
    if (envelope.organizationId !== this.organizationId || expected.organizationId && envelope.organizationId !== expected.organizationId) throw new Error('Encrypted state backup belongs to a different organization.');
    if (!validSha256(envelope.stateChecksum) || expected.stateChecksum && envelope.stateChecksum !== expected.stateChecksum) throw new Error('Encrypted state backup checksum metadata does not match the signed pointer.');
    if (!Number.isFinite(Date.parse(String(envelope.createdAt || '')))) throw new Error('Encrypted state backup timestamp is invalid.');
    if (expected.createdAt && envelope.createdAt !== expected.createdAt) throw new Error('Encrypted state backup timestamp does not match the signed pointer.');
    if (String(envelope.stateVersion == null ? '' : envelope.stateVersion).length > 80) throw new Error('Encrypted state backup version is invalid.');
    if (expected.stateVersion != null && String(envelope.stateVersion) !== String(expected.stateVersion)) throw new Error('Encrypted state backup version does not match the signed pointer.');
    const stateSize = Number(envelope.stateSize);
    if (!Number.isSafeInteger(stateSize) || stateSize < 2 || stateSize > this.maxStateBytes) throw new Error('Encrypted state backup size metadata is invalid.');
    if (expected.stateSize != null && stateSize !== Number(expected.stateSize)) throw new Error('Encrypted state backup size does not match the signed pointer.');
    if (envelope.compression !== 'gzip' || envelope.encryption !== 'AES-256-GCM') throw new Error('Encrypted state backup encoding is unsupported.');
    if (!/^[a-zA-Z0-9._-]{1,80}$/.test(String(envelope.keyVersion || ''))) throw new Error('Encrypted state backup key version is invalid.');
    if (expected.keyVersion && envelope.keyVersion !== expected.keyVersion) throw new Error('Encrypted state backup key version does not match the signed pointer.');
    if (!validSha256(envelope.ciphertextSha256)) throw new Error('Encrypted state backup payload checksum is invalid.');
    const nonce = decodeCanonicalBase64(envelope.nonce, 'Encrypted state backup nonce');
    const authTag = decodeCanonicalBase64(envelope.authTag, 'Encrypted state backup authentication tag');
    const ciphertext = decodeCanonicalBase64(envelope.ciphertext, 'Encrypted state backup ciphertext');
    if (nonce.length !== 12 || authTag.length !== 16 || sha256(ciphertext) !== envelope.ciphertextSha256) throw new Error('Encrypted state backup payload integrity failed.');
    const key = this.keyForVersion(envelope.keyVersion);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAAD(backupAad(envelope));
    decipher.setAuthTag(authTag);
    let compressed;
    try {
      compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch {
      throw new Error('Encrypted state backup authentication failed.');
    }
    let plaintext;
    try {
      plaintext = zlib.gunzipSync(compressed, { maxOutputLength: this.maxStateBytes });
    } catch {
      throw new Error('Encrypted state backup decompression failed.');
    }
    if (plaintext.length !== Number(envelope.stateSize || 0)) throw new Error('Encrypted state backup size verification failed.');
    const state = parseJsonObject(plaintext, 'Decrypted state backup', this.maxStateBytes);
    const actualChecksum = stateRepository.checksum(state);
    if (actualChecksum !== envelope.stateChecksum) throw new Error('Encrypted state backup state checksum verification failed.');
    return {
      state,
      metadata: {
        organizationId: envelope.organizationId,
        createdAt: envelope.createdAt,
        stateVersion: envelope.stateVersion,
        stateChecksum: envelope.stateChecksum,
        stateSize: envelope.stateSize,
        keyVersion: envelope.keyVersion
      }
    };
  }

  verifyPointer(pointer) {
    if (!pointer || pointer.format !== POINTER_FORMAT || Number(pointer.version) !== BACKUP_VERSION) throw new Error('Encrypted state backup pointer is invalid.');
    if (pointer.organizationId !== this.organizationId) throw new Error('Encrypted state backup pointer belongs to a different organization.');
    if (!validSha256(pointer.backupSha256) || !validSha256(pointer.stateChecksum)) throw new Error('Encrypted state backup pointer checksums are invalid.');
    if (!Number.isFinite(Date.parse(String(pointer.createdAt || '')))) throw new Error('Encrypted state backup pointer timestamp is invalid.');
    if (String(pointer.stateVersion == null ? '' : pointer.stateVersion).length > 80) throw new Error('Encrypted state backup pointer version is invalid.');
    const stateSize = Number(pointer.stateSize);
    if (!Number.isSafeInteger(stateSize) || stateSize < 2 || stateSize > this.maxStateBytes) throw new Error('Encrypted state backup pointer size is invalid.');
    if (!/^[a-zA-Z0-9._-]{1,80}$/.test(String(pointer.keyVersion || ''))) throw new Error('Encrypted state backup pointer key version is invalid.');
    const prefix = this.backupPrefix();
    if (String(pointer.storageKey || '').length > 512 || !String(pointer.storageKey || '').startsWith(prefix) || pointer.storageKey === this.latestPointerKey()) throw new Error('Encrypted state backup pointer contains an invalid object key.');
    const key = this.keyForVersion(pointer.keyVersion);
    if (!timingSafeHexEqual(pointer.signature, pointerSignature(pointer, key))) throw new Error('Encrypted state backup pointer signature verification failed.');
    return pointer;
  }

  async create(state, options = {}) {
    const created = this.createEnvelope(state, options);
    const stamp = created.envelope.createdAt.replace(/[^0-9]/g, '').slice(0, 17);
    const storageKey = this.backupPrefix() + stamp + '-' + created.stateChecksum.slice(0, 16) + '-' + crypto.randomBytes(5).toString('hex') + '.woabackup';
    const pointer = {
      format: POINTER_FORMAT,
      version: BACKUP_VERSION,
      organizationId: this.organizationId,
      storageKey,
      createdAt: created.envelope.createdAt,
      stateVersion: created.envelope.stateVersion,
      stateChecksum: created.stateChecksum,
      stateSize: created.stateSize,
      backupSha256: sha256(created.bytes),
      keyVersion: this.keyVersion
    };
    pointer.signature = pointerSignature(pointer, this.key);
    let backupWritten = false;
    let pointerUpdated = false;
    let previousPointerBytes = null;
    try {
      try {
        previousPointerBytes = await this.objectStore.readObject(this.latestPointerKey());
      } catch (error) {
        const missing = error && (error.code === 'ENOENT' || error.statusCode === 404);
        if (!missing) throw error;
      }
      await this.objectStore.writeObject(storageKey, created.bytes);
      backupWritten = true;
      await this.objectStore.replaceObject(this.latestPointerKey(), Buffer.from(stateRepository.stableJson(pointer), 'utf8'));
      pointerUpdated = true;
      const verified = await this.readLatest();
      if (verified.metadata.stateChecksum !== created.stateChecksum) throw new Error('Encrypted state backup read-back verification failed.');
      return { ...verified.metadata, storageKey, backupSha256: pointer.backupSha256, verified: true };
    } catch (error) {
      let pointerRollbackError = null;
      if (pointerUpdated) {
        try {
          if (previousPointerBytes) await this.objectStore.replaceObject(this.latestPointerKey(), previousPointerBytes);
          else await this.objectStore.deleteObject(this.latestPointerKey());
        } catch (rollbackError) {
          pointerRollbackError = rollbackError;
        }
      }
      if (backupWritten && !pointerRollbackError) await this.objectStore.deleteObject(storageKey).catch(() => {});
      if (pointerRollbackError) {
        const combined = new Error('Encrypted state backup verification failed and the latest-pointer rollback also failed. The new immutable object was retained for recovery review.');
        combined.cause = pointerRollbackError;
        throw combined;
      }
      throw error;
    }
  }

  async readLatest() {
    this.assertConfigured();
    let pointerBytes;
    try {
      pointerBytes = await this.objectStore.readObject(this.latestPointerKey());
    } catch (error) {
      if (error && (error.code === 'ENOENT' || error.statusCode === 404)) {
        const missing = new Error('No encrypted state backup has been created yet.');
        missing.code = 'woa_state_backup_not_found';
        throw missing;
      }
      throw error;
    }
    const pointer = this.verifyPointer(parseJsonObject(pointerBytes, 'Encrypted state backup pointer', this.maxEnvelopeBytes));
    let backupBytes;
    try {
      backupBytes = await this.objectStore.readObject(pointer.storageKey);
    } catch (error) {
      if (error && (error.code === 'ENOENT' || error.statusCode === 404)) {
        const missing = new Error('The encrypted state backup referenced by the signed pointer is missing. Restore the last verified backup before launch.');
        missing.code = 'woa_state_backup_object_missing';
        throw missing;
      }
      throw error;
    }
    if (sha256(backupBytes) !== pointer.backupSha256) throw new Error('Encrypted state backup object checksum does not match the signed pointer.');
    const recovered = this.decryptEnvelope(backupBytes, pointer);
    return { ...recovered, pointer };
  }

  async verifyLatest() {
    const recovered = await this.readLatest();
    return { ...recovered.metadata, storageKey: recovered.pointer.storageKey, backupSha256: recovered.pointer.backupSha256, verified: true };
  }
}

function createEncryptedStateBackupStore(options = {}) {
  return new EncryptedStateBackupStore(options);
}

module.exports = {
  BACKUP_FORMAT,
  POINTER_FORMAT,
  BACKUP_VERSION,
  safeOrganizationId,
  pointerSigningValue,
  EncryptedStateBackupStore,
  createEncryptedStateBackupStore
};
