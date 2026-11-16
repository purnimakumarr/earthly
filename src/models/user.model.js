const crypto = require('crypto');
const mongoose = require('mongoose');
const validator = require('validator');
const bcrypt = require('bcryptjs');
const plainText = require('../utils/plainText');

const ROLES = ['traveler', 'guide', 'lead', 'admin'];
const RESET_TOKEN_TTL_MS = 10 * 60 * 1000;
const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const BCRYPT_COST = 12;
// Compared against when a login names no account, so that answer takes as
// long as a wrong password and timing does not reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('no-such-account', BCRYPT_COST);

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    maxLength: [60, 'Name can be at most 60 characters'],
    set: plainText,
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    validate: [validator.isEmail, 'That email address does not look valid'],
  },
  // URL path of the profile picture; the client falls back to initials.
  photo: String,
  role: {
    type: String,
    enum: ROLES,
    default: 'traveler',
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minLength: [8, 'Password needs at least 8 characters'],
    select: false,
  },
  passwordConfirm: {
    type: String,
    required: [true, 'Please confirm the password'],
    validate: {
      // Runs on create() and save() only, not on findOneAndUpdate().
      validator: function (value) {
        return value === this.password;
      },
      message: 'Passwords do not match',
    },
  },
  passwordChangedAt: Date,
  passwordResetToken: String,
  passwordResetExpires: Date,
  emailVerified: {
    type: Boolean,
    default: false,
  },
  emailVerifyToken: { type: String, select: false },
  emailVerifyExpires: { type: Date, select: false },
  twoFactorEnabled: {
    type: Boolean,
    default: false,
  },
  // TOTP seed, encrypted at rest. Present but not yet active during setup.
  twoFactorSecret: { type: String, select: false },
  // Hashes of the unused one-time recovery codes.
  twoFactorRecoveryCodes: { type: [String], select: false },
  // Last 30-second step a code was accepted for, so a code cannot be replayed.
  twoFactorLastStep: { type: Number, select: false },
  // Wrong codes at login since the last success, and the lock they lead to.
  twoFactorFailures: { type: Number, select: false },
  twoFactorFailuresSince: { type: Date, select: false },
  twoFactorLockedUntil: { type: Date, select: false },
  favourites: [{ type: mongoose.Schema.ObjectId, ref: 'Expedition' }],
  active: {
    type: Boolean,
    default: true,
    select: false,
  },
});

userSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.password;
    // Only ever present (and false) on the admin routes, which select it.
    if (ret.active !== false) delete ret.active;
    delete ret.passwordResetToken;
    delete ret.passwordResetExpires;
    delete ret.emailVerifyToken;
    delete ret.emailVerifyExpires;
    delete ret.twoFactorSecret;
    delete ret.twoFactorRecoveryCodes;
    delete ret.twoFactorLastStep;
    delete ret.twoFactorFailures;
    delete ret.twoFactorFailuresSince;
    delete ret.twoFactorLockedUntil;
    delete ret.__v;
    return ret;
  },
});

// Deactivated accounts are invisible to every find query, unless the query
// opts in with { includeInactive: true } (the admin routes do).
userSchema.pre(/^find/, function () {
  if (this.getOptions().includeInactive) return;
  this.where({ active: { $ne: false } });
});

userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;

  this.password = await bcrypt.hash(this.password, BCRYPT_COST);
  this.passwordConfirm = undefined;

  // Backdate by a second so a token issued in the same request stays valid.
  if (!this.isNew) this.passwordChangedAt = Date.now() - 1000;
});

userSchema.methods.passwordMatches = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

userSchema.methods.changedPasswordSince = function (issuedAtSeconds) {
  if (!this.passwordChangedAt) return false;
  return issuedAtSeconds < Math.floor(this.passwordChangedAt.getTime() / 1000);
};

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

// Only the hash is stored; the plain token goes out by email.
userSchema.methods.createPasswordResetToken = function () {
  const token = crypto.randomBytes(32).toString('hex');

  this.passwordResetToken = hashToken(token);
  this.passwordResetExpires = Date.now() + RESET_TOKEN_TTL_MS;

  return token;
};

userSchema.methods.createEmailVerifyToken = function () {
  const token = crypto.randomBytes(32).toString('hex');

  this.emailVerified = false;
  this.emailVerifyToken = hashToken(token);
  this.emailVerifyExpires = Date.now() + VERIFY_TOKEN_TTL_MS;

  return token;
};

// Does the work of a password check without an account. Always false.
userSchema.statics.rejectPassword = async (candidate) => {
  await bcrypt.compare(String(candidate), DUMMY_HASH);
  return false;
};

// Active admins other than the given account.
userSchema.statics.otherAdmins = function (userId) {
  return this.countDocuments({
    role: 'admin',
    active: { $ne: false },
    _id: { $ne: userId },
  });
};

userSchema.statics.hashToken = hashToken;
userSchema.statics.ROLES = ROLES;

module.exports = mongoose.model('User', userSchema);
