const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const QRCode = require('qrcode');
const { authenticator } = require('otplib');
const config = require('../config');
const logger = require('../config/logger');
const User = require('../models/user.model');
const RefreshToken = require('../models/refreshToken.model');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const secretBox = require('../utils/secretBox');
const { issueSession } = require('./auth.controller');

const ISSUER = 'Earthly';
const RECOVERY_CODE_COUNT = 8;
const STEP_MS = 30 * 1000;
// Wrong codes allowed at login before the second step is locked for a while.
const MAX_FAILURES = 5;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;

// Accept the previous and next 30-second step to allow for clock drift.
authenticator.options = { window: 1 };

// A seed that no longer decrypts (the encryption key was changed) is an
// operator problem: say so plainly, without leaking the decryption error.
const openSecret = (user) => {
  try {
    return secretBox.open(user.twoFactorSecret);
  } catch (err) {
    logger.error({ err, userId: user.id }, 'two-factor seed could not be decrypted');
    throw new ApiError(
      500,
      'Two-factor authentication is unavailable for this account. Please contact support.',
    );
  }
};

// Resolves to the 30-second step the code belongs to, or null if it is wrong.
const matchedStep = (user, code) => {
  if (typeof code !== 'string' || !user.twoFactorSecret) return null;

  const delta = authenticator.checkDelta(code.replace(/\s/g, ''), openSecret(user));
  return delta === null ? null : Math.floor(Date.now() / STEP_MS) + delta;
};

const codeMatches = (user, code) => matchedStep(user, code) !== null;

// A code opens one login only: the step is recorded in the same query that
// checks it is newer than the last one used, so a replay (or a parallel
// request with the same code) finds nothing to update.
const claimStep = async (userId, step) => {
  const result = await User.updateOne(
    {
      _id: userId,
      $or: [{ twoFactorLastStep: null }, { twoFactorLastStep: { $lt: step } }],
    },
    { twoFactorLastStep: step },
  );
  return result.modifiedCount === 1;
};

// The rate limiter counts per IP; this counts per account, so guesses spread
// over many addresses still run out.
// Failures are counted within a window, so the odd mistyped code weeks apart
// never adds up to a lock.
const noteFailure = async (userId) => {
  const windowStart = new Date(Date.now() - FAILURE_WINDOW_MS);

  // First failure, or the first in a new window: start counting from one.
  const restarted = await User.updateOne(
    {
      _id: userId,
      $or: [
        { twoFactorFailuresSince: null },
        { twoFactorFailuresSince: { $lt: windowStart } },
      ],
    },
    { twoFactorFailures: 1, twoFactorFailuresSince: new Date() },
  );
  if (restarted.modifiedCount === 1) return;

  const user = await User.findByIdAndUpdate(
    userId,
    { $inc: { twoFactorFailures: 1 } },
    { new: true },
  ).select('+twoFactorFailures');

  if (user && user.twoFactorFailures >= MAX_FAILURES) {
    await User.updateOne(
      { _id: userId },
      {
        $set: { twoFactorLockedUntil: new Date(Date.now() + LOCK_MS) },
        $unset: { twoFactorFailures: 1, twoFactorFailuresSince: 1 },
      },
    );
  }
};

const normaliseRecoveryCode = (code) => String(code).trim().toLowerCase();

// Recovery codes work once: the matching hash is pulled in the same query
// that checks it, so a code cannot be spent twice in parallel.
const spendRecoveryCode = async (userId, code) => {
  if (typeof code !== 'string') return false;

  const result = await User.updateOne(
    { _id: userId },
    { $pull: { twoFactorRecoveryCodes: User.hashToken(normaliseRecoveryCode(code)) } },
  );
  return result.modifiedCount === 1;
};

const withSecrets = (id) =>
  User.findById(id).select(
    '+twoFactorSecret +twoFactorRecoveryCodes +twoFactorLockedUntil +password',
  );

// Step 1 of switching 2FA on: generate a secret and show it as a QR code.
// Nothing is enforced until a code from the app is confirmed.
exports.setup = asyncHandler(async (req, res) => {
  if (req.user.twoFactorEnabled) {
    throw new ApiError(409, 'Two-factor authentication is already on.');
  }

  const secret = authenticator.generateSecret();
  const otpauthUrl = authenticator.keyuri(req.user.email, ISSUER, secret);

  await User.updateOne({ _id: req.user.id }, { twoFactorSecret: secretBox.seal(secret) });

  res.status(200).json({
    status: 'success',
    data: { secret, otpauthUrl, qr: await QRCode.toDataURL(otpauthUrl, { margin: 1 }) },
  });
});

