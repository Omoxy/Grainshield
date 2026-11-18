"use client";

import React from "react";

interface RiskBarProps {
  label: string;
  score: number;
  max?: number;
}

export function RiskBar({ label, score, max = 100 }: RiskBarProps) {
  const pct = (score / max) * 100;
  const color =
    score > 65 ? "#C53030" : score > 40 ? "#B7791F" : "#2B6CB0";
  const statusText =
    score > 65
      ? "High — Farmer alert required"
      : score > 40
      ? "Medium — Monitor closely"
      : "Low — No action required";

  return (
    <div className="mb-3" role="meter" aria-label={`${label} risk score`} aria-valuenow={score} aria-valuemin={0} aria-valuemax={max}>
      <div className="flex justify-between mb-1.5">
        <span className="text-sm text-ink">{label}</span>
        <span className="text-sm font-semibold tabular-nums" style={{ color }}>
          {score}/{max}
        </span>
      </div>
      <div className="bg-surface-sunken h-1.5 overflow-hidden">
        <div
          className="h-full transition-all"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <div className="text-2xs text-ink-muted mt-1">
        {statusText}
      </div>
    </div>
  );
}
