"use client";

import { useEffect } from "react";
import { Wheat, RotateCcw, Home } from "lucide-react";
import Link from "next/link";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Application error:", error);
  }, [error]);

  return (
    <div className="min-h-screen bg-surface-secondary flex flex-col items-center justify-center px-4">
      <div className="text-center max-w-md">
        <Wheat style={{ width: 16, height: 16 }} className="text-status-danger mx-auto mb-3" />

        <h1 className="text-base font-semibold text-ink mb-1">A system error occurred</h1>
        <p className="text-sm text-ink-tertiary mb-1.5">
          This may be a temporary issue. Try again, or return to the home page. If the problem persists, contact support.
        </p>
        {error.digest && (
          <p className="text-2xs text-ink-faint font-mono mb-5">
            Ref: {error.digest}
          </p>
        )}

        <div className="flex items-center justify-center gap-2">
          <button
            onClick={reset}
            className="btn-primary"
          >
            <RotateCcw style={{ width: 14, height: 14 }} />
            Try Again
          </button>
          <Link
            href="/"
            className="btn-secondary"
          >
            <Home style={{ width: 15, height: 15 }} />
            Home
          </Link>
        </div>
      </div>
    </div>
  );
}
