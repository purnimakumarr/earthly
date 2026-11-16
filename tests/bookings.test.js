const crypto = require('crypto');
const request = require('supertest');
const app = require('../src/app');
const db = require('./helpers/db');
const Booking = require('../src/models/booking.model');
const razorpay = require('../src/services/razorpay');
const Expedition = require('../src/models/expedition.model');
const {
  loginAs,
  createUser,
  createExpedition,
  PASSWORD,
} = require('./helpers/factories');

beforeAll(db.connect);
afterEach(async () => {
  jest.restoreAllMocks();
  await db.clear();
});
afterAll(db.disconnect);

const sign = (secret, payload) =>
  crypto.createHmac('sha256', secret).update(payload).digest('hex');

const paymentBody = (orderId, paymentId) => ({
  razorpay_order_id: orderId,
  razorpay_payment_id: paymentId,
  razorpay_signature: sign(process.env.RAZORPAY_KEY_SECRET, `${orderId}|${paymentId}`),
});

// Stands in for the order Razorpay would hold after createOrder.
const stubOrder = (expedition, user, id = 'order_123') => {
  const order = {
    id,
    amount: expedition.price * 100,
    currency: 'INR',
    notes: {
      expeditionId: expedition.id,
      userId: user.id,
      departureId: expedition.departures[0].id,
      departureDate: expedition.departures[0].date.toISOString(),
    },
  };
  jest.spyOn(razorpay, 'fetchOrder').mockResolvedValue(order);
  return order;
};

const webhook = (event, secret = process.env.RAZORPAY_WEBHOOK_SECRET) => {
  const raw = JSON.stringify(event);
  return request(app)
    .post('/api/v1/webhooks/razorpay')
    .set('Content-Type', 'application/json')
    .set('x-razorpay-signature', sign(secret, raw))
    .send(raw);
};

const capturedEvent = (orderId, paymentId) => ({
  event: 'payment.captured',
  payload: { payment: { entity: { id: paymentId, order_id: orderId } } },
});

describe('POST /bookings/orders', () => {
  it('requires a session', async () => {
    await request(app).post('/api/v1/bookings/orders').send({}).expect(401);
  });

  it('creates an order priced by the server, in paise', async () => {
    const expedition = await createExpedition({ price: 30000 });
    const { user, auth } = await loginAs();
    const create = jest
      .spyOn(razorpay, 'createOrder')
      .mockImplementation(async (params) => ({ id: 'order_123', ...params }));

    const res = await request(app).post('/api/v1/bookings/orders').set(auth).send({
      expeditionId: expedition.id,
      departureId: expedition.departures[0].id,
      amount: 1,
    });

    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({
      keyId: 'rzp_test_key',
      order: { id: 'order_123', amount: 3000000, currency: 'INR' },
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 3000000,
        notes: expect.objectContaining({
          expeditionId: expedition.id,
          userId: user.id,
          departureId: expedition.departures[0].id,
        }),
      }),
    );
  });

  const order = (auth, expedition, departure = expedition.departures[0]) =>
    request(app)
      .post('/api/v1/bookings/orders')
      .set(auth)
      .send({ expeditionId: expedition.id, departureId: departure.id });

  it('answers 404 for a departure the expedition does not have', async () => {
    const expedition = await createExpedition();
    const other = await createExpedition();
    const { auth } = await loginAs();

    await order(auth, expedition, other.departures[0]).expect(404);
  });

  it('refuses a sold-out departure and one that has already left', async () => {
    const expedition = await createExpedition({
      maxGroupSize: 4,
      departures: [
        { date: '2027-03-10T04:00:00.000Z', participants: 4, soldOut: true },
        { date: '2020-03-10T04:00:00.000Z' },
      ],
    });
    const { auth } = await loginAs();
    const create = jest.spyOn(razorpay, 'createOrder');

    const full = await order(auth, expedition, expedition.departures[0]);
    expect(full.status).toBe(409);
    expect(full.body.message).toMatch(/sold out/i);

    const gone = await order(auth, expedition, expedition.departures[1]);
    expect(gone.status).toBe(409);
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses a second booking of the same expedition', async () => {
    const expedition = await createExpedition();
    const { user, auth } = await loginAs();
    await Booking.create({ expedition: expedition.id, user: user.id, price: 1 });

    const res = await order(auth, expedition);

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already booked/i);
  });

  it('asks for a confirmed email address first', async () => {
    const expedition = await createExpedition();
    const user = await createUser({ emailVerified: false });
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: PASSWORD });

    const res = await order({ Authorization: `Bearer ${login.body.token}` }, expedition);

    expect(res.status).toBe(403);
  });

  it('answers 404 for an unknown expedition', async () => {
    const { auth } = await loginAs();
    await request(app)
      .post('/api/v1/bookings/orders')
      .set(auth)
      .send({ expeditionId: '64b000000000000000000000' })
      .expect(404);
  });
});

