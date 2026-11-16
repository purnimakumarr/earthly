const slugify = require('slugify');
const Expedition = require('../models/expedition.model');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const crud = require('./crudFactory');
const Booking = require('../models/booking.model');
const Review = require('../models/review.model');
const User = require('../models/user.model');
const upload = require('../middleware/upload');

const EARTH_RADIUS = { km: 6378.1, mi: 3963.2 };
const METRES_TO = { km: 0.001, mi: 0.000621371 };

const parsePosition = (query) => {
  const [lat, lng] = String(query.latlng || '')
    .split(',')
    .map(Number);
  const unit = query.unit === 'mi' ? 'mi' : 'km';

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || query.latlng === undefined) {
    throw new ApiError(400, 'Pass a position as latlng=<latitude>,<longitude>.');
  }

  return { lat, lng, unit };
};

exports.listExpeditions = crud.list(Expedition);
exports.getExpedition = crud.getOne(Expedition, { path: 'reviews' });

// What staff may set. Ratings come from reviews, the slug from the name and
// seat counts from bookings, so none of those are taken from a request.
const EDITABLE = [
  'name',
  'region',
  'duration',
  'maxGroupSize',
  'difficulty',
  'price',
  'priceDiscount',
  'summary',
  'description',
  'coverImage',
  'images',
  'startLocation',
  'locations',
  'guides',
  'unlisted',
];

// Seat counts belong to the booking flow. Whatever a client sends for a
// departure, only its id and date are read.
const readDepartures = (input) => {
  if (!Array.isArray(input)) throw new ApiError(400, 'departures must be a list.');

  return input.map((item) => {
    const date = new Date(item?.date);
    if (Number.isNaN(date.getTime())) {
      throw new ApiError(400, 'Every departure needs a valid date.');
    }
    return { id: item._id ? String(item._id) : null, date };
  });
};

// Works out how to bring the stored departures in line with the submitted
// list, and refuses the request before anything is written if it cannot be.
const planDepartures = (expedition, wanted) => {
  const stored = new Map(expedition.departures.map((d) => [d.id, d]));
  const kept = new Set();

  for (const { id } of wanted) {
    if (id && !stored.has(id))
      throw new ApiError(404, 'No departure found with that id.');
    if (id) kept.add(id);
  }

  const dropped = expedition.departures.filter((d) => !kept.has(d.id));
  if (dropped.some((d) => d.participants > 0)) {
    throw new ApiError(409, 'A departure with bookings cannot be removed.');
  }

  return {
    moved: wanted.filter(
      ({ id, date }) => id && stored.get(id).date.getTime() !== date.getTime(),
    ),
    dropped,
    added: wanted.filter(({ id }) => !id).map(({ date }) => ({ date })),
  };
};

// Applies the plan one targeted update at a time, so a seat taken while
// someone had the editor open is never overwritten: dates are changed in
// place, new departures are pushed, and one that was left out is only pulled
// while nobody is booked on it.
const applyDepartures = async (_id, { moved, dropped, added }) => {
  // People already booked on a departure move with it.
  await Promise.all(
    moved.flatMap(({ id, date }) => [
      Expedition.updateOne(
        { _id, 'departures._id': id },
        { $set: { 'departures.$.date': date } },
      ),
      Booking.updateMany({ departure: id }, { departureDate: date }),
    ]),
  );

  if (dropped.length > 0) {
    await Expedition.updateOne(
      { _id },
      {
        $pull: {
          departures: { _id: { $in: dropped.map((d) => d._id) }, participants: 0 },
        },
      },
    );
  }

  if (added.length > 0) {
    await Expedition.updateOne({ _id }, { $push: { departures: { $each: added } } });
  }
};

// `soldOut` is derived, and the group size may just have changed.
const refreshSoldOut = (_id) =>
  Expedition.updateOne({ _id }, [
    {
      $set: {
        departures: {
          $map: {
            input: '$departures',
            as: 'd',
            in: {
              $mergeObjects: [
                '$$d',
                { soldOut: { $gte: ['$$d.participants', '$maxGroupSize'] } },
              ],
            },
          },
        },
      },
    },
  ]);

exports.createExpedition = asyncHandler(async (req, res) => {
  const { departures } = req.body;
  const fields = crud.pick(req.body, EDITABLE);

  const doc = await Expedition.create({
    ...fields,
    ...(departures !== undefined && {
      departures: readDepartures(departures).map(({ date }) => ({ date })),
    }),
  });

  res.status(201).json({ status: 'success', data: doc });
});

