import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Avatar from '../components/Avatar';
import RouteMap from '../components/RouteMap';
import Spinner from '../components/Spinner';
import Stars from '../components/Stars';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { api } from '../lib/api';
import { bookExpedition } from '../lib/checkout';
import { formatDate, formatPrice, nextDeparture, ROLE_LABELS } from '../lib/format';
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

  useEffect(() => {
    let cancelled = false;
    setExpedition(null);
    setError(null);

    api
      .get(`/expeditions/slug/${slug}`)
      .then((res) => {
        if (cancelled) return;
        setExpedition(res.data);
        document.title = `${res.data.name} · Earthly`;
      })
      .catch((err) => !cancelled && setError(err));

    return () => {
      cancelled = true;
      document.title = 'Earthly';
    };
  }, [slug]);

  if (error?.status === 404) return <NotFound />;
  if (error) return <p className="py-20 text-center text-ink-soft">{error.message}</p>;
  if (!expedition) return <Spinner />;

  const departure = nextDeparture(expedition.startDates);

  const handleBook = async () => {
    setBooking(true);
    try {
      const result = await bookExpedition(expedition, user);
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
            <h1 className="mt-2 max-w-3xl text-3xl leading-tight sm:text-5xl">
              {expedition.name}
            </h1>
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
              {departure && <Fact label="Next departure">{formatDate(departure)}</Fact>}
            </dl>

            {user ? (
              <button
                type="button"
                onClick={handleBook}
                disabled={booking}
                className="btn btn-accent mt-5 w-full"
              >
                {booking ? 'Opening payment…' : 'Book this expedition'}
              </button>
            ) : (
              <Link
                to="/login"
                state={{ from: `/expeditions/${slug}` }}
                className="btn btn-accent mt-5 w-full"
              >
                Log in to book
              </Link>
            )}
          </div>
        </aside>
      </div>
    </article>
  );
}
