const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;

function getKey() {
  const raw = process.env.COOKIE_ENCRYPTION_KEY || '';
  if (!raw) return null;
  return crypto.createHash('sha256').update(raw).digest();
}

function encryptJson(data) {
  const key = getKey();
  if (!key) return JSON.stringify(data);
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const plain = JSON.stringify(data);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    v: 1,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: enc.toString('base64'),
  });
}

function decryptJson(stored) {
  if (!stored) return null;
  if (typeof stored === 'string') {
    try {
      const parsed = JSON.parse(stored);
      if (!parsed?.v) return parsed;
      stored = parsed;
    } catch {
      return null;
    }
  }
  if (!stored?.v) return stored;

  const key = getKey();
  if (!key) throw new Error('COOKIE_ENCRYPTION_KEY required to decrypt cookies');

  const iv = Buffer.from(stored.iv, 'base64');
  const tag = Buffer.from(stored.tag, 'base64');
  const data = Buffer.from(stored.data, 'base64');
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  return JSON.parse(plain);
}

module.exports = { encryptJson, decryptJson, getKey };
