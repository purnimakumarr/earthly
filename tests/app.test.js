const request = require('supertest');
const app = require('../src/app');
const db = require('./helpers/db');

beforeAll(db.connect);
afterAll(db.disconnect);

describe('app', () => {
  it('reports health', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', db: true });
  });

  it('answers unknown API routes with a JSON 404', async () => {
    const res = await request(app).get('/api/v1/nowhere');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      status: 'fail',
      message: 'No route for GET /api/v1/nowhere',
    });
  });

  it('answers malformed JSON with 400', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email":');
    expect(res.status).toBe(400);
  });

  it('rejects oversized bodies', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'a@example.com', password: 'x'.repeat(20_000) });
    expect(res.status).toBe(413);
  });

  it('sets security headers', async () => {
    const res = await request(app).get('/healthz');
    expect(res.headers['content-security-policy']).toMatch(/default-src 'self'/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
