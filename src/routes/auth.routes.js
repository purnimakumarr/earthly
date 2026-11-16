const express = require('express');
const auth = require('../controllers/auth.controller');
const twoFactor = require('../controllers/twoFactor.controller');
const { requireAuth } = require('../middleware/auth');
const { credentialLimiter } = require('../middleware/rateLimit');

const router = express.Router();

router.post('/signup', credentialLimiter, auth.signup);
router.post('/login', credentialLimiter, auth.login);
router.post('/refresh', auth.refresh);
router.post('/logout', auth.logout);

router.post('/forgot-password', credentialLimiter, auth.forgotPassword);
router.patch('/reset-password/:token', credentialLimiter, auth.resetPassword);

router.post('/verify-email/:token', credentialLimiter, auth.verifyEmail);
router.post(
  '/resend-verification',
  credentialLimiter,
  requireAuth,
  auth.resendVerification,
);

router.post('/2fa/verify', credentialLimiter, twoFactor.verify);
router.post('/2fa/setup', requireAuth, twoFactor.setup);
router.post('/2fa/enable', credentialLimiter, requireAuth, twoFactor.enable);
router.post('/2fa/disable', credentialLimiter, requireAuth, twoFactor.disable);

module.exports = router;
