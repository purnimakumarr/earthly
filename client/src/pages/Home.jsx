import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import ExpeditionCard from '../components/ExpeditionCard';
import Spinner from '../components/Spinner';
import { api } from '../lib/api';

const PAGE_SIZE = 6;
const CARD_FIELDS =
  'name,slug,region,duration,maxGroupSize,difficulty,price,summary,coverImage,ratingsAverage,ratingsQuantity,startDates';

const DIFFICULTIES = ['easy', 'moderate', 'challenging'];
const SORTS = [
  { value: '-ratingsAverage,price', label: 'Top rated' },
  { value: 'price', label: 'Price: low to high' },
  { value: '-price', label: 'Price: high to low' },
  { value: 'duration', label: 'Shortest first' },
];

export default function Home() {
  // Filters live in the URL so a filtered view can be shared or reloaded.
  const [params, setParams] = useSearchParams();
  const difficulty = params.get('difficulty') || '';
  const sort = params.get('sort') || SORTS[0].value;
  const page = Number(params.get('page')) || 1;

  const [state, setState] = useState({ loading: true, items: [], total: 0, error: null });

  useEffect(() => {
    let cancelled = false;
    const query = new URLSearchParams({
      fields: CARD_FIELDS,
      limit: PAGE_SIZE,
      page,
      sort,
    });
    if (difficulty) query.set('difficulty', difficulty);

    setState((s) => ({ ...s, loading: true, error: null }));
    api
      .get(`/expeditions?${query}`)
      .then(
        (res) =>
          !cancelled &&
          setState({ loading: false, items: res.data, total: res.total, error: null }),
      )
      .catch(
        (err) =>
          !cancelled &&
          setState({ loading: false, items: [], total: 0, error: err.message }),
      );

    return () => {
      cancelled = true;
    };
  }, [difficulty, sort, page]);

  const update = (changes) => {
    const next = new URLSearchParams(params);
    Object.entries({ page: '', ...changes }).forEach(([key, value]) =>
      value ? next.set(key, value) : next.delete(key),
    );
    setParams(next);
  };

  const pages = Math.ceil(state.total / PAGE_SIZE);

  return (
    <>
      <section className="border-b border-line bg-paper">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <p className="eyebrow">Small-group expeditions across India</p>
          <h1 className="mt-3 max-w-3xl text-4xl leading-tight sm:text-6xl">
            Go far. <span className="text-clay italic">Tread lightly.</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink-soft">
            Ten people at most, guides who grew up where you are going, and stays that are
            owned by the villages you visit.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div
            className="flex flex-wrap gap-2"
            role="group"
            aria-label="Filter by difficulty"
          >
            {['', ...DIFFICULTIES].map((level) => (
              <button
                key={level || 'all'}
                type="button"
                aria-pressed={difficulty === level}
                onClick={() => update({ difficulty: level })}
                className={`rounded-full border px-4 py-1.5 text-sm capitalize transition-colors ${
                  difficulty === level
                    ? 'border-ink bg-ink text-paper'
                    : 'border-line bg-paper text-ink-soft hover:border-ink/40'
                }`}
              >
                {level || 'All'}
              </button>
            ))}
          </div>

          <label className="flex items-center gap-2 text-sm text-ink-soft">
            Sort by
            <select
              value={sort}
              onChange={(e) => update({ sort: e.target.value })}
              className="input w-auto py-1.5"
            >
              {SORTS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {state.loading ? (
          <Spinner label="Loading expeditions" />
        ) : state.error ? (
          <p className="card mt-8 p-8 text-center text-ink-soft">{state.error}</p>
        ) : state.items.length === 0 ? (
          <p className="card mt-8 p-8 text-center text-ink-soft">
            No expeditions match that filter.
          </p>
        ) : (
          <>
            <p className="mt-6 text-sm text-ink-soft">
              {state.total} expedition{state.total === 1 ? '' : 's'}
            </p>
            <div className="mt-4 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {state.items.map((expedition) => (
                <ExpeditionCard key={expedition._id} expedition={expedition} />
              ))}
            </div>
          </>
        )}

        {pages > 1 && (
          <nav
            className="mt-10 flex items-center justify-center gap-3"
            aria-label="Pages"
          >
            <button
              type="button"
              className="btn btn-quiet"
              disabled={page <= 1}
              onClick={() => update({ page: page - 1 })}
            >
              Previous
            </button>
            <span className="text-sm text-ink-soft">
              Page {page} of {pages}
            </span>
            <button
              type="button"
              className="btn btn-quiet"
              disabled={page >= pages}
              onClick={() => update({ page: page + 1 })}
            >
              Next
            </button>
          </nav>
        )}
      </section>
    </>
  );
}
