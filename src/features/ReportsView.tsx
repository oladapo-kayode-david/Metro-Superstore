import React, { useRef, useState } from 'react';
import {
  Download,
  FileSpreadsheet,
  FileText,
  Printer,
  Trash2,
} from 'lucide-react';
import type {
  AllModelResults,
  DataQualityReport,
  FactSale,
  GlobalFilters,
  PinnedInsight,
  RecommendationsBundle,
} from '../types/sales';
import {
  aggregateCategories,
  aggregateStores,
  computeCoreTotals,
  formatCAD,
  formatCADExact,
  formatNumber,
  formatPct,
  getDataDateBounds,
} from '../lib/analytics/calculations';
import {
  downloadDataQualityReport,
  downloadRejectedRowsCsv,
  exportExecutiveReportPdf,
  exportExecutiveWorkbookExcel,
} from '../lib/reports/exporters';

interface ReportsViewProps {
  filteredFacts: FactSale[];
  filters: GlobalFilters;
  models: AllModelResults;
  recommendations: RecommendationsBundle | null;
  latestQualityReport: DataQualityReport | null;
  pinnedInsights: PinnedInsight[];
  onRemovePin: (id: string) => void;
  onNotify: (msg: string, tone?: 'success' | 'error' | 'info') => void;
}

