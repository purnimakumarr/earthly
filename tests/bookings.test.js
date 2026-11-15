const crypto = require('crypto');
const request = require('supertest');
const app = require('../src/app');
const db = require('./helpers/db');
const Booking = require('../src/models/booking.model');
const razorpay = require('../src/services/razorpay');
const { loginAs, createExpedition } = require('./helpers/factories');

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
    notes: { expeditionId: expedition.id, userId: user.id },
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

    const res = await request(app)
      .post('/api/v1/bookings/orders')
      .set(auth)
      .send({ expeditionId: expedition.id, amount: 1 });

    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({
      keyId: 'rzp_test_key',
      order: { id: 'order_123', amount: 3000000, currency: 'INR' },
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 3000000,
        notes: { expeditionId: expedition.id, userId: user.id },
      }),
    );
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
  });
});

describe('reading bookings', () => {
  it('GET /bookings/me returns only the caller’s bookings, newest first', async () => {
    const expedition = await createExpedition();
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
        expedition: expedition.id,
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
});
