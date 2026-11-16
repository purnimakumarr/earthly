const Expedition = require('../models/expedition.model');
const Booking = require('../models/booking.model');
const User = require('../models/user.model');
const config = require('../config');
const logger = require('../config/logger');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const razorpay = require('../services/razorpay');
const crud = require('./crudFactory');

// Takes one seat on a departure. The filter only matches while there is room,
// so two concurrent bookings cannot both take the last seat.
const takeSeat = async (expeditionId, departureId) => {
  const expedition = await Expedition.findById(expeditionId).select('maxGroupSize');
  if (!expedition) return false;

  const { maxGroupSize } = expedition;

  const taken = await Expedition.updateOne(
    {
      _id: expeditionId,
      departures: {
        $elemMatch: { _id: departureId, participants: { $lt: maxGroupSize } },
      },
    },
    { $inc: { 'departures.$.participants': 1 } },
  );

  await Expedition.updateOne(
    {
      _id: expeditionId,
      departures: {
        $elemMatch: { _id: departureId, participants: { $gte: maxGroupSize } },
      },
    },
    { $set: { 'departures.$.soldOut': true } },
  );

  return taken.modifiedCount === 1;
};

const releaseSeat = (expeditionId, departureId) =>
  Expedition.updateOne(
    {
      _id: expeditionId,
      departures: { $elemMatch: { _id: departureId, participants: { $gt: 0 } } },
    },
    {
      $inc: { 'departures.$.participants': -1 },
      $set: { 'departures.$.soldOut': false },
    },
  );

// How old an unfinished booking must be before a repeated report completes
// it. Younger than this, the request that inserted it is still at work.
const SETTLE_AFTER_MS = 60 * 1000;

const needsSeat = (booking) =>
  Boolean(booking.departure) && !booking.seated && !booking.overbooked;

// Second half of recording a payment: take the seat and note the outcome on
// the booking. The two writes are not one transaction, so the outcome is
// written with a condition; if another request settled the booking first,
// the seat taken here is handed back.
const settleSeat = async (booking, expeditionId) => {
  const took = await takeSeat(expeditionId, booking.departure);

  const settled = await Booking.findOneAndUpdate(
    { _id: booking._id, seated: { $ne: true }, overbooked: { $ne: true } },
    took ? { seated: true } : { overbooked: true },
    { new: true },
  );

  if (!settled) {
    if (took) await releaseSeat(expeditionId, booking.departure);
    return Booking.findById(booking._id);
  }

  if (!took) {
    // The money has been taken, so the booking stands; staff sort it out.
    logger.warn(
      { bookingId: booking.id, expeditionId, departureId: booking.departure },
      'booking recorded for a departure that is already full',
    );
  }

  return settled;
};

// A repeated report (Razorpay retries a webhook that got no answer) picks up
// a booking whose seat step never ran because the server stopped part-way.
const finishIfStalled = (booking, expeditionId) => {
  const stalled =
    needsSeat(booking) && Date.now() - booking.createdAt.getTime() > SETTLE_AFTER_MS;
  return stalled ? settleSeat(booking, expeditionId) : booking;
};

// A payment is reported twice: by the browser right after checkout and by
// Razorpay's webhook. The upsert on the unique order id makes whichever
// arrives second a no-op, and the seat is taken by the one that inserts.
const recordBooking = async (order, paymentId) => {
  const { expeditionId, userId, departureId, departureDate } = order.notes || {};

  // An order this app did not create (the Razorpay account is shared, or the
  // notes were lost) cannot become a booking: upserts skip `required`.
  if (!expeditionId || !userId) {
    logger.warn({ orderId: order.id }, 'payment for an order without booking notes');
    return null;
  }

  let result;
  try {
    result = await Booking.findOneAndUpdate(
      { razorpayOrderId: order.id },
      {
        $setOnInsert: {
          expedition: expeditionId,
          user: userId,
          departure: departureId,
          departureDate,
          price: order.amount / 100,
          razorpayOrderId: order.id,
          razorpayPaymentId: paymentId,
        },
      },
      { upsert: true, new: true, includeResultMetadata: true },
    );
  } catch (err) {
    if (err.code !== 11000) throw err;

    // Either the other reporter won the insert race for this order, or the
    // traveler paid twice for one expedition from two tabs.
    const existing = await Booking.findOne({ expedition: expeditionId, user: userId });
    if (existing && existing.razorpayOrderId !== order.id) {
      logger.warn(
        { orderId: order.id, bookingId: existing.id },
        'second payment for an expedition already booked: refund needed',
      );
      return existing;
    }
    return existing && finishIfStalled(existing, expeditionId);
  }

  const booking = result.value;
  const inserted = !result.lastErrorObject?.updatedExisting;

  if (inserted) {
    return needsSeat(booking) ? settleSeat(booking, expeditionId) : booking;
  }
  return finishIfStalled(booking, expeditionId);
};

