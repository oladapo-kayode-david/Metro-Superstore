import React, { useRef, useState } from 'react';
import { Download, Maximize2, Table as TableIcon, X } from 'lucide-react';
import { downloadElementAsPng, exportRowsToCsv, exportRowsToJson } from '../lib/reports/exporters';

import {
  EXTENDED_CATEGORICAL_DARK,
  getCategoricalPalette,
  getPatternId,
} from '../lib/theme/chartTheme';

/**
 * Re-exported Extended Categorical Palette from the shared chart theme file.
 */
export const CHART_PALETTE = EXTENDED_CATEGORICAL_DARK;

/**
 * Reusable SVG <defs> patterns for colour-blind accessibility whenever >6 series share one chart.
 */
export const SeriesPatternDefs: React.FC<{ prefix: string; theme: 'dark' | 'light' }> = ({
  prefix,
  theme,
}) => {
  const palette = getCategoricalPalette(theme);
  const ink = theme === 'dark' ? 'rgba(15,34,56,0.34)' : 'rgba(255,255,255,0.35)';

  return (
    <defs>
      {palette.map((color, idx) => {
        const id = getPatternId(prefix, idx);
        const variant = idx % 5;
        return (
          <pattern key={id} id={id} width="8" height="8" patternUnits="userSpaceOnUse">
            <rect width="8" height="8" fill={color} />
            {variant === 1 && (
              <path d="M-2,2 l4,-4 M0,8 l8,-8 M6,10 l4,-4" stroke={ink} strokeWidth="1.4" />
            )}
            {variant === 2 && <circle cx="4" cy="4" r="1.4" fill={ink} />}
            {variant === 3 && <path d="M0,4 l8,0" stroke={ink} strokeWidth="1.4" />}
            {variant === 4 && (
              <path d="M4,0 l0,8 M0,4 l8,0" stroke={ink} strokeWidth="1.1" />
            )}
          </pattern>
        );
      })}
    </defs>
  );
};

interface ChartCardProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  tableData?: Array<Record<string, unknown>>;
  exportName?: string;
  headerRight?: React.ReactNode;
  isEmpty?: boolean;
  emptyMessage?: string;
  className?: string;
  minHeight?: number;
}

export const ChartCard: React.FC<ChartCardProps> = ({
  title,
  subtitle,
  children,
  tableData = [],
  exportName = 'chart',
  headerRight,
  isEmpty = false,
  emptyMessage = 'No data matches the active filters.',
  className = '',
  minHeight = 290,
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const [showTable, setShowTable] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const handleDownloadPng = async () => {
    if (!cardRef.current) return;
    setDownloading(true);
    try {
      await downloadElementAsPng(cardRef.current, `${exportName.replace(/\s+/g, '_')}.png`);
    } finally {
      setDownloading(false);
    }
  };

  const columns = tableData.length > 0 ? Object.keys(tableData[0]) : [];

  const renderContent = (heightPx: number) => {
    if (isEmpty) {
      return (
        <div
          style={{ minHeight: heightPx }}
          className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300/70 px-6 py-10 text-center dark:border-white/10"
        >
          <p className="text-sm font-medium text-slate-600 dark:text-slate-300">{emptyMessage}</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Adjust or clear global slicers to restore data.
          </p>
        </div>
      );
    }

    if (showTable && tableData.length > 0) {
      return (
        <div style={{ maxHeight: Math.max(heightPx, 320) }} className="overflow-auto">
          <div className="mb-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => exportRowsToCsv(tableData, `${exportName}.csv`)}
              className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-white/15 dark:text-slate-200 dark:hover:bg-white/10"
            >
              Export CSV
            </button>
            <button
              type="button"
              onClick={() => exportRowsToJson(tableData, `${exportName}.json`)}
              className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-white/15 dark:text-slate-200 dark:hover:bg-white/10"
            >
              Export JSON
            </button>
          </div>
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500 dark:border-white/10 dark:text-slate-400">
                {columns.map((col) => (
                  <th key={col} className="whitespace-nowrap px-3 py-2 font-medium">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {tableData.slice(0, 100).map((row, idx) => (
                <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-white/5">
                  {columns.map((col) => {
                    const val = row[col];
                    const isNum = typeof val === 'number';
                    return (
                      <td
                        key={col}
                        className={`whitespace-nowrap px-3 py-2 ${
                          isNum ? 'font-mono tabular-nums text-right' : ''
                        } text-[#0F2238] dark:text-slate-100`}
                      >
                        {isNum ? val.toLocaleString('en-CA', { maximumFractionDigits: 2 }) : String(val ?? '')}
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

    return <div style={{ minHeight: heightPx }}>{children}</div>;
  };

  return (
    <>
      <section
        ref={cardRef}
        className={`print-card flex flex-col rounded-[16px] border border-slate-200/90 bg-white p-5 transition-colors dark:border-white/10 dark:bg-[#16314D] ${className}`}
      >
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="font-display text-base font-semibold tracking-tight text-[#0F2238] dark:text-white">
              {title}
            </h3>
            {subtitle && (
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
            )}
          </div>
          <div className="no-print flex items-center gap-1.5 shrink-0">
            {headerRight}
            {tableData.length > 0 && (
              <button
                type="button"
                onClick={() => setShowTable((v) => !v)}
                title={showTable ? 'Show chart view' : 'View data table'}
                aria-label={showTable ? 'Show chart view' : 'View data table'}
                className={`rounded-lg p-1.5 text-xs transition-colors ${
                  showTable
                    ? 'bg-[#26E6D0]/20 text-[#0FA696] dark:text-[#26E6D0]'
                    : 'text-slate-500 hover:bg-slate-100 hover:text-[#0F2238] dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white'
                }`}
              >
                <TableIcon className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
            <button
              type="button"
              onClick={handleDownloadPng}
              disabled={downloading}
              title="Download PNG"
              aria-label={`Download ${title} as PNG`}
              className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-[#0F2238] disabled:opacity-50 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => setExpanded(true)}
              title="Expand chart"
              aria-label={`Expand ${title}`}
              className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-[#0F2238] dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white"
            >
              <Maximize2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="flex-1">{renderContent(minHeight)}</div>
      </section>

      {expanded && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0F2238]/75 p-4 backdrop-blur-sm sm:p-8"
          onClick={() => setExpanded(false)}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-[16px] border border-slate-200 bg-white p-6 dark:border-white/15 dark:bg-[#16314D]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h3 className="font-display text-lg font-semibold text-[#0F2238] dark:text-white">
                  {title}
                </h3>
                {subtitle && (
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {tableData.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowTable((v) => !v)}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-white/15 dark:text-slate-200 dark:hover:bg-white/10"
                  >
                    {showTable ? 'Show Chart' : 'View Data Table'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setExpanded(false)}
                  aria-label="Close expanded view"
                  className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10"
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto">{renderContent(460)}</div>
          </div>
        </div>
      )}
    </>
  );
};
