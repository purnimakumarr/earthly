import { useState } from 'react';
import { api } from '../../lib/api';
import { byDate, formatDate, formatPrice } from '../../lib/format';
import { DeleteButton, Table, useAction, useAll, useList } from './shared';

export default function ManageBookings() {
  const [expeditionId, setExpeditionId] = useState('');
  const [userId, setUserId] = useState('');
  const [adding, setAdding] = useState(false);

  // The filters map onto the nested routes: bookings of one expedition, or
  // of one traveler. With both set, the traveler narrows the expedition's list.
  const path = expeditionId
    ? `/expeditions/${expeditionId}/bookings${userId ? `?user=${userId}` : ''}`
    : userId
      ? `/users/${userId}/bookings`
      : '/bookings';

  const list = useList(path);
  // The dropdowns need every expedition and traveler, not one page of them.
  const expeditions = useAll(
    '/expeditions?fields=name,price,departures,maxGroupSize&sort=name',
  );
  const users = useAll('/users?sort=name');
  const act = useAction(list.reload);

  const addBooking = async (event) => {
    event.preventDefault();
    const { expedition, departure, user, price } = Object.fromEntries(
      new FormData(event.currentTarget),
    );

    const done = await act(
      () =>
        api.post(`/expeditions/${expedition}/bookings`, {
          user,
          departure,
          ...(price && { price: Number(price) }),
        }),
      'Booking added.',
    );
    if (done) {
      setAdding(false);
      expeditions.reload();
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="label">Expedition</span>
          <select
            className="input w-auto"
            value={expeditionId}
            onChange={(event) => setExpeditionId(event.target.value)}
          >
            <option value="">All expeditions</option>
            {(expeditions.rows || []).map((e) => (
              <option key={e._id} value={e._id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">Traveler</span>
          <select
            className="input w-auto"
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
          >
            <option value="">Everyone</option>
            {(users.rows || []).map((u) => (
              <option key={u._id} value={u._id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
        <p className="py-2.5 text-sm text-ink-soft">
          {list.rows ? `${list.total} booking${list.total === 1 ? '' : 's'}` : ''}
        </p>
        <button
          type="button"
          className="btn btn-primary ml-auto"
          onClick={() => setAdding((value) => !value)}
        >
          {adding ? 'Close' : 'Add a booking'}
        </button>
      </div>

      {adding && (
        <AddBookingForm
          expeditions={expeditions.rows || []}
          users={users.rows || []}
          onSubmit={addBooking}
        />
      )}

      <Table
        list={list}
        columns={['Expedition', 'Traveler', 'Departure', 'Price', 'Status', '']}
        empty="No bookings match."
      >
        {(booking) => (
          <tr key={booking._id}>
            <td className="font-medium">{booking.expedition?.name || '—'}</td>
            <td>
              {booking.user?.name || 'Former traveler'}
              <span className="block text-xs text-ink-soft">{booking.user?.email}</span>
            </td>
            <td className="whitespace-nowrap">
              {booking.departureDate ? formatDate(booking.departureDate) : '—'}
              <span className="block text-xs text-ink-soft">
                Booked {formatDate(booking.createdAt)}
              </span>
            </td>
            <td className="whitespace-nowrap">{formatPrice(booking.price)}</td>
            <td>
              <button
                type="button"
                className={`font-medium underline underline-offset-4 ${
                  booking.paid ? 'text-moss' : 'text-clay'
                }`}
                title="Click to change"
                onClick={() =>
                  act(
                    () => api.patch(`/bookings/${booking._id}`, { paid: !booking.paid }),
                    booking.paid ? 'Marked as unpaid.' : 'Marked as paid.',
                  )
                }
              >
                {booking.paid ? 'Paid' : 'Unpaid'}
              </button>
            </td>
            <td className="text-right">
              <DeleteButton
                what="this booking"
                onConfirm={() =>
                  act(
                    () => api.delete(`/bookings/${booking._id}`),
                    'Booking deleted and the seat released.',
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

// For places sold outside the site (phone, bank transfer).
function AddBookingForm({ expeditions, users, onSubmit }) {
  const [expeditionId, setExpeditionId] = useState('');
  const expedition = expeditions.find((e) => e._id === expeditionId);

  return (
    <form
      onSubmit={onSubmit}
      className="card grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-5"
    >
      <label className="block">
        <span className="label">Expedition</span>
        <select
          className="input"
          name="expedition"
          required
          value={expeditionId}
          onChange={(event) => setExpeditionId(event.target.value)}
        >
          <option value="">Choose…</option>
          {expeditions.map((e) => (
            <option key={e._id} value={e._id}>
              {e.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="label">Departure</span>
        <select className="input" name="departure" required key={expeditionId}>
          <option value="">Choose…</option>
          {byDate(expedition?.departures).map((d) => {
            const full = d.soldOut || d.participants >= expedition.maxGroupSize;
            return (
              <option key={d._id} value={d._id} disabled={full}>
                {formatDate(d.date)} ({d.participants}/{expedition.maxGroupSize})
              </option>
            );
          })}
        </select>
      </label>
      <label className="block">
        <span className="label">Traveler</span>
        <select className="input" name="user" required>
          <option value="">Choose…</option>
          {users.map((u) => (
            <option key={u._id} value={u._id}>
              {u.name} ({u.email})
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="label">Price paid (INR)</span>
        <input
          className="input"
          name="price"
          type="number"
          min="0"
          placeholder={expedition ? String(expedition.price) : 'List price'}
        />
      </label>
      <div className="flex items-end">
        <button className="btn btn-primary w-full">Add booking</button>
      </div>
    </form>
  );
}
