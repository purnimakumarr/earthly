const jwt = require('jsonwebtoken');
const config = require('../config');
const logger = require('../config/logger');
const User = require('../models/user.model');
const RefreshToken = require('../models/refreshToken.model');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const mailer = require('../utils/mailer');

const ACCESS_COOKIE = 'session';
const REFRESH_COOKIE = 'refresh';
// The refresh cookie is only ever sent to the auth endpoints.
const REFRESH_PATH = '/api/v1/auth';
const REFRESH_TTL_MS = config.jwt.refreshDays * 24 * 60 * 60 * 1000;
// Two tabs can present the same refresh token at the same moment. A token that
// was rotated this recently is treated as that, not as theft.
const ROTATION_GRACE_MS = 10 * 1000;

const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: config.isProd,
});

const clearCookies = (res) => {
  res.clearCookie(ACCESS_COOKIE, cookieOptions());
  res.clearCookie(REFRESH_COOKIE, { ...cookieOptions(), path: REFRESH_PATH });
};

// Starts (or continues) a session: a short-lived access JWT plus a long-lived,
// single-use refresh token. Both go out as httpOnly cookies. They are also in
// the body for API clients that use an Authorization header, unless
// `exposeTokens` is off.
const issueSession = async (
  user,
  statusCode,
  req,
  res,
  { family, exposeTokens = true } = {},
) => {
  const token = jwt.sign({ id: user._id }, config.jwt.secret, {
    expiresIn: config.jwt.accessTtl,
  });

  const refreshToken = await RefreshToken.issue({
    userId: user._id,
    family,
    ttlMs: REFRESH_TTL_MS,
    userAgent: req.get('user-agent'),
  });

  res.cookie(ACCESS_COOKIE, token, {
    ...cookieOptions(),
    maxAge: jwt.decode(token).exp * 1000 - Date.now(),
  });
  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...cookieOptions(),
    path: REFRESH_PATH,
    maxAge: REFRESH_TTL_MS,
  });

  res.status(statusCode).json({
    status: 'success',
    ...(exposeTokens && { token, refreshToken }),
    data: user,
  });
};

const siteUrl = (req) => config.clientUrl || `${req.protocol}://${req.get('host')}`;

// Stores a fresh confirmation token on the user and emails the link.
// A mail outage is logged, not raised: the link can be requested again.
const sendVerification = async (user, req) => {
  const token = user.createEmailVerifyToken();
  await user.save({ validateBeforeSave: false });

  await mailer
    .sendVerification(user, `${siteUrl(req)}/verify-email/${token}`)
    .catch((err) => logger.warn({ err }, 'verification email failed'));
};

exports.issueSession = issueSession;
exports.sendVerification = sendVerification;

exports.signup = asyncHandler(async (req, res) => {
  // Role is deliberately not read from the body: new accounts are travelers.
  const { name, email, password, passwordConfirm } = req.body;
  const user = await User.create({ name, email, password, passwordConfirm });

  await sendVerification(user, req);

  await issueSession(user, 201, req, res);
});

exports.login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (typeof email !== 'string' || typeof password !== 'string') {
    throw new ApiError(400, 'Email and password are required.');
  }

  const user = await User.findOne({ email }).select('+password');

  // Same answer, after the same amount of work, for an unknown email and a
  // wrong password.
  const matches = user
    ? await user.passwordMatches(password)
    : await User.rejectPassword(password);
  if (!matches) {
    throw new ApiError(401, 'Incorrect email or password.');
  }

  // With two-factor on, the password only earns a short-lived challenge
  // token; the session starts at POST /auth/2fa/verify.
  if (user.twoFactorEnabled) {
    const challengeToken = jwt.sign({ id: user._id, purpose: '2fa' }, config.jwt.secret, {
      expiresIn: '5m',
    });

    return res
      .status(200)
      .json({ status: 'success', twoFactorRequired: true, challengeToken });
  }

  await issueSession(user, 200, req, res);
});

