const fs = require('fs');
const path = require('path');
const request = require('supertest');
const sharp = require('sharp');
const app = require('../src/app');
const db = require('./helpers/db');
const Expedition = require('../src/models/expedition.model');
const Booking = require('../src/models/booking.model');
const Review = require('../src/models/review.model');
const User = require('../src/models/user.model');
const { UPLOAD_ROOT } = require('../src/middleware/upload');
const {
  loginAs,
  createUser,
  createExpedition,
  expeditionData,
  book,
} = require('./helpers/factories');

beforeAll(db.connect);
afterEach(db.clear);
afterAll(db.disconnect);

const seedThree = () =>
  Promise.all([
    createExpedition({
      name: 'Spiti High Passes',
      difficulty: 'challenging',
      price: 52000,
      ratingsAverage: 4.9,
    }),
    createExpedition({
      name: 'Kaziranga Grasslands',
      difficulty: 'easy',
      price: 28000,
      ratingsAverage: 4.6,
      region: 'Assam',
      startLocation: { type: 'Point', coordinates: [93.1711, 26.5775] },
    }),
    createExpedition({
      name: 'Western Ghats Canopy',
      difficulty: 'easy',
      price: 24000,
      ratingsAverage: 4.2,
      region: 'Karnataka',
      startLocation: { type: 'Point', coordinates: [75.7382, 12.4244] },
    }),
  ]);

describe('GET /expeditions', () => {
  it('returns documents with paging metadata', async () => {
    await seedThree();
    const res = await request(app).get('/api/v1/expeditions');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'success', results: 3, total: 3, page: 1 });
    expect(res.body.data[0]).toHaveProperty('slug');
  });

  it('filters by equality and by range operators', async () => {
    await seedThree();

    const easy = await request(app).get('/api/v1/expeditions?difficulty=easy');
    expect(easy.body.data.map((e) => e.name).sort()).toEqual([
      'Kaziranga Grasslands',
      'Western Ghats Canopy',
    ]);

    const cheap = await request(app).get('/api/v1/expeditions?price[lt]=25000');
    expect(cheap.body.data).toHaveLength(1);
    expect(cheap.body.data[0].name).toBe('Western Ghats Canopy');
  });

  it('sorts, projects and paginates', async () => {
    await seedThree();
    const res = await request(app).get(
      '/api/v1/expeditions?sort=-price&fields=name,price&limit=2&page=2',
    );

    expect(res.body).toMatchObject({ results: 1, total: 3, page: 2 });
    expect(res.body.data[0].name).toBe('Western Ghats Canopy');
    expect(res.body.data[0].summary).toBeUndefined();
  });

  it('does not let query operators through as top-level keys', async () => {
    await seedThree();
    const res = await request(app).get('/api/v1/expeditions?$where=sleep(1000)');

    expect(res.status).toBe(200);
    expect(res.body.results).toBe(3);
  });

  it('hides unlisted expeditions from lists, counts and lookups', async () => {
    await seedThree();
    const hidden = await createExpedition({ name: 'Private Charter', unlisted: true });

    const list = await request(app).get('/api/v1/expeditions');
    expect(list.body.total).toBe(3);

    await request(app).get(`/api/v1/expeditions/${hidden.id}`).expect(404);
    await request(app).get(`/api/v1/expeditions/slug/${hidden.slug}`).expect(404);
  });
});

describe('single expedition', () => {
  it('is reachable by id and by slug', async () => {
    const expedition = await createExpedition({ name: 'Valley of Flowers' });
    expect(expedition.slug).toBe('valley-of-flowers');

    await request(app).get(`/api/v1/expeditions/${expedition.id}`).expect(200);
    const res = await request(app).get('/api/v1/expeditions/slug/valley-of-flowers');

    expect(res.status).toBe(200);
    expect(res.body.data.reviews).toEqual([]);
  });

  it('answers 400 for a malformed id and 404 for an unknown one', async () => {
    await request(app).get('/api/v1/expeditions/not-an-id').expect(400);
    await request(app).get('/api/v1/expeditions/64b000000000000000000000').expect(404);
  });
});

