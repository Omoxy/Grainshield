"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Wheat } from "lucide-react";

const HERO_IMAGES = [
  "/images/pexels-abraham-szilard-2149600427-30743387.jpg",
  "/images/pexels-david-lago-rodriguez-84330347-12600062.jpg",
  "/images/pexels-rakibul-alam-khan-2154391542-33762316.jpg",
];

const TRANSITION_DURATION = 600;
const DISPLAY_DURATION = 10000;

const LIFECYCLE_STEPS = [
  {
    phase: "01",
    title: "Deposit & Receipt",
    body: "Grain received at verified warehouses. Each bag weighed, graded, warehouse receipt issued same day.",
  },
  {
    phase: "02",
    title: "Condition Monitoring",
    body: "Temperature, humidity, moisture recorded continuously. Out-of-range conditions flagged to operators.",
  },
  {
    phase: "03",
    title: "Finance & Coverage",
    body: "Warehouse receipts serve as collateral for short-term credit. Coverage applies to storage loss and pre-harvest weather events.",
  },
  {
    phase: "04",
    title: "Market Timing",
    body: "County-level price data and seasonal patterns available. Reduces pressure to sell at harvest lows.",
  },
];

export default function LandingPage() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);

  const advanceSlide = useCallback(() => {
    setIsTransitioning(true);
    setTimeout(() => {
      setCurrentIndex((prev) => (prev + 1) % HERO_IMAGES.length);
      setIsTransitioning(false);
    }, TRANSITION_DURATION);
  }, []);

  useEffect(() => {
    const timer = setInterval(advanceSlide, DISPLAY_DURATION);
    return () => clearInterval(timer);
  }, [advanceSlide]);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#F3F4F1" }}>
      {/* Navigation — flat, institutional */}
      <nav className="bg-white border-b border-border px-5 sm:px-8 lg:px-10 py-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wheat style={{ width: 16, height: 16 }} className="text-brand-700" />
            <span className="text-[14px] font-semibold text-ink tracking-[-0.01em]">
              GrainShield
            </span>
            <span className="text-[10px] text-ink-muted tracking-[0.06em] uppercase ml-1 hidden sm:inline">
              Grain Operations
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Link
              href="/login"
              className="text-ink-tertiary hover:text-ink px-3 py-1.5 text-[13px] font-medium transition-colors"
            >
              Sign In
            </Link>
            <Link
              href="/register"
              className="bg-brand-700 hover:bg-brand-800 text-white px-3.5 py-[6px] text-[13px] font-medium transition-colors"
            >
              Open Account
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero — daylight, documentary, no cinematic overlay */}
      <div className="relative h-[340px] lg:h-[380px] overflow-hidden">
        {HERO_IMAGES.map((src, i) => (
          <div
            key={src}
            className="absolute inset-0"
            style={{
              transition: `opacity ${TRANSITION_DURATION}ms ease`,
              opacity: i === currentIndex && !isTransitioning ? 1 : 0,
            }}
          >
            <img
              src={src}
              alt=""
              className="w-full h-full object-cover"
              style={{ filter: "brightness(0.85) saturate(0.9)" }}
              aria-hidden="true"
            />
          </div>
        ))}

        {/* Minimal overlay — not cinematic, just readability */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.25) 100%)",
          }}
        />

        <div className="relative z-10 max-w-6xl mx-auto px-5 sm:px-8 lg:px-10 h-full flex items-end pb-8">
          <div>
            <p className="text-[10px] tracking-[0.1em] uppercase text-white/60 font-medium mb-2">
              Uasin Gishu &middot; Trans Nzoia &middot; Kenya
            </p>
            <h1 className="text-[1.35rem] sm:text-[1.55rem] lg:text-[1.75rem] font-semibold text-white tracking-[-0.01em] leading-[1.25] mb-2">
              Grain storage, protection,<br />
              and warehouse receipt finance.
            </h1>
            <p className="text-[12.5px] text-white/65 max-w-md leading-[1.6]">
              Deposit maize at verified warehouses. Monitor conditions.
              Access credit against receipts. Track county-level prices.
            </p>
          </div>
        </div>
      </div>

      {/* Grain Lifecycle — dense, operational, not feature-card layout */}
      <div className="bg-white border-b border-border">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 lg:px-10 py-8 lg:py-10">
          <div className="flex items-baseline gap-3 mb-6">
            <h2 className="text-[14px] font-semibold text-ink tracking-[-0.005em]">
              How it works
            </h2>
            <span className="text-[11px] text-ink-muted">
              Deposit to sale
            </span>
          </div>

          <div className="lg:grid lg:grid-cols-4 lg:gap-0 lg:divide-x lg:divide-border-subtle">
            {LIFECYCLE_STEPS.map((step) => (
              <div
                key={step.phase}
                className="py-3 lg:py-0 lg:px-5 lg:first:pl-0 lg:last:pr-0 border-b lg:border-b-0 border-border-subtle last:border-b-0"
              >
                <div className="flex items-baseline gap-2 mb-1.5">
                  <span className="text-[11px] font-medium text-ink-faint tabular-nums">
                    {step.phase}
                  </span>
                  <h3 className="text-[13px] font-semibold text-ink tracking-[-0.005em]">
                    {step.title}
                  </h3>
                </div>
                <p className="text-[12px] text-ink-tertiary leading-[1.55]">
                  {step.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Regional context — asymmetric, editorial, compact */}
      <div className="max-w-6xl mx-auto px-5 sm:px-8 lg:px-10 py-8 lg:py-10">
        <div className="lg:flex lg:gap-16">
          <div className="lg:w-[280px] flex-shrink-0 mb-4 lg:mb-0">
            <h2 className="text-[13px] font-semibold text-ink tracking-[-0.005em] mb-1">
              Regional coverage
            </h2>
            <p className="text-[12px] text-ink-tertiary leading-[1.55]">
              Warehouse partners, pricing feeds, and condition monitoring
              calibrated to local agricultural cycles.
            </p>
          </div>
          <div className="flex-1">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
              {[
                { region: "Uasin Gishu County", detail: "Eldoret corridor. Verified warehouse network across major collection points." },
                { region: "Trans Nzoia County", detail: "Kitale corridor. Storage facilities serving the Trans Nzoia maize belt." },
              ].map((r) => (
                <div key={r.region}>
                  <p className="text-[12.5px] font-semibold text-ink mb-0.5">{r.region}</p>
                  <p className="text-[11.5px] text-ink-tertiary leading-[1.5]">{r.detail}</p>
                </div>
              ))}
            </div>

            <div className="mt-5 pt-4 border-t border-border-subtle">
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-muted">
                <span>Warehouse receipt financing</span>
                <span>Pre &amp; post-harvest protection</span>
                <span>M-Pesa integration</span>
                <span>USSD &amp; SMS access</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Institutional credibility strip */}
      <div className="bg-white border-t border-b border-border">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 lg:px-10 py-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
            {[
              { figure: "6", unit: "Warehouses", detail: "Verified facilities across two counties" },
              { figure: "24/7", unit: "Monitoring", detail: "Temperature, humidity, and moisture tracking" },
              { figure: "M-Pesa", unit: "Disbursement", detail: "Loan proceeds and claim payouts" },
              { figure: "SMS", unit: "Alerts", detail: "Price changes, condition flags, claim updates" },
            ].map((item) => (
              <div key={item.unit}>
                <p className="text-[14px] font-semibold text-ink tracking-[-0.01em]">{item.figure}</p>
                <p className="text-[12px] font-medium text-ink-secondary mt-0.5">{item.unit}</p>
                <p className="text-[11px] text-ink-tertiary leading-[1.4] mt-0.5">{item.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Footer — minimal */}
      <footer className="mt-auto border-t border-border-subtle bg-white px-5 sm:px-8 lg:px-10 py-3.5">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[11px] text-ink-muted">
            <Wheat style={{ width: 12, height: 12 }} />
            <span>&copy; {new Date().getFullYear()} GrainShield</span>
          </div>
          <div className="flex items-center gap-3 text-[10px] text-ink-faint tracking-wide">
            <span>Uasin Gishu</span>
            <span>Trans Nzoia</span>
            <span>Kenya</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
