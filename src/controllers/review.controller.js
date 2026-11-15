const Review = require('../models/review.model');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const crud = require('./crudFactory');

// For POST /expeditions/:expeditionId/reviews: the author is always the
// logged-in user, and the expedition comes from the URL when present.
exports.setExpeditionAndUser = (req, res, next) => {
  req.body = {
    review: req.body.review,
    rating: req.body.rating,
    expedition: req.params.expeditionId || req.body.expedition,
    user: req.user.id,
  };
  next();
};

// Travelers may only change their own reviews; admins may moderate any.
exports.ownReviewOnly = asyncHandler(async (req, res, next) => {
  if (req.user.role === 'admin') return next();

  const review = await Review.findById(req.params.id);
  if (!review) throw new ApiError(404, 'No review found with that id.');

  if (review.user?.id !== req.user.id) {
    throw new ApiError(403, 'You can only change your own reviews.');
  }

  next();
});

exports.getMyReviews = asyncHandler(async (req, res) => {
  const reviews = await Review.find({ user: req.user.id })
    .sort('-createdAt')
    .populate({ path: 'expedition', select: 'name slug coverImage' });

  res.status(200).json({ status: 'success', results: reviews.length, data: reviews });
});

exports.listReviews = crud.list(Review);
exports.getReview = crud.getOne(Review);
exports.createReview = crud.create(Review);
exports.updateReview = crud.update(Review, { fields: ['review', 'rating'] });
exports.deleteReview = crud.remove(Review);
