import { useState } from 'react';
import { byDate } from '../../lib/format';
import { useAll } from './shared';

const DIFFICULTIES = ['easy', 'moderate', 'challenging'];
const FILE_INPUT =
  'block w-full text-sm text-ink-soft file:mr-3 file:cursor-pointer file:rounded-lg file:border file:border-line file:bg-paper file:px-3 file:py-2 file:text-sm file:font-medium file:text-ink';

let rowKey = 0;
const withKey = (row) => ({ key: (rowKey += 1), ...row });

// Departures leave at 09:30 India time.
const toIso = (day) => new Date(`${day}T04:00:00.000Z`).toISOString();
const toDay = (iso) => new Date(iso).toISOString().slice(0, 10);

// GeoJSON stores [longitude, latitude]; the form shows them the usual way round.
const fromPoint = (point = {}) => ({
  lat: point.coordinates?.[1] ?? '',
  lng: point.coordinates?.[0] ?? '',
  description: point.description ?? '',
});
const toPoint = ({ lat, lng, description }) => ({
  type: 'Point',
  coordinates: [Number(lng), Number(lat)],
  description,
});

const blank = {
  name: '',
  region: '',
  duration: '',
  maxGroupSize: '',
  difficulty: 'moderate',
  price: '',
  summary: '',
  description: '',
  guides: [],
};

