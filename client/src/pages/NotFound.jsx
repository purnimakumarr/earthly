import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center">
      <p className="eyebrow">404</p>
      <h1 className="mt-2 text-4xl">Off the map</h1>
      <p className="mt-3 text-ink-soft">
        That page does not exist, or the expedition is no longer offered.
      </p>
      <Link to="/" className="btn btn-primary mt-6">
        See all expeditions
      </Link>
    </div>
  );
}
