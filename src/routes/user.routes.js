const express = require('express');
const users = require('../controllers/user.controller');
const { changePassword } = require('../controllers/auth.controller');
const { requireAuth, allowRoles } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { passwordCheckLimiter } = require('../middleware/rateLimit');

const bookingRouter = require('./booking.routes');

const router = express.Router();

router.use(requireAuth);

router
  .route('/me')
  .get(users.getMe)
  .patch(passwordCheckLimiter, upload.userPhoto, users.updateMe)
  .delete(users.deleteMe);
router.patch('/me/password', passwordCheckLimiter, changePassword);

router.get('/me/favourites', users.getMyFavourites);
router
  .route('/me/favourites/:expeditionId')
  .put(users.addFavourite)
  .delete(users.removeFavourite);

// Staff-only inside the booking router.
router.use('/:userId/bookings', bookingRouter);

router.use(allowRoles('admin'));

router.get('/', users.listUsers);
router.route('/:id').get(users.getUser).patch(users.updateUser).delete(users.deleteUser);

module.exports = router;