// Create and edit form for one expedition, used by the Expeditions tab.
export default function ExpeditionForm({ expedition, onSave, onCancel }) {
  const isNew = !expedition._id;
  const staff = useAll('/users?role[ne]=traveler&sort=name');
  const guides = (staff.rows || []).filter((u) => ['guide', 'lead'].includes(u.role));

  const [fields, setFields] = useState(() => ({
    ...blank,
    ...Object.fromEntries(
      Object.keys(blank)
        .filter((key) => expedition[key] !== undefined)
        .map((key) => [key, expedition[key]]),
    ),
    guides: (expedition.guides || []).map((guide) => guide._id || guide),
  }));
  const [start, setStart] = useState(() => fromPoint(expedition.startLocation));
  const [stops, setStops] = useState(() =>
    (expedition.locations || []).map((stop) =>
      withKey({ ...fromPoint(stop), day: stop.day ?? '' }),
    ),
  );
  const [departures, setDepartures] = useState(() =>
    byDate(expedition.departures).map((d) =>
      withKey({ _id: d._id, day: toDay(d.date), participants: d.participants }),
    ),
  );
  const [saving, setSaving] = useState(false);

  const set = (key) => (event) =>
    setFields((current) => ({ ...current, [key]: event.target.value }));

  // Helpers for the repeatable rows (stops and departures).
  const editRow = (setRows, key, field) => (event) =>
    setRows((rows) =>
      rows.map((row) =>
        row.key === key ? { ...row, [field]: event.target.value } : row,
      ),
    );
  const dropRow = (setRows, key) => () =>
    setRows((rows) => rows.filter((row) => row.key !== key));

  const toggleGuide = (id) =>
    setFields((current) => ({
      ...current,
      guides: current.guides.includes(id)
        ? current.guides.filter((guide) => guide !== id)
        : [...current.guides, id],
    }));

  const handleSubmit = async (event) => {
    event.preventDefault();
    const files = new FormData(event.currentTarget);

    const data = {
      ...fields,
      duration: Number(fields.duration),
      maxGroupSize: Number(fields.maxGroupSize),
      price: Number(fields.price),
      startLocation: toPoint(start),
      locations: stops.map((stop) => ({ ...toPoint(stop), day: Number(stop.day) })),
      // Existing departures keep their id, so their bookings stay attached.
      // Seat counts are not sent: the API owns them.
      departures: departures.map((d) => ({
        ...(d._id && { _id: d._id }),
        date: toIso(d.day),
      })),
    };

    // Nested values go in one JSON part; the images travel beside it.
    const body = new FormData();
    body.append('data', JSON.stringify(data));
    const cover = files.get('coverImage');
    if (cover?.size) body.append('coverImage', cover);
    files
      .getAll('images')
      .filter((file) => file.size)
      .slice(0, 3)
      .forEach((file) => body.append('images', file));

    setSaving(true);
    await onSave(body);
    setSaving(false);
  };

  const input = (key, props = {}) => (
    <input
      className="input"
      value={fields[key]}
      onChange={set(key)}
      required
      {...props}
    />
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl">
          {isNew ? 'New expedition' : `Edit: ${expedition.name}`}
        </h2>
        <div className="flex gap-2">
          <button type="button" className="btn btn-quiet" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save expedition'}
          </button>
        </div>
      </div>

      <section className="card grid gap-4 p-6 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block sm:col-span-2">
          <span className="label">Name</span>
          {input('name', { minLength: 8, maxLength: 60 })}
        </label>
        <label className="block sm:col-span-2">
          <span className="label">Region</span>
          {input('region')}
        </label>
        <label className="block">
          <span className="label">Duration (days)</span>
          {input('duration', { type: 'number', min: 1 })}
        </label>
        <label className="block">
          <span className="label">Group size</span>
          {input('maxGroupSize', { type: 'number', min: 1 })}
        </label>
        <label className="block">
          <span className="label">Difficulty</span>
          <select
            className="input"
            value={fields.difficulty}
            onChange={set('difficulty')}
          >
            {DIFFICULTIES.map((level) => (
              <option key={level} value={level}>
                {level[0].toUpperCase() + level.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">Price per person (INR)</span>
          {input('price', { type: 'number', min: 0 })}
        </label>
        <label className="block sm:col-span-2 lg:col-span-4">
          <span className="label">One-line summary</span>
          {input('summary')}
        </label>
        <label className="block sm:col-span-2 lg:col-span-4">
          <span className="label">Description</span>
          <textarea
            className="input"
            rows={5}
            value={fields.description}
            onChange={set('description')}
          />
        </label>
      </section>

      <section className="card space-y-4 p-6">
        <h3 className="text-xl">Photos</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="label">Cover image</span>
            <input
              className={FILE_INPUT}
              name="coverImage"
              type="file"
              accept="image/*"
              required={isNew}
            />
          </label>
          <label className="block">
            <span className="label">Gallery (up to 3, replaces the current set)</span>
            <input
              className={FILE_INPUT}
              name="images"
              type="file"
              accept="image/*"
              multiple
            />
          </label>
        </div>
        {!isNew && (
          <div className="flex flex-wrap gap-2">
            {[expedition.coverImage, ...(expedition.images || [])].map((src) => (
              <img
                key={src}
                src={src}
                alt=""
                className="h-16 w-24 rounded-lg object-cover"
              />
            ))}
          </div>
        )}
      </section>

      <section className="card space-y-4 p-6">
        <h3 className="text-xl">Departures</h3>
        {departures.length === 0 && (
          <p className="text-sm text-ink-soft">No departures yet.</p>
        )}
        <ul className="space-y-2">
          {departures.map((d) => (
            <li key={d.key} className="flex flex-wrap items-center gap-3">
              <input
                className="input w-auto"
                type="date"
                aria-label="Departure date"
                value={d.day}
                onChange={editRow(setDepartures, d.key, 'day')}
                required
              />
              <span className="text-sm text-ink-soft">
                {d.participants} of {fields.maxGroupSize || '?'} places booked
              </span>
              {/* A departure with bookings cannot be removed from here. */}
              {d.participants === 0 && (
                <button
                  type="button"
                  className="text-sm font-medium text-clay-dark underline underline-offset-4"
                  onClick={dropRow(setDepartures, d.key)}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="btn btn-quiet"
          onClick={() =>
            setDepartures((rows) => [...rows, withKey({ day: '', participants: 0 })])
          }
        >
          Add a departure
        </button>
      </section>

      <section className="card space-y-4 p-6">
        <h3 className="text-xl">Route</h3>
        <div className="grid gap-4 sm:grid-cols-[1fr_8rem_8rem]">
          <label className="block">
            <span className="label">Starting point</span>
            <input
              className="input"
              value={start.description}
              onChange={(e) => setStart({ ...start, description: e.target.value })}
              placeholder="Kaza, Himachal Pradesh"
              required
            />
          </label>
          <label className="block">
            <span className="label">Latitude</span>
            <input
              className="input"
              type="number"
              step="any"
              min="-90"
              max="90"
              value={start.lat}
              onChange={(e) => setStart({ ...start, lat: e.target.value })}
              required
            />
          </label>
          <label className="block">
            <span className="label">Longitude</span>
            <input
              className="input"
              type="number"
              step="any"
              min="-180"
              max="180"
              value={start.lng}
              onChange={(e) => setStart({ ...start, lng: e.target.value })}
              required
            />
          </label>
        </div>

        <p className="label">Stops along the way</p>
        <ul className="space-y-2">
          {stops.map((stop) => (
            <li
              key={stop.key}
              className="grid gap-2 sm:grid-cols-[5rem_1fr_8rem_8rem_auto]"
            >
              <input
                className="input"
                type="number"
                min="1"
                placeholder="Day"
                aria-label="Day"
                value={stop.day}
                onChange={editRow(setStops, stop.key, 'day')}
                required
              />
              <input
                className="input"
                placeholder="Place"
                aria-label="Place"
                value={stop.description}
                onChange={editRow(setStops, stop.key, 'description')}
                required
              />
              <input
                className="input"
                type="number"
                step="any"
                placeholder="Latitude"
                aria-label="Latitude"
                value={stop.lat}
                onChange={editRow(setStops, stop.key, 'lat')}
                required
              />
              <input
                className="input"
                type="number"
                step="any"
                placeholder="Longitude"
                aria-label="Longitude"
                value={stop.lng}
                onChange={editRow(setStops, stop.key, 'lng')}
                required
              />
              <button
                type="button"
                className="text-sm font-medium text-clay-dark underline underline-offset-4"
                onClick={dropRow(setStops, stop.key)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="btn btn-quiet"
          onClick={() =>
            setStops((rows) => [
              ...rows,
              withKey({ day: '', description: '', lat: '', lng: '' }),
            ])
          }
        >
          Add a stop
        </button>
      </section>

      <section className="card space-y-3 p-6">
        <h3 className="text-xl">Guides</h3>
        {guides.length === 0 && (
          <p className="text-sm text-ink-soft">
            No guides yet. Give someone the guide or lead role on the Users tab.
          </p>
        )}
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {guides.map((guide) => (
            <label key={guide._id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="accent-ink"
                checked={fields.guides.includes(guide._id)}
                onChange={() => toggleGuide(guide._id)}
              />
              {guide.name}
            </label>
          ))}
        </div>
      </section>
    </form>
  );
}
