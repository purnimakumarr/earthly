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

bookingSchema.pre(/^find/, function () {
  this.populate({ path: 'user', select: 'name email' }).populate({
    path: 'expedition',
    select: 'name slug coverImage duration region',
  });
});

module.exports = mongoose.model('Booking', bookingSchema);
