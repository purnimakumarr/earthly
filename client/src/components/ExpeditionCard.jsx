import { Link } from 'react-router-dom';
import { formatMonth, formatPrice, nextDeparture } from '../lib/format';

export default function ExpeditionCard({ expedition }) {
  const departure = nextDeparture(expedition.startDates);

  return (
    <Link
      to={`/expeditions/${expedition.slug}`}
      className="card group flex flex-col overflow-hidden transition-shadow hover:shadow-lg"
    >
      <div className="relative aspect-[3/2] overflow-hidden">
        <img
          src={expedition.coverImage}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
        <span className="absolute top-3 left-3 rounded-full bg-paper/95 px-3 py-1 text-xs font-medium capitalize">
          {expedition.difficulty}
        </span>
      </div>

      <div className="flex flex-1 flex-col p-5">
        <p className="eyebrow">{expedition.region}</p>
        <h3 className="mt-1 text-xl leading-snug">{expedition.name}</h3>
        <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-soft">
          {expedition.summary}
        </p>

        <dl className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft">
          <div>
            <dt className="sr-only">Duration</dt>
            <dd>{expedition.duration} days</dd>
          </div>
          <div>
            <dt className="sr-only">Group size</dt>
            <dd>Up to {expedition.maxGroupSize}</dd>
          </div>
          {departure && (
            <div>
              <dt className="sr-only">Next departure</dt>
              <dd>Next: {formatMonth(departure)}</dd>
            </div>
          )}
        </dl>

        <div className="mt-4 flex items-end justify-between border-t border-line pt-4">
          <p>
            <span className="text-lg font-semibold">{formatPrice(expedition.price)}</span>
            <span className="text-xs text-ink-soft"> per person</span>
          </p>
          <p className="text-sm">
            <span className="font-semibold">★ {expedition.ratingsAverage}</span>
            <span className="text-ink-soft"> ({expedition.ratingsQuantity})</span>
          </p>
        </div>
      </div>
    </Link>
  );
}