// Step 2: prove the authenticator app is set up, then hand out recovery codes.
exports.enable = asyncHandler(async (req, res) => {
  const user = await withSecrets(req.user.id);

  if (user.twoFactorEnabled) {
    throw new ApiError(409, 'Two-factor authentication is already on.');
  }
  if (!user.twoFactorSecret) {
    throw new ApiError(400, 'Start with POST /auth/2fa/setup.');
  }
  if (!codeMatches(user, req.body.code)) {
    throw new ApiError(400, 'That code is not correct. Check the app and try again.');
  }

  const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const hex = crypto.randomBytes(5).toString('hex');
    return `${hex.slice(0, 5)}-${hex.slice(5)}`;
  });

  await User.updateOne(
    { _id: user.id },
    {
      twoFactorEnabled: true,
      twoFactorRecoveryCodes: recoveryCodes.map((code) => User.hashToken(code)),
    },
  );

  // Sessions opened before this point never passed a second factor, so they
  // end here. The one making this request (known by its refresh token, which
  // the browser sends as a cookie) carries on.
  const presented = req.cookies?.refresh || req.body.refreshToken;
  const current =
    typeof presented === 'string' ? await RefreshToken.findByToken(presented) : null;
  await RefreshToken.revokeAllFor(user._id, {
    exceptFamily: current?.user.equals(user._id) ? current.family : undefined,
  });

  // Shown once; only their hashes are kept.
  res.status(200).json({ status: 'success', data: { recoveryCodes } });
});

exports.disable = asyncHandler(async (req, res) => {
  const user = await withSecrets(req.user.id);

  if (!user.twoFactorEnabled) {
    throw new ApiError(409, 'Two-factor authentication is not on.');
  }

  if (
    typeof req.body.password !== 'string' ||
    !(await user.passwordMatches(req.body.password))
  ) {
    throw new ApiError(401, 'Password is incorrect.');
  }

  const proven =
    codeMatches(user, req.body.code) ||
    (await spendRecoveryCode(user.id, req.body.recoveryCode));
  if (!proven) throw new ApiError(400, 'That code is not correct.');

  await User.updateOne(
    { _id: user.id },
    {
      $set: { twoFactorEnabled: false },
      $unset: {
        twoFactorSecret: 1,
        twoFactorRecoveryCodes: 1,
        twoFactorLastStep: 1,
        twoFactorFailures: 1,
        twoFactorFailuresSince: 1,
        twoFactorLockedUntil: 1,
      },
    },
  );

  res.status(200).json({ status: 'success' });
});

// Second step of login: exchange the challenge token and a code for a session.
exports.verify = asyncHandler(async (req, res) => {
  const { challengeToken, code, recoveryCode } = req.body;

  if (typeof challengeToken !== 'string') {
    throw new ApiError(400, 'challengeToken is required.');
  }

  let payload;
  try {
    payload = jwt.verify(challengeToken, config.jwt.secret);
  } catch {
    throw new ApiError(401, 'Login timed out. Please start again.');
  }
  if (payload.purpose !== '2fa') {
    throw new ApiError(401, 'Login timed out. Please start again.');
  }

  const user = await withSecrets(payload.id);
  if (!user || !user.twoFactorEnabled) {
    throw new ApiError(401, 'Login timed out. Please start again.');
  }

  if (user.twoFactorLockedUntil > new Date()) {
    throw new ApiError(429, 'Too many incorrect codes. Try again in 15 minutes.');
  }

  const step = matchedStep(user, code);
  const proven =
    (step !== null && (await claimStep(user.id, step))) ||
    (await spendRecoveryCode(user.id, recoveryCode));

  if (!proven) {
    await noteFailure(user.id);
    throw new ApiError(401, 'That code is not correct.');
  }

  await User.updateOne(
    { _id: user.id },
    {
      $unset: {
        twoFactorFailures: 1,
        twoFactorFailuresSince: 1,
        twoFactorLockedUntil: 1,
      },
    },
  );

  await issueSession(user, 200, req, res);
});
