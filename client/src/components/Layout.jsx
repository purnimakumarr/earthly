import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import Avatar from './Avatar';
import Logo from './Logo';

export default function Layout() {
  const { user, logout } = useAuth();
  const notify = useToast();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    notify('You have been logged out.');
    navigate('/');
  };

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-line bg-paper/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link to="/" aria-label="Earthly home">
            <Logo />
          </Link>

          <nav className="flex items-center gap-2 text-sm sm:gap-4">
            <NavLink
              to="/"
              className="hidden px-2 py-1 text-ink-soft hover:text-ink sm:block"
            >
              Expeditions
            </NavLink>
            <a
              href="/api/docs"
              className="hidden px-2 py-1 text-ink-soft hover:text-ink sm:block"
            >
              API
            </a>

            {user ? (
              <>
                <Link
                  to="/account"
                  className="flex items-center gap-2 rounded-full py-1 pr-3 pl-1 hover:bg-ink/5"
                >
                  <Avatar user={user} size="sm" />
                  <span className="font-medium">{user.name.split(' ')[0]}</span>
                </Link>
                <button type="button" onClick={handleLogout} className="btn btn-quiet">
                  Log out
                </button>
              </>
            ) : (
              user === null && (
                <>
                  <Link to="/login" className="btn btn-quiet">
                    Log in
                  </Link>
                  <Link to="/signup" className="btn btn-primary">
                    Sign up
                  </Link>
                </>
              )
            )}
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-line bg-paper">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-x-3 gap-y-2 px-4 py-8 text-center text-sm text-ink-soft sm:flex-row sm:flex-wrap sm:justify-center sm:px-6">
          <p>© {new Date().getFullYear()} Earthly. All rights reserved.</p>
          <span aria-hidden="true" className="hidden sm:inline">
            ·
          </span>
          <p>
            Created by{' '}
            <a
              href="https://github.com/purnimakumarr"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 align-bottom font-medium text-ink underline underline-offset-4 hover:text-clay"
            >
              <svg viewBox="0 0 16 16" className="h-4 w-4 fill-current" aria-hidden="true">
                <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
              </svg>
              Purnima Kumar
            </a>
          </p>
          <span aria-hidden="true" className="hidden sm:inline">
            ·
          </span>
          <p>Demo project, no real trips are sold.</p>
        </div>
      </footer>
    </div>
  );
}
