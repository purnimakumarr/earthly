const request = require('supertest');
const app = require('../src/app');
const db = require('./helpers/db');
const User = require('../src/models/user.model');
const mailer = require('../src/utils/mailer');
const { createUser, loginAs, PASSWORD } = require('./helpers/factories');

beforeAll(db.connect);
afterEach(db.clear);
afterAll(db.disconnect);

const signupBody = (overrides = {}) => ({
  name: 'Asha Rao',
  email: 'asha@example.com',
  password: PASSWORD,
  passwordConfirm: PASSWORD,
  ...overrides,
});

describe('POST /auth/signup', () => {
  it('creates a traveler, sets an httpOnly cookie and hides the password', async () => {
    const res = await request(app).post('/api/v1/auth/signup').send(signupBody());

    expect(res.status).toBe(201);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.data).toMatchObject({ email: 'asha@example.com', role: 'traveler' });
    expect(res.body.data.password).toBeUndefined();

    const cookie = res.headers['set-cookie'][0];
    expect(cookie).toMatch(/^session=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);

    const stored = await User.findOne({ email: 'asha@example.com' }).select('+password');
    expect(stored.password).not.toBe(PASSWORD);
  });

  it('ignores a role sent by the client', async () => {
    const res = await request(app)
      .post('/api/v1/auth/signup')
      .send(signupBody({ role: 'admin' }));

    expect(res.status).toBe(201);
    expect(res.body.data.role).toBe('traveler');
  });

  it('rejects mismatched passwords', async () => {
    const res = await request(app)
      .post('/api/v1/auth/signup')
      .send(signupBody({ passwordConfirm: 'something-else' }));

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/do not match/i);
  });

  it('rejects a duplicate email with 409', async () => {
    await request(app).post('/api/v1/auth/signup').send(signupBody());
    const res = await request(app).post('/api/v1/auth/signup').send(signupBody());

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/email/);
  });
});

describe('POST /auth/login', () => {
  it('gives the same 401 for a wrong password and an unknown email', async () => {
    const user = await createUser();

    const wrong = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'not-the-password' });
    const unknown = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.com', password: PASSWORD });

    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.message).toBe(unknown.body.message);
  });

  it('rejects operator objects in place of credentials', async () => {
    await createUser();

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: { $gt: '' }, password: { $gt: '' } });

    expect(res.status).toBe(400);
  });
});

