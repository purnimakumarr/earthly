const express = require('express');
const bookings = require('../controllers/booking.controller');
const { requireAuth, allowRoles } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

router.post('/orders', bookings.createOrder);
router.post('/verify', bookings.verifyPayment);
router.get('/me', bookings.getMyBookings);

router.use(allowRoles('admin', 'lead'));

router.route('/').get(bookings.listBookings).post(bookings.createBooking);
router
  .route('/:id')
  .get(bookings.getBooking)
  .patch(bookings.updateBooking)
  .delete(bookings.deleteBooking);

module.exports = router;
