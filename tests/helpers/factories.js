const request = require('supertest');
const app = require('../../src/app');
const User = require('../../src/models/user.model');
const Expedition = require('../../src/models/expedition.model');

const PASSWORD = 'correct-horse-battery';
let counter = 0;

exports.PASSWORD = PASSWORD;

exports.createUser = async (overrides = {}) => {
  counter += 1;
  return User.create({
    name: `Test User ${counter}`,
    email: `user${counter}@example.com`,
    password: PASSWORD,
    passwordConfirm: PASSWORD,
    ...overrides,
  });
};

// Returns a user plus an Authorization header for them.
exports.loginAs = async (overrides = {}) => {
  const user = await exports.createUser(overrides);
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: user.email, password: PASSWORD });

  return {
    user,
    token: res.body.token,
    auth: { Authorization: `Bearer ${res.body.token}` },
  };
};

exports.expeditionData = (overrides = {}) => {
  counter += 1;
  return {
    name: `Test Expedition ${counter}`,
    region: 'Himachal Pradesh',
    duration: 6,
    maxGroupSize: 10,
    difficulty: 'moderate',
    price: 30000,
    summary: 'A short summary',
    description: 'A longer description',
    coverImage: '/img/expeditions/test-cover.jpg',
    startDates: ['2027-03-10T04:00:00.000Z', '2027-10-05T04:00:00.000Z'],
    // Kaza, Spiti
    startLocation: {
      type: 'Point',
      coordinates: [78.0722, 32.2276],
      description: 'Kaza',
    },
    ...overrides,
  };
};

exports.createExpedition = (overrides) =>
  Expedition.create(exports.expeditionData(overrides));
