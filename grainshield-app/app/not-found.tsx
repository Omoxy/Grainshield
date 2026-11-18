import Link from "next/link";
import { Wheat, ArrowLeft, Home } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4" style={{ background: "#F3F4F1" }}>
      <div className="text-center max-w-md">
        <Wheat style={{ width: 16, height: 16 }} className="text-brand-600 mx-auto mb-3" />

        <h1 className="text-lg font-semibold text-ink mb-0.5 tabular-nums">404</h1>
        <h2 className="text-sm font-medium text-ink-secondary mb-1">Page not found</h2>
        <p className="text-xs text-ink-tertiary mb-5">
          The requested page does not exist or has been moved. If you followed a link, it may be outdated.
        </p>

        <div className="flex items-center justify-center gap-2">
          <Link href="/" className="btn-primary">
            <Home style={{ width: 14, height: 14 }} />
            Home
          </Link>
          <Link href="/farmer/home" className="btn-secondary">
            <ArrowLeft style={{ width: 14, height: 14 }} />
            Farmer Portal
          </Link>
        </div>
      </div>
    </div>
  );
}
