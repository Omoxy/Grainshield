export default function AdminOverviewLoading() {
  return (
    <div className="max-w-7xl">
      <div className="mb-4">
        <div className="h-6 w-44 bg-surface-sunken animate-pulse mb-2" />
        <p className="text-sm text-ink-muted">Loading operational status and risk posture...</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-border mb-4">
        {["Active farmers", "Grain protected", "Loan exposure", "Pending claims"].map((label) => (
          <div key={label} className="card p-3 border-0">
            <p className="text-2xs text-ink-muted uppercase tracking-wide mb-1.5">{label}</p>
            <div className="h-5 w-16 bg-surface-sunken animate-pulse" />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 card p-4">
          <div className="flex items-center gap-2 text-sm text-ink-muted">
            <div className="w-3 h-3 bg-surface-sunken animate-pulse" />
            Loading active risk alerts...
          </div>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-2 text-sm text-ink-muted">
            <div className="w-3 h-3 bg-surface-sunken animate-pulse" />
            Checking platform services...
          </div>
        </div>
      </div>
    </div>
  );
}
