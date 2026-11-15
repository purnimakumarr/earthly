const crypto = require('crypto');
const mongoose = require('mongoose');
const validator = require('validator');
const bcrypt = require('bcryptjs');
const plainText = require('../utils/plainText');

const ROLES = ['traveler', 'guide', 'lead', 'admin'];
const RESET_TOKEN_TTL_MS = 10 * 60 * 1000;

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
  active: {
    type: Boolean,
    default: true,
    select: false,
  },
});

userSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.password;
    delete ret.active;
    delete ret.passwordResetToken;
    delete ret.passwordResetExpires;
    delete ret.__v;
    return ret;
  },
});

// Deactivated accounts are invisible to every find query.
userSchema.pre(/^find/, function () {
  this.where({ active: { $ne: false } });
});

userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;

  this.password = await bcrypt.hash(this.password, 12);
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

userSchema.statics.hashToken = hashToken;
userSchema.statics.ROLES = ROLES;

module.exports = mongoose.model('User', userSchema);
