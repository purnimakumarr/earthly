import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { api } from '../lib/api';

function AuthCard({ title, intro, children, footer }) {
  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <div className="card p-8">
        <h1 className="text-3xl">{title}</h1>
        {intro && <p className="mt-2 text-sm text-ink-soft">{intro}</p>}
        <div className="mt-6">{children}</div>
      </div>
      {footer && <p className="mt-5 text-center text-sm text-ink-soft">{footer}</p>}
    </div>
  );
}

function Field({ label, ...props }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input className="input" required {...props} />
    </label>
  );
}

// Shared submit handling: tracks the pending state and shows API errors inline.
function useSubmit(action) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  const onSubmit = async (event) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await action(Object.fromEntries(new FormData(event.currentTarget)));
    } catch (err) {
      setError(err.message);
    } finally {
      setPending(false);
    }
  };

  return { pending, error, onSubmit };
}

function FormError({ message }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-lg bg-clay/10 px-3 py-2 text-sm text-clay-dark">
      {message}
    </p>
  );
}

const linkClass = 'font-medium text-ink underline underline-offset-4';

export function Login() {
  const { user, login } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const destination = location.state?.from || '/';

  const form = useSubmit(async (values) => {
    await login(values);
    navigate(destination, { replace: true });
  });

  if (user) return <Navigate to={destination} replace />;

  return (
    <AuthCard
      title="Welcome back"
      footer={
        <>
          New here?{' '}
          <Link to="/signup" className={linkClass}>
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={form.onSubmit} className="space-y-4">
        <Field label="Email" name="email" type="email" autoComplete="email" />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          minLength={8}
        />
        <FormError message={form.error} />
        <button className="btn btn-primary w-full" disabled={form.pending}>
          {form.pending ? 'Logging in…' : 'Log in'}
        </button>
        <p className="text-center text-sm">
          <Link
            to="/forgot-password"
            className="text-ink-soft underline underline-offset-4"
          >
            Forgot your password?
          </Link>
        </p>
      </form>
    </AuthCard>
  );
}

export function Signup() {
  const { user, signup } = useAuth();
  const notify = useToast();
  const navigate = useNavigate();

  const form = useSubmit(async (values) => {
    await signup(values);
    notify('Account created. Welcome to Earthly.');
    navigate('/', { replace: true });
  });

  if (user) return <Navigate to="/" replace />;

  return (
    <AuthCard
      title="Create your account"
      intro="You need an account to book an expedition and to leave reviews."
      footer={
        <>
          Already have one?{' '}
          <Link to="/login" className={linkClass}>
            Log in
          </Link>
        </>
      }
    >
      <form onSubmit={form.onSubmit} className="space-y-4">
        <Field label="Full name" name="name" autoComplete="name" />
        <Field label="Email" name="email" type="email" autoComplete="email" />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
        />
        <Field
          label="Confirm password"
          name="passwordConfirm"
          type="password"
          autoComplete="new-password"
          minLength={8}
        />
        <FormError message={form.error} />
        <button className="btn btn-primary w-full" disabled={form.pending}>
          {form.pending ? 'Creating account…' : 'Sign up'}
        </button>
      </form>
    </AuthCard>
  );
}

export function ForgotPassword() {
  const [sent, setSent] = useState(false);

  const form = useSubmit(async (values) => {
    await api.post('/auth/forgot-password', values);
    setSent(true);
  });

  return (
    <AuthCard
      title="Reset your password"
      intro="Enter the email on your account and we will send a link that is valid for 10 minutes."
      footer={
        <Link to="/login" className={linkClass}>
          Back to log in
        </Link>
      }
    >
      {sent ? (
        <p className="rounded-lg bg-moss/10 px-3 py-3 text-sm text-ink">
          If that address has an account, a reset link is on its way. Check your inbox.
        </p>
      ) : (
        <form onSubmit={form.onSubmit} className="space-y-4">
          <Field label="Email" name="email" type="email" autoComplete="email" />
          <FormError message={form.error} />
          <button className="btn btn-primary w-full" disabled={form.pending}>
            {form.pending ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
      )}
    </AuthCard>
  );
}

export function ResetPassword() {
  const { token } = useParams();
  const { setUser } = useAuth();
  const notify = useToast();
  const navigate = useNavigate();

  const form = useSubmit(async (values) => {
    const res = await api.patch(`/auth/reset-password/${token}`, values);
    setUser(res.data);
    notify('Password updated. You are logged in.');
    navigate('/', { replace: true });
  });

  return (
    <AuthCard title="Choose a new password">
      <form onSubmit={form.onSubmit} className="space-y-4">
        <Field
          label="New password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
        />
        <Field
          label="Confirm new password"
          name="passwordConfirm"
          type="password"
          autoComplete="new-password"
          minLength={8}
        />
        <FormError message={form.error} />
        <button className="btn btn-primary w-full" disabled={form.pending}>
          {form.pending ? 'Saving…' : 'Save password'}
        </button>
      </form>
    </AuthCard>
  );
}
