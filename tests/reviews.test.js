const request = require('supertest');
const app = require('../src/app');
const db = require('./helpers/db');
const Expedition = require('../src/models/expedition.model');
const {
  loginAs,
  bookedTraveler,
  book,
  createUser,
  PASSWORD,
  createExpedition,
} = require('./helpers/factories');

beforeAll(db.connect);
afterEach(db.clear);
afterAll(db.disconnect);

const postReview = (expedition, auth, body) =>
  request(app).post(`/api/v1/expeditions/${expedition.id}/reviews`).set(auth).send(body);

describe('reviews', () => {
  it('recalculates the expedition rating on create, update and delete', async () => {
    const expedition = await createExpedition();
    const a = await bookedTraveler(expedition);
    const b = await bookedTraveler(expedition);

    const first = await postReview(expedition, a.auth, { review: 'Superb', rating: 5 });
    expect(first.status).toBe(201);
    await postReview(expedition, b.auth, { review: 'Good', rating: 4 }).expect(201);

    let fresh = await Expedition.findById(expedition.id);
    expect(fresh).toMatchObject({ ratingsQuantity: 2, ratingsAverage: 4.5 });

    await request(app)
      .patch(`/api/v1/reviews/${first.body.data._id}`)
      .set(a.auth)
      .send({ rating: 2 })
      .expect(200);
    fresh = await Expedition.findById(expedition.id);
    expect(fresh.ratingsAverage).toBe(3);

    await request(app)
      .delete(`/api/v1/reviews/${first.body.data._id}`)
      .set(a.auth)
      .expect(204);
    fresh = await Expedition.findById(expedition.id);
    expect(fresh).toMatchObject({ ratingsQuantity: 1, ratingsAverage: 4 });
  });

  it('allows one review per traveler per expedition', async () => {
    const expedition = await createExpedition();
    const { auth } = await bookedTraveler(expedition);

    await postReview(expedition, auth, { review: 'First', rating: 5 }).expect(201);
    const res = await postReview(expedition, auth, { review: 'Second', rating: 1 });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already reviewed/);
  });

  it('always attributes the review to the logged-in user', async () => {
    const expedition = await createExpedition();
    const author = await bookedTraveler(expedition);
    const other = await bookedTraveler(expedition);

    const res = await postReview(expedition, author.auth, {
      review: 'Mine',
      rating: 4,
      user: other.user.id,
    });

    expect(res.body.data.user).toBe(author.user.id);
  });

  it('stops travelers from changing reviews they did not write', async () => {
    const expedition = await createExpedition();
    const author = await bookedTraveler(expedition);
    const other = await bookedTraveler(expedition);
    const admin = await loginAs({ role: 'admin' });

    const { body } = await postReview(expedition, author.auth, {
      review: 'Mine',
      rating: 4,
    });
    const url = `/api/v1/reviews/${body.data._id}`;

    await request(app).patch(url).set(other.auth).send({ rating: 1 }).expect(403);
    await request(app).delete(url).set(other.auth).expect(403);
    await request(app).delete(url).set(admin.auth).expect(204);
  });

  it('does not let guides post reviews', async () => {
    const expedition = await createExpedition();
    const guide = await loginAs({ role: 'guide' });

    await postReview(expedition, guide.auth, { review: 'Great group', rating: 5 }).expect(
      403,
    );
  });

  it('lists reviews per expedition and per author', async () => {
    const one = await createExpedition();
    const two = await createExpedition();
    const { auth } = await bookedTraveler(one, two);

    await postReview(one, auth, { review: 'One', rating: 5 });
    await postReview(two, auth, { review: 'Two', rating: 3 });

    const nested = await request(app).get(`/api/v1/expeditions/${one.id}/reviews`);
    expect(nested.body.data.map((r) => r.review)).toEqual(['One']);

    const mine = await request(app).get('/api/v1/reviews/me').set(auth);
    expect(mine.body.results).toBe(2);
    expect(mine.body.data[0].expedition).toHaveProperty('slug');
  });

  it('validates the rating range', async () => {
    const expedition = await createExpedition();
    const { auth } = await bookedTraveler(expedition);

    await postReview(expedition, auth, { review: 'Off the scale', rating: 6 }).expect(
      400,
    );
  });

  it('only lets travelers review an expedition they have booked', async () => {
    const expedition = await createExpedition();
    const elsewhere = await createExpedition();
    const { auth } = await bookedTraveler(elsewhere);

    const res = await postReview(expedition, auth, { review: 'Never went', rating: 5 });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/booked/i);
  });

  it('does not count an unpaid booking', async () => {
    const expedition = await createExpedition();
    const { user, auth } = await loginAs();
    await book(user, expedition, { paid: false });

    await postReview(expedition, auth, { review: 'Not yet', rating: 5 }).expect(403);
  });

  it('asks for a confirmed email address first', async () => {
    const expedition = await createExpedition();
    const user = await createUser({ emailVerified: false });
    await book(user, expedition);
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: PASSWORD });

    const res = await postReview(
      expedition,
      { Authorization: `Bearer ${login.body.token}` },
      { review: 'Lovely', rating: 5 },
    );

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/confirm your email/i);
  });
});
