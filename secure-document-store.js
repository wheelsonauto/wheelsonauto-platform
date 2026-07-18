'use strict';

const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

function decodeEncryptionKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^[a-f0-9]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
  try {
    const decoded = Buffer.from(raw, 'base64');
    return decoded.length === 32 ? decoded : null;
  } catch {
    return null;
  }
}

function hmac(key, value, encoding) {
  return crypto.createHmac('sha256', key).update(value, 'utf8').digest(encoding);
}

function normalizeObjectKey(value) {
  const key = String(value || '').replace(/^\/+/, '');
  if (!key || key.split('/').some(segment => !segment || segment === '.' || segment === '..')) throw new Error('Invalid private document storage key.');
  return key.replace(/[^a-zA-Z0-9._/-]/g, '_');
}

function signingHeaders(method, urlValue, body, config) {
  const url = new URL(urlValue);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = crypto.createHash('sha256').update(body || Buffer.alloc(0)).digest('hex');
  const host = url.host;
  const canonicalHeaders = 'host:' + host + '\n' + 'x-amz-content-sha256:' + payloadHash + '\n' + 'x-amz-date:' + amzDate + '\n';
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [method, url.pathname.split('/').map(encodeURIComponent).join('/').replace(/%2F/g, '/'), url.searchParams.toString(), canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = [dateStamp, config.region, 's3', 'aws4_request'].join('/');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, crypto.createHash('sha256').update(canonicalRequest, 'utf8').digest('hex')].join('\n');
  const dateKey = hmac('AWS4' + config.secretAccessKey, dateStamp);
  const regionKey = hmac(dateKey, config.region);
  const serviceKey = hmac(regionKey, 's3');
  const signingKey = hmac(serviceKey, 'aws4_request');
  const signature = hmac(signingKey, stringToSign, 'hex');
  const headers = {
    Host: host,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
    Authorization: 'AWS4-HMAC-SHA256 Credential=' + config.accessKeyId + '/' + scope + ', SignedHeaders=' + signedHeaders + ', Signature=' + signature
  };
  if (config.sessionToken) headers['x-amz-security-token'] = config.sessionToken;
  return headers;
}

function s3ObjectUrl(config, key) {
  const safeKey = normalizeObjectKey(key).split('/').map(encodeURIComponent).join('/');
  if (config.endpoint.includes('{bucket}')) return config.endpoint.replace('{bucket}', encodeURIComponent(config.bucket)).replace(/\/+$/, '') + '/' + safeKey;
  if (config.pathStyle) return config.endpoint.replace(/\/+$/, '') + '/' + encodeURIComponent(config.bucket) + '/' + safeKey;
  const endpoint = new URL(config.endpoint);
  endpoint.hostname = encodeURIComponent(config.bucket) + '.' + endpoint.hostname;
  endpoint.pathname = '/' + safeKey;
  return endpoint.toString();
}

