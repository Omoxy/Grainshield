export default function StorageLoading() {
  return (
    <div className="max-w-5xl">
      <div className="mb-5">
        <div className="h-6 w-24 bg-surface-sunken animate-pulse mb-2" />
        <p className="text-sm text-ink-muted">Retrieving warehouse receipt records...</p>
      </div>

      <div className="card p-4 mb-4">
        <div className="flex items-center gap-2 text-sm text-ink-muted">
          <div className="w-3 h-3 bg-surface-sunken animate-pulse" />
          Loading storage summary...
        </div>
      </div>

      <div className="space-y-3">
        {[1, 2].map((i) => (
          <div key={i} className="card p-4">
            <div className="flex items-center gap-2 text-sm text-ink-muted">
              <div className="w-3 h-3 bg-surface-sunken animate-pulse" />
              Loading receipt details...
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
