import React, { useState } from 'react';
import { BookOpen, CheckCircle2, Play, ShieldCheck, XCircle } from 'lucide-react';
import { runCalculationUnitTests, type UnitTestResult } from '../lib/analytics/calculations';

export const AboutHelpView: React.FC = () => {
  const [testResults, setTestResults] = useState<UnitTestResult[]>(() => runCalculationUnitTests());

  const rerunTests = () => {
    setTestResults(runCalculationUnitTests());
  };

  return (
    <div className="space-y-6">
      <section className="rounded-[16px] border border-slate-200/90 bg-white p-6 dark:border-white/10 dark:bg-[#16314D]">
        <div className="flex items-center gap-2.5">
          <BookOpen className="h-5 w-5 text-[#26E6D0]" aria-hidden="true" />
          <h2 className="font-display text-lg font-bold text-[#0F2238] dark:text-white">
            Sales Intelligence Platform — User Guide &amp; Architecture
          </h2>
        </div>
        <p className="mt-2 max-w-4xl text-xs leading-relaxed text-slate-600 dark:text-slate-300">
          This application performs local-first star-schema ETL, interactive executive BI, in-browser machine
          learning, tool-grounded AI analysis, retention planning, and board-ready reporting directly in your
          browser using IndexedDB (Dexie).
        </p>

        <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[
            {
              title: 'Executive Overview & Trends',
              desc: '10 core KPIs with prior-period & YoY deltas, monthly revenue vs volume combo charts, forecast overlays, Day-of-Week × Month heatmaps, and discount band realization.',
            },
            {
              title: 'Products, Stores & Salespeople',
              desc: 'Pareto product rankings, category heatmaps, Canadian province choropleth & tile map, Province × Store drilldowns, Orders vs AOV bubble plots, and rep leaderboards.',
            },
            {
              title: 'Model Lab (5 Browser ML Models)',
              desc: 'Chronological Sales Forecast (Holt-Winters + optional TensorFlow.js LSTM), Anomaly Detection, Log-Log Discount Elasticity, K-Means Segmentation, and Apriori Basket Affinity.',
            },
            {
              title: 'AI Analyst (Tool-Grounded)',
              desc: 'Gemini converts questions into structured local queries (query_sales, compare_periods, top_n, get_forecast, get_anomalies, get_segment_profile, explain_trend) so no figure is fabricated.',
            },
            {
              title: 'Retention Recommendations',
              desc: 'Protects recurring revenue across stores, products, categories, channels, and salespeople using deterministic risk/opportunity signals structured into 30/60/90-day playbooks.',
            },
            {
              title: 'Data Manager & Star Schema',
              desc: 'Supports .xlsx, .xls, .xlsm, .csv, .tsv, .json, .txt with automatic cleaning, near-duplicate merging, financial reconciliation, quality scoring, rollback, and IndexedDB persistence.',
            },
          ].map((item) => (
            <div
              key={item.title}
              className="rounded-xl border border-slate-200/80 p-4 dark:border-white/10"
            >
              <h3 className="font-display text-sm font-semibold text-[#0F2238] dark:text-white">
                {item.title}
              </h3>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                {item.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Source Data Requirements & Exact KPI Formulas */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <section className="rounded-[16px] border border-slate-200/90 bg-white p-6 dark:border-white/10 dark:bg-[#16314D]">
          <h3 className="font-display text-base font-semibold text-[#0F2238] dark:text-white">
            Expected 3-Sheet Workbook Headers
          </h3>
          <div className="mt-3 space-y-3 text-xs text-slate-600 dark:text-slate-300">
            <div>
              <div className="font-semibold text-[#0F2238] dark:text-[#26E6D0]">Sheet 1: Transactions (Fact)</div>
              <p className="mt-1 font-mono text-[11px] leading-relaxed">
                Transaction ID | Date | Product | Category | Quantity | Unit Price (CAD) | Discount Rate | Gross Sales | Discount Amount | Sales Amount | Store | Province | Sales Channel | Payment Method | Salesperson | Order ID
              </p>
            </div>
            <div>
              <div className="font-semibold text-[#0F2238] dark:text-[#26E6D0]">Sheet 2: Stores (Dimension)</div>
              <p className="mt-1 font-mono text-[11px]">Store | Province | Country</p>
            </div>
            <div>
              <div className="font-semibold text-[#0F2238] dark:text-[#26E6D0]">Sheet 3: Products (Dimension)</div>
              <p className="mt-1 font-mono text-[11px]">Product | Category | Reference Unit Price (CAD)</p>
            </div>
          </div>

          <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-slate-200/80 bg-slate-50/70 p-3.5 text-xs dark:border-white/10 dark:bg-[#0F2238]/60">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#26E6D0]" aria-hidden="true" />
            <div className="text-slate-600 dark:text-slate-300">
              <strong className="text-[#0F2238] dark:text-white">Privacy &amp; Security:</strong> Raw transaction
              tables stay exclusively in your browser&apos;s IndexedDB. Only minimal aggregated tool outputs or
              verified signal summaries are sent to Gemini when AI features are enabled, and you can toggle AI
              off at any time in AI Analyst.
            </div>
          </div>
        </section>

        <section className="rounded-[16px] border border-slate-200/90 bg-white p-6 dark:border-white/10 dark:bg-[#16314D]">
          <h3 className="font-display text-base font-semibold text-[#0F2238] dark:text-white">
            Core Metric &amp; Reconciliation Formulas
          </h3>
          <dl className="mt-3 space-y-2.5 text-xs">
            {[
              ['Gross Sales', 'Quantity × Unit Price (CAD)'],
              ['Discount Amount', 'Gross Sales × Discount Rate (0 to 1)'],
              ['Sales Amount', 'Gross Sales − Discount Amount'],
              ['Average Order Value (AOV)', 'SUM(Sales Amount) ÷ COUNT(DISTINCT Order ID)'],
              ['Effective Discount %', 'SUM(Discount Amount) ÷ SUM(Gross Sales)'],
              ['Period-over-Period Growth %', '(Current Period − Prior Period) ÷ |Prior Period|'],
              ['Priority Score', '(Impact × Confidence) ÷ Effort'],
              ['Forecast Evaluation', 'Chronological 80/20 holdout: MAE, RMSE, MAPE, R² vs Naive Seasonal Baseline'],
            ].map(([term, formula]) => (
              <div
                key={term}
                className="flex flex-wrap justify-between gap-2 border-b border-slate-100 pb-2 last:border-none dark:border-white/10"
              >
                <dt className="font-semibold text-[#0F2238] dark:text-white">{term}</dt>
                <dd className="font-mono text-[11px] text-slate-600 dark:text-slate-300">{formula}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>

      {/* Live Calculation Layer Unit Tests */}
      <section className="rounded-[16px] border border-slate-200/90 bg-white p-6 dark:border-white/10 dark:bg-[#16314D]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-base font-semibold text-[#0F2238] dark:text-white">
              Calculation Layer Unit Tests
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Live verification suite testing AOV, Discount %, Growth %, Share %, and Forecast MAE/RMSE formulas
            </p>
          </div>
          <button
            type="button"
            onClick={rerunTests}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-[#0F2238] hover:bg-slate-100 dark:border-white/15 dark:text-white dark:hover:bg-white/10"
          >
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
            Re-run Unit Tests
          </button>
        </div>

        <div className="mt-4 divide-y divide-slate-100 text-xs dark:divide-white/10">
          {testResults.map((t) => (
            <div key={t.name} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <div className="flex items-center gap-2">
                {t.passed ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 dark:text-[#26E6D0]" aria-hidden="true" />
                ) : (
                  <XCircle className="h-4 w-4 text-rose-500" aria-hidden="true" />
                )}
                <span className="font-medium text-[#0F2238] dark:text-slate-100">{t.name}</span>
              </div>
              <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                Expected: {t.expected} · Actual: <span className="text-[#0F2238] dark:text-white">{t.actual}</span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
