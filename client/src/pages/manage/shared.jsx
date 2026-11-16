import { useCallback, useEffect, useState } from 'react';
import Spinner from '../../components/Spinner';
import { useToast } from '../../context/ToastContext';
import { api } from '../../lib/api';

const PAGE_SIZE = 20;
// The API returns at most this many rows per request.
const MAX_PAGE_SIZE = 100;

const withQuery = (path, query) => `${path}${path.includes('?') ? '&' : '?'}${query}`;

// Loads one page of a list endpoint and exposes a reload for after each
// change. `path` carries the filters and sort; paging is added here.
// eslint-disable-next-line react-refresh/only-export-components
export function useList(path, { pageSize = PAGE_SIZE } = {}) {
  const [page, setPage] = useState(1);
  const [state, setState] = useState({ rows: null, total: 0, error: null });

  // A different list (a filter changed) starts again from its first page.
  const [shownPath, setShownPath] = useState(path);
  if (shownPath !== path) {
    setShownPath(path);
    setPage(1);
  }

  const reload = useCallback(
    () =>
      api
        .get(withQuery(path, `limit=${pageSize}&page=${page}`))
        .then((res) => {
          // Deleting the last row of the last page leaves it empty: step back.
          if (res.data.length === 0 && page > 1) return setPage(page - 1);
          setState({ rows: res.data, total: res.total ?? res.results, error: null });
        })
        .catch((err) => setState({ rows: null, total: 0, error: err.message })),
    [path, page, pageSize],
  );

  useEffect(() => {
    reload();
  }, [reload]);

  return {
    ...state,
    reload,
    page,
    setPage,
    pages: Math.max(1, Math.ceil(state.total / pageSize)),
  };
}

// Loads every row of a list endpoint, page by page. For dropdowns and
// lookups, which need the whole set and not one screenful.
// eslint-disable-next-line react-refresh/only-export-components
export function useAll(path) {
  const [state, setState] = useState({ rows: null, error: null });

  const reload = useCallback(async () => {
    try {
      const rows = [];
      for (let page = 1; ; page += 1) {
        const res = await api.get(withQuery(path, `limit=${MAX_PAGE_SIZE}&page=${page}`));
        rows.push(...res.data);
        if (res.data.length === 0 || rows.length >= (res.total ?? 0)) break;
      }
      setState({ rows, error: null });
    } catch (err) {
      setState({ rows: null, error: err.message });
    }
  }, [path]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { ...state, reload };
}

// Runs a change, reports the outcome, then refreshes the list.
// eslint-disable-next-line react-refresh/only-export-components
export function useAction(reload) {
  const notify = useToast();

  return useCallback(
    async (action, message) => {
      try {
        await action();
        notify(message);
        await reload();
        return true;
      } catch (err) {
        notify(err.message, 'error');
        return false;
      }
    },
    [notify, reload],
  );
}

export function Table({ list, columns, empty = 'Nothing here yet.', children }) {
  if (list.error) return <p className="text-ink-soft">{list.error}</p>;
  if (!list.rows) return <Spinner />;
  if (list.rows.length === 0) return <p className="text-ink-soft">{empty}</p>;

  return (
    <div className="space-y-4">
      <div className="card overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line text-xs tracking-wide text-ink-soft uppercase">
            <tr>
              {columns.map((column) => (
                <th key={column} className="px-4 py-3 font-medium whitespace-nowrap">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line [&_td]:px-4 [&_td]:py-3 [&_td]:align-top">
            {list.rows.map(children)}
          </tbody>
        </table>
      </div>
      <Pager list={list} />
    </div>
  );
}

function Pager({ list }) {
  if (!list.pages || list.pages <= 1) return null;

  return (
    <nav aria-label="Pages" className="flex items-center justify-end gap-3 text-sm">
      <button
        type="button"
        className="btn btn-quiet"
        disabled={list.page <= 1}
        onClick={() => list.setPage(list.page - 1)}
      >
        Previous
      </button>
      <span className="text-ink-soft">
        Page {list.page} of {list.pages}
      </span>
      <button
        type="button"
        className="btn btn-quiet"
        disabled={list.page >= list.pages}
        onClick={() => list.setPage(list.page + 1)}
      >
        Next
      </button>
    </nav>
  );
}

export function DeleteButton({ what, onConfirm }) {
  return (
    <button
      type="button"
      className="font-medium text-clay-dark underline underline-offset-4"
      onClick={() =>
        window.confirm(`Delete ${what}? This cannot be undone.`) && onConfirm()
      }
    >
      Delete
    </button>
  );
}
