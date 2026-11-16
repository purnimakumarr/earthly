const request = require('supertest');
const { authenticator } = require('otplib');
const app = require('../src/app');
const db = require('./helpers/db');
const User = require('../src/models/user.model');
const RefreshToken = require('../src/models/refreshToken.model');
const mailer = require('../src/utils/mailer');
const {
  createUser,
  createExpedition,
  loginAs,
  book,
  PASSWORD,
} = require('./helpers/factories');

beforeAll(db.connect);
afterEach(async () => {
  jest.restoreAllMocks();
  await db.clear();
});
afterAll(db.disconnect);

const api = (path) => `/api/v1${path}`;
const login = (email, password = PASSWORD) =>
  request(app).post(api('/auth/login')).send({ email, password });
const refresh = (refreshToken) =>
  request(app).post(api('/auth/refresh')).send({ refreshToken });
const me = (token) =>
  request(app).get(api('/users/me')).set('Authorization', `Bearer ${token}`);

describe('refresh tokens', () => {
  it('sets a refresh cookie that is only sent to the auth endpoints', async () => {
    const user = await createUser();
    const res = await login(user.email);

    const cookie = res.headers['set-cookie'].find((c) => c.startsWith('refresh='));
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
    expect(cookie).toMatch(/SameSite=Lax/);
  });

  it('stores only a hash of the token', async () => {
    const user = await createUser();
    const res = await login(user.email);

    const [stored] = await RefreshToken.find();
    expect(stored.tokenHash).not.toBe(res.body.refreshToken);
    expect(stored.tokenHash).toHaveLength(64);
  });

  it('swaps a refresh token for a new session, from the body or the cookie', async () => {
    const user = await createUser();
    const first = await login(user.email);

    const second = await refresh(first.body.refreshToken);
    expect(second.status).toBe(200);
    expect(second.body.refreshToken).not.toBe(first.body.refreshToken);
    await me(second.body.token).expect(200);

    const third = await request(app)
      .post(api('/auth/refresh'))
      .set('Cookie', `refresh=${second.body.refreshToken}`);
    expect(third.status).toBe(200);
  });

  it('keeps the tokens out of the body when the refresh came by cookie', async () => {
    const user = await createUser();
    const first = await login(user.email);

    const res = await request(app)
      .post(api('/auth/refresh'))
      .set('Cookie', `refresh=${first.body.refreshToken}`);

    expect(res.status).toBe(200);
    expect(res.body.token).toBeUndefined();
    expect(res.body.refreshToken).toBeUndefined();
    expect(res.body.data.email).toBe(user.email);
    const cookies = res.headers['set-cookie'].join(';');
    expect(cookies).toMatch(/session=/);
    expect(cookies).toMatch(/refresh=/);
  });

  it('revokes the whole chain when a used token is presented again', async () => {
    const user = await createUser();
    const first = await login(user.email);
    const second = await refresh(first.body.refreshToken);

    // Once the short grace period for parallel tabs has passed...
    await RefreshToken.updateMany(
      { rotated: true },
      { revokedAt: new Date(Date.now() - 60 * 1000) },
    );

    // ...a replay of the first token looks like theft.
    await refresh(first.body.refreshToken).expect(401);
    // The legitimate successor is dead too.
    await refresh(second.body.refreshToken).expect(401);
  });

  it('lets two tabs refresh with the same token at the same moment', async () => {
    const user = await createUser();
    const { body } = await login(user.email);

    const results = await Promise.all([
      refresh(body.refreshToken),
      refresh(body.refreshToken),
    ]);

    expect(results.map((r) => r.status)).toEqual([200, 200]);
    // Neither tab was treated as a thief: both sessions carry on.
    await refresh(results[0].body.refreshToken).expect(200);
    await refresh(results[1].body.refreshToken).expect(200);
  });

  it('gives no grace to a rotated token once the session is logged out', async () => {
    const user = await createUser();
    const first = await login(user.email);
    const second = await refresh(first.body.refreshToken);

    await request(app)
      .post(api('/auth/logout'))
      .send({ refreshToken: second.body.refreshToken })
      .expect(200);

    await refresh(first.body.refreshToken).expect(401);
  });

  it('rejects unknown, missing and expired tokens', async () => {
    const user = await createUser();
    const { body } = await login(user.email);

    await refresh('not-a-real-token').expect(401);
    await request(app).post(api('/auth/refresh')).expect(401);

    await RefreshToken.updateMany({}, { expiresAt: new Date(Date.now() - 1000) });
    await refresh(body.refreshToken).expect(401);
  });

  it('ends the session on logout', async () => {
    const user = await createUser();
    const { body } = await login(user.email);

    await request(app)
      .post(api('/auth/logout'))
      .send({ refreshToken: body.refreshToken })
      .expect(200);

    await refresh(body.refreshToken).expect(401);
  });

  it('signs other devices out when the password changes', async () => {
    const user = await createUser();
    const laptop = await login(user.email);
    const phone = await login(user.email);

    const changed = await request(app)
      .patch(api('/users/me/password'))
      .set('Authorization', `Bearer ${laptop.body.token}`)
      .send({
        passwordCurrent: PASSWORD,
        password: 'a-brand-new-password',
        passwordConfirm: 'a-brand-new-password',
      });

    expect(changed.status).toBe(200);
    await refresh(phone.body.refreshToken).expect(401);
    await refresh(changed.body.refreshToken).expect(200);
  });
});

