const mongoose = require('mongoose');
const slugify = require('slugify');
const plainText = require('../utils/plainText');

const pointSchema = {
  type: {
    type: String,
    default: 'Point',
    enum: ['Point'],
  },
  // GeoJSON order: [longitude, latitude]
  coordinates: [Number],
  address: String,
  description: String,
};

const expeditionSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'An expedition needs a name'],
      unique: true,
      trim: true,
      minLength: [8, 'Name needs at least 8 characters'],
      maxLength: [60, 'Name can be at most 60 characters'],
      set: plainText,
    },
    slug: { type: String, unique: true },
    region: {
      type: String,
      required: [true, 'An expedition needs a region'],
      trim: true,
    },
    duration: {
      type: Number,
      required: [true, 'Duration (in days) is required'],
      min: [1, 'Duration must be at least one day'],
    },
    maxGroupSize: {
      type: Number,
      required: [true, 'Group size is required'],
      min: [1, 'Group size must be at least 1'],
    },
    difficulty: {
      type: String,
      required: [true, 'Difficulty is required'],
      enum: {
        values: ['easy', 'moderate', 'challenging'],
        message: 'Difficulty must be easy, moderate or challenging',
      },
    },
    ratingsAverage: {
      type: Number,
      default: 4.5,
      min: [1, 'Rating cannot be below 1'],
      max: [5, 'Rating cannot be above 5'],
      set: (value) => Math.round(value * 10) / 10,
    },
    ratingsQuantity: {
      type: Number,
      default: 0,
    },
    // Per person, in INR
    price: {
      type: Number,
      required: [true, 'Price is required'],
      min: [0, 'Price cannot be negative'],
    },
    priceDiscount: {
      type: Number,
      validate: {
        // `this` is the document only on create() and save().
        validator: function (value) {
          return value < this.price;
        },
        message: 'Discount ({VALUE}) must be lower than the price',
      },
    },
    summary: {
      type: String,
      trim: true,
      required: [true, 'A one-line summary is required'],
      set: plainText,
    },
    description: {
      type: String,
      trim: true,
      set: plainText,
    },
    // URL paths, e.g. /img/expeditions/x.jpg or /uploads/expeditions/y.jpeg
    coverImage: {
      type: String,
      required: [true, 'A cover image is required'],
    },
    images: [String],
    createdAt: {
      type: Date,
      default: Date.now,
      select: false,
    },
    startDates: [Date],
    // Unlisted expeditions are hidden from all queries and aggregates.
    unlisted: {
      type: Boolean,
      default: false,
    },
    startLocation: pointSchema,
    locations: [{ ...pointSchema, day: Number }],
    guides: [{ type: mongoose.Schema.ObjectId, ref: 'User' }],
  },
  {
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

expeditionSchema.index({ price: 1, ratingsAverage: -1 });
expeditionSchema.index({ startLocation: '2dsphere' });

expeditionSchema.virtual('durationWeeks').get(function () {
  return this.duration ? Math.round((this.duration / 7) * 10) / 10 : undefined;
});

// Reviews live in their own collection and point back here.
expeditionSchema.virtual('reviews', {
  ref: 'Review',
  foreignField: 'expedition',
  localField: '_id',
});

expeditionSchema.pre('save', function () {
  if (this.isModified('name')) {
    this.slug = slugify(this.name, { lower: true, strict: true });
  }
});

expeditionSchema.pre([/^find/, 'countDocuments'], function () {
  this.where({ unlisted: { $ne: true } });
});

expeditionSchema.pre(/^find/, function () {
  // Skip the join when the caller asked for specific fields and left guides out.
  const projection = this.projection() || {};
  if (this.selectedInclusively() && !projection.guides) return;

  this.populate({ path: 'guides', select: 'name photo role' });
});

expeditionSchema.pre('aggregate', function () {
  const pipeline = this.pipeline();
  const hide = { $match: { unlisted: { $ne: true } } };

  // $geoNear is only valid as the first stage, so slot in right after it.
  if (pipeline.length && pipeline[0].$geoNear) pipeline.splice(1, 0, hide);
  else pipeline.unshift(hide);
});

module.exports = mongoose.model('Expedition', expeditionSchema);
