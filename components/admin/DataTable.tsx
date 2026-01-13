"use client";

import { useMemo } from "react";

import { cn } from "@/lib/utils";

type DataTableProps = {
  title: string;
  description?: string;
  rows: Array<Record<string, unknown>>;
  maxHeight?: string;
  dense?: boolean;
};

const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 3,
});

function formatValue(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return numberFormatter.format(value);
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export default function DataTable({
  title,
  description,
  rows,
  maxHeight = "420px",
  dense = false,
}: DataTableProps) {
  const columns = useMemo(() => {
    const keys: string[] = [];
    rows.forEach((row) => {
      Object.keys(row).forEach((key) => {
        if (!keys.includes(key)) {
          keys.push(key);
        }
      });
    });
    return keys;
  }, [rows]);

  const numericColumns = useMemo(() => {
    const numeric = new Set<string>();
    columns.forEach((key) => {
      const values = rows.map((row) => row[key]).filter((value) => value !== "" && value !== null);
      if (values.length && values.every((value) => typeof value === "number")) {
        numeric.add(key);
      }
    });
    return numeric;
  }, [columns, rows]);

  return (
    <div className="space-y-3">
      <div>
        <div className="text-base font-semibold text-foreground">{title}</div>
        {description ? <div className="text-sm text-muted-foreground">{description}</div> : null}
      </div>
      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/70 bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
          No data available.
        </div>
      ) : (
        <div
          className="overflow-auto rounded-xl border border-border/60 bg-background/80"
          style={{ maxHeight }}
        >
          <table className="min-w-full border-collapse text-left text-xs">
            <thead className="sticky top-0 bg-slate-900 text-slate-50">
              <tr>
                {columns.map((column) => (
                  <th
                    key={column}
                    className={cn(
                      "border-b border-slate-800 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em]",
                      numericColumns.has(column) ? "text-right" : "text-left"
                    )}
                  >
                    {column.replace(/_/g, " ")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className={cn(dense ? "text-[11px]" : "text-xs")}>
              {rows.map((row, rowIndex) => (
                <tr
                  key={rowIndex}
                  className={cn(
                    rowIndex % 2 === 0 ? "bg-background" : "bg-muted/30",
                    "border-b border-border/60"
                  )}
                >
                  {columns.map((column) => {
                    const raw = row[column];
                    return (
                      <td
                        key={`${rowIndex}-${column}`}
                        className={cn(
                          "px-3 py-2 align-top text-foreground/90",
                          numericColumns.has(column) ? "text-right" : "text-left"
                        )}
                      >
                        {formatValue(raw)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