exports.updateExpedition = asyncHandler(async (req, res) => {
  const { departures } = req.body;
  const changes = crud.pick(req.body, EDITABLE);
  const { id } = req.params;

  const expedition = await Expedition.findById(id);
  if (!expedition) throw new ApiError(404, 'No expedition found with that id.');

  // Checked before anything is written, so a refused request changes nothing.
  const plan =
    departures === undefined
      ? null
      : planDepartures(expedition, readDepartures(departures));

  if (changes.maxGroupSize !== undefined) {
    const booked = Math.max(0, ...expedition.departures.map((d) => d.participants));
    if (Number(changes.maxGroupSize) < booked) {
      throw new ApiError(
        409,
        `Group size cannot go below ${booked}: that many travelers are already booked on one departure.`,
      );
    }
  }

  // Update queries skip the save hook that derives the slug, so a rename
  // has to carry the new slug along with it.
  if (typeof changes.name === 'string') {
    changes.slug = slugify(changes.name, { lower: true, strict: true });
  }

  // The steps below are separate writes, ordered so that each one is safe to
  // repeat: if one fails, saving the form again finishes the job.
  const updated = await Expedition.findByIdAndUpdate(id, changes, {
    new: true,
    runValidators: true,
  });
  if (plan) await applyDepartures(expedition._id, plan);
  await refreshSoldOut(id);

  // Re-read for the departures; an expedition that was just unlisted is
  // hidden from queries, so fall back to the document as updated.
  const doc = (await Expedition.findById(id)) || updated;

  // Images that were just replaced are no longer referenced anywhere.
  const current = [doc.coverImage, ...(doc.images || [])];
  await upload.discard(
    [expedition.coverImage, ...(expedition.images || [])].filter(
      (url) => !current.includes(url),
    ),
  );

  res.status(200).json({ status: 'success', data: doc });
});
// An expedition people have booked is not deleted from under them. Otherwise
// everything that points at it goes too: reviews, favourites and its images.
exports.deleteExpedition = asyncHandler(async (req, res) => {
  const expedition = await Expedition.findById(req.params.id);
  if (!expedition) throw new ApiError(404, 'No expedition found with that id.');

  if (await Booking.exists({ expedition: expedition._id })) {
    throw new ApiError(409, 'This expedition has bookings. Remove those first.');
  }

  await Expedition.deleteOne({ _id: expedition._id });
  await Promise.all([
    Review.deleteMany({ expedition: expedition._id }),
    User.updateMany(
      { favourites: expedition._id },
      { $pull: { favourites: expedition._id } },
    ),
    upload.discard([expedition.coverImage, ...(expedition.images || [])]),
  ]);

  res.status(204).send();
});

// Preset for the list handler: the five best-rated, cheapest first on ties.
exports.featuredPreset = (req, res, next) => {
  req.query.limit = '5';
  req.query.sort = '-ratingsAverage,price';
  req.query.fields =
    'name,slug,region,price,ratingsAverage,summary,difficulty,coverImage';
  next();
};

exports.getExpeditionBySlug = asyncHandler(async (req, res) => {
  const expedition = await Expedition.findOne({ slug: req.params.slug }).populate({
    path: 'reviews',
    select: 'review rating user createdAt',
    options: { sort: '-createdAt' },
  });

  if (!expedition) throw new ApiError(404, 'No expedition found with that name.');

  res.status(200).json({ status: 'success', data: expedition });
});

// Price and rating summary per difficulty level.
exports.getStats = asyncHandler(async (req, res) => {
  const stats = await Expedition.aggregate([
    {
      $group: {
        _id: '$difficulty',
        expeditions: { $sum: 1 },
        ratings: { $sum: '$ratingsQuantity' },
        avgRating: { $avg: '$ratingsAverage' },
        avgPrice: { $avg: '$price' },
        minPrice: { $min: '$price' },
        maxPrice: { $max: '$price' },
      },
    },
    {
      $project: {
        _id: 0,
        difficulty: '$_id',
        expeditions: 1,
        ratings: 1,
        avgRating: { $round: ['$avgRating', 2] },
        avgPrice: { $round: ['$avgPrice', 0] },
        minPrice: 1,
        maxPrice: 1,
      },
    },
    { $sort: { avgPrice: 1 } },
  ]);

  res.status(200).json({ status: 'success', data: stats });
});

// Departures per month for a given year, busiest month first. For guides.
exports.getSchedule = asyncHandler(async (req, res) => {
  const year = Number(req.params.year);
  if (!Number.isInteger(year)) throw new ApiError(400, 'Year must be a number.');

  const schedule = await Expedition.aggregate([
    { $unwind: '$departures' },
    {
      $match: {
        'departures.date': {
          $gte: new Date(Date.UTC(year, 0, 1)),
          $lt: new Date(Date.UTC(year + 1, 0, 1)),
        },
      },
    },
    {
      $group: {
        _id: { $month: '$departures.date' },
        departures: { $sum: 1 },
        travelers: { $sum: '$departures.participants' },
        expeditions: { $addToSet: '$name' },
      },
    },
    { $project: { _id: 0, month: '$_id', departures: 1, travelers: 1, expeditions: 1 } },
    { $sort: { departures: -1, month: 1 } },
  ]);

  res.status(200).json({ status: 'success', data: schedule });
});

// Expeditions whose starting point lies within `distance` of a position.
exports.getNearby = asyncHandler(async (req, res) => {
  const { lat, lng, unit } = parsePosition(req.query);
  const distance = Number(req.query.distance);

  if (!(distance > 0)) throw new ApiError(400, 'distance must be a positive number.');

  const expeditions = await Expedition.find({
    startLocation: {
      $geoWithin: { $centerSphere: [[lng, lat], distance / EARTH_RADIUS[unit]] },
    },
  });

  res.status(200).json({
    status: 'success',
    results: expeditions.length,
    data: expeditions,
  });
});

// Distance from a position to every starting point, nearest first.
exports.getDistances = asyncHandler(async (req, res) => {
  const { lat, lng, unit } = parsePosition(req.query);

  const distances = await Expedition.aggregate([
    {
      $geoNear: {
        near: { type: 'Point', coordinates: [lng, lat] },
        distanceField: 'distance',
        distanceMultiplier: METRES_TO[unit],
        spherical: true,
      },
    },
    {
      $project: {
        name: 1,
        slug: 1,
        region: 1,
        distance: { $round: ['$distance', 1] },
      },
    },
  ]);

  res.status(200).json({ status: 'success', unit, data: distances });
});
