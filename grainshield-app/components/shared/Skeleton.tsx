"use client";

export function SkeletonText({
  width = "100%",
  height = 14,
}: {
  width?: string | number;
  height?: number;
}) {
  return (
    <div
      className="bg-surface-sunken animate-pulse"
      style={{ width, height, minHeight: height }}
      role="status"
      aria-label="Loading"
    />
  );
}

export function SkeletonCard() {
  return (
    <div className="card p-4 flex-1 min-w-[140px]">
      <SkeletonText width="60%" height={10} />
      <div className="mt-3">
        <SkeletonText width="50%" height={22} />
      </div>
      <div className="mt-2">
        <SkeletonText width="80%" height={10} />
      </div>
    </div>
  );
}

export function SkeletonTable({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="card overflow-hidden">
      <div className="flex gap-2 p-3 border-b border-border bg-surface-raised">
        {Array.from({ length: cols }).map((_, i) => (
          <div key={i} className="flex-1">
            <SkeletonText height={10} width="70%" />
          </div>
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          className="flex gap-2 p-3 border-b border-border-subtle"
          style={{ animationDelay: `${r * 60}ms` }}
        >
          {Array.from({ length: cols }).map((_, c) => (
            <div key={c} className="flex-1">
              <SkeletonText height={12} width={c === 0 ? "80%" : "60%"} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonCardRow({ count = 4 }: { count?: number }) {
  return (
    <div className="flex gap-4 flex-wrap">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

export function SkeletonRiskBars({ count = 5 }: { count?: number }) {
  return (
    <div className="card p-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="mb-3">
          <SkeletonText width="40%" height={10} />
          <div className="mt-2">
            <SkeletonText height={8} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ErrorCard({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="card p-5 border-status-warning bg-status-warning-surface">
      <div className="text-sm text-status-warning mb-1">{message}</div>
      <p className="text-2xs text-yellow-700/60 mb-3">This may be a temporary issue. If it persists, contact support.</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="btn-primary"
          type="button"
        >
          Retry
        </button>
      )}
    </div>
  );
}
