const crypto = require('crypto');
const config = require('../config');

// Encrypts small secrets (the TOTP seed) before they are stored, so a database
// dump alone does not reveal them. The key comes from SECRET_BOX_KEY (or
// JWT_SECRET when that is unset); changing it makes stored seeds unreadable.
const key = Buffer.from(
  crypto.hkdfSync(
    'sha256',
    config.secretBoxKey,
    Buffer.alloc(0),
    'earthly:secret-box',
    32,
  ),
);

exports.seal = (plain) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);

  return [iv, cipher.getAuthTag(), body].map((part) => part.toString('base64')).join('.');
};

exports.open = (sealed) => {
  const [iv, tag, body] = String(sealed)
    .split('.')
    .map((part) => Buffer.from(part, 'base64'));

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
};
