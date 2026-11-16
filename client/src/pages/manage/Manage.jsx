import { NavLink, Outlet } from 'react-router-dom';

const TABS = [
  { to: '/manage', label: 'Expeditions', end: true },
  { to: '/manage/bookings', label: 'Bookings' },
  { to: '/manage/reviews', label: 'Reviews' },
  { to: '/manage/users', label: 'Users' },
];

export default function Manage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <p className="eyebrow">Earthly team</p>
      <h1 className="mt-1 text-3xl">Manage</h1>

      <nav
        className="mt-6 flex gap-1 overflow-x-auto border-b border-line"
        aria-label="Manage sections"
      >
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
