const jwt = require('jsonwebtoken');
const config = require('../config');
const logger = require('../config/logger');
const User = require('../models/user.model');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const mailer = require('../utils/mailer');

const COOKIE_NAME = 'session';

const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: config.isProd,
});

// Signs a JWT, sets it as an httpOnly cookie and also returns it in the body
// for API clients that prefer an Authorization header.
const issueSession = (user, statusCode, res) => {
  const token = jwt.sign({ id: user._id }, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
  });

  res.cookie(COOKIE_NAME, token, {
    ...cookieOptions(),
    maxAge: config.jwt.cookieDays * 24 * 60 * 60 * 1000,
  });

  res.status(statusCode).json({ status: 'success', token, data: user });
};

const siteUrl = (req) => config.clientUrl || `${req.protocol}://${req.get('host')}`;

exports.signup = asyncHandler(async (req, res) => {
  // Role is deliberately not read from the body: new accounts are travelers.
  const { name, email, password, passwordConfirm } = req.body;
  const user = await User.create({ name, email, password, passwordConfirm });

  // A mail outage should not block registration.
  mailer
    .sendWelcome(user, siteUrl(req))
    .catch((err) => logger.warn({ err }, 'welcome email failed'));

  issueSession(user, 201, res);
});

exports.login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (typeof email !== 'string' || typeof password !== 'string') {
    throw new ApiError(400, 'Email and password are required.');
  }

  const user = await User.findOne({ email }).select('+password');

  // Same answer for unknown email and wrong password.
  if (!user || !(await user.passwordMatches(password))) {
    throw new ApiError(401, 'Incorrect email or password.');
  }

  issueSession(user, 200, res);
});

exports.logout = (req, res) => {
  res.clearCookie(COOKIE_NAME, cookieOptions());
  res.status(200).json({ status: 'success' });
};

exports.forgotPassword = asyncHandler(async (req, res) => {
  const reply = () =>
    res.status(200).json({
      status: 'success',
      message: 'If that address has an account, a reset link is on its way.',
    });

  if (typeof req.body.email !== 'string') {
    throw new ApiError(400, 'Email is required.');
  }

  // Reply identically whether or not the account exists.
  const user = await User.findOne({ email: req.body.email });
  if (!user) return reply();

  const token = user.createPasswordResetToken();
  await user.save({ validateBeforeSave: false });

  try {
    await mailer.sendPasswordReset(user, `${siteUrl(req)}/reset-password/${token}`);
  } catch (err) {
    // Do not leave a live token behind that nobody received.
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save({ validateBeforeSave: false });

    logger.error({ err }, 'password reset email failed');
    throw new ApiError(502, 'Could not send the reset email. Try again shortly.');
  }

  reply();
});

exports.resetPassword = asyncHandler(async (req, res) => {
  const user = await User.findOne({
    passwordResetToken: User.hashToken(req.params.token),
    passwordResetExpires: { $gt: Date.now() },
  });

  if (!user) throw new ApiError(400, 'This reset link is invalid or has expired.');

  user.password = req.body.password;
  user.passwordConfirm = req.body.passwordConfirm;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;
  await user.save();

  issueSession(user, 200, res);
});

exports.changePassword = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id).select('+password');

  if (
    typeof req.body.passwordCurrent !== 'string' ||
    !(await user.passwordMatches(req.body.passwordCurrent))
  ) {
    throw new ApiError(401, 'Current password is incorrect.');
  }

  // save() rather than an update query, so validators and hashing run.
  user.password = req.body.password;
  user.passwordConfirm = req.body.passwordConfirm;
  await user.save();

  issueSession(user, 200, res);
});
