export default function Logo({ className = '' }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden="true">
        <circle cx="16" cy="16" r="15" className="fill-ink" />
        <path
          d="M3.5 19.5c4-3 7.5-3 11 0s7.500 3 14 -1.500"
          fill="none"
          stroke="#f4efe6"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          d="M6 24c3.500-2 6.500-2 9.500 0s6 2 10-.5"
          fill="none"
          stroke="#d98a5f"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle cx="21" cy="10.500" r="3" fill="#d98a5f" />
      </svg>
      <span className="font-display text-2xl leading-none font-medium tracking-tight">
        earthly
      </span>
    </span>
  );
}
