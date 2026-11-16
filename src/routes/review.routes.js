const express = require('express');
const reviews = require('../controllers/review.controller');
const { requireAuth, requireVerified, allowRoles } = require('../middleware/auth');

// mergeParams exposes :expeditionId when mounted under /expeditions/:expeditionId/reviews
const router = express.Router({ mergeParams: true });

router.get('/', reviews.listReviews);

router.use(requireAuth);

router.get('/me', reviews.getMyReviews);
router.post(
  '/',
  allowRoles('traveler'),
  requireVerified,
  reviews.setExpeditionAndUser,
  reviews.bookedOnly,
  reviews.createReview,
);

router
  .route('/:id')
  .get(reviews.getReview)
  .patch(reviews.ownReviewOnly, reviews.updateReview)
  .delete(reviews.ownReviewOnly, reviews.deleteReview);

module.exports = router;
