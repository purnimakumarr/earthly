/**
 * Loads demo data.
 *
 *   npm run seed          add the data to an empty database
 *   npm run seed:reset    wipe users, sessions, expeditions, reviews and bookings first
 *
 * Records refer to each other by email and by a short key rather than by
 * ObjectId, so the JSON files stay readable and ids are generated on insert.
 */
const mongoose = require('mongoose');
const config = require('../src/config');
const User = require('../src/models/user.model');
const Expedition = require('../src/models/expedition.model');
const Review = require('../src/models/review.model');
const Booking = require('../src/models/booking.model');
const RefreshToken = require('../src/models/refreshToken.model');

const users = require('./data/users.json');
const expeditions = require('./data/expeditions.json');
const reviews = require('./data/reviews.json');

const DEMO_PASSWORD = process.env.SEED_PASSWORD || 'earthly-demo-2026';
const reset = process.argv.includes('--reset');

const imagesFor = (key) => ({
  coverImage: `/img/expeditions/${key}-cover.jpg`,
  images: [1, 2, 3].map((n) => `/img/expeditions/${key}-${n}.jpg`),
});

const run = async () => {
  await mongoose.connect(config.mongo.uri, { dbName: config.mongo.dbName });
  console.log(`Connected to database "${config.mongo.dbName}"`);

  if (reset) {
    await Promise.all(
      [User, RefreshToken, Expedition, Review, Booking].map((M) => M.deleteMany({})),
    );
    console.log('Cleared existing data');
  } else if (await Expedition.estimatedDocumentCount()) {
    console.log(
      'Database already has expeditions. Use "npm run seed:reset" to replace them.',
    );
    return;
  }

  const userDocs = await User.create(
    users.map((user) => ({
      ...user,
      emailVerified: true,
      password: DEMO_PASSWORD,
      passwordConfirm: DEMO_PASSWORD,
    })),
  );
  const userIdByEmail = new Map(userDocs.map((u) => [u.email, u._id]));

  const expeditionDocs = await Expedition.create(
    expeditions.map(({ key, guides, ...fields }) => ({
      ...fields,
      ...imagesFor(key),
      guides: guides.map((email) => userIdByEmail.get(email)),
    })),
  );
  const expeditionIdByKey = new Map(
    expeditions.map(({ key }, i) => [key, expeditionDocs[i]._id]),
  );

  // insertMany skips the post-save hook, so ratings are refreshed once per
  // expedition afterwards instead of once per review.
  const start = Date.UTC(2026, 2, 1);
  await Review.insertMany(
    reviews.map((review, i) => ({
      review: review.review,
      rating: review.rating,
      expedition: expeditionIdByKey.get(review.expedition),
      user: userIdByEmail.get(`${review.user}@example.com`),
      createdAt: new Date(start + i * 4 * 24 * 60 * 60 * 1000),
    })),
  );
  await Promise.all(expeditionDocs.map((doc) => Review.refreshRatings(doc._id)));

  // Every reviewer holds a paid booking (reviews require one), spread across
  // the departures so the seat counts look lived-in.
  const expeditionByKey = new Map(
    expeditions.map(({ key }, i) => [key, expeditionDocs[i]]),
  );
  const bookings = reviews.map((review, i) => {
    const expedition = expeditionByKey.get(review.expedition);
    const departure = expedition.departures[i % expedition.departures.length];
    departure.participants += 1;
    departure.soldOut = departure.participants >= expedition.maxGroupSize;

    return {
      expedition: expedition._id,
      user: userIdByEmail.get(`${review.user}@example.com`),
      departure: departure._id,
      departureDate: departure.date,
      seated: true,
      price: expedition.price,
      createdAt: new Date(start + (i * 4 - 20) * 24 * 60 * 60 * 1000),
    };
  });
  await Booking.insertMany(bookings);
  await Promise.all(expeditionDocs.map((doc) => doc.save()));

  console.log(
    `Seeded ${userDocs.length} users, ${expeditionDocs.length} expeditions, ${reviews.length} reviews and bookings`,
  );
  console.log(`Every demo account uses the password: ${DEMO_PASSWORD}`);
};

run()
  .catch((err) => {
    console.error('Seeding failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
