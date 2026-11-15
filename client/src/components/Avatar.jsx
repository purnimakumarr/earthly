import { initials } from '../lib/format';

const SIZES = { sm: 'h-8 w-8 text-xs', md: 'h-11 w-11 text-sm', lg: 'h-20 w-20 text-xl' };

// Shows the uploaded photo, or the person's initials when there is none.
export default function Avatar({ user, size = 'md' }) {
  const box = `${SIZES[size]} shrink-0 rounded-full`;

  if (user?.photo) {
    return <img src={user.photo} alt="" className={`${box} object-cover`} />;
  }

  return (
    <span
      aria-hidden="true"
      className={`${box} flex items-center justify-center bg-ink/10 font-semibold text-ink`}
    >
      {initials(user?.name)}
    </span>
  );
}