// Swaps a refresh token for a new session. Each token works once.
exports.refresh = asyncHandler(async (req, res) => {
  const fromCookie = req.cookies?.[REFRESH_COOKIE];
  const presented = fromCookie || req.body?.refreshToken;
  const expired = () => {
    clearCookies(res);
    return new ApiError(401, 'Session expired. Please log in again.');
  };

  if (typeof presented !== 'string') throw expired();

  const stored = await RefreshToken.findByToken(presented);
  if (!stored || stored.expiresAt <= new Date()) throw expired();

  const consumed = stored.revokedAt ? null : await RefreshToken.consume(stored._id);
  if (!consumed) {
    // Re-read: another request may have rotated it since the lookup above.
    const current = await RefreshToken.findById(stored._id);
    const justRotated =
      current?.rotated && Date.now() - current.revokedAt.getTime() <= ROTATION_GRACE_MS;

    // Outside the grace period a used token means it leaked (or a client
    // replayed it): end every session descended from that login.
    if (!justRotated) {
      await RefreshToken.revokeFamily(stored.family);
      logger.warn({ userId: stored.user }, 'refresh token reuse: sessions revoked');
      throw expired();
    }
  }

  const user = await User.findById(stored.user);
  if (!user) throw expired();

  // A page that refreshes by cookie never needs to see the tokens, so a
  // script running on it cannot read a long-lived one out of the response.
  await issueSession(user, 200, req, res, {
    family: stored.family,
    exposeTokens: !fromCookie,
  });
});

exports.logout = asyncHandler(async (req, res) => {
  const presented = req.cookies?.[REFRESH_COOKIE] || req.body?.refreshToken;

  if (typeof presented === 'string') {
    const stored = await RefreshToken.findByToken(presented);
    if (stored) await RefreshToken.revokeFamily(stored.family);
  }

  clearCookies(res);
  res.status(200).json({ status: 'success' });
});

exports.verifyEmail = asyncHandler(async (req, res) => {
  const user = await User.findOneAndUpdate(
    {
      emailVerifyToken: User.hashToken(req.params.token),
      emailVerifyExpires: { $gt: Date.now() },
    },
    {
      $set: { emailVerified: true },
      $unset: { emailVerifyToken: 1, emailVerifyExpires: 1 },
    },
    { new: true },
  );

  if (!user) {
    throw new ApiError(400, 'This confirmation link is invalid or has expired.');
  }

  res.status(200).json({ status: 'success', data: user });
});

exports.resendVerification = asyncHandler(async (req, res) => {
  if (req.user.emailVerified) {
    throw new ApiError(409, 'This email address is already confirmed.');
  }

  await sendVerification(req.user, req);

  res.status(200).json({ status: 'success', message: 'Confirmation email sent.' });
});

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
  // The link arrived by email, so using it also proves the address.
  user.emailVerified = true;
  await user.save();

  // A new password signs every other device out.
  await RefreshToken.revokeAllFor(user._id);

  // Two-factor still applies: the reset link alone must not bypass it.
  if (user.twoFactorEnabled) {
    return res.status(200).json({
      status: 'success',
      message: 'Password updated. Log in with your new password.',
    });
  }

  await issueSession(user, 200, req, res);
});

exports.changePassword = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id).select('+password');

  if (
    typeof req.body.passwordCurrent !== 'string' ||
    !(await user.passwordMatches(req.body.passwordCurrent))
  ) {
    // 403, not 401: the session is fine, so the client must not try to
    // renew it and send the request again.
    res.locals.wrongPassword = true;
    throw new ApiError(403, 'Current password is incorrect.');
  }

  // save() rather than an update query, so validators and hashing run.
  user.password = req.body.password;
  user.passwordConfirm = req.body.passwordConfirm;
  await user.save();

  await RefreshToken.revokeAllFor(user._id);
  await issueSession(user, 200, req, res);
});
