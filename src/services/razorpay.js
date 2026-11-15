const crypto = require('crypto');
const Razorpay = require('razorpay');
const config = require('../config');
const ApiError = require('../utils/ApiError');

let client;

// Created on first use so the API can boot (and tests can run) without keys.
const getClient = () => {
  if (!config.razorpay.keyId || !config.razorpay.keySecret) {
    throw new ApiError(503, 'Payments are not configured on this server.');
  }

  client ??= new Razorpay({
    key_id: config.razorpay.keyId,
    key_secret: config.razorpay.keySecret,
  });

  return client;
};

const hmac = (secret, payload) =>
  crypto.createHmac('sha256', secret).update(payload).digest('hex');

const safeEqual = (expected, received) => {
  const a = Buffer.from(expected);
  const b = Buffer.from(String(received ?? ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

exports.createOrder = (params) => getClient().orders.create(params);
exports.fetchOrder = (orderId) => getClient().orders.fetch(orderId);

// Signature Razorpay Checkout hands to the browser after a payment.
exports.isValidPaymentSignature = ({ orderId, paymentId, signature }) =>
  Boolean(config.razorpay.keySecret) &&
  safeEqual(hmac(config.razorpay.keySecret, `${orderId}|${paymentId}`), signature);

// Signature on webhook deliveries, computed over the raw request body.
exports.isValidWebhookSignature = (rawBody, signature) =>
  Boolean(config.razorpay.webhookSecret) &&
  safeEqual(hmac(config.razorpay.webhookSecret, rawBody), signature);
