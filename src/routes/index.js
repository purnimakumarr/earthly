const express = require('express');

const router = express.Router();

router.use('/auth', require('./auth.routes'));
router.use('/users', require('./user.routes'));
router.use('/expeditions', require('./expedition.routes'));
router.use('/reviews', require('./review.routes'));
router.use('/bookings', require('./booking.routes'));

module.exports = router;
