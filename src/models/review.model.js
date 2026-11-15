const mongoose = require('mongoose');
const Expedition = require('./expedition.model');
const plainText = require('../utils/plainText');

const reviewSchema = new mongoose.Schema({
  review: {
    type: String,
    required: [true, 'Review text is required'],
    maxLength: [1000, 'Review can be at most 1000 characters'],
    set: plainText,
  },
  rating: {
    type: Number,
    min: [1, 'Rating must be between 1 and 5'],
    max: [5, 'Rating must be between 1 and 5'],
    required: [true, 'Rating is required'],
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  expedition: {
    type: mongoose.Schema.ObjectId,
    ref: 'Expedition',
    required: [true, 'A review must belong to an expedition'],
  },
  user: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: [true, 'A review must belong to a user'],
  },
});

// One review per traveler per expedition.
reviewSchema.index({ expedition: 1, user: 1 }, { unique: true });

reviewSchema.pre(/^find/, function () {
  this.populate({ path: 'user', select: 'name photo' });
});

// Keeps the denormalised rating fields on the expedition in step.
reviewSchema.statics.refreshRatings = async function (expeditionId) {
  const [stats] = await this.aggregate([
    { $match: { expedition: expeditionId } },
    {
      $group: {
        _id: '$expedition',
        count: { $sum: 1 },
        average: { $avg: '$rating' },
      },
    },
  ]);

  await Expedition.findByIdAndUpdate(expeditionId, {
    ratingsQuantity: stats ? stats.count : 0,
    ratingsAverage: stats ? stats.average : 4.5,
  });
};

reviewSchema.post('save', async function () {
  await this.constructor.refreshRatings(this.expedition);
});

// findByIdAndUpdate / findByIdAndDelete hand the affected document to post hooks.
reviewSchema.post(/^findOneAnd/, async function (doc) {
  if (doc) await doc.constructor.refreshRatings(doc.expedition);
});

module.exports = mongoose.model('Review', reviewSchema);
