import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { api } from '../lib/api';

// Switches two-factor authentication on (scan, confirm, save recovery codes)
// or off (password plus a current code).
export default function TwoFactorSettings() {
  const { user, setUser } = useAuth();
  const notify = useToast();

  const [setup, setSetup] = useState(null); // { secret, qr } while enrolling
  const [recoveryCodes, setRecoveryCodes] = useState(null);
  const [pending, setPending] = useState(false);

  const run = async (action) => {
    setPending(true);
    try {
      await action();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setPending(false);
    }
  };

  const start = () =>
    run(async () => {
      const res = await api.post('/auth/2fa/setup');
      setSetup(res.data);
    });

  const confirm = (event) => {
    event.preventDefault();
    const { code } = Object.fromEntries(new FormData(event.currentTarget));

    run(async () => {
      const res = await api.post('/auth/2fa/enable', { code });
      setRecoveryCodes(res.data.recoveryCodes);
      setSetup(null);
      setUser({ ...user, twoFactorEnabled: true });
      notify('Two-factor authentication is on.');
    });
  };

  const disable = (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));

    run(async () => {
      await api.post('/auth/2fa/disable', values);
      setRecoveryCodes(null);
      setUser({ ...user, twoFactorEnabled: false });
      notify('Two-factor authentication is off.');
    });
  };

  return (
    <section className="card space-y-4 p-6 md:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl">Two-factor authentication</h2>
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            user.twoFactorEnabled ? 'bg-moss/15 text-moss' : 'bg-ink/5 text-ink-soft'
          }`}
        >
          {user.twoFactorEnabled ? 'On' : 'Off'}
        </span>
      </div>

      {recoveryCodes && (
        <div className="rounded-xl bg-sand p-4">
          <p className="text-sm font-medium">Save these recovery codes now</p>
          <p className="mt-1 text-sm text-ink-soft">
            Each one logs you in once if you lose your phone. They will not be shown
            again.
          </p>
          <ul className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-sm sm:grid-cols-4">
            {recoveryCodes.map((code) => (
              <li key={code}>{code}</li>
            ))}
          </ul>
          <button
            type="button"
            className="btn btn-quiet mt-3"
            onClick={() => setRecoveryCodes(null)}
          >
            I have saved them
          </button>
        </div>
      )}

      {!user.twoFactorEnabled && !setup && (
        <>
          <p className="text-sm text-ink-soft">
            Ask for a code from an authenticator app (Google Authenticator, 1Password,
            Authy) each time you log in, on top of your password.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={start}
            disabled={pending}
          >
            Set up two-factor
          </button>
        </>
      )}

      {setup && (
        <div className="grid gap-6 sm:grid-cols-[auto_1fr] sm:items-start">
          <img
            src={setup.qr}
            alt="QR code to scan with an authenticator app"
            className="h-44 w-44 rounded-xl border border-line bg-white p-2"
          />
          <form onSubmit={confirm} className="space-y-3">
            <p className="text-sm text-ink-soft">
              Scan the code with your authenticator app, or type this key in by hand:
            </p>
            <p className="font-mono text-sm break-all">{setup.secret}</p>
            <label className="block">
              <span className="label">6-digit code from the app</span>
              <input
                className="input max-w-40"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9 ]{6,7}"
                required
              />
            </label>
            <div className="flex gap-2">
              <button className="btn btn-primary" disabled={pending}>
                Switch on
              </button>
              <button
                type="button"
                className="btn btn-quiet"
                onClick={() => setSetup(null)}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {user.twoFactorEnabled && !recoveryCodes && (
        <form
          onSubmit={disable}
          className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        >
          <label className="block">
            <span className="label">Password</span>
            <input
              className="input"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          <label className="block">
            <span className="label">Code from the app</span>
            <input
              className="input"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
            />
          </label>
          <button className="btn btn-quiet text-clay-dark" disabled={pending}>
            Switch off
          </button>
        </form>
      )}
    </section>
  );
}
