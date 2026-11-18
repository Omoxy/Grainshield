export default function FarmerHomeLoading() {
  return (
    <div className="max-w-5xl">
      <div className="mb-5">
        <div className="h-6 w-44 bg-surface-sunken animate-pulse mb-2" />
        <p className="text-sm text-ink-muted">Loading your grain records and market conditions...</p>
      </div>

      <div className="card p-4 mb-4">
        <div className="flex items-center gap-2 text-sm text-ink-muted">
          <div className="w-3 h-3 bg-surface-sunken animate-pulse" />
          Retrieving storage records...
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div className="card p-4">
          <div className="flex items-center gap-2 text-sm text-ink-muted">
            <div className="w-3 h-3 bg-surface-sunken animate-pulse" />
            Loading current market prices...
          </div>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-2 text-sm text-ink-muted">
            <div className="w-3 h-3 bg-surface-sunken animate-pulse" />
            Checking loan eligibility...
          </div>
        </div>
      </div>

      <div className="card p-4">
        <div className="flex items-center gap-2 text-sm text-ink-muted">
          <div className="w-3 h-3 bg-surface-sunken animate-pulse" />
          Checking for alerts...
        </div>
      </div>
    </div>
  );
}
