export default function AdminClaimsLoading() {
  return (
    <div className="max-w-7xl">
      <div className="mb-5">
        <div className="h-6 w-40 bg-surface-sunken animate-pulse mb-2" />
        <p className="text-sm text-ink-muted">Loading claims queue and review status...</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {["Pending review", "Total claims", "Approved", "Fraud flags"].map((label) => (
          <div key={label} className="card p-4">
            <p className="text-2xs text-ink-muted uppercase tracking-wide mb-1">{label}</p>
            <div className="h-5 w-12 bg-surface-sunken animate-pulse" />
          </div>
        ))}
      </div>

      <div className="card p-4">
        <div className="flex items-center gap-2 text-sm text-ink-muted">
          <div className="w-3 h-3 bg-surface-sunken animate-pulse" />
          Retrieving claim records...
        </div>
      </div>
    </div>
  );
}