export const ReportsView: React.FC<ReportsViewProps> = ({
  filteredFacts,
  filters,
  models,
  recommendations,
  latestQualityReport,
  pinnedInsights,
  onRemovePin,
  onNotify,
}) => {
  const [exportingPdf, setExportingPdf] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);

  const totals = computeCoreTotals(filteredFacts, filters.useRecomputedFinancials);
  const bounds = getDataDateBounds(filteredFacts);
  const topStores = aggregateStores(filteredFacts, filters.useRecomputedFinancials).slice(0, 5);
  const topCats = aggregateCategories(filteredFacts, filters.useRecomputedFinancials).slice(0, 5);

  const handleExportPdf = async () => {
    setExportingPdf(true);
    try {
      await exportExecutiveReportPdf({
        facts: filteredFacts,
        filters,
        models,
        recommendations,
        qualityReport: latestQualityReport,
        pinnedInsights,
        captureElement: previewRef.current,
      });
      onNotify('Branded Executive PDF exported successfully.', 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'PDF export failed', 'error');
    } finally {
      setExportingPdf(false);
    }
  };

  const handleExportExcel = () => {
    exportExecutiveWorkbookExcel({
      facts: filteredFacts,
      models,
      recommendations,
      useRecomputed: filters.useRecomputedFinancials,
    });
    onNotify('9-sheet Executive Excel Workbook downloaded.', 'success');
  };

  return (
    <div className="space-y-6">
      {/* Export Actions Grid */}
      <div className="no-print grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col justify-between rounded-[16px] border border-slate-200/90 bg-white p-5 dark:border-white/10 dark:bg-[#16314D]">
          <div>
            <FileText className="h-5 w-5 text-[#26E6D0]" aria-hidden="true" />
            <h3 className="mt-3 font-display text-sm font-semibold text-[#0F2238] dark:text-white">
              Executive Report (PDF)
            </h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Branded cover page, KPIs, snapshot, ML results, recommendations &amp; data-quality appendix. Respects active filters.
            </p>
          </div>
          <button
            type="button"
            disabled={exportingPdf || filteredFacts.length === 0}
            onClick={handleExportPdf}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg brand-gradient px-3.5 py-2 text-xs font-semibold text-[#0F2238] disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            {exportingPdf ? 'Generating PDF…' : 'Download PDF'}
          </button>
        </div>

        <div className="flex flex-col justify-between rounded-[16px] border border-slate-200/90 bg-white p-5 dark:border-white/10 dark:bg-[#16314D]">
          <div>
            <FileSpreadsheet className="h-5 w-5 text-[#B740DE]" aria-hidden="true" />
            <h3 className="mt-3 font-display text-sm font-semibold text-[#0F2238] dark:text-white">
              Multi-Sheet Excel Workbook
            </h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              9 formatted tabs: Summary, Monthly Trend, Product, Category, Store, Province, Salesperson, Forecast, Recommendations.
            </p>
          </div>
          <button
            type="button"
            disabled={filteredFacts.length === 0}
            onClick={handleExportExcel}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 px-3.5 py-2 text-xs font-semibold text-[#0F2238] hover:bg-slate-100 disabled:opacity-50 dark:border-white/15 dark:text-white dark:hover:bg-white/10"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            Download XLSX
          </button>
        </div>

        <div className="flex flex-col justify-between rounded-[16px] border border-slate-200/90 bg-white p-5 dark:border-white/10 dark:bg-[#16314D]">
          <div>
            <Download className="h-5 w-5 text-[#26E6D0]" aria-hidden="true" />
            <h3 className="mt-3 font-display text-sm font-semibold text-[#0F2238] dark:text-white">
              Data Quality &amp; Audit Files
            </h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Download full ETL cleaning logs, label merges, and any rejected rows with rejection reasons.
            </p>
          </div>
          <div className="mt-4 flex flex-col gap-2">
            <button
              type="button"
              disabled={!latestQualityReport}
              onClick={() => latestQualityReport && downloadDataQualityReport(latestQualityReport)}
              className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-[#0F2238] hover:bg-slate-100 disabled:opacity-40 dark:border-white/15 dark:text-white dark:hover:bg-white/10"
            >
              Quality Report (XLSX)
            </button>
            {latestQualityReport && latestQualityReport.rejectedRows.length > 0 && (
              <button
                type="button"
                onClick={() => downloadRejectedRowsCsv(latestQualityReport)}
                className="w-full rounded-lg border border-rose-500/40 px-3 py-1.5 text-xs font-medium text-rose-600 dark:text-rose-400"
              >
                Rejected Rows CSV ({latestQualityReport.rowsRejected})
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-col justify-between rounded-[16px] border border-slate-200/90 bg-white p-5 dark:border-white/10 dark:bg-[#16314D]">
          <div>
            <Printer className="h-5 w-5 text-[#B740DE]" aria-hidden="true" />
            <h3 className="mt-3 font-display text-sm font-semibold text-[#0F2238] dark:text-white">
              Schedule-Ready Print Brief
            </h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Print-optimized executive brief below formatted cleanly for weekly board packets or Save-as-PDF.
            </p>
          </div>
          <button
            type="button"
            onClick={() => window.print()}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 px-3.5 py-2 text-xs font-semibold text-[#0F2238] hover:bg-slate-100 dark:border-white/15 dark:text-white dark:hover:bg-white/10"
          >
            <Printer className="h-3.5 w-3.5" aria-hidden="true" />
            Print Brief
          </button>
        </div>
      </div>

      {/* Schedule-Ready Print Preview Template */}
      <section
        ref={previewRef}
        className="print-card rounded-[16px] border border-slate-200/90 bg-white p-6 dark:border-white/10 dark:bg-[#16314D]"
      >
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4 dark:border-white/10">
          <div>
            <div className="text-xs font-semibold text-[#0FA696] dark:text-[#26E6D0]">
              Schedule-Ready Executive Brief
            </div>
            <h2 className="mt-1 font-display text-xl font-bold text-[#0F2238] dark:text-white">
              Metro Superstore Sales Intelligence — Executive Report
            </h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Coverage: {bounds.min || '—'} to {bounds.max || '—'} · {filteredFacts.length.toLocaleString()} transactions · Currency: CAD
            </p>
          </div>
          <div className="text-right font-mono text-xs text-slate-500 dark:text-slate-400">
            Generated {new Date().toISOString().slice(0, 10)}
          </div>
        </div>

        {/* KPI Snapshot */}
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Total Sales (CAD)', val: formatCAD(totals.sales) },
            { label: 'Orders', val: formatNumber(totals.orders) },
            { label: 'Avg Order Value', val: formatCADExact(totals.aov) },
            { label: 'Effective Discount %', val: formatPct(totals.discountPct) },
          ].map((k) => (
            <div
              key={k.label}
              className="rounded-xl border border-slate-200/80 p-3 dark:border-white/10"
            >
              <div className="text-[11px] text-slate-500 dark:text-slate-400">{k.label}</div>
              <div className="mt-1 font-mono text-lg font-bold text-[#0F2238] tabular-nums dark:text-white">
                {k.val}
              </div>
            </div>
          ))}
        </div>

        {/* Top Stores & Categories Side-by-Side */}
        <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
          <div>
            <h3 className="font-display text-sm font-semibold text-[#0F2238] dark:text-white">
              Top 5 Stores
            </h3>
            <table className="mt-2 w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 dark:border-white/10 dark:text-slate-400">
                  <th className="py-1.5">Store</th>
                  <th className="py-1.5 text-right">Sales</th>
                  <th className="py-1.5 text-right">Share</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {topStores.map((s) => (
                  <tr key={s.store}>
                    <td className="py-1.5 font-medium text-[#0F2238] dark:text-slate-100">{s.store}</td>
                    <td className="py-1.5 text-right font-mono tabular-nums">{formatCAD(s.sales)}</td>
                    <td className="py-1.5 text-right font-mono tabular-nums">{formatPct(s.sharePct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <h3 className="font-display text-sm font-semibold text-[#0F2238] dark:text-white">
              Category Mix
            </h3>
            <table className="mt-2 w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 dark:border-white/10 dark:text-slate-400">
                  <th className="py-1.5">Category</th>
                  <th className="py-1.5 text-right">Sales</th>
                  <th className="py-1.5 text-right">Share</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {topCats.map((c) => (
                  <tr key={c.category}>
                    <td className="py-1.5 font-medium text-[#0F2238] dark:text-slate-100">{c.category}</td>
                    <td className="py-1.5 text-right font-mono tabular-nums">{formatCAD(c.sales)}</td>
                    <td className="py-1.5 text-right font-mono tabular-nums">{formatPct(c.sharePct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* AI Analyst Report Additions */}
        {pinnedInsights.length > 0 && (
          <div className="mt-6 border-t border-slate-200 pt-4 dark:border-white/10">
            <h3 className="font-display text-sm font-semibold text-[#0F2238] dark:text-white">
              Saved AI Analyst Findings ({pinnedInsights.length})
            </h3>
            <div className="mt-2.5 space-y-3">
              {pinnedInsights.map((p) => (
                <div
                  key={p.id}
                  className="flex items-start justify-between gap-3 rounded-xl border border-slate-200/80 p-3 text-xs dark:border-white/10"
                >
                  <div>
                    <div className="font-semibold text-[#0F2238] dark:text-white">{p.title}</div>
                    <p className="mt-1 whitespace-pre-line text-slate-600 dark:text-slate-300">{p.summary}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemovePin(p.id)}
                    aria-label="Remove saved finding"
                    className="no-print rounded p-1 text-slate-400 hover:text-rose-500"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
