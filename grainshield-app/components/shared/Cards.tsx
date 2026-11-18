"use client";

import React from "react";

export function Tag({ text }: { text: string }) {
  return (
    <span className="badge bg-brand-50 text-brand-700 mr-1">
      {text}
    </span>
  );
}

export function SectionLabel({ text }: { text: string }) {
  return (
    <div className="label-caps mb-2.5 mt-5 pb-1.5 border-b border-border-subtle">
      {text}
    </div>
  );
}

export function Row({
  children,
  gap = 12,
}: {
  children: React.ReactNode;
  gap?: number;
}) {
  return (
    <div className="flex flex-wrap items-start" style={{ gap: `${gap}px` }}>
      {children}
    </div>
  );
}

export function Col({
  children,
  flex = 1,
}: {
  children: React.ReactNode;
  flex?: number;
}) {
  return <div style={{ flex }}>{children}</div>;
}
