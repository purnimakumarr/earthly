export default function Stars({ rating }) {
  return (
    <span className="inline-flex" role="img" aria-label={`${rating} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <svg
          key={n}
          viewBox="0 0 20 20"
          className={`h-4 w-4 ${n <= Math.round(rating) ? 'fill-clay' : 'fill-line'}`}
        >
          <path d="M10 1.5l2.6 5.4 5.9.8-4.3 4.1 1 5.800L10 14.900l-5.200 2.700 1-5.800L1.500 7.700l5.900-.8z" />
        </svg>
      ))}
    </span>
  );
}
