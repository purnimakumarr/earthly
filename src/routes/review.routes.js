const express = require('express');
const reviews = require('../controllers/review.controller');
const { requireAuth, allowRoles } = require('../middleware/auth');

// mergeParams exposes :expeditionId when mounted under /expeditions/:expeditionId/reviews
const router = express.Router({ mergeParams: true });

router.get('/', reviews.listReviews);

router.use(requireAuth);

router.get('/me', reviews.getMyReviews);
router.post(
  '/',
  allowRoles('traveler'),
  reviews.setExpeditionAndUser,
  reviews.createReview,
);

router
  .route('/:id')
  .get(reviews.getReview)
  .patch(reviews.ownReviewOnly, reviews.updateReview)
  .delete(reviews.ownReviewOnly, reviews.deleteReview);

module.exports = router;
