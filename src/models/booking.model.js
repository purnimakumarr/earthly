const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
  expedition: {
    type: mongoose.Schema.ObjectId,
    ref: 'Expedition',
    required: [true, 'A booking must reference an expedition'],
  },
  user: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: [true, 'A booking must reference a user'],
  },
  // Id of the departure inside expedition.departures, plus a copy of its date
  // so a booking can be listed without loading the expedition's schedule.
  // The copy is updated when staff move the departure.
  departure: mongoose.Schema.ObjectId,
  departureDate: Date,
  // Whether this booking holds one of the departure's counted seats. False
  // for an overbooked payment, so removing it does not free someone else's.
  seated: { type: Boolean, default: false },
  // True when the payment arrived after the departure had filled up. A
  // booking with a departure that is neither seated nor overbooked has not
  // finished its seat step yet (the server stopped in between).
  overbooked: { type: Boolean, default: false },
  // Amount actually charged, in INR
  price: {
    type: Number,
    required: [true, 'A booking must record the price paid'],
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  paid: {
    type: Boolean,
    default: true,
  },
  // Unique so the browser callback and the webhook cannot both create a booking.
  razorpayOrderId: {
    type: String,
    unique: true,
    sparse: true,
  },
  razorpayPaymentId: String,
});

bookingSchema.index({ user: 1, createdAt: -1 });
// One booking per traveler per expedition.
bookingSchema.index({ expedition: 1, user: 1 }, { unique: true });

bookingSchema.pre(/^find/, function () {
  this.populate({ path: 'user', select: 'name email' }).populate({
    path: 'expedition',
    select: 'name slug coverImage duration region',
  });
});

module.exports = mongoose.model('Booking', bookingSchema);
