const crypto = require('crypto');

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
    throw new Error('Catalog key could not unlock this backup. It was encrypted for a different account.');
  }
}

function isEncryptedBackup(payload) {
  return Buffer.isBuffer(payload) && payload.length >= 4 && payload.subarray(0, 4).equals(MAGIC);
}

module.exports = {
  encryptBackupBuffer,
  decryptBackupBuffer,
  isEncryptedBackup
};
