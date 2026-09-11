/* OmniBlock account-sync protocol.
 *
 * This file is deliberately dependency-free and UMD-shaped: the extension
 * loads it as a normal browser script, while the regression suite requires it
 * from Node. It contains no provider key, account password, cookie, or page
 * identifier handling. The server only receives the encrypted envelope made
 * by encryptDocument().
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OmniBlockSync = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const FORMAT = 'omniblock.sync-document';
  const ENVELOPE_FORMAT = 'omniblock.sync-envelope';
  const EXPORT_FORMAT = 'omniblock.extension-export';
  const SCHEMA = 1;
  const DATA_KEY = 'omniblock:data:v1';
  const PROFILE_KEY = 'omniblock:ai-prompt-profile:v1';
  const FEEDBACK_KEY = 'omniblock:ai-feedback:v1';
  const DEVICE_ID_KEY = 'omniblock:sync-device-id:v1';
  const AUTH_KEY = 'omniblock:sync-auth:v1';
  const LOCAL_STATE_KEY = 'omniblock:sync-local:v1';
  const DEVICE_CONFIG_KEY = 'omniblock:ai-device-config:v1';
  const KDF_ITERATIONS = 310000;
  const MIN_PASSPHRASE_LENGTH = 8;
  const MAX_ENVELOPE_CHARS = 12 * 1024 * 1024;
  const NAMESPACES = ['persons', 'settings', 'prompt', 'feedback'];

  function clone(value) {
    if (value == null) return value;
    try { return JSON.parse(JSON.stringify(value)); } catch (error) { return null; }
  }

  function stable(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
    return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
  }

  function parseStored(value) {
    if (typeof value !== 'string') return clone(value);
    try { return JSON.parse(value); } catch (error) { return null; }
  }

  function plainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function cleanString(value, maxLength) {
    return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, maxLength);
  }

  function normalizeClock(value) {
    const clock = value && typeof value === 'object' ? value : {};
    const counter = Number(clock.counter);
    const deviceId = cleanString(clock.deviceId, 80);
    if (!Number.isSafeInteger(counter) || counter < 0 || !deviceId) return null;
    return { counter, deviceId };
  }

  function compareClock(left, right) {
    const a = normalizeClock(left) || { counter: 0, deviceId: '' };
    const b = normalizeClock(right) || { counter: 0, deviceId: '' };
    if (a.counter !== b.counter) return a.counter > b.counter ? 1 : -1;
    if (a.deviceId === b.deviceId) return 0;
    return a.deviceId > b.deviceId ? 1 : -1;
  }

  function normalizeRecord(value) {
    if (!plainObject(value)) return null;
    const clock = normalizeClock(value.clock);
    if (!clock || typeof value.tombstone !== 'boolean') return null;
    if (!value.tombstone && value.value === undefined) return null;
    return {
      clock,
      tombstone: value.tombstone,
      ...(value.tombstone ? {} : { value: clone(value.value) }),
    };
  }

  function emptyDocument(deviceId) {
    const id = cleanString(deviceId, 80) || 'device-unknown';
    return { format: FORMAT, schema: SCHEMA, deviceId: id, logicalClock: 0, records: {} };
  }

  function normalizeDocument(value) {
    if (!plainObject(value) || value.format !== FORMAT || Number(value.schema) !== SCHEMA) return null;
    const deviceId = cleanString(value.deviceId, 80);
    if (!deviceId || !plainObject(value.records)) return null;
    const out = emptyDocument(deviceId);
    const logicalClock = Number(value.logicalClock);
    out.logicalClock = Number.isSafeInteger(logicalClock) && logicalClock >= 0 ? logicalClock : 0;
    for (const namespace of NAMESPACES) {
      const source = plainObject(value.records[namespace]) ? value.records[namespace] : {};
      const target = {};
      for (const key of Object.keys(source).sort()) {
        const record = normalizeRecord(source[key]);
        if (record) target[cleanString(key, 160)] = record;
      }
      if (Object.keys(target).length) out.records[namespace] = target;
    }
    return out;
  }

  function maxDocumentClock(document) {
    const normalized = normalizeDocument(document);
    if (!normalized) return 0;
    let max = normalized.logicalClock;
    for (const namespace of NAMESPACES) for (const record of Object.values(normalized.records[namespace] || {})) {
      max = Math.max(max, Number(record.clock && record.clock.counter) || 0);
    }
    return max;
  }

  function normalizeState(state) {
    const source = plainObject(state) ? state : {};
    const data = plainObject(source.data) ? source.data : {};
    const prompt = plainObject(source.promptProfile) ? source.promptProfile : {};
    const feedback = plainObject(source.feedbackState) ? source.feedbackState : {};
    return {
      data: {
        version: 1,
        persons: plainObject(data.persons) ? clone(data.persons) : {},
        settings: plainObject(data.settings) ? clone(data.settings) : {},
      },
      promptProfile: clone(prompt) || {},
      feedbackState: clone(feedback) || {},
    };
  }

  function stateFromStorage(storage) {
    const source = plainObject(storage) ? storage : {};
    const data = parseStored(source[DATA_KEY]);
    const promptProfile = parseStored(source[PROFILE_KEY]);
    const feedbackState = parseStored(source[FEEDBACK_KEY]);
    return normalizeState({ data, promptProfile, feedbackState });
  }

  function storageFromState(state) {
    const normalized = normalizeState(state);
    return {
      [DATA_KEY]: JSON.stringify(normalized.data),
      [PROFILE_KEY]: JSON.stringify(normalized.promptProfile),
      [FEEDBACK_KEY]: JSON.stringify(normalized.feedbackState),
    };
  }

  function stateCollections(state) {
    const normalized = normalizeState(state);
    const prompt = normalized.promptProfile;
    const feedback = normalized.feedbackState;
    const events = {};
    for (const event of Array.isArray(feedback.events) ? feedback.events : []) {
      if (!plainObject(event)) continue;
      const id = cleanString(event.id, 160);
      if (id) events[id] = clone(event);
    }
    return {
      persons: normalized.data.persons,
      settings: normalized.data.settings,
      prompt: {
        profile: plainObject(prompt.profile) ? prompt.profile : {},
        personalization: plainObject(prompt.personalization) ? prompt.personalization : {},
        meta: plainObject(prompt.meta) ? prompt.meta : {},
      },
      feedback: {
        ...events,
        meta: plainObject(feedback.meta) ? feedback.meta : {},
      },
    };
  }

  function materializeDocument(document) {
    const normalized = normalizeDocument(document);
    if (!normalized) throw new Error('sync-document-invalid');
    const collections = {};
    for (const namespace of NAMESPACES) {
      const target = {};
      for (const [key, record] of Object.entries(normalized.records[namespace] || {})) {
        if (!record.tombstone) target[key] = clone(record.value);
      }
      collections[namespace] = target;
    }
    const prompt = collections.prompt || {};
    const feedbackRecords = collections.feedback || {};
    const events = Object.keys(feedbackRecords)
      .filter((key) => key !== 'meta')
      .map((key) => feedbackRecords[key])
      .filter(plainObject)
      .sort((a, b) => Number(a.createdAt) - Number(b.createdAt) || String(a.id || '').localeCompare(String(b.id || '')));
    return normalizeState({
      data: { version: 1, persons: collections.persons || {}, settings: collections.settings || {} },
      promptProfile: {
        schemaVersion: 1,
        profile: prompt.profile || {},
        personalization: prompt.personalization || {},
        meta: prompt.meta || {},
      },
      feedbackState: { schemaVersion: 1, events, meta: feedbackRecords.meta || {} },
    });
  }

  function documentFromState(state, previous, deviceId) {
    const current = stateCollections(state);
    const base = normalizeDocument(previous) || emptyDocument(deviceId);
    const id = cleanString(deviceId, 80) || base.deviceId || 'device-unknown';
    let counter = Math.max(maxDocumentClock(base), Number(base.logicalClock) || 0);
    const out = emptyDocument(id);
    for (const namespace of NAMESPACES) {
      const target = {};
      const before = base.records[namespace] || {};
      const now = current[namespace] || {};
      const keys = new Set([...Object.keys(before), ...Object.keys(now)]);
      for (const key of Array.from(keys).sort()) {
        const cleanKey = cleanString(key, 160);
        const oldRecord = before[key];
        if (Object.prototype.hasOwnProperty.call(now, key)) {
          const value = clone(now[key]);
          if (oldRecord && !oldRecord.tombstone && stable(oldRecord.value) === stable(value)) {
            target[cleanKey] = oldRecord;
          } else {
            counter++;
            target[cleanKey] = { clock: { counter, deviceId: id }, tombstone: false, value };
          }
        } else if (oldRecord && !oldRecord.tombstone) {
          counter++;
          target[cleanKey] = { clock: { counter, deviceId: id }, tombstone: true };
        } else if (oldRecord) {
          target[cleanKey] = oldRecord;
        }
      }
      if (Object.keys(target).length) out.records[namespace] = target;
    }
    out.logicalClock = counter;
    return out;
  }

  function chooseRecord(left, right) {
    if (!left) return right;
    if (!right) return left;
    const comparison = compareClock(left.clock, right.clock);
    if (comparison > 0) return left;
    if (comparison < 0) return right;
    // A malformed or replayed equal clock must still converge. Tombstones win
    // over a live value, then stable JSON decides the remaining tie.
    if (left.tombstone !== right.tombstone) return left.tombstone ? left : right;
    return stable(left) >= stable(right) ? left : right;
  }

  function mergeDocuments(left, right, deviceId) {
    const a = normalizeDocument(left) || emptyDocument(deviceId || 'device-left');
    const b = normalizeDocument(right) || emptyDocument(deviceId || 'device-right');
    const out = emptyDocument(cleanString(deviceId, 80) || a.deviceId || b.deviceId);
    out.logicalClock = Math.max(maxDocumentClock(a), maxDocumentClock(b));
    for (const namespace of NAMESPACES) {
      const target = {};
      const keys = new Set([...Object.keys(a.records[namespace] || {}), ...Object.keys(b.records[namespace] || {})]);
      for (const key of Array.from(keys).sort()) {
        const chosen = chooseRecord(a.records[namespace] && a.records[namespace][key], b.records[namespace] && b.records[namespace][key]);
        if (chosen) target[key] = clone(chosen);
      }
      if (Object.keys(target).length) out.records[namespace] = target;
    }
    return out;
  }

  function exportPackage(storage, metadata) {
    const state = stateFromStorage(storage);
    return {
      format: EXPORT_FORMAT,
      schema: SCHEMA,
      exportedAt: Date.now(),
      ...(plainObject(metadata) ? clone(metadata) : {}),
      data: state.data,
      promptProfile: state.promptProfile,
      feedbackState: state.feedbackState,
    };
  }

  function importPackage(input) {
    const source = typeof input === 'string' ? JSON.parse(input) : input;
    if (!plainObject(source)) throw new Error('extension-export-invalid');
    // Accept the existing Store.exportJSON() shape as the migration source.
    if (source.persons && !source.data) {
      return normalizeState({ data: source, promptProfile: source.promptProfile, feedbackState: source.feedbackState });
    }
    if (source.format != null && source.format !== EXPORT_FORMAT) throw new Error('extension-export-format-unsupported');
    if (source.schema != null && Number(source.schema) !== SCHEMA) throw new Error('extension-export-schema-unsupported');
    if (!plainObject(source.data)) throw new Error('extension-export-data-missing');
    return normalizeState(source);
  }

  function runtimeCrypto() {
    if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle) return globalThis.crypto;
    if (typeof require === 'function') {
      try { return require('crypto').webcrypto; } catch (error) {}
    }
    throw new Error('webcrypto-unavailable');
  }

  function utf8(value) {
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(String(value));
    if (typeof Buffer !== 'undefined') return Uint8Array.from(Buffer.from(String(value), 'utf8'));
    throw new Error('text-encoder-unavailable');
  }

  function bytesToBase64(value) {
    const bytes = new Uint8Array(value);
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }

  function base64ToBytes(value) {
    if (typeof Buffer !== 'undefined') return Uint8Array.from(Buffer.from(String(value || ''), 'base64'));
    const binary = atob(String(value || ''));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  function randomBytes(length) {
    const crypto = runtimeCrypto();
    const output = new Uint8Array(length);
    crypto.getRandomValues(output);
    return output;
  }

  async function deriveKey(passphrase, salt, iterations) {
    if (String(passphrase || '').length < MIN_PASSPHRASE_LENGTH) throw new Error('sync-passphrase-too-short');
    const crypto = runtimeCrypto();
    const subtle = crypto.subtle;
    const material = await subtle.importKey('raw', utf8(passphrase), 'PBKDF2', false, ['deriveKey']);
    return subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, material,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  async function encryptDocument(document, passphrase, accountId, options) {
    const normalized = normalizeDocument(document);
    if (!normalized) throw new Error('sync-document-invalid');
    const crypto = runtimeCrypto();
    const opts = plainObject(options) ? options : {};
    const iterations = Number.isSafeInteger(Number(opts.iterations)) ? Number(opts.iterations) : KDF_ITERATIONS;
    if (iterations < 100000 || iterations > 1000000) throw new Error('sync-kdf-iterations-invalid');
    const salt = opts.salt ? base64ToBytes(opts.salt) : randomBytes(16);
    const iv = opts.iv ? base64ToBytes(opts.iv) : randomBytes(12);
    if (salt.length < 16 || iv.length !== 12) throw new Error('sync-crypto-parameters-invalid');
    const key = await deriveKey(passphrase, salt, iterations);
    const aad = utf8('omniblock.sync.v1|' + cleanString(accountId, 160));
    const plaintext = utf8(stable(normalized));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, plaintext);
    return {
      format: ENVELOPE_FORMAT,
      schema: SCHEMA,
      kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: bytesToBase64(salt) },
      cipher: { name: 'AES-GCM', bits: 256, iv: bytesToBase64(iv), data: bytesToBase64(ciphertext) },
    };
  }

  async function decryptEnvelope(envelope, passphrase, accountId) {
    if (!plainObject(envelope) || envelope.format !== ENVELOPE_FORMAT || Number(envelope.schema) !== SCHEMA
      || !plainObject(envelope.kdf) || !plainObject(envelope.cipher)) throw new Error('sync-envelope-invalid');
    const iterations = Number(envelope.kdf.iterations);
    const salt = base64ToBytes(envelope.kdf.salt);
    const iv = base64ToBytes(envelope.cipher.iv);
    const data = base64ToBytes(envelope.cipher.data);
    if (envelope.kdf.name !== 'PBKDF2' || envelope.kdf.hash !== 'SHA-256'
      || !Number.isSafeInteger(iterations) || iterations < 100000 || iterations > 1000000
      || salt.length < 16 || iv.length !== 12 || !data.length
      || JSON.stringify(envelope).length > MAX_ENVELOPE_CHARS) throw new Error('sync-envelope-invalid');
    try {
      const crypto = runtimeCrypto();
      const key = await deriveKey(passphrase, salt, iterations);
      const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: utf8('omniblock.sync.v1|' + cleanString(accountId, 160)) }, key, data);
      const value = JSON.parse(new TextDecoder().decode(plaintext));
      const document = normalizeDocument(value);
      if (!document) throw new Error('sync-document-invalid');
      return document;
    } catch (error) {
      if (error && error.message === 'sync-document-invalid') throw error;
      const wrapped = new Error('sync-decrypt-failed');
      wrapped.cause = error;
      throw wrapped;
    }
  }

  function normalizeEndpoint(value) {
    try {
      const url = new URL(String(value || ''));
      const host = String(url.hostname || '').toLowerCase();
      const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(host);
      if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password || url.search || url.hash) return '';
      url.pathname = url.pathname.replace(/\/+$/, '');
      return url.href;
    } catch (error) { return ''; }
  }

  function endpointPath(endpoint, path) {
    const base = normalizeEndpoint(endpoint);
    if (!base) throw new Error('sync-endpoint-invalid');
    return base.replace(/\/+$/, '') + (String(path).startsWith('/') ? String(path) : '/' + String(path));
  }

  class SyncError extends Error {
    constructor(code, message, details) {
      super(message || code);
      this.name = 'SyncError';
      this.code = code;
      this.details = details || null;
    }
  }

  async function responseJson(response) {
    let body = null;
    try { body = await response.json(); } catch (error) {}
    return body;
  }

  async function requestAccount(path, payload, options) {
    const opts = plainObject(options) ? options : {};
    const fetchImpl = opts.fetchImpl || (typeof fetch === 'function' ? fetch : null);
    if (!fetchImpl) throw new SyncError('offline', 'fetch-unavailable');
    let response;
    try {
      response = await fetchImpl(endpointPath(opts.endpoint, path), {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload || {}), credentials: 'omit',
      });
    } catch (error) { throw new SyncError('offline', 'sync-network-unavailable', { cause: String(error && error.message || error) }); }
    const body = await responseJson(response);
    if (response.status === 401) throw new SyncError('auth', 'sync-auth-failed', body);
    if (!response.ok) throw new SyncError('server', 'sync-server-error', { status: response.status, body });
    return body || {};
  }

  function register(options) {
    const opts = plainObject(options) ? options : {};
    return requestAccount('/v1/auth/register', { username: opts.username, password: opts.password }, opts);
  }

  function login(options) {
    const opts = plainObject(options) ? options : {};
    return requestAccount('/v1/auth/login', { username: opts.username, password: opts.password }, opts);
  }

  async function readRemote(options) {
    const opts = plainObject(options) ? options : {};
    const fetchImpl = opts.fetchImpl || (typeof fetch === 'function' ? fetch : null);
    if (!fetchImpl) throw new SyncError('offline', 'fetch-unavailable');
    let response;
    try {
      response = await fetchImpl(endpointPath(opts.endpoint, '/v1/sync/state'), {
        method: 'GET', headers: { Accept: 'application/json', Authorization: 'Bearer ' + String(opts.token || '') }, credentials: 'omit',
      });
    } catch (error) { throw new SyncError('offline', 'sync-network-unavailable', { cause: String(error && error.message || error) }); }
    const body = await responseJson(response);
    if (response.status === 401) throw new SyncError('auth', 'sync-auth-failed', body);
    if (response.status === 404) return { revision: 0, blob: null };
    if (!response.ok) throw new SyncError('server', 'sync-server-error', { status: response.status, body });
    if (!body || !Number.isSafeInteger(Number(body.revision)) || (body.blob != null && !plainObject(body.blob))) {
      throw new SyncError('server', 'sync-remote-state-invalid');
    }
    return { revision: Number(body.revision), blob: body.blob || null, updatedAt: body.updatedAt || '' };
  }

  async function putRemote(options, revision, blob) {
    const opts = plainObject(options) ? options : {};
    const fetchImpl = opts.fetchImpl || (typeof fetch === 'function' ? fetch : null);
    if (!fetchImpl) throw new SyncError('offline', 'fetch-unavailable');
    let response;
    try {
      response = await fetchImpl(endpointPath(opts.endpoint, '/v1/sync/state'), {
        method: 'PUT', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Bearer ' + String(opts.token || '') },
        body: JSON.stringify({ baseRevision: revision, blob }), credentials: 'omit',
      });
    } catch (error) { throw new SyncError('offline', 'sync-network-unavailable', { cause: String(error && error.message || error) }); }
    const body = await responseJson(response);
    if (response.status === 401) throw new SyncError('auth', 'sync-auth-failed', body);
    if (response.status === 409) throw new SyncError('conflict', 'sync-revision-conflict', body);
    if (!response.ok) throw new SyncError('server', 'sync-server-error', { status: response.status, body });
    if (!body || !Number.isSafeInteger(Number(body.revision))) throw new SyncError('server', 'sync-write-response-invalid');
    return { revision: Number(body.revision), updatedAt: body.updatedAt || '' };
  }

  async function synchronize(options) {
    const opts = plainObject(options) ? options : {};
    const deviceId = cleanString(opts.deviceId, 80);
    const accountId = cleanString(opts.accountId, 160);
    if (!deviceId || !accountId || String(opts.token || '').length < 8) throw new SyncError('auth', 'sync-credentials-missing');
    if (String(opts.passphrase || '').length < MIN_PASSPHRASE_LENGTH) throw new SyncError('auth', 'sync-passphrase-too-short');
    let local = normalizeDocument(opts.localDocument) || emptyDocument(deviceId);
    let conflicts = 0;
    for (let attempt = 0; attempt <= Math.max(0, Number(opts.maxConflicts) || 3); attempt++) {
      const remote = await readRemote(opts);
      let merged = local;
      if (remote.blob) {
        let remoteDocument;
        try { remoteDocument = await decryptEnvelope(remote.blob, opts.passphrase, accountId); }
        catch (error) { throw new SyncError('crypto', 'sync-remote-decrypt-failed', { cause: String(error && error.message || error) }); }
        merged = mergeDocuments(local, remoteDocument, deviceId);
      }
      const blob = await encryptDocument(merged, opts.passphrase, accountId);
      try {
        const written = await putRemote(opts, remote.revision, blob);
        return { document: merged, blob, revision: written.revision, updatedAt: written.updatedAt, conflicts };
      } catch (error) {
        if (!(error instanceof SyncError) || error.code !== 'conflict') throw error;
        conflicts++;
        const conflictBody = error.details || {};
        // Keep the local document and let the next iteration re-read the
        // server. This also handles a server that omits the conflict blob.
        if (conflictBody.blob) {
          try {
            const conflictDocument = await decryptEnvelope(conflictBody.blob, opts.passphrase, accountId);
            local = mergeDocuments(local, conflictDocument, deviceId);
          } catch (decryptError) {
            throw new SyncError('crypto', 'sync-conflict-decrypt-failed', { cause: String(decryptError && decryptError.message || decryptError) });
          }
        }
      }
    }
    throw new SyncError('conflict', 'sync-conflict-retry-exhausted', { conflicts });
  }

  async function synchronizeWithRetry(options) {
    const opts = plainObject(options) ? options : {};
    const attempts = Math.max(1, Math.min(4, Number(opts.networkAttempts) || 2));
    const delayMs = Math.max(0, Math.min(5000, Number(opts.retryDelayMs) || 300));
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try { return await synchronize(opts); }
      catch (error) {
        lastError = error;
        if (!(error instanceof SyncError) || error.code !== 'offline' || attempt + 1 >= attempts) throw error;
        if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    throw lastError || new SyncError('offline', 'sync-network-unavailable');
  }

  return {
    FORMAT, ENVELOPE_FORMAT, EXPORT_FORMAT, SCHEMA, DATA_KEY, PROFILE_KEY, FEEDBACK_KEY,
    DEVICE_ID_KEY, AUTH_KEY, LOCAL_STATE_KEY, DEVICE_CONFIG_KEY, KDF_ITERATIONS,
    MIN_PASSPHRASE_LENGTH, clone, stable, parseStored, normalizeState, stateFromStorage,
    storageFromState, emptyDocument, normalizeDocument, documentFromState, materializeDocument,
    compareClock, mergeDocuments, exportPackage, importPackage, normalizeEndpoint,
    encryptDocument, decryptEnvelope, register, login, readRemote, putRemote, synchronize, synchronizeWithRetry, SyncError,
  };
});