describe('named collections', () => {
  it('GET /featured returns at most five, best rated first', async () => {
    await seedThree();
    const res = await request(app).get('/api/v1/expeditions/featured');

    expect(res.status).toBe(200);
    expect(res.body.data.map((e) => e.ratingsAverage)).toEqual([4.9, 4.6, 4.2]);
    expect(res.body.data[0].description).toBeUndefined();
  });

  it('GET /stats groups by difficulty and skips unlisted', async () => {
    await seedThree();
    await createExpedition({
      name: 'Private Charter',
      difficulty: 'easy',
      price: 900000,
      unlisted: true,
    });

    const res = await request(app).get('/api/v1/expeditions/stats');
    const easy = res.body.data.find((row) => row.difficulty === 'easy');

    expect(easy).toMatchObject({
      expeditions: 2,
      minPrice: 24000,
      maxPrice: 28000,
      avgPrice: 26000,
    });
  });

  it('GET /nearby finds starting points inside the radius', async () => {
    await seedThree();
    // Guwahati, roughly 150 km from Kaziranga
    const res = await request(app).get(
      '/api/v1/expeditions/nearby?latlng=26.1445,91.7362&distance=250&unit=km',
    );

    expect(res.status).toBe(200);
    expect(res.body.data.map((e) => e.name)).toEqual(['Kaziranga Grasslands']);
  });

  it('GET /distances orders by distance and validates the position', async () => {
    await seedThree();

    const res = await request(app).get(
      '/api/v1/expeditions/distances?latlng=26.1445,91.7362',
    );
    expect(res.body.unit).toBe('km');
    expect(res.body.data[0].name).toBe('Kaziranga Grasslands');
    expect(res.body.data[0].distance).toBeGreaterThan(100);
    expect(res.body.data[0].distance).toBeLessThan(200);

    await request(app).get('/api/v1/expeditions/distances?latlng=abc').expect(400);
    await request(app).get('/api/v1/expeditions/nearby?latlng=26,91').expect(400);
  });

  it('GET /schedule/:year is for staff and counts departures per month', async () => {
    await seedThree();
    const traveler = await loginAs();
    const guide = await loginAs({ role: 'guide' });

    await request(app).get('/api/v1/expeditions/schedule/2027').expect(401);
    await request(app)
      .get('/api/v1/expeditions/schedule/2027')
      .set(traveler.auth)
      .expect(403);

    const res = await request(app)
      .get('/api/v1/expeditions/schedule/2027')
      .set(guide.auth);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ month: 3, departures: 3 })]),
    );
  });
});

describe('writes', () => {
  it('only lets leads and admins create', async () => {
    const traveler = await loginAs();
    const lead = await loginAs({ role: 'lead' });

    await request(app).post('/api/v1/expeditions').send(expeditionData()).expect(401);
    await request(app)
      .post('/api/v1/expeditions')
      .set(traveler.auth)
      .send(expeditionData())
      .expect(403);

    const res = await request(app)
      .post('/api/v1/expeditions')
      .set(lead.auth)
      .send(expeditionData({ name: 'Rann of Kutch Salt Flats' }));

    expect(res.status).toBe(201);
    expect(res.body.data.slug).toBe('rann-of-kutch-salt-flats');
  });

  it('validates input and reports every problem', async () => {
    const admin = await loginAs({ role: 'admin' });
    const res = await request(app)
      .post('/api/v1/expeditions')
      .set(admin.auth)
      .send(expeditionData({ difficulty: 'extreme', price: undefined }));

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Difficulty must be/);
    expect(res.body.message).toMatch(/Price is required/);
  });

  it('strips markup from text fields', async () => {
    const admin = await loginAs({ role: 'admin' });
    const res = await request(app)
      .post('/api/v1/expeditions')
      .set(admin.auth)
      .send(expeditionData({ summary: 'Calm <script>alert(1)</script>waters' }));

    expect(res.body.data.summary).toBe('Calm alert(1)waters');
  });

  it('updates and deletes', async () => {
    const admin = await loginAs({ role: 'admin' });
    const expedition = await createExpedition();

    const patched = await request(app)
      .patch(`/api/v1/expeditions/${expedition.id}`)
      .set(admin.auth)
      .send({ price: 31000 });
    expect(patched.body.data.price).toBe(31000);

    await request(app)
      .delete(`/api/v1/expeditions/${expedition.id}`)
      .set(admin.auth)
      .expect(204);
    await request(app).get(`/api/v1/expeditions/${expedition.id}`).expect(404);
  });
});

