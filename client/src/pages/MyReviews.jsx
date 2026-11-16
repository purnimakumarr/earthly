import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import ReviewForm from '../components/ReviewForm';
import Spinner from '../components/Spinner';
import Stars from '../components/Stars';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { api } from '../lib/api';
import { formatDate } from '../lib/format';

export default function MyReviews() {
  const { user } = useAuth();
  const notify = useToast();
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    const [reviews, bookings] = await Promise.all([
      api.get('/reviews/me'),
      api.get('/bookings/me'),
    ]);
    setData({ reviews: reviews.data, bookings: bookings.data });
  }, []);

  useEffect(() => {
    load().catch((err) => notify(err.message, 'error'));
  }, [load, notify]);

  if (!data) return <Spinner />;

  // Booked expeditions that have no review from this person yet.
  const reviewed = new Set(data.reviews.map((r) => r.expedition?._id));
  const awaiting = [
    ...new Map(
      data.bookings
        .filter((b) => b.expedition && !reviewed.has(b.expedition._id))
        .map((b) => [b.expedition._id, b.expedition]),
    ).values(),
  ];

  const act = async (action, message) => {
    try {
      await action();
      setEditing(null);
      await load();
      notify(message);
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  return (
    <div className="space-y-10">
      {user.role === 'traveler' && awaiting.length > 0 && (
        <section>
          <h2 className="text-xl">Waiting for your review</h2>
          <ul className="mt-4 space-y-4">
            {awaiting.map((expedition) => (
              <li key={expedition._id} className="card p-5">
                <p className="font-display text-lg">{expedition.name}</p>
                <ReviewForm
                  submitLabel="Post review"
                  onSubmit={(values) =>
                    act(
                      () => api.post(`/expeditions/${expedition._id}/reviews`, values),
                      'Review posted.',
                    )
                  }
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="text-xl">Your reviews</h2>
        {data.reviews.length === 0 ? (
          <p className="mt-4 text-ink-soft">
            Nothing here yet. Reviews can be written once you have booked an expedition.
          </p>
        ) : (
          <ul className="mt-4 space-y-4">
            {data.reviews.map((review) => (
              <li key={review._id} className="card p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    {review.expedition ? (
                      <Link
                        to={`/expeditions/${review.expedition.slug}`}
                        className="font-display text-lg hover:underline"
                      >
                        {review.expedition.name}
                      </Link>
                    ) : (
                      <p className="font-display text-lg text-ink-soft">
                        Expedition no longer offered
                      </p>
                    )}
                    <p className="flex items-center gap-2 text-xs text-ink-soft">
                      <Stars rating={review.rating} /> {formatDate(review.createdAt)}
                    </p>
                  </div>
                  {editing !== review._id && (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="btn btn-quiet"
                        onClick={() => setEditing(review._id)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn-quiet text-clay-dark"
                        onClick={() =>
                          window.confirm('Delete this review?') &&
                          act(
                            () => api.delete(`/reviews/${review._id}`),
                            'Review deleted.',
                          )
                        }
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>

                {editing === review._id ? (
                  <ReviewForm
                    initial={review}
                    submitLabel="Save changes"
                    onCancel={() => setEditing(null)}
                    onSubmit={(values) =>
                      act(
                        () => api.patch(`/reviews/${review._id}`, values),
                        'Review updated.',
                      )
                    }
                  />
                ) : (
                  <p className="mt-3 text-sm leading-relaxed text-ink-soft">
                    {review.review}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
