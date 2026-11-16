import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import ExpeditionCard from '../components/ExpeditionCard';
import Spinner from '../components/Spinner';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';

export default function Favourites() {
  const { user } = useAuth();
  const [expeditions, setExpeditions] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .get('/users/me/favourites')
      .then((res) => setExpeditions(res.data))
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <p className="text-ink-soft">{error}</p>;
  if (!expeditions) return <Spinner />;

  // Un-hearting a card removes it from this page without a refetch.
  const liked = expeditions.filter((e) => user.favourites?.includes(e._id));

  if (liked.length === 0) {
    return (
      <div className="card p-10 text-center">
        <p className="text-ink-soft">
          Nothing saved yet. Tap the heart on an expedition to keep it here.
        </p>
        <Link to="/" className="btn btn-primary mt-4">
          Browse expeditions
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-6 sm:grid-cols-2">
      {liked.map((expedition) => (
        <ExpeditionCard key={expedition._id} expedition={expedition} />
      ))}
    </div>
  );
}
