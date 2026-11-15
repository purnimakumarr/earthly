const Expedition = require('../models/expedition.model');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const crud = require('./crudFactory');

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
exports.createExpedition = crud.create(Expedition);
exports.updateExpedition = crud.update(Expedition);
exports.deleteExpedition = crud.remove(Expedition);

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
    { $unwind: '$startDates' },
    {
      $match: {
        startDates: {
          $gte: new Date(Date.UTC(year, 0, 1)),
          $lt: new Date(Date.UTC(year + 1, 0, 1)),
        },
      },
    },
    {
      $group: {
        _id: { $month: '$startDates' },
        departures: { $sum: 1 },
        expeditions: { $addToSet: '$name' },
      },
    },
    { $project: { _id: 0, month: '$_id', departures: 1, expeditions: 1 } },
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
