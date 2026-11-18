export default function AdminFarmersLoading() {
  return (
    <div className="max-w-7xl">
      <div className="mb-5">
        <div className="h-6 w-24 bg-surface-sunken animate-pulse mb-2" />
        <p className="text-sm text-ink-muted">Loading registered accounts and verification records...</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {["Total registered", "KYC approved", "Pending KYC", "Active loans"].map((label) => (
          <div key={label} className="card p-4">
            <p className="text-2xs text-ink-muted uppercase tracking-wide mb-1">{label}</p>
            <div className="h-5 w-16 bg-surface-sunken animate-pulse" />
          </div>
        ))}
      </div>

      <div className="card p-4">
        <div className="flex items-center gap-2 text-sm text-ink-muted">
          <div className="w-3 h-3 bg-surface-sunken animate-pulse" />
          Retrieving farmer records...
        </div>
      </div>
    </div>
  );
}
