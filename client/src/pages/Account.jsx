import { NavLink, Outlet } from 'react-router-dom';
import Avatar from '../components/Avatar';
import { useAuth } from '../context/AuthContext';
import { ROLE_LABELS } from '../lib/format';

const TABS = [
  { to: '/account', label: 'Profile', end: true },
  { to: '/account/bookings', label: 'Bookings' },
  { to: '/account/reviews', label: 'Reviews' },
  { to: '/account/favourites', label: 'Favourites' },
];

export default function Account() {
  const { user } = useAuth();

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <div className="flex items-center gap-4">
        <Avatar user={user} size="lg" />
        <div>
          <h1 className="text-3xl">{user.name}</h1>
          <p className="text-sm text-ink-soft">
            {user.email} · {ROLE_LABELS[user.role]}
          </p>
        </div>
      </div>

      <nav className="mt-8 flex gap-1 border-b border-line" aria-label="Account sections">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              `-mb-px border-b-2 px-4 py-2.5 text-sm font-medium ${
                isActive
                  ? 'border-clay text-ink'
                  : 'border-transparent text-ink-soft hover:text-ink'
              }`
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <div className="py-8">
        <Outlet />
      </div>
    </div>
  );
}
