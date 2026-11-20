import React, { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Download } from 'lucide-react';
import { exportRowsToCsv, exportRowsToJson } from '../lib/reports/exporters';

export interface VirtualColumn<T> {
  key: string;
  label: string;
  align?: 'left' | 'right';
  width?: string;
  render?: (row: T) => React.ReactNode;
  sortValue?: (row: T) => number | string;
}

interface VirtualTableProps<T> {
  rows: T[];
  columns: Array<VirtualColumn<T>>;
  rowHeight?: number;
  maxHeight?: number;
  exportName?: string;
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
}

export function VirtualTable<T extends Record<string, unknown>>({
  rows,
  columns,
  rowHeight = 40,
  maxHeight = 440,
  exportName,
  onRowClick,
  emptyMessage = 'No records match the current filters.',
}: VirtualTableProps<T>) {
  const [scrollTop, setScrollTop] = useState(0);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const sortedRows = useMemo(() => {
    if (!sortKey) return rows;
    const col = columns.find((c) => c.key === sortKey);
    return [...rows].sort((a, b) => {
      const av = col?.sortValue ? col.sortValue(a) : (a[sortKey] as string | number);
      const bv = col?.sortValue ? col.sortValue(b) : (b[sortKey] as string | number);
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortDir === 'asc' ? av - bv : bv - av;
      }
      return sortDir === 'asc'
        ? String(av ?? '').localeCompare(String(bv ?? ''))
        : String(bv ?? '').localeCompare(String(av ?? ''));
    });
  }, [rows, sortKey, sortDir, columns]);

  const totalHeight = sortedRows.length * rowHeight;
  const visibleCount = Math.ceil(maxHeight / rowHeight) + 6;
  const startIdx = Math.max(0, Math.floor(scrollTop / rowHeight) - 3);
  const endIdx = Math.min(sortedRows.length, startIdx + visibleCount);
  const visibleRows = sortedRows.slice(startIdx, endIdx);

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300/70 p-8 text-center text-sm text-slate-500 dark:border-white/10 dark:text-slate-400">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {exportName && (
        <div className="mb-2 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
          <span className="font-mono tabular-nums">{rows.length.toLocaleString('en-CA')} rows</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => exportRowsToCsv(sortedRows, `${exportName}.csv`)}
              className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-white/15 dark:text-slate-200 dark:hover:bg-white/10"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              CSV
            </button>
            <button
              type="button"
              onClick={() => exportRowsToJson(sortedRows, `${exportName}.json`)}
              className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-white/15 dark:text-slate-200 dark:hover:bg-white/10"
            >
              JSON
            </button>
          </div>
        </div>
      )}

      <div
        className="overflow-auto rounded-xl border border-slate-200/90 dark:border-white/10"
        style={{ maxHeight }}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        <table className="w-full border-collapse text-left text-xs">
          <thead className="sticky top-0 z-10 bg-slate-100 text-slate-600 dark:bg-[#0F2238] dark:text-slate-300">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  style={{ width: col.width }}
                  className={`whitespace-nowrap border-b border-slate-200 px-3 py-2.5 font-semibold dark:border-white/10 ${
                    col.align === 'right' ? 'text-right' : 'text-left'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => toggleSort(col.key)}
                    className={`inline-flex items-center gap-1 hover:text-[#0F2238] dark:hover:text-white ${
                      col.align === 'right' ? 'flex-row-reverse' : ''
                    }`}
                  >
                    <span>{col.label}</span>
                    {sortKey === col.key &&
                      (sortDir === 'asc' ? (
                        <ArrowUp className="h-3 w-3 text-[#26E6D0]" aria-hidden="true" />
                      ) : (
                        <ArrowDown className="h-3 w-3 text-[#26E6D0]" aria-hidden="true" />
                      ))}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {startIdx > 0 && (
              <tr style={{ height: startIdx * rowHeight }}>
                <td colSpan={columns.length} />
              </tr>
            )}
            {visibleRows.map((row, i) => {
              const absIdx = startIdx + i;
              return (
                <tr
                  key={absIdx}
                  style={{ height: rowHeight }}
                  onClick={() => onRowClick?.(row)}
                  className={`border-b border-slate-100 transition-colors dark:border-white/5 ${
                    onRowClick ? 'cursor-pointer hover:bg-[#26E6D0]/10' : 'hover:bg-slate-50 dark:hover:bg-white/5'
                  }`}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={`whitespace-nowrap px-3 py-2 text-[#0F2238] dark:text-slate-100 ${
                        col.align === 'right' ? 'text-right font-mono tabular-nums' : 'text-left'
                      }`}
                    >
                      {col.render ? col.render(row) : String(row[col.key] ?? '')}
                    </td>
                  ))}
                </tr>
              );
            })}
            {endIdx < sortedRows.length && (
              <tr style={{ height: Math.max(0, totalHeight - endIdx * rowHeight) }}>
                <td colSpan={columns.length} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
