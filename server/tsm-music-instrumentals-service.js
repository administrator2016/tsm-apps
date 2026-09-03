// =====================================================
// TSM MUSIC INSTRUMENTALS SERVICE
// Real server-side storage for uploaded beat/instrumental files
// (Beat Workbench). Uses the same MongoClient connection pattern as
// server/tsm-ledger-service.js (MONGODB_URI, Firestore Mongo-compat
// endpoint) rather than a separate persistence layer.
//
// Files are stored CHUNKED across documents instead of one big binary
// blob per file: MongoDB/Firestore's Mongo-compat layer caps a single
// document at 16MB, and most real WAV instrumentals exceed that. Each
// file is split into fixed-size chunks, each chunk its own document in
// music_instrumental_chunks, keyed by (fileId, chunkIndex) so they can
// be streamed back out in order without loading the whole file into
// memory at once.
//
// Encryption at rest is optional (MUSIC_FILE_ENCRYPTION_KEY env var).
// When set, each chunk is encrypted individually with AES-256-GCM
// before being written; the iv + authTag travel alongside the chunk so
// decryption doesn't need any other lookup. When unset, chunks are
// stored as plain Binary — the service still works, just without
// at-rest encryption (fine for a local/demo Mongo instance; set the
// key before pointing this at anything with real uploads in it).
// =====================================================

const { MongoClient, ObjectId, Binary } = require('mongodb');
const crypto = require('crypto');

const DEFAULT_DB_NAME = 'tsm-consultz';
const FILES_COLLECTION = 'music_instrumental_files';
const CHUNKS_COLLECTION = 'music_instrumental_chunks';

// 512KB per chunk — comfortably under the 16MB document cap even
// after base64/Binary overhead, small enough to stream smoothly.
const CHUNK_SIZE = 512 * 1024;

const ALLOWED_MIME_PREFIXES = ['audio/'];
const ALLOWED_EXTENSIONS = ['.mp3', '.wav', '.flac', '.aac', '.m4a', '.ogg'];
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

let client = null;
let db = null;
let connecting = null;

// Mirrors tsm-ledger-service.js connect(): lazy, cached, single
// MongoClient per process, shared in-flight promise for concurrent
// first-callers, self-healing on a failed attempt.
async function connect() {
  if (db) return db;
  if (connecting) return connecting;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      'MONGODB_URI is not set. Add it to .env (see server/tsm-ledger-service.js header for format).'
    );
  }

  connecting = (async () => {
    try {
      client = new MongoClient(uri, {
        serverSelectionTimeoutMS: 10000,
        connectTimeoutMS: 10000,
        socketTimeoutMS: 15000,
      });
      await client.connect();
      db = client.db(DEFAULT_DB_NAME);
      connecting = null;
      return db;
    } catch (err) {
      client = null;
      connecting = null;
      throw err;
    }
  })();

  return connecting;
}

async function getDb() {
  return db || connect();
}

async function filesCollection() {
  const database = await getDb();
  return database.collection(FILES_COLLECTION);
}

async function chunksCollection() {
  const database = await getDb();
  return database.collection(CHUNKS_COLLECTION);
}

function encryptionEnabled() {
  return !!process.env.MUSIC_FILE_ENCRYPTION_KEY;
}

function getEncryptionKey() {
  const raw = process.env.MUSIC_FILE_ENCRYPTION_KEY;
  if (!raw) return null;
  // Accept either a 64-char hex string or any string (hashed to 32
  // bytes with SHA-256) so this doesn't demand a specific key format.
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  return crypto.createHash('sha256').update(raw).digest();
}

function encryptChunk(buffer) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { data: encrypted, iv, authTag };
}

