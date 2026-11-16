import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

// Heart toggle. Signed-out visitors are sent to log in.
export default function FavouriteButton({ expeditionId, className = '' }) {
  const { user, toggleFavourite } = useAuth();
  const notify = useToast();
  const navigate = useNavigate();

  const liked = Boolean(user?.favourites?.includes(expeditionId));

  const handleClick = () => {
    if (!user) return navigate('/login');
    toggleFavourite(expeditionId).catch((err) => notify(err.message, 'error'));
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-pressed={liked}
      aria-label={liked ? 'Remove from favourites' : 'Add to favourites'}
      title={liked ? 'Remove from favourites' : 'Add to favourites'}
      className={`flex h-9 w-9 items-center justify-center rounded-full bg-paper/95 shadow-sm transition-transform hover:scale-110 ${className}`}
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className={`h-5 w-5 ${liked ? 'fill-clay stroke-clay' : 'fill-none stroke-ink'}`}
        strokeWidth="1.8"
        strokeLinejoin="round"
      >
        <path d="M12 20.5s-7.500-4.400-7.500-10.100A4.400 4.400 0 0 1 12 7.700a4.400 4.400 0 0 1 7.500 2.700c0 5.700-7.500 10.100-7.500 10.100Z" />
      </svg>
    </button>
  );
}