describe('POST /bookings/verify', () => {
  it('records a booking when the signature is valid', async () => {
    const expedition = await createExpedition({ price: 30000 });
    const { user, auth } = await loginAs();
    stubOrder(expedition, user);

    const res = await request(app)
      .post('/api/v1/bookings/verify')
      .set(auth)
      .send(paymentBody('order_123', 'pay_abc'));

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      price: 30000,
      paid: true,
      razorpayOrderId: 'order_123',
      razorpayPaymentId: 'pay_abc',
    });
    expect(await Booking.countDocuments()).toBe(1);
  });

  it('takes one seat on the departure and remembers its date', async () => {
    const expedition = await createExpedition();
    const { user, auth } = await loginAs();
    stubOrder(expedition, user);

    const res = await request(app)
      .post('/api/v1/bookings/verify')
      .set(auth)
      .send(paymentBody('order_123', 'pay_abc'));

    expect(res.body.data.departureDate).toBe('2027-03-10T04:00:00.000Z');

    const [first, second] = (await Expedition.findById(expedition.id)).departures;
    expect(first).toMatchObject({ participants: 1, soldOut: false });
    expect(second.participants).toBe(0);
  });

  it('marks the departure sold out when the last seat goes', async () => {
    const expedition = await createExpedition({
      maxGroupSize: 2,
      departures: [{ date: '2027-03-10T04:00:00.000Z', participants: 1 }],
    });
    const { user, auth } = await loginAs();
    stubOrder(expedition, user);

    await request(app)
      .post('/api/v1/bookings/verify')
      .set(auth)
      .send(paymentBody('order_123', 'pay_abc'))
      .expect(200);

    const [departure] = (await Expedition.findById(expedition.id)).departures;
    expect(departure).toMatchObject({ participants: 2, soldOut: true });
  });

  it('keeps one booking when the same traveler pays twice', async () => {
    const expedition = await createExpedition();
    const { user, auth } = await loginAs();

    stubOrder(expedition, user, 'order_1');
    await request(app)
      .post('/api/v1/bookings/verify')
      .set(auth)
      .send(paymentBody('order_1', 'pay_1'))
      .expect(200);

    stubOrder(expedition, user, 'order_2');
    const res = await request(app)
      .post('/api/v1/bookings/verify')
      .set(auth)
      .send(paymentBody('order_2', 'pay_2'));

    expect(res.status).toBe(200);
    expect(res.body.data.razorpayOrderId).toBe('order_1');
    expect(await Booking.countDocuments()).toBe(1);
    expect((await Expedition.findById(expedition.id)).departures[0].participants).toBe(1);
  });

  it('rejects a forged signature without touching Razorpay', async () => {
    const expedition = await createExpedition();
    const { user, auth } = await loginAs();
    stubOrder(expedition, user);

    const res = await request(app)
      .post('/api/v1/bookings/verify')
      .set(auth)
      .send({
        ...paymentBody('order_123', 'pay_abc'),
        razorpay_signature: 'f'.repeat(64),
      });

    expect(res.status).toBe(400);
    expect(razorpay.fetchOrder).not.toHaveBeenCalled();
    expect(await Booking.countDocuments()).toBe(0);
  });

  it('rejects a payment that belongs to another account', async () => {
    const expedition = await createExpedition();
    const payer = await loginAs();
    const other = await loginAs();
    stubOrder(expedition, payer.user);

    const res = await request(app)
      .post('/api/v1/bookings/verify')
      .set(other.auth)
      .send(paymentBody('order_123', 'pay_abc'));

    expect(res.status).toBe(403);
    expect(await Booking.countDocuments()).toBe(0);
  });

  it('answers 400 when fields are missing', async () => {
    const { auth } = await loginAs();
    await request(app)
      .post('/api/v1/bookings/verify')
      .set(auth)
      .send({ razorpay_order_id: 'order_123' })
      .expect(400);
  });
});

