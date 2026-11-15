const express = require('express');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const auth = require('../controllers/auth.controller');

const router = express.Router();

// Tighter than the global limit: these endpoints are the brute-force targets.
const credentialLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => config.isTest,
  message: { status: 'fail', message: 'Too many attempts. Try again in 15 minutes.' },
});

router.post('/signup', credentialLimiter, auth.signup);
router.post('/login', credentialLimiter, auth.login);
router.post('/logout', auth.logout);
router.post('/forgot-password', credentialLimiter, auth.forgotPassword);
router.patch('/reset-password/:token', credentialLimiter, auth.resetPassword);

module.exports = router;