function buildS3Config(options = {}) {
  const bucket = String(options.bucket || process.env.WOA_OBJECT_STORAGE_BUCKET || process.env.S3_BUCKET || '').trim();
  const accessKeyId = String(options.accessKeyId || process.env.WOA_OBJECT_STORAGE_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = String(options.secretAccessKey || process.env.WOA_OBJECT_STORAGE_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY || '').trim();
  const sessionToken = String(options.sessionToken || process.env.AWS_SESSION_TOKEN || '').trim();
  const region = String(options.region || process.env.WOA_OBJECT_STORAGE_REGION || process.env.S3_REGION || 'auto').trim() || 'auto';
  const endpoint = String(options.endpoint || process.env.WOA_OBJECT_STORAGE_ENDPOINT || process.env.S3_ENDPOINT || '').trim() || (region === 'auto' ? '' : 'https://s3.' + region + '.amazonaws.com');
  const pathStyle = options.pathStyle === true || process.env.WOA_OBJECT_STORAGE_PATH_STYLE === '1' || /r2\.cloudflarestorage\.com|localhost|127\.0\.0\.1/i.test(endpoint);
  return { bucket, accessKeyId, secretAccessKey, sessionToken, region, endpoint, pathStyle };
}

class SecureDocumentStore {
  constructor(options = {}) {
    this.provider = String(options.provider || process.env.WOA_DOCUMENT_STORAGE_PROVIDER || 'local').trim().toLowerCase();
    this.localRoot = path.resolve(options.localRoot || process.env.WOA_DOCUMENT_LOCAL_ROOT || path.join(process.cwd(), 'private-documents'));
    this.key = decodeEncryptionKey(options.encryptionKey || process.env.WOA_DOCUMENT_ENCRYPTION_KEY || '');
    this.keyVersion = String(options.keyVersion || process.env.WOA_DOCUMENT_ENCRYPTION_KEY_VERSION || 'v1').trim() || 'v1';
    this.s3 = buildS3Config(options);
    this.fetch = options.fetch || global.fetch;
    this.timeoutMs = Math.max(3000, Math.min(60000, Number(options.timeoutMs || process.env.WOA_OBJECT_STORAGE_TIMEOUT_MS || 15000)));
  }

  status() {
    const encryptionConfigured = !!this.key;
    let endpointValid = false;
    let secureTransport = false;
    try {
      const endpoint = new URL(this.s3.endpoint);
      endpointValid = endpoint.protocol === 'https:' || endpoint.protocol === 'http:';
      secureTransport = endpoint.protocol === 'https:';
    } catch {}
    const s3Configured = !!(this.s3.bucket && this.s3.accessKeyId && this.s3.secretAccessKey && this.s3.endpoint && endpointValid);
    const providerConfigured = this.provider === 's3' ? s3Configured : this.provider === 'local';
    return {
      provider: this.provider === 's3' ? 'S3-compatible private object storage' : 'Encrypted local development store',
      encryptionConfigured,
      providerConfigured,
      configured: encryptionConfigured && providerConfigured,
      productionReady: encryptionConfigured && this.provider === 's3' && s3Configured && secureTransport,
      secureTransport: this.provider === 's3' ? secureTransport : false,
      keyVersion: encryptionConfigured ? this.keyVersion : '',
      message: !encryptionConfigured
        ? 'Set WOA_DOCUMENT_ENCRYPTION_KEY before storing new identity or insurance documents.'
        : this.provider === 's3' && !s3Configured
          ? 'Complete WOA_OBJECT_STORAGE_BUCKET, endpoint, region, and access keys before enabling private object storage.'
          : this.provider === 's3' && !secureTransport
            ? 'Private object storage must use an HTTPS endpoint before production launch.'
          : this.provider === 'local'
            ? 'Encrypted locally for development only. Use S3-compatible object storage before production launch.'
            : 'Encrypted private object storage is ready.'
    };
  }

  isConfigured() {
    return this.status().configured;
  }

  isEncryptedDocument(document = {}) {
    return !!(document && document.storageKey && document.encryption && document.encryption.algorithm === 'AES-256-GCM');
  }

  async fetchObject(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
    try {
      return await this.fetch(url, { ...options, signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) throw new Error('Private object storage request timed out.');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async writeObject(key, bytes) {
    const storageKey = normalizeObjectKey(key);
    if (this.provider === 'local') {
      const target = path.resolve(this.localRoot, storageKey);
      if (!target.startsWith(this.localRoot + path.sep)) throw new Error('Invalid encrypted document path.');
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, bytes, { flag: 'wx' });
      return { storageKey, storagePath: path.relative(path.dirname(this.localRoot), target) };
    }
    if (this.provider !== 's3') throw new Error('Unknown document storage provider.');
    const url = s3ObjectUrl(this.s3, storageKey);
    const headers = signingHeaders('PUT', url, bytes, this.s3);
    headers['Content-Type'] = 'application/octet-stream';
    const response = await this.fetchObject(url, { method: 'PUT', headers, body: bytes });
    if (!response.ok) throw new Error('Private object storage upload failed (' + response.status + ').');
    return { storageKey, storagePath: '' };
  }

  async readObject(key) {
    const storageKey = normalizeObjectKey(key);
    if (this.provider === 'local') {
      const target = path.resolve(this.localRoot, storageKey);
      if (!target.startsWith(this.localRoot + path.sep)) throw new Error('Invalid encrypted document path.');
      return fs.readFile(target);
    }
    if (this.provider !== 's3') throw new Error('Unknown document storage provider.');
    const url = s3ObjectUrl(this.s3, storageKey);
    const headers = signingHeaders('GET', url, Buffer.alloc(0), this.s3);
    const response = await this.fetchObject(url, { method: 'GET', headers });
    if (!response.ok) throw new Error('Private object storage read failed (' + response.status + ').');
    return Buffer.from(await response.arrayBuffer());
  }

  async deleteObject(key) {
    const storageKey = normalizeObjectKey(key);
    if (this.provider === 'local') {
      const target = path.resolve(this.localRoot, storageKey);
      if (!target.startsWith(this.localRoot + path.sep)) throw new Error('Invalid encrypted document path.');
      await fs.rm(target, { force: true });
      return;
    }
    if (this.provider !== 's3') throw new Error('Unknown document storage provider.');
    const url = s3ObjectUrl(this.s3, storageKey);
    const headers = signingHeaders('DELETE', url, Buffer.alloc(0), this.s3);
    const response = await this.fetchObject(url, { method: 'DELETE', headers });
    if (!response.ok && response.status !== 404) throw new Error('Private object storage delete failed (' + response.status + ').');
  }

  async probe(options = {}) {
    const status = this.status();
    if (!status.configured) throw new Error(status.message);
    const probeId = 'storage-probe-' + Date.now() + '-' + crypto.randomBytes(6).toString('hex');
    const expected = Buffer.from('WheelsonAuto private storage validation ' + crypto.randomBytes(18).toString('hex'), 'utf8');
    let stored = null;
    let deleted = false;
    try {
      stored = await this.save({
        id: probeId,
        bytes: expected,
        contentType: 'application/octet-stream',
        originalName: 'wheelsonauto-storage-validation.bin',
        organizationId: options.organizationId || 'org-wheelsonauto-storage-validation'
      });
      const recovered = await this.read(stored);
      if (!recovered.equals(expected)) throw new Error('Private object storage validation read did not match the encrypted write.');
      let publicReadBlocked = null;
      if (this.provider === 's3') {
        const publicResponse = await this.fetchObject(s3ObjectUrl(this.s3, stored.storageKey), { method: 'GET', redirect: 'follow' });
        if (publicResponse.ok) throw new Error('Private object storage validation failed because the encrypted object was publicly readable without credentials. Block anonymous object reads before launch.');
        publicReadBlocked = true;
      }
      await this.deleteObject(stored.storageKey);
      deleted = true;
      return {
        ok: true,
        checkedAt: new Date().toISOString(),
        provider: this.provider,
        encrypted: true,
        publicReadBlocked,
        objectDeleted: true
      };
    } catch (error) {
      if (stored && stored.storageKey && !deleted) await this.deleteObject(stored.storageKey).catch(() => {});
      throw error;
    }
  }

  async save({ id, bytes, contentType, originalName, organizationId } = {}) {
    if (!this.isConfigured()) throw new Error(this.status().message);
    if (!Buffer.isBuffer(bytes) || !bytes.length) throw new Error('Private document data is missing.');
    const documentId = String(id || 'document').replace(/[^a-z0-9-]/gi, '').slice(0, 80) || 'document';
    const ownerOrganizationId = String(organizationId || 'org-wheelsonauto');
    const ownerContentType = String(contentType || 'application/octet-stream');
    const nonce = crypto.randomBytes(12);
    const aad = Buffer.from([ownerOrganizationId, documentId, ownerContentType].join('|'), 'utf8');
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, nonce);
    cipher.setAAD(aad);
    const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const storageKey = 'documents/' + ownerOrganizationId.replace(/[^a-z0-9-]/gi, '') + '/' + documentId + '-' + crypto.randomBytes(8).toString('hex') + '.enc';
    const stored = await this.writeObject(storageKey, encrypted);
    return {
      id: documentId,
      organizationId: ownerOrganizationId,
      storageProvider: this.provider === 's3' ? 's3-encrypted' : 'local-encrypted',
      storageKey: stored.storageKey,
      storagePath: stored.storagePath,
      originalName: String(originalName || '').slice(0, 180),
      contentType: ownerContentType,
      size: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      encryption: {
        algorithm: 'AES-256-GCM',
        keyVersion: this.keyVersion,
        nonce: nonce.toString('base64'),
        authTag: authTag.toString('base64'),
        aad: aad.toString('base64')
      }
    };
  }

  async read(document = {}) {
    if (!this.isEncryptedDocument(document)) throw new Error('This document has not been migrated into encrypted private storage.');
    if (!this.key) throw new Error('WOA_DOCUMENT_ENCRYPTION_KEY is required to read private documents.');
    const encryption = document.encryption || {};
    const nonce = Buffer.from(String(encryption.nonce || ''), 'base64');
    const authTag = Buffer.from(String(encryption.authTag || ''), 'base64');
    const aad = Buffer.from(String(encryption.aad || ''), 'base64');
    if (nonce.length !== 12 || authTag.length !== 16 || !aad.length) throw new Error('Encrypted document metadata is invalid.');
    const aadParts = aad.toString('utf8').split('|');
    const recordOrganizationId = String(document.organizationId || '').trim();
    const recordDocumentId = String(document.id || '').trim();
    const recordContentType = String(document.contentType || document.signatureImageContentType || '').trim();
    if (aadParts.length !== 3 ||
      (recordOrganizationId && aadParts[0] !== recordOrganizationId) ||
      (recordDocumentId && aadParts[1] !== recordDocumentId) ||
      (recordContentType && aadParts[2] !== recordContentType)) {
      throw new Error('Encrypted document ownership metadata does not match the authenticated storage record.');
    }
    const encrypted = await this.readObject(document.storageKey);
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, nonce);
    decipher.setAAD(aad);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  }
}

function createSecureDocumentStore(options = {}) {
  return new SecureDocumentStore(options);
}

module.exports = {
  decodeEncryptionKey,
  normalizeObjectKey,
  SecureDocumentStore,
  createSecureDocumentStore
};