describe('POST /webhooks/razorpay', () => {
  it('records a booking for payment.captured', async () => {
    const expedition = await createExpedition();
    const { user } = await loginAs();
    stubOrder(expedition, user);

    await webhook(capturedEvent('order_123', 'pay_abc')).expect(200);

    const booking = await Booking.findOne({ razorpayOrderId: 'order_123' });
    expect(booking.user.id).toBe(user.id);
    expect(booking.seated).toBe(true);
  });

  it('finishes the seat step of a booking that was cut short', async () => {
    const expedition = await createExpedition();
    const { user } = await loginAs();
    const order = stubOrder(expedition, user);
    const seats = async () =>
      (await Expedition.findById(expedition.id)).departures[0].participants;

    // The server stopped after saving the booking and before taking the seat.
    await Booking.create({
      expedition: expedition.id,
      user: user.id,
      departure: order.notes.departureId,
      price: expedition.price,
      razorpayOrderId: order.id,
      createdAt: new Date(Date.now() - 5 * 60 * 1000),
    });

    // Razorpay retries the webhook it got no answer to.
    await webhook(capturedEvent(order.id, 'pay_abc')).expect(200);
    expect(await seats()).toBe(1);
    expect((await Booking.findOne({ razorpayOrderId: order.id })).seated).toBe(true);

    // Further retries change nothing.
    await webhook(capturedEvent(order.id, 'pay_abc')).expect(200);
    expect(await seats()).toBe(1);
  });

  it('ignores a captured payment for an order it did not create', async () => {
    jest
      .spyOn(razorpay, 'fetchOrder')
      .mockResolvedValue({ id: 'order_elsewhere', amount: 5000, notes: [] });

    await webhook(capturedEvent('order_elsewhere', 'pay_abc')).expect(200);

    expect(await Booking.countDocuments()).toBe(0);
  });

  it('rejects a bad signature', async () => {
    await webhook(capturedEvent('order_123', 'pay_abc'), 'wrong-secret').expect(400);
    expect(await Booking.countDocuments()).toBe(0);
  });

  it('acknowledges events it does not act on', async () => {
    await webhook({ event: 'payment.failed', payload: {} }).expect(200);
    expect(await Booking.countDocuments()).toBe(0);
  });

  it('creates one booking when the webhook and the browser both report', async () => {
    const expedition = await createExpedition();
    const { user, auth } = await loginAs();
    stubOrder(expedition, user);

    await Promise.all([
      webhook(capturedEvent('order_123', 'pay_abc')),
      request(app)
        .post('/api/v1/bookings/verify')
        .set(auth)
        .send(paymentBody('order_123', 'pay_abc')),
      webhook(capturedEvent('order_123', 'pay_abc')),
    ]);
    await webhook(capturedEvent('order_123', 'pay_abc')).expect(200);

    expect(await Booking.countDocuments()).toBe(1);
    expect((await Expedition.findById(expedition.id)).departures[0].participants).toBe(1);
  });
});

describe('reading bookings', () => {
  it('GET /bookings/me returns only the caller’s bookings, newest first', async () => {
    const expedition = await createExpedition();
    const another = await createExpedition();
    const me = await loginAs();
    const other = await loginAs();

    await Booking.create([
      {
        expedition: expedition.id,
        user: me.user.id,
        price: 100,
        createdAt: new Date('2027-01-01'),
      },
      {
        expedition: another.id,
        user: me.user.id,
        price: 200,
        createdAt: new Date('2027-02-01'),
      },
      { expedition: expedition.id, user: other.user.id, price: 300 },
    ]);

    const res = await request(app).get('/api/v1/bookings/me').set(me.auth);

    expect(res.body.data.map((b) => b.price)).toEqual([200, 100]);
    expect(res.body.data[0].expedition).toHaveProperty('slug');
  });

  it('keeps the full list for leads and admins', async () => {
    const traveler = await loginAs();
    const lead = await loginAs({ role: 'lead' });

    await request(app).get('/api/v1/bookings').set(traveler.auth).expect(403);
    await request(app).get('/api/v1/bookings').set(lead.auth).expect(200);
  });

  it('scopes the list under /expeditions/:id/bookings and /users/:id/bookings', async () => {
    const [one, two] = [await createExpedition(), await createExpedition()];
    const [ana, ben] = [await createUser(), await createUser()];
    const lead = await loginAs({ role: 'lead' });
    const traveler = await loginAs();

    await Booking.create([
      { expedition: one.id, user: ana.id, price: 100 },
      { expedition: one.id, user: ben.id, price: 200 },
      { expedition: two.id, user: ana.id, price: 300 },
    ]);

    const byExpedition = await request(app)
      .get(`/api/v1/expeditions/${one.id}/bookings?sort=price`)
      .set(lead.auth);
    expect(byExpedition.body.data.map((b) => b.price)).toEqual([100, 200]);
    expect(byExpedition.body.total).toBe(2);

    const byUser = await request(app)
      .get(`/api/v1/users/${ana.id}/bookings?sort=price`)
      .set(lead.auth);
    expect(byUser.body.data.map((b) => b.price)).toEqual([100, 300]);

    await request(app)
      .get(`/api/v1/expeditions/${one.id}/bookings`)
      .set(traveler.auth)
      .expect(403);
    await request(app)
      .get(`/api/v1/users/${ana.id}/bookings`)
      .set(traveler.auth)
      .expect(403);
    await request(app).get(`/api/v1/users/${ana.id}/bookings`).expect(401);
  });
});

