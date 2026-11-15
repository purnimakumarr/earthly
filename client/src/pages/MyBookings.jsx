import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Spinner from '../components/Spinner';
import { api } from '../lib/api';
import { formatDate, formatPrice } from '../lib/format';

export default function MyBookings() {
  const [bookings, setBookings] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .get('/bookings/me')
      .then((res) => setBookings(res.data))
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <p className="text-ink-soft">{error}</p>;
  if (!bookings) return <Spinner />;

  if (bookings.length === 0) {
    return (
      <div className="card p-10 text-center">
        <p className="text-ink-soft">You have not booked anything yet.</p>
        <Link to="/" className="btn btn-primary mt-4">
          Browse expeditions
        </Link>
      </div>
    );
  }

  return (
    <ul className="space-y-4">
      {bookings.map((booking) => (
        <li
          key={booking._id}
          className="card flex flex-col gap-4 p-4 sm:flex-row sm:items-center"
        >
          {booking.expedition ? (
            <>
              <img
                src={booking.expedition.coverImage}
                alt=""
                className="h-24 w-full rounded-xl object-cover sm:w-36"
              />
              <div className="min-w-0 flex-1">
                <p className="eyebrow">{booking.expedition.region}</p>
                <Link
                  to={`/expeditions/${booking.expedition.slug}`}
                  className="font-display text-xl hover:underline"
                >
                  {booking.expedition.name}
                </Link>
                <p className="mt-1 text-sm text-ink-soft">
                  Booked {formatDate(booking.createdAt)} · {booking.expedition.duration}{' '}
                  days
                </p>
              </div>
            </>
          ) : (
            <p className="flex-1 text-ink-soft">This expedition is no longer offered.</p>
          )}

          <div className="text-sm sm:text-right">
            <p className="text-lg font-semibold">{formatPrice(booking.price)}</p>
            <p className={booking.paid ? 'text-moss' : 'text-clay'}>
              {booking.paid ? 'Paid' : 'Payment pending'}
            </p>
            {booking.razorpayPaymentId && (
              <p className="font-mono text-xs break-all text-ink-soft">
                {booking.razorpayPaymentId}
              </p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