describe('editing as staff', () => {
  it('accepts nested fields as a JSON part and derives the slug', async () => {
    const admin = await loginAs({ role: 'admin' });
    const { coverImage, ...data } = expeditionData({ name: 'Monsoon in the Ghats' });
    expect(coverImage).toBeDefined();

    const res = await request(app)
      .post('/api/v1/expeditions')
      .set(admin.auth)
      .field('data', JSON.stringify({ ...data, coverImage: '/img/expeditions/x.jpg' }));

    expect(res.status).toBe(201);
    expect(res.body.data.slug).toBe('monsoon-in-the-ghats');
    expect(res.body.data.departures).toHaveLength(2);
    expect(res.body.data.departures[0]).toMatchObject({
      participants: 0,
      soldOut: false,
    });
  });

  it('strips query operators hidden in the JSON part', async () => {
    const admin = await loginAs({ role: 'admin' });
    const expedition = await createExpedition();

    const res = await request(app)
      .patch(`/api/v1/expeditions/${expedition.id}`)
      .set(admin.auth)
      .field('data', JSON.stringify({ $set: { price: 1 }, summary: 'Changed' }));

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ price: expedition.price, summary: 'Changed' });
  });

  it('reads only the id and date of a departure, never its seat count', async () => {
    const admin = await loginAs({ role: 'admin' });
    const expedition = await createExpedition({
      departures: [{ date: '2027-03-10T04:00:00.000Z', participants: 3 }],
    });
    const [existing] = expedition.departures;

    const res = await request(app)
      .patch(`/api/v1/expeditions/${expedition.id}`)
      .set(admin.auth)
      .send({
        departures: [
          // What a stale editor would send back: an old count and flag.
          {
            _id: existing.id,
            date: '2027-03-12T04:00:00.000Z',
            participants: 0,
            soldOut: true,
          },
          { date: '2027-11-01T04:00:00.000Z', participants: 9, soldOut: true },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.data.departures).toHaveLength(2);
    expect(res.body.data.departures[0]).toMatchObject({
      _id: existing.id,
      date: '2027-03-12T04:00:00.000Z',
      participants: 3,
      soldOut: false,
    });
    expect(res.body.data.departures[1]).toMatchObject({
      participants: 0,
      soldOut: false,
    });
  });

  it('ignores loose multipart fields that are not on the allow-list', async () => {
    const lead = await loginAs({ role: 'lead' });
    const expedition = await createExpedition({
      departures: [{ date: '2027-03-10T04:00:00.000Z', participants: 3 }],
    });

    const res = await request(app)
      .patch(`/api/v1/expeditions/${expedition.id}`)
      .set(lead.auth)
      .field('departures.0.participants', '0')
      .field('$inc[price]', '5')
      .field('ratingsAverage', '5')
      .field('slug', 'hijacked')
      .field('summary', 'Changed');

    expect(res.status).toBe(200);
    const stored = await Expedition.findById(expedition.id);
    expect(stored.departures[0].participants).toBe(3);
    expect(stored).toMatchObject({
      price: expedition.price,
      ratingsAverage: expedition.ratingsAverage,
      slug: expedition.slug,
      summary: 'Changed',
    });
  });

  it('moves the people booked on a departure along with its date', async () => {
    const admin = await loginAs({ role: 'admin' });
    const traveler = await createUser();
    const expedition = await createExpedition();
    const [first, second] = expedition.departures;
    await book(traveler, expedition, { departure: first.id, departureDate: first.date });

    await request(app)
      .patch(`/api/v1/expeditions/${expedition.id}`)
      .set(admin.auth)
      .send({
        departures: [
          { _id: first.id, date: '2027-04-20T04:00:00.000Z' },
          { _id: second.id, date: second.date },
        ],
      })
      .expect(200);

    const booking = await Booking.findOne({ user: traveler.id });
    expect(booking.departureDate.toISOString()).toBe('2027-04-20T04:00:00.000Z');
  });

  it('refuses a group size below the number already booked', async () => {
    const admin = await loginAs({ role: 'admin' });
    const expedition = await createExpedition({
      maxGroupSize: 10,
      departures: [{ date: '2027-03-10T04:00:00.000Z', participants: 4 }],
    });

    const res = await request(app)
      .patch(`/api/v1/expeditions/${expedition.id}`)
      .set(admin.auth)
      .send({ maxGroupSize: 3 });

    expect(res.status).toBe(409);
    expect((await Expedition.findById(expedition.id)).maxGroupSize).toBe(10);
  });

  it('deletes an uploaded cover once it has been replaced', async () => {
    const admin = await loginAs({ role: 'admin' });
    const expedition = await createExpedition();
    const image = await sharp({
      create: { width: 8, height: 8, channels: 3, background: '#5d7a4f' },
    })
      .png()
      .toBuffer();
    const onDisk = (url) => path.join(UPLOAD_ROOT, url.replace('/uploads/', ''));
    const uploadCover = async () => {
      const res = await request(app)
        .patch(`/api/v1/expeditions/${expedition.id}`)
        .set(admin.auth)
        .attach('coverImage', image, 'cover.png');
      expect(res.status).toBe(200);
      return res.body.data.coverImage;
    };

    const first = await uploadCover();
    expect(fs.existsSync(onDisk(first))).toBe(true);

    const second = await uploadCover();
    try {
      expect(second).not.toBe(first);
      expect(fs.existsSync(onDisk(first))).toBe(false);
      expect(fs.existsSync(onDisk(second))).toBe(true);
    } finally {
      fs.rmSync(onDisk(second), { force: true });
    }
  });

  it('does not delete an expedition that has bookings', async () => {
    const admin = await loginAs({ role: 'admin' });
    const expedition = await createExpedition();
    await book(await createUser(), expedition);

    const res = await request(app)
      .delete(`/api/v1/expeditions/${expedition.id}`)
      .set(admin.auth);

    expect(res.status).toBe(409);
    expect(await Expedition.findById(expedition.id)).not.toBeNull();
  });

  it('takes reviews and favourites with it when an expedition is deleted', async () => {
    const admin = await loginAs({ role: 'admin' });
    const [gone, kept] = [await createExpedition(), await createExpedition()];
    const fan = await createUser({ favourites: [gone.id, kept.id] });
    await Review.create({
      review: 'Lovely',
      rating: 5,
      expedition: gone.id,
      user: fan.id,
    });

    await request(app)
      .delete(`/api/v1/expeditions/${gone.id}`)
      .set(admin.auth)
      .expect(204);

    expect(await Review.countDocuments()).toBe(0);
    expect((await User.findById(fan.id)).favourites.map(String)).toEqual([kept.id]);
  });

  it('starts new expeditions with empty departures whatever is sent', async () => {
    const admin = await loginAs({ role: 'admin' });

    const res = await request(app)
      .post('/api/v1/expeditions')
      .set(admin.auth)
      .send(
        expeditionData({
          departures: [
            { date: '2027-03-10T04:00:00.000Z', participants: 7, soldOut: true },
          ],
        }),
      );

    expect(res.status).toBe(201);
    expect(res.body.data.departures[0]).toMatchObject({
      participants: 0,
      soldOut: false,
    });
  });

  it('removes a departure only while nobody is booked on it', async () => {
    const admin = await loginAs({ role: 'admin' });
    const expedition = await createExpedition({
      departures: [
        { date: '2027-03-10T04:00:00.000Z', participants: 2 },
        { date: '2027-10-05T04:00:00.000Z' },
      ],
    });
    const patch = (departures) =>
      request(app)
        .patch(`/api/v1/expeditions/${expedition.id}`)
        .set(admin.auth)
        .send({ departures, price: 99 });

    const refused = await patch([]);
    expect(refused.status).toBe(409);
    // A refused request changes nothing, including the other fields.
    const untouched = await Expedition.findById(expedition.id);
    expect(untouched.departures).toHaveLength(2);
    expect(untouched.price).toBe(expedition.price);

    const allowed = await patch([
      { _id: expedition.departures[0].id, date: '2027-03-10T04:00:00.000Z' },
    ]);
    expect(allowed.status).toBe(200);
    expect(allowed.body.data.departures).toHaveLength(1);
    expect(allowed.body.data.departures[0].participants).toBe(2);
  });

  it('works out sold out again when the group size changes', async () => {
    const admin = await loginAs({ role: 'admin' });
    const expedition = await createExpedition({
      maxGroupSize: 10,
      departures: [{ date: '2027-03-10T04:00:00.000Z', participants: 2 }],
    });
    const resize = (maxGroupSize) =>
      request(app)
        .patch(`/api/v1/expeditions/${expedition.id}`)
        .set(admin.auth)
        .send({ maxGroupSize });

    expect((await resize(2)).body.data.departures[0].soldOut).toBe(true);
    expect((await resize(6)).body.data.departures[0].soldOut).toBe(false);
  });

  it('refuses an id that is not an id before writing any image', async () => {
    const admin = await loginAs({ role: 'admin' });

    const res = await request(app)
      .patch('/api/v1/expeditions/..%2F..%2Fescape')
      .set(admin.auth)
      .field('data', JSON.stringify({ summary: 'x' }));

    expect(res.status).toBe(400);
  });

  it('answers 400 when the JSON part is not an object', async () => {
    const admin = await loginAs({ role: 'admin' });
    const expedition = await createExpedition();

    for (const data of ['null', '42', '[]']) {
      const res = await request(app)
        .patch(`/api/v1/expeditions/${expedition.id}`)
        .set(admin.auth)
        .field('data', data);
      expect(res.status).toBe(400);
    }
  });

  it('keeps the slug in step when an expedition is renamed', async () => {
    const admin = await loginAs({ role: 'admin' });
    const expedition = await createExpedition();

    const res = await request(app)
      .patch(`/api/v1/expeditions/${expedition.id}`)
      .set(admin.auth)
      .send({ name: 'A Completely New Name' });

    expect(res.body.data.slug).toBe('a-completely-new-name');
  });
});