describe('email confirmation', () => {
  const signup = () =>
    request(app).post(api('/auth/signup')).send({
      name: 'Asha Rao',
      email: 'asha@example.com',
      password: PASSWORD,
      passwordConfirm: PASSWORD,
    });

  it('signs up unconfirmed and emails a single-use link', async () => {
    const send = jest.spyOn(mailer, 'sendVerification').mockResolvedValue();

    const res = await signup();
    expect(res.status).toBe(201);
    expect(res.body.data.emailVerified).toBe(false);
    expect(res.body.data.emailVerifyToken).toBeUndefined();

    const url = send.mock.calls[0][1];
    expect(url).toMatch(/^http:\/\/localhost:5173\/verify-email\/[0-9a-f]{64}$/);
    const token = url.split('/').pop();

    const confirmed = await request(app).post(api(`/auth/verify-email/${token}`));
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data.emailVerified).toBe(true);

    await request(app)
      .post(api(`/auth/verify-email/${token}`))
      .expect(400);
  });

  it('still creates the account when the email cannot be sent', async () => {
    jest.spyOn(mailer, 'sendVerification').mockRejectedValue(new Error('smtp down'));
    await signup().expect(201);
  });

  it('rejects an expired or made-up link', async () => {
    const send = jest.spyOn(mailer, 'sendVerification').mockResolvedValue();
    await signup();
    const token = send.mock.calls[0][1].split('/').pop();

    await request(app)
      .post(api(`/auth/verify-email/${'0'.repeat(64)}`))
      .expect(400);

    await User.updateOne(
      { email: 'asha@example.com' },
      { emailVerifyExpires: Date.now() - 1000 },
    );
    await request(app)
      .post(api(`/auth/verify-email/${token}`))
      .expect(400);
  });

  it('sends a fresh link on request, and replaces the old one', async () => {
    const send = jest.spyOn(mailer, 'sendVerification').mockResolvedValue();
    const { body } = await signup();
    const auth = { Authorization: `Bearer ${body.token}` };

    await request(app).post(api('/auth/resend-verification')).set(auth).expect(200);
    expect(send).toHaveBeenCalledTimes(2);

    const [oldToken, newToken] = send.mock.calls.map((call) => call[1].split('/').pop());
    await request(app)
      .post(api(`/auth/verify-email/${oldToken}`))
      .expect(400);
    await request(app)
      .post(api(`/auth/verify-email/${newToken}`))
      .expect(200);

    await request(app).post(api('/auth/resend-verification')).set(auth).expect(409);
  });

  it('asks for confirmation again when the address changes', async () => {
    const send = jest.spyOn(mailer, 'sendVerification').mockResolvedValue();
    const { auth } = await loginAs();

    const res = await request(app)
      .patch(api('/users/me'))
      .set(auth)
      .send({ email: 'new-address@example.com', passwordCurrent: PASSWORD });

    expect(res.body.data.emailVerified).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('needs the current password to change the address, and tells the old one', async () => {
    jest.spyOn(mailer, 'sendVerification').mockResolvedValue();
    const notice = jest.spyOn(mailer, 'sendEmailChanged').mockResolvedValue();
    const { user, auth } = await loginAs();
    const change = (body) => request(app).patch(api('/users/me')).set(auth).send(body);

    await change({ email: 'new-address@example.com' }).expect(403);
    await change({ email: 'new-address@example.com', passwordCurrent: 'wrong' }).expect(
      403,
    );
    expect((await User.findById(user.id)).email).toBe(user.email);

    // Other details, or the same address again, need no password.
    await change({ name: 'Renamed Person', email: user.email.toUpperCase() }).expect(200);
    expect(notice).not.toHaveBeenCalled();

    await change({ email: 'new-address@example.com', passwordCurrent: PASSWORD }).expect(
      200,
    );
    expect(notice).toHaveBeenCalledTimes(1);
    expect(notice.mock.calls[0][0].email).toBe('new-address@example.com');
    expect(notice.mock.calls[0][1]).toBe(user.email);
  });

  it('never takes the photo path from the request', async () => {
    const { user, auth } = await loginAs();

    await request(app)
      .patch(api('/users/me'))
      .set(auth)
      .send({ photo: 'https://elsewhere.example/pixel.png' })
      .expect(200);
    await request(app)
      .patch(api('/users/me'))
      .set(auth)
      .field('photo', '/uploads/users/someone-else.jpeg')
      .expect(200);

    expect((await User.findById(user.id)).photo).toBe(user.photo);
  });

  it('does not let an old reset link confirm a new address', async () => {
    jest.spyOn(mailer, 'sendVerification').mockResolvedValue();
    const reset = jest.spyOn(mailer, 'sendPasswordReset').mockResolvedValue();
    const { user, auth } = await loginAs();

    await request(app).post(api('/auth/forgot-password')).send({ email: user.email });
    const token = reset.mock.calls[0][1].split('/').pop();

    await request(app)
      .patch(api('/users/me'))
      .set(auth)
      .send({ email: 'someone-else@example.com', passwordCurrent: PASSWORD })
      .expect(200);

    await request(app)
      .patch(api(`/auth/reset-password/${token}`))
      .send({ password: 'a-brand-new-password', passwordConfirm: 'a-brand-new-password' })
      .expect(400);

    expect((await User.findById(user.id)).emailVerified).toBe(false);
  });
});

describe('two-factor authentication', () => {
  // Walks through setup and returns what a user would have afterwards.
  const enableFor = async (auth) => {
    const setup = await request(app).post(api('/auth/2fa/setup')).set(auth);
    const { secret } = setup.body.data;

    const enabled = await request(app)
      .post(api('/auth/2fa/enable'))
      .set(auth)
      .send({ code: authenticator.generate(secret) });

    return { secret, setup, enabled, recoveryCodes: enabled.body.data?.recoveryCodes };
  };

  it('sets up with a QR code and hands out recovery codes once', async () => {
    const { user, auth } = await loginAs();
    const { setup, enabled, recoveryCodes, secret } = await enableFor(auth);

    expect(setup.body.data.otpauthUrl).toMatch(/^otpauth:\/\/totp\/Earthly/);
    expect(setup.body.data.qr).toMatch(/^data:image\/png;base64,/);
    expect(enabled.status).toBe(200);
    expect(recoveryCodes).toHaveLength(8);

    const stored = await User.findById(user.id).select(
      '+twoFactorSecret +twoFactorRecoveryCodes',
    );
    expect(stored.twoFactorEnabled).toBe(true);
    // Neither the seed nor the recovery codes are stored in the clear.
    expect(stored.twoFactorSecret).not.toContain(secret);
    expect(stored.twoFactorRecoveryCodes).not.toContain(recoveryCodes[0]);

    const profile = await request(app).get(api('/users/me')).set(auth);
    expect(profile.body.data.twoFactorEnabled).toBe(true);
    expect(profile.body.data.twoFactorSecret).toBeUndefined();
  });

  it('does not switch on until a correct code is given', async () => {
    const { user, auth } = await loginAs();
    await request(app).post(api('/auth/2fa/setup')).set(auth);

    await request(app)
      .post(api('/auth/2fa/enable'))
      .set(auth)
      .send({ code: '000000' })
      .expect(400);

    expect((await User.findById(user.id)).twoFactorEnabled).toBe(false);
    expect((await login(user.email)).body.token).toEqual(expect.any(String));
  });

  it('asks for a code at login and starts no session before it', async () => {
    const { user, auth } = await loginAs();
    const { secret } = await enableFor(auth);

    const step1 = await login(user.email);
    expect(step1.status).toBe(200);
    expect(step1.body.twoFactorRequired).toBe(true);
    expect(step1.body.token).toBeUndefined();
    expect(step1.headers['set-cookie']).toBeUndefined();

    // The challenge token is not a session.
    await me(step1.body.challengeToken).expect(401);

    await request(app)
      .post(api('/auth/2fa/verify'))
      .send({ challengeToken: step1.body.challengeToken, code: '000000' })
      .expect(401);

    const step2 = await request(app)
      .post(api('/auth/2fa/verify'))
      .send({
        challengeToken: step1.body.challengeToken,
        code: authenticator.generate(secret),
      });
    expect(step2.status).toBe(200);
    await me(step2.body.token).expect(200);
  });

  it('does not accept a session token as a challenge token', async () => {
    const { user, auth, token } = await loginAs();
    const { secret } = await enableFor(auth);
    expect(user.id).toBeDefined();

    await request(app)
      .post(api('/auth/2fa/verify'))
      .send({ challengeToken: token, code: authenticator.generate(secret) })
      .expect(401);
  });

  it('accepts each recovery code once', async () => {
    const { user, auth } = await loginAs();
    const { recoveryCodes } = await enableFor(auth);

    const attempt = async () => {
      const { body } = await login(user.email);
      return request(app)
        .post(api('/auth/2fa/verify'))
        .send({ challengeToken: body.challengeToken, recoveryCode: recoveryCodes[0] });
    };

    expect((await attempt()).status).toBe(200);
    expect((await attempt()).status).toBe(401);
  });

  it('needs the password and a code to switch off', async () => {
    const { user, auth } = await loginAs();
    const { secret } = await enableFor(auth);
    const disable = (body) =>
      request(app).post(api('/auth/2fa/disable')).set(auth).send(body);

    await disable({
      password: 'wrong-password',
      code: authenticator.generate(secret),
    }).expect(401);
    await disable({ password: PASSWORD, code: '000000' }).expect(400);
    await disable({ password: PASSWORD, code: authenticator.generate(secret) }).expect(
      200,
    );

    expect((await login(user.email)).body.token).toEqual(expect.any(String));
  });

  it('accepts a code for one login only', async () => {
    const { user, auth } = await loginAs();
    const { secret } = await enableFor(auth);
    const code = authenticator.generate(secret);
    const verify = async (value) => {
      const { body } = await login(user.email);
      return request(app)
        .post(api('/auth/2fa/verify'))
        .send({ challengeToken: body.challengeToken, code: value });
    };

    expect((await verify(code)).status).toBe(200);
    expect((await verify(code)).status).toBe(401);

    // The next 30-second step's code is new, so it works.
    const next = authenticator.clone({ epoch: Date.now() + 30 * 1000 }).generate(secret);
    expect((await verify(next)).status).toBe(200);
  });

  it('locks the second step after five wrong codes', async () => {
    const { user, auth } = await loginAs();
    const { secret } = await enableFor(auth);
    const { body } = await login(user.email);
    const verify = (code) =>
      request(app)
        .post(api('/auth/2fa/verify'))
        .send({ challengeToken: body.challengeToken, code });

    for (let i = 0; i < 5; i += 1) {
      await verify('000000').expect(401);
    }

    const locked = await verify(authenticator.generate(secret));
    expect(locked.status).toBe(429);

    // The lock runs out on its own.
    await User.updateOne({ _id: user.id }, { twoFactorLockedUntil: new Date(0) });
    await verify(authenticator.generate(secret)).expect(200);
  });

  it('forgets wrong codes after fifteen minutes', async () => {
    const { user, auth } = await loginAs();
    const { secret } = await enableFor(auth);
    const { body } = await login(user.email);
    const verify = (code) =>
      request(app)
        .post(api('/auth/2fa/verify'))
        .send({ challengeToken: body.challengeToken, code });

    for (let i = 0; i < 4; i += 1) {
      await verify('000000').expect(401);
    }
    // Those four happened a while ago.
    await User.updateOne(
      { _id: user.id },
      { twoFactorFailuresSince: new Date(Date.now() - 16 * 60 * 1000) },
    );

    // A fifth wrong code now starts a new count instead of locking.
    await verify('000000').expect(401);
    await verify(authenticator.generate(secret)).expect(200);
  });

  it('ends other sessions when it is switched on, but not the one doing it', async () => {
    const user = await createUser();
    const laptop = await login(user.email);
    const phone = await login(user.email);
    const auth = { Authorization: `Bearer ${laptop.body.token}` };

    const setup = await request(app).post(api('/auth/2fa/setup')).set(auth);
    await request(app)
      .post(api('/auth/2fa/enable'))
      .set(auth)
      .set('Cookie', `refresh=${laptop.body.refreshToken}`)
      .send({ code: authenticator.generate(setup.body.data.secret) })
      .expect(200);

    await refresh(phone.body.refreshToken).expect(401);
    await refresh(laptop.body.refreshToken).expect(200);
  });

  it('reports a seed it can no longer decrypt without leaking why', async () => {
    const { user, auth } = await loginAs();
    await enableFor(auth);
    await User.updateOne({ _id: user.id }, { twoFactorSecret: 'not-a-sealed-value' });

    const { body } = await login(user.email);
    const res = await request(app)
      .post(api('/auth/2fa/verify'))
      .send({ challengeToken: body.challengeToken, code: '123456' });

    expect(res.status).toBe(500);
    expect(res.body.message).toMatch(/unavailable for this account/);
  });

  it('is not bypassed by a password reset', async () => {
    const send = jest.spyOn(mailer, 'sendPasswordReset').mockResolvedValue();
    const { user, auth } = await loginAs();
    await enableFor(auth);

    await request(app).post(api('/auth/forgot-password')).send({ email: user.email });
    const token = send.mock.calls[0][1].split('/').pop();

    const res = await request(app)
      .patch(api(`/auth/reset-password/${token}`))
      .send({
        password: 'a-brand-new-password',
        passwordConfirm: 'a-brand-new-password',
      });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeUndefined();
    expect((await login(user.email, 'a-brand-new-password')).body.twoFactorRequired).toBe(
      true,
    );
  });
});

describe('favourites', () => {
  it('adds, lists and removes favourites without duplicates', async () => {
    const [one, two] = [await createExpedition(), await createExpedition()];
    const { auth } = await loginAs();
    const url = (id) => api(`/users/me/favourites/${id}`);

    await request(app).put(url(one.id)).set(auth).expect(200);
    await request(app).put(url(one.id)).set(auth).expect(200);
    const added = await request(app).put(url(two.id)).set(auth);
    expect(added.body.data).toEqual([one.id, two.id]);

    const list = await request(app).get(api('/users/me/favourites')).set(auth);
    expect(list.body.results).toBe(2);
    expect(list.body.data[0]).toMatchObject({ name: one.name, slug: one.slug });

    const profile = await request(app).get(api('/users/me')).set(auth);
    expect(profile.body.data.favourites).toEqual([one.id, two.id]);

    const removed = await request(app).delete(url(one.id)).set(auth);
    expect(removed.body.data).toEqual([two.id]);
  });

  it('answers 404 for an unknown expedition and 401 without a session', async () => {
    const { auth } = await loginAs();

    await request(app)
      .put(api('/users/me/favourites/64b000000000000000000000'))
      .set(auth)
      .expect(404);
    await request(app).get(api('/users/me/favourites')).expect(401);
  });
});

describe('managing accounts as an admin', () => {
  const users = (id) => api(`/users/${id}`);

  it('keeps at least one admin', async () => {
    const admin = await loginAs({ role: 'admin' });

    const demoted = await request(app)
      .patch(users(admin.user.id))
      .set(admin.auth)
      .send({ role: 'traveler' });
    expect(demoted.status).toBe(409);
    await request(app).delete(users(admin.user.id)).set(admin.auth).expect(409);
    await request(app).delete(api('/users/me')).set(admin.auth).expect(409);
    expect((await User.findById(admin.user.id)).role).toBe('admin');

    // Renaming the only admin is fine, and so is stepping down once there is another.
    await request(app)
      .patch(users(admin.user.id))
      .set(admin.auth)
      .send({ name: 'Still Admin', role: 'admin' })
      .expect(200);
    await request(app)
      .patch(users(admin.user.id))
      .set(admin.auth)
      .send({ active: 'false' })
      .expect(400);
    await request(app)
      .patch(users(admin.user.id))
      .set(admin.auth)
      .send({ active: false })
      .expect(409);

    await createUser({ role: 'admin' });
    await request(app)
      .patch(users(admin.user.id))
      .set(admin.auth)
      .send({ role: 'traveler' })
      .expect(200);
  });

  it('sees deactivated accounts, and can delete or bring them back', async () => {
    const admin = await loginAs({ role: 'admin' });
    const left = await loginAs();
    const alsoLeft = await loginAs();
    await request(app).delete(api('/users/me')).set(left.auth).expect(204);
    await request(app).delete(api('/users/me')).set(alsoLeft.auth).expect(204);

    const list = await request(app).get(api('/users')).set(admin.auth);
    expect(list.body.results).toBe(3);
    expect(list.body.total).toBe(3);
    const row = (id) => list.body.data.find((u) => u._id === id);
    expect(row(left.user.id).active).toBe(false);
    expect(row(admin.user.id).active).toBeUndefined();

    // Brought back: the account can log in again.
    const restored = await request(app)
      .patch(users(left.user.id))
      .set(admin.auth)
      .send({ active: true });
    expect(restored.status).toBe(200);
    expect((await login(left.user.email)).status).toBe(200);

    await request(app).delete(users(alsoLeft.user.id)).set(admin.auth).expect(204);
    expect(await User.countDocuments()).toBe(2);

    // Everyone else still cannot see a deactivated account.
    await request(app)
      .patch(users(left.user.id))
      .set(admin.auth)
      .send({ active: false })
      .expect(200);
    expect((await login(left.user.email)).status).toBe(401);
  });

  it('does not delete an account that has bookings', async () => {
    const admin = await loginAs({ role: 'admin' });
    const expedition = await createExpedition();
    const booked = await createUser();
    const idle = await createUser();
    await book(booked, expedition);
    await login(idle.email);

    const refused = await request(app).delete(users(booked.id)).set(admin.auth);
    expect(refused.status).toBe(409);
    expect(await User.findById(booked.id)).not.toBeNull();

    await request(app).delete(users(idle.id)).set(admin.auth).expect(204);
    expect(await User.findById(idle.id)).toBeNull();
    expect(await RefreshToken.countDocuments({ user: idle.id })).toBe(0);
  });
});