describe('protected routes', () => {
  it('rejects requests without a session', async () => {
    const res = await request(app).get('/api/v1/users/me');
    expect(res.status).toBe(401);
  });

  it('accepts a bearer token', async () => {
    const { user, auth } = await loginAs();
    const res = await request(app).get('/api/v1/users/me').set(auth);

    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe(user.email);
  });

  it('accepts the session cookie', async () => {
    const agent = request.agent(app);
    const user = await createUser();
    await agent
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: PASSWORD });

    const res = await agent.get('/api/v1/users/me');
    expect(res.status).toBe(200);
  });

  it('rejects a tampered token', async () => {
    const { token } = await loginAs();
    const res = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${token.slice(0, -2)}xx`);

    expect(res.status).toBe(401);
  });

  it('rejects a token issued before the password was changed', async () => {
    const { user, auth } = await loginAs();

    const account = await User.findById(user.id);
    account.passwordChangedAt = new Date(Date.now() + 60_000);
    await account.save({ validateBeforeSave: false });

    const res = await request(app).get('/api/v1/users/me').set(auth);
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/password was changed/i);
  });

  it('rejects the token of a deactivated account', async () => {
    const { auth } = await loginAs();
    await request(app).delete('/api/v1/users/me').set(auth).expect(204);

    const res = await request(app).get('/api/v1/users/me').set(auth);
    expect(res.status).toBe(401);
  });

  it('keeps non-admins out of user administration', async () => {
    const { auth } = await loginAs({ role: 'guide' });
    const res = await request(app).get('/api/v1/users').set(auth);
    expect(res.status).toBe(403);
  });
});

describe('PATCH /users/me/password', () => {
  it('requires the current password', async () => {
    const { auth } = await loginAs();
    const res = await request(app).patch('/api/v1/users/me/password').set(auth).send({
      passwordCurrent: 'wrong',
      password: 'new-password-1',
      passwordConfirm: 'new-password-1',
    });

    // 403, not 401: the session itself is fine.
    expect(res.status).toBe(403);
  });

  it('changes the password and lets the user log in with it', async () => {
    const { user, auth } = await loginAs();

    await request(app)
      .patch('/api/v1/users/me/password')
      .set(auth)
      .send({
        passwordCurrent: PASSWORD,
        password: 'new-password-1',
        passwordConfirm: 'new-password-1',
      })
      .expect(200);

    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'new-password-1' })
      .expect(200);
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: PASSWORD })
      .expect(401);
  });
});

describe('PATCH /users/me', () => {
  it('updates the name but never the role', async () => {
    const { auth } = await loginAs();
    const res = await request(app)
      .patch('/api/v1/users/me')
      .set(auth)
      .send({ name: 'New Name', role: 'admin' });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: 'New Name', role: 'traveler' });
  });

  it('runs validators on update', async () => {
    const { auth } = await loginAs();
    const res = await request(app)
      .patch('/api/v1/users/me')
      .set(auth)
      .send({ email: 'not-an-email', passwordCurrent: PASSWORD });

    expect(res.status).toBe(400);
  });
});

describe('password reset', () => {
  afterEach(() => jest.restoreAllMocks());

  it('answers 200 for unknown addresses without sending mail', async () => {
    const send = jest.spyOn(mailer, 'sendPasswordReset');
    const res = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'nobody@example.com' });

    expect(res.status).toBe(200);
    expect(send).not.toHaveBeenCalled();
  });

  it('emails a single-use link that sets a new password', async () => {
    const send = jest.spyOn(mailer, 'sendPasswordReset').mockResolvedValue();
    const user = await createUser();

    await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: user.email })
      .expect(200);

    const url = send.mock.calls[0][1];
    expect(url).toMatch(/^http:\/\/localhost:5173\/reset-password\/[0-9a-f]{64}$/);
    const token = url.split('/').pop();

    // Only a hash of the token is stored.
    const stored = await User.findById(user.id);
    expect(stored.passwordResetToken).not.toBe(token);

    const body = { password: 'brand-new-pass', passwordConfirm: 'brand-new-pass' };
    await request(app)
      .patch(`/api/v1/auth/reset-password/${token}`)
      .send(body)
      .expect(200);
    await request(app)
      .patch(`/api/v1/auth/reset-password/${token}`)
      .send(body)
      .expect(400);

    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'brand-new-pass' })
      .expect(200);
  });

  it('rejects an expired link', async () => {
    const send = jest.spyOn(mailer, 'sendPasswordReset').mockResolvedValue();
    const user = await createUser();
    await request(app).post('/api/v1/auth/forgot-password').send({ email: user.email });
    const token = send.mock.calls[0][1].split('/').pop();

    await User.updateOne({ _id: user.id }, { passwordResetExpires: Date.now() - 1000 });

    const res = await request(app)
      .patch(`/api/v1/auth/reset-password/${token}`)
      .send({ password: 'brand-new-pass', passwordConfirm: 'brand-new-pass' });
    expect(res.status).toBe(400);
  });

  it('clears the token when the email cannot be sent', async () => {
    jest.spyOn(mailer, 'sendPasswordReset').mockRejectedValue(new Error('smtp down'));
    const user = await createUser();

    const res = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: user.email });

    expect(res.status).toBe(502);
    const stored = await User.findById(user.id);
    expect(stored.passwordResetToken).toBeUndefined();
  });
});
