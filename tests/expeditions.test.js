const request = require('supertest');
const app = require('../src/app');
const db = require('./helpers/db');
const { loginAs, createExpedition, expeditionData } = require('./helpers/factories');

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
