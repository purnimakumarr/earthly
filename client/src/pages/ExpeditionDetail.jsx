import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Avatar from '../components/Avatar';
import FavouriteButton from '../components/FavouriteButton';
import ReviewForm from '../components/ReviewForm';
import RouteMap from '../components/RouteMap';
import Spinner from '../components/Spinner';
import Stars from '../components/Stars';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { api } from '../lib/api';
import { bookExpedition } from '../lib/checkout';
import { byDate, formatDate, formatPrice, isUpcoming, ROLE_LABELS } from '../lib/format';
import NotFound from './NotFound';

function Fact({ label, children }) {
  return (
    <div>
      <dt className="text-xs tracking-wide text-ink-soft uppercase">{label}</dt>
      <dd className="mt-0.5 font-medium first-letter:uppercase">{children}</dd>
    </div>
  );
}

export default function ExpeditionDetail() {
  const { slug } = useParams();
  const { user } = useAuth();
  const notify = useToast();
  const navigate = useNavigate();

  const [expedition, setExpedition] = useState(null);
  const [error, setError] = useState(null);
  const [booking, setBooking] = useState(false);
  // undefined = not loaded yet, null = this person has no booking here
  const [myBooking, setMyBooking] = useState(undefined);
  const [departureId, setDepartureId] = useState(null);

  const load = useCallback(
    () => api.get(`/expeditions/slug/${slug}`).then((res) => res.data),
    [slug],
  );

  useEffect(() => {
    let cancelled = false;
    setExpedition(null);
    setError(null);

    load()
      .then((data) => {
        if (cancelled) return;
        setExpedition(data);
        document.title = `${data.name} · Earthly`;
      })
      .catch((err) => !cancelled && setError(err));

    return () => {
      cancelled = true;
      document.title = 'Earthly';
    };
  }, [load]);

  // Whether the signed-in person already holds a place on this expedition.
  const expeditionId = expedition?._id;
  useEffect(() => {
    if (!user || !expeditionId) return setMyBooking(user ? undefined : null);

    let cancelled = false;
    api
      .get('/bookings/me')
      .then((res) => {
        if (cancelled) return;
        setMyBooking(res.data.find((b) => b.expedition?._id === expeditionId) || null);
      })
      .catch(() => !cancelled && setMyBooking(null));

    return () => {
      cancelled = true;
    };
  }, [user, expeditionId]);

  if (error?.status === 404) return <NotFound />;
  if (error) return <p className="py-20 text-center text-ink-soft">{error.message}</p>;
  if (!expedition) return <Spinner />;

  const seatsLeft = (d) => Math.max(expedition.maxGroupSize - d.participants, 0);
  const isOpen = (d) => !d.soldOut && seatsLeft(d) > 0;
  const upcoming = byDate(expedition.departures).filter(isUpcoming);
  const chosen =
    upcoming.find((d) => d._id === departureId && isOpen(d)) || upcoming.find(isOpen);

  const canReview =
    user?.role === 'traveler' &&
    myBooking?.paid &&
    !expedition.reviews.some((review) => review.user?._id === user._id);

  const postReview = async (values) => {
    try {
      await api.post(`/expeditions/${expedition._id}/reviews`, values);
      setExpedition(await load());
      notify('Review posted. Thank you.');
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  const handleBook = async () => {
    setBooking(true);
    try {
      const result = await bookExpedition(expedition, chosen._id, user);
      if (result) {
        notify('Payment received. Your place is booked.');
        navigate('/account/bookings');
      }
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBooking(false);
    }
  };

  return (
    <article>
      <div className="relative h-[46vh] max-h-[34rem] min-h-72 bg-ink">
        <img
          src={expedition.coverImage}
          alt=""
          className="h-full w-full object-cover opacity-80"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-ink/80 via-ink/10 to-transparent" />
        <div className="absolute inset-x-0 bottom-0">
          <div className="mx-auto max-w-6xl px-4 pb-8 text-paper sm:px-6">
            <p className="text-xs font-semibold tracking-[0.14em] uppercase opacity-90">
              {expedition.region}
            </p>
            <div className="mt-2 flex items-end justify-between gap-4">
              <h1 className="max-w-3xl text-3xl leading-tight sm:text-5xl">
                {expedition.name}
              </h1>
              <FavouriteButton expeditionId={expedition._id} className="mb-1 shrink-0" />
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-12">
          <section>
            <p className="font-display text-2xl leading-snug text-ink">
              {expedition.summary}.
            </p>
            <div className="mt-5 space-y-4 leading-relaxed text-ink-soft">
              {(expedition.description || '').split('\n').map((paragraph) => (
                <p key={paragraph.slice(0, 24)}>{paragraph}</p>
              ))}
            </div>
          </section>

          {expedition.images?.length > 0 && (
            <section aria-label="Photos" className="grid gap-3 sm:grid-cols-3">
              {expedition.images.map((src) => (
                <img
                  key={src}
                  src={src}
                  alt=""
                  loading="lazy"
                  className="aspect-[3/2] w-full rounded-xl object-cover"
                />
              ))}
            </section>
          )}

          <section>
            <h2 className="text-2xl">The route</h2>
            <ol className="mt-4 mb-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink-soft">
              {expedition.locations.map((stop, i) => (
                <li key={stop._id} className="flex items-center gap-2">
                  <span className="stop-marker h-6 w-6">{i + 1}</span>
                  Day {stop.day}: {stop.description}
                </li>
              ))}
            </ol>
            <RouteMap locations={expedition.locations} />
          </section>

          <section>
            <h2 className="text-2xl">Who you will walk with</h2>
            <ul className="mt-4 grid gap-4 sm:grid-cols-2">
              {expedition.guides.map((guide) => (
                <li key={guide._id} className="card flex items-center gap-3 p-4">
                  <Avatar user={guide} />
                  <div>
                    <p className="font-medium">{guide.name}</p>
                    <p className="text-sm text-ink-soft">{ROLE_LABELS[guide.role]}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="text-2xl">
              What travelers said{' '}
              <span className="font-sans text-base font-normal text-ink-soft">
                ★ {expedition.ratingsAverage} from {expedition.ratingsQuantity} reviews
              </span>
            </h2>
            {canReview && (
              <div className="card mt-4 p-5">
                <p className="font-display text-lg">How was it?</p>
                <p className="text-sm text-ink-soft">
                  You have a place on this expedition, so you can leave a review.
                </p>
                {user.emailVerified ? (
                  <ReviewForm submitLabel="Post review" onSubmit={postReview} />
                ) : (
                  <p className="mt-3 text-sm text-clay-dark">
                    Confirm your email address first, using the link we sent you.
                  </p>
                )}
              </div>
            )}

            {expedition.reviews.length === 0 ? (
              <p className="mt-4 text-ink-soft">No reviews yet.</p>
            ) : (
              <ul className="mt-4 grid gap-4 sm:grid-cols-2">
                {expedition.reviews.map((review) => (
                  <li key={review._id} className="card p-5">
                    <div className="flex items-center gap-3">
                      <Avatar user={review.user} size="sm" />
                      <div>
                        <p className="text-sm font-medium">
                          {review.user?.name || 'Former traveler'}
                        </p>
                        <Stars rating={review.rating} />
                      </div>
                    </div>
                    <p className="mt-3 text-sm leading-relaxed text-ink-soft">
                      {review.review}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="lg:sticky lg:top-6 lg:self-start">
          <div className="card p-6">
            <p>
              <span className="font-display text-3xl">
                {formatPrice(expedition.price)}
              </span>
              <span className="text-sm text-ink-soft"> per person</span>
            </p>

            <dl className="mt-5 grid grid-cols-2 gap-4 border-y border-line py-5 text-sm">
              <Fact label="Duration">{expedition.duration} days</Fact>
              <Fact label="Difficulty">{expedition.difficulty}</Fact>
              <Fact label="Group size">Up to {expedition.maxGroupSize}</Fact>
              <Fact label="Starts in">
                {expedition.startLocation.description.split(',')[0]}
              </Fact>
            </dl>

            {user && myBooking === undefined ? (
              <Spinner />
            ) : myBooking ? (
              <div className="mt-5 rounded-xl bg-moss/10 p-4 text-sm">
                <p className="font-medium text-ink">
                  You are booked
                  {myBooking.departureDate &&
                    ` for ${formatDate(myBooking.departureDate)}`}
                  .
                </p>
                <Link
                  to="/account/bookings"
                  className="mt-1 inline-block font-medium text-ink underline underline-offset-4"
                >
                  View your bookings
                </Link>
              </div>
            ) : (
              <>
                <fieldset className="mt-5">
                  <legend className="label">Choose a departure</legend>
                  {upcoming.length === 0 && (
                    <p className="text-sm text-ink-soft">No departures scheduled yet.</p>
                  )}
                  <div className="space-y-2">
                    {upcoming.map((d) => (
                      <label
                        key={d._id}
                        className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm ${
                          isOpen(d)
                            ? 'cursor-pointer border-line has-checked:border-ink has-checked:bg-ink/5'
                            : 'border-line/60 text-ink-soft/70'
                        }`}
                      >
                        <input
                          type="radio"
                          name="departure"
                          className="accent-ink"
                          disabled={!isOpen(d)}
                          checked={chosen?._id === d._id}
                          onChange={() => setDepartureId(d._id)}
                        />
                        <span className="flex-1 font-medium">{formatDate(d.date)}</span>
                        <span className={isOpen(d) ? 'text-ink-soft' : 'text-clay-dark'}>
                          {isOpen(d)
                            ? `${seatsLeft(d)} seat${seatsLeft(d) === 1 ? '' : 's'} left`
                            : 'Sold out'}
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                {!user ? (
                  <Link
                    to="/login"
                    state={{ from: `/expeditions/${slug}` }}
                    className="btn btn-accent mt-5 w-full"
                  >
                    Log in to book
                  </Link>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={handleBook}
                      disabled={booking || !chosen || !user.emailVerified}
                      className="btn btn-accent mt-5 w-full"
                    >
                      {booking
                        ? 'Opening payment…'
                        : chosen
                          ? 'Book this expedition'
                          : 'Fully booked'}
                    </button>
                    {!user.emailVerified && (
                      <p className="mt-2 text-center text-xs text-clay-dark">
                        Confirm your email address to book.
                      </p>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </aside>
      </div>
    </article>
  );
}
