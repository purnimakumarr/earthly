import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { api } from '../lib/api';

export default function Profile() {
  const { user, setUser } = useAuth();
  const notify = useToast();
  const [saving, setSaving] = useState(null);

  const run = async (section, action, successMessage, form) => {
    setSaving(section);
    try {
      await action();
      notify(successMessage);
      if (section === 'password') form.reset();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setSaving(null);
    }
  };

  const saveDetails = (event) => {
    event.preventDefault();
    // Sent as multipart so the photo can travel with the text fields.
    const data = new FormData(event.currentTarget);
    if (!data.get('photo')?.size) data.delete('photo');

    run(
      'details',
      async () => {
        const res = await api.patch('/users/me', data);
        setUser(res.data);
      },
      'Profile saved.',
    );
  };

  const savePassword = (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));

    run(
      'password',
      async () => {
        const res = await api.patch('/users/me/password', values);
        setUser(res.data);
      },
      'Password changed.',
      form,
    );
  };

  return (
    <div className="grid gap-8 md:grid-cols-2">
      <form onSubmit={saveDetails} className="card space-y-4 p-6">
        <h2 className="text-xl">Your details</h2>
        <label className="block">
          <span className="label">Full name</span>
          <input className="input" name="name" defaultValue={user.name} required />
        </label>
        <label className="block">
          <span className="label">Email</span>
          <input
            className="input"
            name="email"
            type="email"
            defaultValue={user.email}
            required
          />
        </label>
        <label className="block">
          <span className="label">Profile photo</span>
          <input
            className="block w-full text-sm text-ink-soft file:mr-3 file:cursor-pointer file:rounded-lg file:border file:border-line file:bg-paper file:px-3 file:py-2 file:text-sm file:font-medium file:text-ink"
            name="photo"
            type="file"
            accept="image/*"
          />
        </label>
        <button className="btn btn-primary" disabled={saving === 'details'}>
          {saving === 'details' ? 'Saving…' : 'Save details'}
        </button>
      </form>

      <form onSubmit={savePassword} className="card space-y-4 p-6">
        <h2 className="text-xl">Change password</h2>
        <label className="block">
          <span className="label">Current password</span>
          <input
            className="input"
            name="passwordCurrent"
            type="password"
            autoComplete="current-password"
            required
          />
        </label>
        <label className="block">
          <span className="label">New password</span>
          <input
            className="input"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </label>
        <label className="block">
          <span className="label">Confirm new password</span>
          <input
            className="input"
            name="passwordConfirm"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </label>
        <button className="btn btn-primary" disabled={saving === 'password'}>
          {saving === 'password' ? 'Saving…' : 'Change password'}
        </button>
      </form>
    </div>
  );
}
