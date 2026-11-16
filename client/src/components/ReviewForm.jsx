import { useState } from 'react';

export default function ReviewForm({ initial, submitLabel, onSubmit, onCancel }) {
  const [pending, setPending] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    setPending(true);
    await onSubmit({ review: values.review, rating: Number(values.rating) });
    setPending(false);
  };

  return (
    <form onSubmit={handleSubmit} className="mt-3 space-y-3">
      <label className="block">
        <span className="label">Rating</span>
        <select
          name="rating"
          defaultValue={initial?.rating ?? 5}
          className="input w-auto"
        >
          {[5, 4, 3, 2, 1].map((n) => (
            <option key={n} value={n}>
              {n} star{n === 1 ? '' : 's'}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="label">Your review</span>
        <textarea
          name="review"
          rows={3}
          maxLength={1000}
          required
          defaultValue={initial?.review}
          className="input"
        />
      </label>
      <div className="flex gap-2">
        <button className="btn btn-primary" disabled={pending}>
          {pending ? 'Saving…' : submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="btn btn-quiet" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
