"use client";

import React from "react";

interface DataTableProps {
  headers: string[];
  rows: (string | React.ReactNode)[][];
  small?: boolean;
}

function badgeClass(cell: string): string | null {
  if (cell.includes("APPROVED") || cell.includes("VERIFIED") || cell.includes("ACTIVE") || cell.includes("PAID"))
    return "badge bg-status-success-surface text-status-success";
  if (cell.includes("PENDING") || cell.includes("UNDER REVIEW") || cell.includes("SUBMITTED"))
    return "badge bg-status-warning-surface text-status-warning";
  if (cell.includes("REJECTED") || cell.includes("WARN") || cell.includes("HIGH") || cell.includes("BLOCKED"))
    return "badge bg-status-danger-surface text-status-danger";
  if (cell.includes("LOW") || cell.includes("INFO"))
    return "badge bg-status-info-surface text-status-info";
  if (cell.includes("DELAYED") || cell.includes("OVERDUE"))
    return "badge bg-orange-50 text-risk-high";
  return null;
}

export function DataTable({ headers, rows }: DataTableProps) {
  return (
    <div className="overflow-x-auto card" role="table" aria-label="Data table">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i} className="table-header-cell">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="table-row">
              {row.map((cell, j) => {
                const cls = typeof cell === "string" ? badgeClass(cell) : null;
                return (
                  <td key={j} className="table-cell">
                    {cls ? <span className={cls}>{cell}</span> : cell}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
