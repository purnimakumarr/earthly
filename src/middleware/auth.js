const jwt = require('jsonwebtoken');
const config = require('../config');
const User = require('../models/user.model');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

const readToken = (req) => {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice(7);
  return req.cookies?.session;
};

// Requires a valid session and loads the account onto req.user.
exports.requireAuth = asyncHandler(async (req, res, next) => {
  const token = readToken(req);
  if (!token) throw new ApiError(401, 'Please log in to continue.');

  // Throws JsonWebTokenError / TokenExpiredError, mapped in the error handler.
  const payload = jwt.verify(token, config.jwt.secret);

  // Single-purpose tokens (the 2FA challenge) are not sessions.
  if (payload.purpose) throw new ApiError(401, 'Invalid session. Please log in again.');

  const user = await User.findById(payload.id);
  if (!user) throw new ApiError(401, 'This account no longer exists.');

  if (user.changedPasswordSince(payload.iat)) {
    throw new ApiError(401, 'Password was changed. Please log in again.');
  }

  req.user = user;
  next();
});

// Booking and reviewing need a confirmed email address. Must run after requireAuth.
exports.requireVerified = (req, res, next) => {
  if (!req.user.emailVerified) {
    return next(new ApiError(403, 'Please confirm your email address first.'));
  }
  next();
};

// Must run after requireAuth.
exports.allowRoles =
  (...roles) =>
  (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return next(new ApiError(403, 'You are not allowed to do that.'));
    }
    next();
  };
