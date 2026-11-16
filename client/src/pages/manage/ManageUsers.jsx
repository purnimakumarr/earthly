import Avatar from '../../components/Avatar';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../lib/api';
import { ROLE_LABELS } from '../../lib/format';
import { DeleteButton, Table, useAction, useList } from './shared';

const ROLES = ['traveler', 'guide', 'lead', 'admin'];

export default function ManageUsers() {
  const { user: me } = useAuth();
  const list = useList('/users?sort=name');
  const act = useAction(list.reload);

  return (
    <Table list={list} columns={['Name', 'Email', 'Role', '']}>
      {(user) => (
        <tr key={user._id}>
          <td>
            <span className="flex items-center gap-2 font-medium">
              <Avatar user={user} size="sm" />
              {user.name}
            </span>
          </td>
          <td>
            {user.email}
            {!user.emailVerified && (
              <span className="block text-xs text-clay-dark">Not confirmed</span>
            )}
            {user.active === false && (
              <span className="block text-xs text-clay-dark">
                Deactivated by the user
              </span>
            )}
          </td>
          <td>
            {/* Changing your own role here would lock you out of this page. */}
            <select
              className="input w-auto py-1.5"
              aria-label={`Role of ${user.name}`}
              value={user.role}
              disabled={user._id === me._id}
              onChange={(event) =>
                act(
                  () => api.patch(`/users/${user._id}`, { role: event.target.value }),
                  `${user.name} is now: ${ROLE_LABELS[event.target.value]}.`,
                )
              }
            >
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </select>
          </td>
          <td className="space-x-4 text-right whitespace-nowrap">
            {user.active === false && (
              <button
                type="button"
                className="font-medium underline underline-offset-4"
                onClick={() =>
                  act(
                    () => api.patch(`/users/${user._id}`, { active: true }),
                    `${user.name} can log in again.`,
                  )
                }
              >
                Reactivate
              </button>
            )}
            {user._id !== me._id && (
              <DeleteButton
                what={user.name}
                onConfirm={() =>
                  act(() => api.delete(`/users/${user._id}`), 'User deleted.')
                }
              />
            )}
          </td>
        </tr>
      )}
    </Table>
  );
}
