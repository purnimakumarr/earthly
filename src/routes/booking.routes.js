const express = require('express');
const bookings = require('../controllers/booking.controller');
const { requireAuth, requireVerified, allowRoles } = require('../middleware/auth');

// mergeParams exposes :expeditionId / :userId when this router is mounted
// under /expeditions/:expeditionId/bookings or /users/:userId/bookings.
const router = express.Router({ mergeParams: true });

router.use(requireAuth);

router.post('/orders', requireVerified, bookings.createOrder);
router.post('/verify', bookings.verifyPayment);
router.get('/me', bookings.getMyBookings);

router.use(allowRoles('admin', 'lead'));

router
  .route('/')
  .get(bookings.listBookings)
  .post(bookings.setParents, bookings.createBooking);
router
  .route('/:id')
  .get(bookings.getBooking)
  .patch(bookings.updateBooking)
  .delete(bookings.deleteBooking);

module.exports = router;