describe('staff bookings', () => {
  it('creates a booking under an expedition, takes a seat and frees it on delete', async () => {
    const expedition = await createExpedition({ price: 30000 });
    const traveler = await createUser();
    const admin = await loginAs({ role: 'admin' });
    const seats = async () =>
      (await Expedition.findById(expedition.id)).departures[0].participants;

    const res = await request(app)
      .post(`/api/v1/expeditions/${expedition.id}/bookings`)
      .set(admin.auth)
      .send({ user: traveler.id, departure: expedition.departures[0].id });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ price: 30000, paid: true, seated: true });
    expect(await seats()).toBe(1);

    const again = await request(app)
      .post(`/api/v1/expeditions/${expedition.id}/bookings`)
      .set(admin.auth)
      .send({ user: traveler.id, departure: expedition.departures[0].id });
    expect(again.status).toBe(409);
    expect(again.body.message).toMatch(/already booked/i);
    // The seat the refused request took is handed back.
    expect(await seats()).toBe(1);

    await request(app)
      .delete(`/api/v1/bookings/${res.body.data._id}`)
      .set(admin.auth)
      .expect(204);
    expect(await seats()).toBe(0);
  });

  it('refuses a staff booking for someone who does not exist', async () => {
    const expedition = await createExpedition();
    const admin = await loginAs({ role: 'admin' });
    const book = (user) =>
      request(app)
        .post(`/api/v1/expeditions/${expedition.id}/bookings`)
        .set(admin.auth)
        .send({ user, departure: expedition.departures[0].id });

    expect((await book('64b7f0c2a1d3e4f5a6b7c8d9')).status).toBe(404);
    expect((await book(undefined)).status).toBe(404);

    expect(await Booking.countDocuments()).toBe(0);
    expect((await Expedition.findById(expedition.id)).departures[0].participants).toBe(0);
  });

  it('refuses a staff booking on a full departure', async () => {
    const expedition = await createExpedition({
      maxGroupSize: 1,
      departures: [{ date: '2027-03-10T04:00:00.000Z', participants: 1, soldOut: true }],
    });
    const traveler = await createUser();
    const admin = await loginAs({ role: 'admin' });

    await request(app)
      .post(`/api/v1/expeditions/${expedition.id}/bookings`)
      .set(admin.auth)
      .send({ user: traveler.id, departure: expedition.departures[0].id })
      .expect(409);

    expect(await Booking.countDocuments()).toBe(0);
    expect((await Expedition.findById(expedition.id)).departures[0].participants).toBe(1);
  });

  it('frees no seat when an overbooked payment is removed', async () => {
    const expedition = await createExpedition({
      maxGroupSize: 1,
      departures: [{ date: '2027-03-10T04:00:00.000Z', participants: 1, soldOut: true }],
    });
    const { user, auth } = await loginAs();
    const admin = await loginAs({ role: 'admin' });
    stubOrder(expedition, user);

    // Paid for the last seat a moment too late: kept, but holds no seat.
    const paid = await request(app)
      .post('/api/v1/bookings/verify')
      .set(auth)
      .send(paymentBody('order_123', 'pay_abc'));
    expect(paid.status).toBe(200);
    expect(paid.body.data).toMatchObject({ seated: false, overbooked: true });

    await request(app)
      .delete(`/api/v1/bookings/${paid.body.data._id}`)
      .set(admin.auth)
      .expect(204);

    const [departure] = (await Expedition.findById(expedition.id)).departures;
    expect(departure).toMatchObject({ participants: 1, soldOut: true });
  });
});