// Step 1: the server creates the order, so the client never chooses the amount.
exports.createOrder = asyncHandler(async (req, res) => {
  const expedition = await Expedition.findById(req.body.expeditionId);
  if (!expedition) throw new ApiError(404, 'No expedition found with that id.');

  const departure = expedition.departures.id(req.body.departureId);
  if (!departure) throw new ApiError(404, 'No departure found with that id.');

  if (departure.date <= new Date()) {
    throw new ApiError(409, 'That departure has already left.');
  }

  if (departure.soldOut || departure.participants >= expedition.maxGroupSize) {
    throw new ApiError(409, 'That departure is sold out.');
  }

  if (await Booking.exists({ expedition: expedition.id, user: req.user.id })) {
    throw new ApiError(409, 'You have already booked this expedition.');
  }

  const order = await razorpay.createOrder({
    amount: Math.round(expedition.price * 100), // paise
    currency: 'INR',
    receipt: `exp_${expedition.id}`,
    notes: {
      expeditionId: expedition.id,
      userId: req.user.id,
      departureId: departure.id,
      departureDate: departure.date.toISOString(),
    },
  });

  res.status(201).json({
    status: 'success',
    data: {
      keyId: config.razorpay.keyId,
      order: { id: order.id, amount: order.amount, currency: order.currency },
    },
  });
});

// Step 2: the browser returns what Razorpay Checkout gave it.
exports.verifyPayment = asyncHandler(async (req, res) => {
  const {
    razorpay_order_id: orderId,
    razorpay_payment_id: paymentId,
    razorpay_signature: signature,
  } = req.body;

  if (!orderId || !paymentId || !signature) {
    throw new ApiError(400, 'Payment details are incomplete.');
  }

  if (!razorpay.isValidPaymentSignature({ orderId, paymentId, signature })) {
    throw new ApiError(400, 'Payment could not be verified.');
  }

  // Expedition, user and amount are read back from Razorpay, not the request.
  const order = await razorpay.fetchOrder(orderId);

  if (order.notes?.userId !== req.user.id) {
    throw new ApiError(403, 'This payment belongs to a different account.');
  }

  const booking = await recordBooking(order, paymentId);
  if (!booking) throw new ApiError(400, 'This payment is not for a booking.');

  res.status(200).json({ status: 'success', data: booking });
});

// Mounted before the JSON parser: the signature covers the raw bytes.
exports.razorpayWebhook = asyncHandler(async (req, res) => {
  if (!config.razorpay.webhookSecret) {
    return res
      .status(503)
      .json({ status: 'error', message: 'Webhook is not configured.' });
  }

  if (!razorpay.isValidWebhookSignature(req.body, req.headers['x-razorpay-signature'])) {
    return res.status(400).json({ status: 'fail', message: 'Invalid signature.' });
  }

  const event = JSON.parse(req.body.toString());

  if (event.event === 'payment.captured') {
    const payment = event.payload.payment.entity;
    const order = await razorpay.fetchOrder(payment.order_id);
    await recordBooking(order, payment.id);
  }

  res.status(200).json({ received: true });
});

exports.getMyBookings = asyncHandler(async (req, res) => {
  const bookings = await Booking.find({ user: req.user.id }).sort('-createdAt');

  res.status(200).json({ status: 'success', results: bookings.length, data: bookings });
});

// Staff

// For POST under /expeditions/:expeditionId/bookings or /users/:userId/bookings
// the parent comes from the URL.
exports.setParents = (req, res, next) => {
  Object.assign(req.body, crud.parentScope(req.params));
  next();
};

// A booking made by staff (phone, bank transfer) still takes a seat.
exports.createBooking = asyncHandler(async (req, res) => {
  const fields = crud.pick(req.body, [
    'expedition',
    'user',
    'departure',
    'price',
    'paid',
  ]);

  const expedition = await Expedition.findById(fields.expedition);
  if (!expedition) throw new ApiError(404, 'No expedition found with that id.');

  const departure = fields.departure && expedition.departures.id(fields.departure);
  if (fields.departure && !departure) {
    throw new ApiError(404, 'No departure found with that id.');
  }

  if (!fields.user || !(await User.exists({ _id: fields.user }))) {
    throw new ApiError(404, 'No user found with that id.');
  }

  // The seat is taken first, by the same conditional update a payment uses,
  // so two staff bookings at once cannot overfill the departure.
  const seated = departure ? await takeSeat(expedition.id, departure.id) : false;
  if (departure && !seated) throw new ApiError(409, 'That departure is sold out.');

  let booking;
  try {
    booking = await Booking.create({
      ...fields,
      price: fields.price ?? expedition.price,
      departureDate: departure?.date,
      seated,
    });
  } catch (err) {
    // For example a second booking for the same traveler: hand the seat back.
    if (seated) await releaseSeat(expedition.id, departure.id);
    throw err;
  }

  res.status(201).json({ status: 'success', data: booking });
});

// Removing a booking gives its seat back, if it held one.
exports.deleteBooking = asyncHandler(async (req, res) => {
  const booking = await Booking.findByIdAndDelete(req.params.id);
  if (!booking) throw new ApiError(404, 'No booking found with that id.');

  // `expedition` is populated by the find hook; it is null if since removed.
  if (booking.seated && booking.departure && booking.expedition) {
    await releaseSeat(booking.expedition._id, booking.departure);
  }

  res.status(204).send();
});

exports.listBookings = crud.list(Booking);
exports.getBooking = crud.getOne(Booking);
exports.updateBooking = crud.update(Booking, { fields: ['paid', 'price'] });
