import { api } from './api';

const SCRIPT_URL = 'https://checkout.razorpay.com/v1/checkout.js';

let scriptPromise;

// Razorpay Checkout is only fetched when someone actually books.
const loadCheckout = () => {
  scriptPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.onload = resolve;
    script.onerror = () => {
      scriptPromise = undefined;
      reject(new Error('Payment window failed to load. Please try again.'));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
};

/**
 * Runs the whole payment flow and resolves with the booking, or with null if
 * the person closes the payment window.
 *
 * 1. the API creates an order (it decides the amount)
 * 2. Razorpay Checkout collects the payment
 * 3. the API verifies the signature and records the booking
 */
export async function bookExpedition(expedition, departureId, user) {
  const [{ data }] = await Promise.all([
    api.post('/bookings/orders', { expeditionId: expedition._id, departureId }),
    loadCheckout(),
  ]);

  return new Promise((resolve, reject) => {
    const checkout = new window.Razorpay({
      key: data.keyId,
      order_id: data.order.id,
      amount: data.order.amount,
      currency: data.order.currency,
      name: 'Earthly',
      description: expedition.name,
      prefill: { name: user.name, email: user.email },
      theme: { color: '#1d3a3a' },
      modal: { ondismiss: () => resolve(null) },
      handler: (payment) =>
        api
          .post('/bookings/verify', payment)
          .then((res) => resolve(res.data))
          .catch(reject),
    });

    checkout.on('payment.failed', (failure) =>
      reject(new Error(failure.error?.description || 'Payment failed.')),
    );

    checkout.open();
  });
}