function decryptChunk(data, iv, authTag) {
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

function isAllowedUpload(originalname, mimetype) {
  const name = (originalname || '').toLowerCase();
  const extOk = ALLOWED_EXTENSIONS.some((ext) => name.endsWith(ext));
  const mimeOk = ALLOWED_MIME_PREFIXES.some((p) => (mimetype || '').startsWith(p));
  // Accept on either signal — some browsers/OSes send a generic
  // application/octet-stream mimetype for audio files, so the
  // extension check alone is enough; but if a real audio/* mimetype
  // is present with an unrecognized extension, allow that too.
  return extOk || mimeOk;
}

/**
 * Stores an uploaded file buffer as chunked documents. Returns the
 * new file's metadata document.
 */
async function storeFile({ buffer, originalname, mimetype, uploadedBy }) {
  if (!buffer || !buffer.length) {
    throw new Error('empty_file');
  }
  if (buffer.length > MAX_FILE_SIZE) {
    throw new Error('file_too_large');
  }
  if (!isAllowedUpload(originalname, mimetype)) {
    throw new Error('unsupported_file_type');
  }

  const filesCol = await filesCollection();
  const chunksCol = await chunksCollection();

  const fileId = new ObjectId();
  const chunkCount = Math.ceil(buffer.length / CHUNK_SIZE);
  const encrypted = encryptionEnabled();

  const chunkDocs = [];
  for (let i = 0; i < chunkCount; i++) {
    const start = i * CHUNK_SIZE;
    const rawChunk = buffer.subarray(start, start + CHUNK_SIZE);

    if (encrypted) {
      const { data, iv, authTag } = encryptChunk(rawChunk);
      chunkDocs.push({
        fileId,
        chunkIndex: i,
        data: new Binary(data),
        iv: new Binary(iv),
        authTag: new Binary(authTag),
        encrypted: true,
      });
    } else {
      chunkDocs.push({
        fileId,
        chunkIndex: i,
        data: new Binary(rawChunk),
        encrypted: false,
      });
    }
  }

  // Insert chunks before the file record so a stream request can never
  // observe a file doc whose chunks aren't fully written yet.
  if (chunkDocs.length) {
    await chunksCol.insertMany(chunkDocs, { ordered: true });
  }

  const fileDoc = {
    _id: fileId,
    filename: originalname || 'untitled',
    mimetype: mimetype || 'application/octet-stream',
    sizeBytes: buffer.length,
    chunkCount,
    chunkSize: CHUNK_SIZE,
    encrypted,
    uploadedBy: uploadedBy || null,
    uploadedAt: new Date().toISOString(),
    // Producer-supplied tags — never AI-guessed. Populated later via
    // tagFile(); starts empty/null so the UI can honestly show
    // "not tagged yet" instead of a fabricated value.
    tags: { genre: null, bpm: null, key: null, mood: null, energy: null, notes: null },
  };

  await filesCol.insertOne(fileDoc);
  return fileDoc;
}

async function listFiles({ uploadedBy } = {}) {
  const filesCol = await filesCollection();
  const query = uploadedBy ? { uploadedBy } : {};
  return filesCol.find(query).sort({ uploadedAt: -1 }).toArray();
}

async function getFileMeta(fileId) {
  const filesCol = await filesCollection();
  return filesCol.findOne({ _id: new ObjectId(fileId) });
}

/**
 * Applies user-supplied tags (genre/bpm/key/mood/energy/notes) to a
 * stored file. Only known fields are accepted; unknown keys are
 * ignored rather than merged in blind.
 */
async function tagFile(fileId, tags) {
  const filesCol = await filesCollection();
  const allowedFields = ['genre', 'bpm', 'key', 'mood', 'energy', 'notes'];
  const update = {};
  for (const field of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(tags || {}, field)) {
      update[`tags.${field}`] = tags[field];
    }
  }
  if (!Object.keys(update).length) {
    throw new Error('no_valid_tag_fields');
  }
  const result = await filesCol.findOneAndUpdate(
    { _id: new ObjectId(fileId) },
    { $set: update },
    { returnDocument: 'after' }
  );
  return result && result.value ? result.value : result;
}

/**
 * Streams a file's chunks back in order as an async generator of
 * decrypted Buffers, for piping into an HTTP response.
 */
async function* readFileChunks(fileId) {
  const chunksCol = await chunksCollection();
  const cursor = chunksCol
    .find({ fileId: new ObjectId(fileId) })
    .sort({ chunkIndex: 1 });

  for await (const chunkDoc of cursor) {
    const rawData = chunkDoc.data.buffer ? chunkDoc.data.buffer : Buffer.from(chunkDoc.data);
    if (chunkDoc.encrypted) {
      const iv = chunkDoc.iv.buffer ? chunkDoc.iv.buffer : Buffer.from(chunkDoc.iv);
      const authTag = chunkDoc.authTag.buffer ? chunkDoc.authTag.buffer : Buffer.from(chunkDoc.authTag);
      yield decryptChunk(rawData, iv, authTag);
    } else {
      yield rawData;
    }
  }
}

async function deleteFile(fileId) {
  const filesCol = await filesCollection();
  const chunksCol = await chunksCollection();
  const id = new ObjectId(fileId);
  await chunksCol.deleteMany({ fileId: id });
  const result = await filesCol.deleteOne({ _id: id });
  return result.deletedCount > 0;
}

async function close() {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}

module.exports = {
  storeFile,
  listFiles,
  getFileMeta,
  tagFile,
  readFileChunks,
  deleteFile,
  close,
  // exported for tests
  isAllowedUpload,
  CHUNK_SIZE,
  MAX_FILE_SIZE,
};
