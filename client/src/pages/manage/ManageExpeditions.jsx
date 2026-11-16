import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../../context/ToastContext';
import { api } from '../../lib/api';
import { byDate, formatDate, formatPrice } from '../../lib/format';
import ExpeditionForm from './ExpeditionForm';
import { DeleteButton, Table, useAction, useList } from './shared';

export default function ManageExpeditions() {
  const list = useList(
    '/expeditions?fields=name,slug,region,price,maxGroupSize,departures,ratingsAverage,ratingsQuantity&sort=name',
  );
  const act = useAction(list.reload);
  const notify = useToast();
  // null = list view, {} = new expedition, otherwise the document being edited
  const [editing, setEditing] = useState(null);

  const openEditor = (id) =>
    api
      .get(`/expeditions/${id}`)
      .then((res) => setEditing(res.data))
      .catch((err) => notify(err.message, 'error'));

  if (editing) {
    return (
      <ExpeditionForm
        expedition={editing}
        onCancel={() => setEditing(null)}
        onSave={async (formData) => {
          const done = await act(
            () =>
              editing._id
                ? api.patch(`/expeditions/${editing._id}`, formData)
                : api.post('/expeditions', formData),
            editing._id ? 'Expedition saved.' : 'Expedition created.',
          );
          if (done) setEditing(null);
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button type="button" className="btn btn-primary" onClick={() => setEditing({})}>
          New expedition
        </button>
      </div>

      <Table
        list={list}
        columns={['Name', 'Price', 'Departures (booked / seats)', 'Rating', '']}
      >
        {(expedition) => (
          <tr key={expedition._id}>
            <td>
              <Link
                to={`/expeditions/${expedition.slug}`}
                className="font-medium hover:underline"
              >
                {expedition.name}
              </Link>
              <span className="block text-xs text-ink-soft">{expedition.region}</span>
            </td>
            <td className="whitespace-nowrap">{formatPrice(expedition.price)}</td>
            <td>
              <ul className="space-y-0.5">
                {byDate(expedition.departures).map((d) => (
                  <li key={d._id} className="whitespace-nowrap">
                    {formatDate(d.date)}{' '}
                    <span className={d.soldOut ? 'text-clay-dark' : 'text-ink-soft'}>
                      {d.participants}/{expedition.maxGroupSize}
                      {d.soldOut && ' sold out'}
                    </span>
                  </li>
                ))}
              </ul>
            </td>
            <td className="whitespace-nowrap">
              ★ {expedition.ratingsAverage} ({expedition.ratingsQuantity})
            </td>
            <td className="space-x-4 text-right whitespace-nowrap">
              <button
                type="button"
                className="font-medium underline underline-offset-4"
                onClick={() => openEditor(expedition._id)}
              >
                Edit
              </button>
              <DeleteButton
                what={expedition.name}
                onConfirm={() =>
                  act(
                    () => api.delete(`/expeditions/${expedition._id}`),
                    'Expedition deleted.',
                  )
                }
              />
            </td>
          </tr>
        )}
      </Table>
    </div>
  );
}
