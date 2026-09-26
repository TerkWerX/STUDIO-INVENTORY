const crypto = require('crypto');
const fs = require('fs');
const { pipeline } = require('stream/promises');

const MAGIC = Buffer.from('SIDB');

function encryptBackupBuffer(plain, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('Backup key must be 32 bytes');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, Buffer.from([1]), iv, cipher.getAuthTag(), body]);
}

function decryptBackupBuffer(payload, key) {
  if (!Buffer.isBuffer(payload) || payload.length < 4 + 1 + 12 + 16) {
    throw new Error('Encrypted backup is incomplete');
  }
  if (!payload.subarray(0, 4).equals(MAGIC) || payload[4] !== 1) {
    throw new Error('Encrypted backup is not a Studio Inventory folder backup');
  }
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new Error('Catalog key could not be unlocked for this encrypted backup');
  }
  const iv = payload.subarray(5, 17);
  const tag = payload.subarray(17, 33);
  const body = payload.subarray(33);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    throw new Error('Catalog key could not unlock this backup. It was encrypted for a different account, or the file is damaged.');
  }
}

function isEncryptedBackup(payload) {
  return Buffer.isBuffer(payload) && payload.length >= 4 && payload.subarray(0, 4).equals(MAGIC);
}

// ---------------------------------------------------------------------------
// Streaming versions. Same file layout as the buffer functions above:
//   'SIDB' | version 1 | 12-byte IV | 16-byte GCM tag | ciphertext
// so backups written either way can be read either way. The tag is only known
// after the last byte, so the writer leaves a gap and fills it in at the end.
// ---------------------------------------------------------------------------
const IV_OFFSET = 5;
const TAG_OFFSET = 17;
const HEADER_BYTES = 33;

function requireKey(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('Backup key must be 32 bytes');
}

/** Encrypt a readable stream into a new file. Resolves once the file is complete and flushed. */
async function encryptStreamToFile(source, filePath, key) {
  requireKey(key);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  fs.writeFileSync(filePath, Buffer.concat([MAGIC, Buffer.from([1]), iv, Buffer.alloc(16)]));
  await pipeline(source, cipher, fs.createWriteStream(filePath, { flags: 'r+', start: HEADER_BYTES }));
  const fd = fs.openSync(filePath, 'r+');
  try {
    fs.writeSync(fd, cipher.getAuthTag(), 0, 16, TAG_OFFSET);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Decrypt an encrypted backup file into a new file. The output is only kept if
 * the authentication tag verifies; otherwise it is deleted and this throws.
 */
async function decryptFileToFile(sourcePath, destPath, key) {
  const size = fs.statSync(sourcePath).size;
  if (size < HEADER_BYTES) throw new Error('Encrypted backup is incomplete');
  const header = Buffer.alloc(HEADER_BYTES);
  const fd = fs.openSync(sourcePath, 'r');
  try { fs.readSync(fd, header, 0, HEADER_BYTES, 0); } finally { fs.closeSync(fd); }
  if (!header.subarray(0, 4).equals(MAGIC) || header[4] !== 1) {
    throw new Error('Encrypted backup is not a Studio Inventory folder backup');
  }
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new Error('Catalog key could not be unlocked for this encrypted backup');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, header.subarray(IV_OFFSET, TAG_OFFSET));
  decipher.setAuthTag(header.subarray(TAG_OFFSET, HEADER_BYTES));
  try {
    await pipeline(fs.createReadStream(sourcePath, { start: HEADER_BYTES }), decipher, fs.createWriteStream(destPath));
  } catch (err) {
    try { fs.unlinkSync(destPath); } catch { /* nothing written */ }
    if (/unable to authenticate|Unsupported state/i.test(err.message)) {
      throw new Error('Catalog key could not unlock this backup. It was encrypted for a different account, or the file is damaged.');
    }
    throw err;
  }
}

function isEncryptedBackupFile(filePath) {
  const head = Buffer.alloc(4);
  const fd = fs.openSync(filePath, 'r');
  try {
    return fs.readSync(fd, head, 0, 4, 0) === 4 && head.equals(MAGIC);
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = {
  encryptBackupBuffer,
  decryptBackupBuffer,
  isEncryptedBackup,
  encryptStreamToFile,
  decryptFileToFile,
  isEncryptedBackupFile
};
