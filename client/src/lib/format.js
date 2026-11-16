const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

export const formatPrice = (amount) => inr.format(amount);

export const formatDate = (
  value,
  options = { day: 'numeric', month: 'short', year: 'numeric' },
) => new Date(value).toLocaleDateString('en-IN', options);

export const formatMonth = (value) =>
  formatDate(value, { month: 'long', year: 'numeric' });

export const byDate = (departures = []) =>
  [...departures].sort((a, b) => new Date(a.date) - new Date(b.date));

export const isUpcoming = (departure) => new Date(departure.date) > new Date();

// The next departure still ahead of today, or the most recent one if none are.
export const nextDeparture = (departures = []) => {
  const sorted = byDate(departures);
  return sorted.find(isUpcoming) || sorted.at(-1);
};

export const initials = (name = '') =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');

export const ROLE_LABELS = {
  lead: 'Lead naturalist',
  guide: 'Field guide',
  admin: 'Earthly team',
  traveler: 'Traveler',
};
