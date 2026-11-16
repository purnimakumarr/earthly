const rateLimit = require('express-rate-limit');
const config = require('../config');

const WINDOW_MS = 15 * 60 * 1000;
const common = {
  windowMs: WINDOW_MS,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => config.isTest,
};

// Tighter than the global limit: these endpoints are the brute-force targets.
// Counted per IP address, because the caller is not known yet.
exports.credentialLimiter = rateLimit({
  ...common,
  limit: 20,
  message: { status: 'fail', message: 'Too many attempts. Try again in 15 minutes.' },
});

// For signed-in routes that ask for the current password again. Counted per
// account, and only a wrong password counts (the handler flags it), so
// ordinary profile edits and their validation errors never use it up but
// guessing a password with a stolen session soon does.
// Must run after requireAuth.
exports.passwordCheckLimiter = rateLimit({
  ...common,
  limit: 10,
  skipSuccessfulRequests: true,
  requestWasSuccessful: (req, res) => !res.locals.wrongPassword,
  keyGenerator: (req) => `password-check:${req.user.id}`,
  message: { status: 'fail', message: 'Too many attempts. Try again in 15 minutes.' },
});
