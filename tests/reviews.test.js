const request = require('supertest');
const app = require('../src/app');
const db = require('./helpers/db');
const Expedition = require('../src/models/expedition.model');
const { loginAs, createExpedition } = require('./helpers/factories');

beforeAll(db.connect);
afterEach(db.clear);
afterAll(db.disconnect);

const postReview = (expedition, auth, body) =>
  request(app).post(`/api/v1/expeditions/${expedition.id}/reviews`).set(auth).send(body);

describe('reviews', () => {
  it('recalculates the expedition rating on create, update and delete', async () => {
    const expedition = await createExpedition();
    const a = await loginAs();
    const b = await loginAs();

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
    const { auth } = await loginAs();

    await postReview(expedition, auth, { review: 'First', rating: 5 }).expect(201);
    const res = await postReview(expedition, auth, { review: 'Second', rating: 1 });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already reviewed/);
  });

  it('always attributes the review to the logged-in user', async () => {
    const expedition = await createExpedition();
    const author = await loginAs();
    const other = await loginAs();

    const res = await postReview(expedition, author.auth, {
      review: 'Mine',
      rating: 4,
      user: other.user.id,
    });

    expect(res.body.data.user).toBe(author.user.id);
  });

  it('stops travelers from changing reviews they did not write', async () => {
    const expedition = await createExpedition();
    const author = await loginAs();
    const other = await loginAs();
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
    const { auth } = await loginAs();

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
    const { auth } = await loginAs();

    await postReview(expedition, auth, { review: 'Off the scale', rating: 6 }).expect(
      400,
    );
  });
});
