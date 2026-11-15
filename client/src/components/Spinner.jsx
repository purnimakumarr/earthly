export default function Spinner({ label = 'Loading' }) {
  return (
    <div className="flex justify-center py-20" role="status" aria-label={label}>
      <span className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-ink" />
    </div>
  );
}
