const Expedition = require('../models/expedition.model');
const Booking = require('../models/booking.model');
const config = require('../config');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const razorpay = require('../services/razorpay');
const crud = require('./crudFactory');

// A payment is reported twice: by the browser right after checkout and by
// Razorpay's webhook. The upsert on the unique order id makes whichever
// arrives second a no-op.
const recordBooking = (order, paymentId) =>
  Booking.findOneAndUpdate(
    { razorpayOrderId: order.id },
    {
      $setOnInsert: {
        expedition: order.notes.expeditionId,
        user: order.notes.userId,
        price: order.amount / 100,
        razorpayOrderId: order.id,
        razorpayPaymentId: paymentId,
      },
    },
    { upsert: true, new: true },
  );

// Step 1: the server creates the order, so the client never chooses the amount.
exports.createOrder = asyncHandler(async (req, res) => {
  const expedition = await Expedition.findById(req.body.expeditionId);
  if (!expedition) throw new ApiError(404, 'No expedition found with that id.');

  const order = await razorpay.createOrder({
    amount: Math.round(expedition.price * 100), // paise
    currency: 'INR',
    receipt: `exp_${expedition.id}`,
    notes: { expeditionId: expedition.id, userId: req.user.id },
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

  if (order.notes.userId !== req.user.id) {
    throw new ApiError(403, 'This payment belongs to a different account.');
  }

  const booking = await recordBooking(order, paymentId);

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
exports.listBookings = crud.list(Booking);
exports.getBooking = crud.getOne(Booking);
exports.createBooking = crud.create(Booking);
exports.updateBooking = crud.update(Booking, { fields: ['paid', 'price'] });
exports.deleteBooking = crud.remove(Booking);
