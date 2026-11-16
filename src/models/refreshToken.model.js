const crypto = require('crypto');
const mongoose = require('mongoose');

const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');

// One row per issued refresh token. Tokens are rotated on every use; all
// tokens descended from one login share a `family`, so presenting a token
// that was already used lets us revoke the whole chain.
const refreshTokenSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  // Only the hash is stored; the token itself lives in the client's cookie.
  tokenHash: { type: String, required: true, unique: true },
  family: { type: String, required: true, index: true },
  // MongoDB removes the row once this passes.
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  revokedAt: Date,
  // True while the token was retired by normal rotation, as opposed to a
  // logout or a revoked family. Only a rotated token gets the short grace
  // period in the refresh handler.
  rotated: Boolean,
  userAgent: String,
  createdAt: { type: Date, default: Date.now },
});

refreshTokenSchema.statics.issue = async function ({ userId, family, ttlMs, userAgent }) {
  const token = crypto.randomBytes(32).toString('base64url');

  await this.create({
    user: userId,
    tokenHash: hash(token),
    family: family || crypto.randomUUID(),
    expiresAt: new Date(Date.now() + ttlMs),
    userAgent: userAgent ? String(userAgent).slice(0, 200) : undefined,
  });

  return token;
};

refreshTokenSchema.statics.findByToken = function (token) {
  return this.findOne({ tokenHash: hash(String(token)) });
};

// Marks the token as used. Resolves to null if someone else got there first.
refreshTokenSchema.statics.consume = function (id) {
  return this.findOneAndUpdate(
    { _id: id, revokedAt: null },
    { revokedAt: new Date(), rotated: true },
    { new: true },
  );
};

// Ends live tokens and withdraws the rotation grace from retired ones.
const revoke = async (Model, filter) => {
  await Model.updateMany({ ...filter, revokedAt: null }, { revokedAt: new Date() });
  await Model.updateMany({ ...filter, rotated: true }, { rotated: false });
};

refreshTokenSchema.statics.revokeFamily = function (family) {
  return revoke(this, { family });
};

// `exceptFamily` spares the session making the request.
refreshTokenSchema.statics.revokeAllFor = function (userId, { exceptFamily } = {}) {
  return revoke(this, {
    user: userId,
    ...(exceptFamily && { family: { $ne: exceptFamily } }),
  });
};

module.exports = mongoose.model('RefreshToken', refreshTokenSchema);
