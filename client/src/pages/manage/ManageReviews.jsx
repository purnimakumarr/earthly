import { Link } from 'react-router-dom';
import Stars from '../../components/Stars';
import { api } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { DeleteButton, Table, useAction, useAll, useList } from './shared';

export default function ManageReviews() {
  const list = useList('/reviews');
  // Reviews carry only the expedition id; names come from a second, small call.
  const expeditions = useAll('/expeditions?fields=name,slug');
  const act = useAction(list.reload);

  const byId = new Map((expeditions.rows || []).map((e) => [e._id, e]));

  return (
    <Table list={list} columns={['Expedition', 'Traveler', 'Review', 'Posted', '']}>
      {(review) => {
        const expedition = byId.get(review.expedition);

        return (
          <tr key={review._id}>
            <td className="font-medium whitespace-nowrap">
              {expedition ? (
                <Link to={`/expeditions/${expedition.slug}`} className="hover:underline">
                  {expedition.name}
                </Link>
              ) : (
                '—'
              )}
            </td>
            <td className="whitespace-nowrap">
              {review.user?.name || 'Former traveler'}
            </td>
            <td className="min-w-64">
              <Stars rating={review.rating} />
              <p className="mt-1 text-ink-soft">{review.review}</p>
            </td>
            <td className="whitespace-nowrap">{formatDate(review.createdAt)}</td>
            <td className="text-right">
              <DeleteButton
                what="this review"
                onConfirm={() =>
                  act(() => api.delete(`/reviews/${review._id}`), 'Review deleted.')
                }
              />
            </td>
          </tr>
        );
      }}
    </Table>
  );
}
