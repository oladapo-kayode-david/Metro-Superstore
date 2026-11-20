import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  Download,
  FileSpreadsheet,
  Info,
  RefreshCw,
  ShieldAlert,
  TrendingUp,
} from 'lucide-react';
import type {
  AllModelResults,
  FactSale,
  GlobalFilters,
  RecommendationCard,
  RecommendationsBundle,
} from '../types/sales';
import { formatCAD, getDataDateBounds } from '../lib/analytics/calculations';
import { computeRetentionSignals } from '../lib/ml/signals';
import { exportExecutiveReportPdf, exportExecutiveWorkbookExcel } from '../lib/reports/exporters';

interface RecommendationsViewProps {
  filteredFacts: FactSale[];
  filters: GlobalFilters;
  models: AllModelResults;
  aiEnabled: boolean;
  bundle: RecommendationsBundle | null;
  onSaveBundle: (next: RecommendationsBundle) => Promise<void>;
  onNotify: (msg: string, tone?: 'success' | 'error' | 'info') => void;
}

export const RecommendationsView: React.FC<RecommendationsViewProps> = ({
  filteredFacts,
  filters,
  models,
  aiEnabled,
  bundle,
  onSaveBundle,
  onNotify,
}) => {
  const [generating, setGenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [priorityFilter, setPriorityFilter] = useState<string>('ALL');
  const [targetFilter, setTargetFilter] = useState<string>('ALL');
  const [searchTarget, setSearchTarget] = useState<string>('');

  const computedSignals = useMemo(
    () => computeRetentionSignals(filteredFacts, models, filters.useRecomputedFinancials),
    [filteredFacts, models, filters.useRecomputedFinancials]
  );

  const handleGenerate = async () => {
    if (!aiEnabled) {
      setErrorMsg('AI features are currently disabled in Privacy Settings. Enable AI to generate recommendations.');
      return;
    }
    if (computedSignals.signals.length === 0) {
      setErrorMsg('No risk or opportunity signals could be derived from the current filtered dataset.');
      return;
    }

    setGenerating(true);
    setErrorMsg(null);
    try {
      const bounds = getDataDateBounds(filteredFacts);
      const resp = await fetch('/api/ai/recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signals: computedSignals.signals,
          summaryStats: computedSignals.summaryStats,
          dateRange: bounds,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || `Failed to generate recommendations (${resp.status})`);
      }

      const existingStatus = new Map(
        (bundle?.recommendations ?? []).map((r) => [r.targetName, r.status])
      );

      const recs: RecommendationCard[] = (data.recommendations ?? []).map(
        (r: Omit<RecommendationCard, 'priorityScore' | 'status'>, idx: number) => {
          const impact = Math.max(1, Number(r.impactScore) || 7);
          const conf = Math.max(1, Number(r.confidenceScore) || 7);
          const effort = Math.max(1, Number(r.effortScore) || 5);
          const score = Number(((impact * conf) / effort).toFixed(1));
          return {
            ...r,
            id: r.id || `rec-${Date.now()}-${idx}`,
            impactScore: impact,
            confidenceScore: conf,
            effortScore: effort,
            priorityScore: score,
            status: existingStatus.get(r.targetName) ?? 'Not started',
          };
        }
      );

      recs.sort((a, b) => b.priorityScore - a.priorityScore);

      const nextBundle: RecommendationsBundle = {
        id: 'singleton',
        generatedAt: new Date().toISOString(),
        executiveSummary: data.executiveSummary || '',
        totalRevenueAtRisk: computedSignals.totalRevenueAtRisk,
        totalOpportunityValue: computedSignals.totalOpportunityValue,
        recommendations: recs,
      };
      await onSaveBundle(nextBundle);
      onNotify(`Generated ${recs.length} evidence-based retention recommendations`, 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to generate recommendations';
      setErrorMsg(msg);
      onNotify(msg, 'error');
    } finally {
      setGenerating(false);
    }
  };

  const handleStatusChange = async (id: string, status: RecommendationCard['status']) => {
    if (!bundle) return;
    const updated: RecommendationsBundle = {
      ...bundle,
      recommendations: bundle.recommendations.map((r) => (r.id === id ? { ...r, status } : r)),
    };
    await onSaveBundle(updated);
  };

  const filteredRecs = useMemo(() => {
    if (!bundle) return [];
    const q = searchTarget.trim().toLowerCase();
    return bundle.recommendations.filter((r) => {
      if (priorityFilter !== 'ALL' && r.priority !== priorityFilter) return false;
      if (targetFilter !== 'ALL' && r.targetType !== targetFilter) return false;
      if (q && !`${r.title} ${r.targetName} ${r.targetType}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [bundle, priorityFilter, targetFilter, searchTarget]);

  const targetTypes = useMemo(() => {
    if (!bundle) return [];
    return Array.from(new Set(bundle.recommendations.map((r) => r.targetType))).sort();
  }, [bundle]);

  const priorityTextClass = (p: RecommendationCard['priority']) => {
    if (p === 'Critical') return 'text-rose-600 dark:text-rose-400 font-semibold';
    if (p === 'High') return 'text-amber-600 dark:text-amber-400 font-semibold';
    if (p === 'Medium') return 'text-[#0FA696] dark:text-[#26E6D0] font-semibold';
    return 'text-slate-500 dark:text-slate-400 font-medium';
  };

  return (
    <div className="space-y-6">
      {/* Explicit Retention Definition & Controls */}
      <div className="rounded-[16px] border border-slate-200/90 bg-white p-5 dark:border-white/10 dark:bg-[#16314D]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 text-xs font-medium text-[#0FA696] dark:text-[#26E6D0]">
              <Info className="h-4 w-4" aria-hidden="true" />
              <span>Retention Definition (No Customer ID Schema)</span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
              Because the source workbook has no Customer ID, <strong>retention</strong> here is defined as{' '}
              <strong>
                protecting and growing recurring revenue across stores, products, categories, channels, and
                salespeople
              </strong>{' '}
              — plus strengthening repeat-basket attachment where Order ID patterns permit. Every risk and
              opportunity signal is computed deterministically in your browser before Gemini structures the
              action plan.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleGenerate}
              disabled={generating || filteredFacts.length === 0}
              className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg brand-gradient px-4 py-2 text-xs font-semibold text-[#0F2238] transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${generating ? 'animate-spin' : ''}`} aria-hidden="true" />
              {generating
                ? 'Synthesizing Action Plan…'
                : bundle
                ? 'Regenerate Recommendations'
                : 'Generate Recommendations'}
            </button>
            <button
              type="button"
              onClick={() =>
                exportExecutiveWorkbookExcel({
                  facts: filteredFacts,
                  models,
                  recommendations: bundle,
                  useRecomputed: filters.useRecomputedFinancials,
                })
              }
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-white/15 dark:text-slate-200 dark:hover:bg-white/10"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden="true" />
              Export Excel
            </button>
            <button
              type="button"
              onClick={() =>
                exportExecutiveReportPdf({
                  facts: filteredFacts,
                  filters,
                  models,
                  recommendations: bundle,
                  qualityReport: null,
                  pinnedInsights: [],
                })
              }
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-white/15 dark:text-slate-200 dark:hover:bg-white/10"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              Export PDF
            </button>
          </div>
        </div>

        {errorMsg && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-700 dark:text-rose-300">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{errorMsg}</span>
          </div>
        )}
      </div>

      {/* Executive Summary Metrics */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-[16px] border border-slate-200/90 bg-white p-4 dark:border-white/10 dark:bg-[#16314D]">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Total Revenue at Risk</span>
            <ShieldAlert className="h-4 w-4 text-rose-500" aria-hidden="true" />
          </div>
          <div className="mt-2 font-mono text-2xl font-bold text-rose-600 tabular-nums dark:text-rose-400">
            {formatCAD(bundle?.totalRevenueAtRisk ?? computedSignals.totalRevenueAtRisk)}
          </div>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Derived from declining stores, excess discounts &amp; price deviations
          </p>
        </div>

        <div className="rounded-[16px] border border-slate-200/90 bg-white p-4 dark:border-white/10 dark:bg-[#16314D]">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Estimated Opportunity Value</span>
            <TrendingUp className="h-4 w-4 text-[#26E6D0]" aria-hidden="true" />
          </div>
          <div className="mt-2 font-mono text-2xl font-bold text-[#0FA696] tabular-nums dark:text-[#26E6D0]">
            {formatCAD(bundle?.totalOpportunityValue ?? computedSignals.totalOpportunityValue)}
          </div>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Assumed recovery + cross-sell lift (explicit assumptions per card)
          </p>
        </div>

        <div className="rounded-[16px] border border-slate-200/90 bg-white p-4 dark:border-white/10 dark:bg-[#16314D]">
          <div className="text-xs text-slate-500 dark:text-slate-400">Verified Signals Computed</div>
          <div className="mt-2 font-mono text-2xl font-bold text-[#0F2238] tabular-nums dark:text-white">
            {computedSignals.signals.length}
          </div>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            {bundle
              ? `${bundle.recommendations.filter((r) => r.status === 'Done').length}/${bundle.recommendations.length} actions completed`
              : 'Ready for Gemini structured synthesis'}
          </p>
        </div>
      </div>

      {/* Pre-generation Verified Signals Preview OR Full Generated Plan */}
      {!bundle ? (
        <section className="rounded-[16px] border border-slate-200/90 bg-white p-5 dark:border-white/10 dark:bg-[#16314D]">
          <h3 className="font-display text-base font-semibold text-[#0F2238] dark:text-white">
            Verified Risk &amp; Opportunity Signals Ready for Synthesis
          </h3>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Click <strong>Generate Recommendations</strong> above to transform these computed signals into
            full 30/60/90-day executive playbooks with KPIs, owners, CAD ranges, and risk mitigations.
          </p>
          <div className="mt-4 divide-y divide-slate-100 dark:divide-white/10">
            {computedSignals.signals.map((sig) => (
              <div key={sig.id} className="flex flex-wrap items-start justify-between gap-3 py-3 text-xs">
                <div className="max-w-2xl">
                  <div className="font-semibold text-[#0F2238] dark:text-white">
                    {sig.targetType}: {sig.targetName}
                    <span className="ml-2 font-normal text-slate-500 dark:text-slate-400">
                      · {sig.sourceModel}
                    </span>
                  </div>
                  <p className="mt-1 text-slate-600 dark:text-slate-300">{sig.evidenceSummary}</p>
                </div>
                <div className="text-right font-mono tabular-nums">
                  {sig.revenueAtRiskCad > 0 && (
                    <div className="text-rose-500">Risk: {formatCAD(sig.revenueAtRiskCad)}</div>
                  )}
                  <div className="text-[#0FA696] dark:text-[#26E6D0]">
                    Opp: {formatCAD(sig.opportunityCad)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <>
          {/* Executive Synthesis & Top 5 Priorities + 90-Day Gantt Roadmap */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
            <section className="rounded-[16px] border border-slate-200/90 bg-white p-5 dark:border-white/10 dark:bg-[#16314D] lg:col-span-5">
              <h3 className="font-display text-base font-semibold text-[#0F2238] dark:text-white">
                Top 5 Priorities
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                {bundle.executiveSummary}
              </p>
              <ol className="mt-4 space-y-2.5 text-xs">
                {bundle.recommendations.slice(0, 5).map((r, i) => (
                  <li
                    key={r.id}
                    className="flex items-start justify-between gap-2 border-b border-slate-100 pb-2 last:border-none dark:border-white/10"
                  >
                    <div>
                      <span className="font-mono font-semibold text-[#0FA696] dark:text-[#26E6D0]">
                        0{i + 1}.
                      </span>{' '}
                      <span className="font-semibold text-[#0F2238] dark:text-white">{r.title}</span>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {r.targetType}: {r.targetName} · Score {r.priorityScore}
                      </div>
                    </div>
                    <span className="shrink-0 font-mono font-semibold tabular-nums text-[#0F2238] dark:text-[#26E6D0]">
                      +{formatCAD(r.expectedImpact.baseCad, true)}
                    </span>
                  </li>
                ))}
              </ol>
            </section>

            {/* 90-Day Gantt-style Action Roadmap */}
            <section className="rounded-[16px] border border-slate-200/90 bg-white p-5 dark:border-white/10 dark:bg-[#16314D] lg:col-span-7">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h3 className="font-display text-base font-semibold text-[#0F2238] dark:text-white">
                    90-Day Action Roadmap
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Sequenced implementation horizons across 30, 60, and 90 days
                  </p>
                </div>
                <div className="flex items-center gap-4 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  <span>Day 1–30</span>
                  <span>Day 31–60</span>
                  <span>Day 61–90</span>
                </div>
              </div>

              <div className="space-y-2.5">
                {bundle.recommendations.slice(0, 6).map((rec) => {
                  const maxDays = Math.max(...rec.implementationPlan.map((s) => s.timelineDays), 30);
                  const pct = Math.min(100, Math.round((maxDays / 90) * 100));
                  return (
                    <div key={rec.id} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="truncate font-medium text-[#0F2238] dark:text-slate-100">
                          {rec.title}
                        </span>
                        <span className="ml-2 shrink-0 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                          {rec.status} · {maxDays}d
                        </span>
                      </div>
                      <div className="grid h-4 w-full grid-cols-3 gap-0.5 overflow-hidden rounded-md bg-slate-100 p-0.5 dark:bg-[#0F2238]">
                        <div
                          className="col-span-3 h-full rounded-sm brand-gradient opacity-85"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>

          {/* Filter Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <div className="flex items-center rounded-lg border border-slate-300 p-0.5 dark:border-white/15">
                {['ALL', 'Critical', 'High', 'Medium', 'Low'].map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPriorityFilter(p)}
                    className={`rounded-md px-2.5 py-1 font-medium ${
                      priorityFilter === p
                        ? 'brand-gradient text-[#0F2238] font-semibold'
                        : 'text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
              <select
                aria-label="Filter by target type"
                value={targetFilter}
                onChange={(e) => setTargetFilter(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-[#0F2238] dark:border-white/15 dark:bg-[#16314D] dark:text-white"
              >
                <option value="ALL">All Target Types</option>
                {targetTypes.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <input
              type="search"
              placeholder="Filter by store, product, or rep…"
              value={searchTarget}
              onChange={(e) => setSearchTarget(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-[#0F2238] dark:border-white/15 dark:bg-[#16314D] dark:text-white sm:w-64"
            />
          </div>

          {/* Detailed Recommendation Cards */}
          <div className="space-y-5">
            {filteredRecs.map((rec) => (
              <article
                key={rec.id}
                className="rounded-[16px] border border-slate-200/90 bg-white p-5 dark:border-white/10 dark:bg-[#16314D]"
              >
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-4 dark:border-white/10">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span className={priorityTextClass(rec.priority)}>{rec.priority} Priority</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        Score {rec.priorityScore} (I:{rec.impactScore} × C:{rec.confidenceScore} ÷ E:{rec.effortScore})
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {rec.targetType}: <strong className="text-[#0F2238] dark:text-white">{rec.targetName}</strong>
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>Source: {rec.sourceModel}</span>
                    </div>
                    <h3 className="mt-1.5 font-display text-lg font-semibold text-[#0F2238] dark:text-white">
                      {rec.title}
                    </h3>
                  </div>

                  {/* Persistent Status Tracker */}
                  <div className="flex items-center gap-1 rounded-lg border border-slate-200 p-0.5 text-xs dark:border-white/15">
                    {(['Not started', 'In progress', 'Done'] as const).map((st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => handleStatusChange(rec.id, st)}
                        className={`whitespace-nowrap rounded-md px-2.5 py-1 font-medium transition-colors ${
                          rec.status === st
                            ? 'brand-gradient text-[#0F2238] font-semibold'
                            : 'text-slate-600 hover:text-[#0F2238] dark:text-slate-300 dark:hover:text-white'
                        }`}
                      >
                        {st}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Evidence + Root Cause + Expected Impact */}
                <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-12">
                  <div className="space-y-3 lg:col-span-7">
                    <div>
                      <h4 className="text-xs font-semibold text-[#0F2238] dark:text-white">
                        Verified Data Evidence
                      </h4>
                      <ul className="mt-1.5 list-disc space-y-1 pl-4 text-xs text-slate-700 dark:text-slate-200">
                        {rec.evidence.map((ev, i) => (
                          <li key={i}>{ev}</li>
                        ))}
                      </ul>
                    </div>

                    <div>
                      <h4 className="text-xs font-semibold text-[#0F2238] dark:text-white">
                        Root-Cause Hypothesis (Confidence: {rec.confidenceLevel})
                      </h4>
                      <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                        {rec.rootCauseHypothesis}
                      </p>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-4 dark:border-white/10 dark:bg-[#0F2238]/60 lg:col-span-5">
                    <h4 className="text-xs font-semibold text-[#0F2238] dark:text-white">
                      Expected Business Impact (CAD Uplift)
                    </h4>
                    <div className="mt-2.5 grid grid-cols-3 gap-2 font-mono tabular-nums">
                      <div>
                        <div className="text-[11px] font-sans text-slate-500 dark:text-slate-400">Low</div>
                        <div className="text-sm font-semibold text-[#0F2238] dark:text-slate-200">
                          {formatCAD(rec.expectedImpact.lowCad, true)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] font-sans text-slate-500 dark:text-slate-400">Base</div>
                        <div className="text-base font-bold text-[#0FA696] dark:text-[#26E6D0]">
                          {formatCAD(rec.expectedImpact.baseCad, true)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] font-sans text-slate-500 dark:text-slate-400">High</div>
                        <div className="text-sm font-semibold text-[#B740DE]">
                          {formatCAD(rec.expectedImpact.highCad, true)}
                        </div>
                      </div>
                    </div>
                    <p className="mt-2.5 border-t border-slate-200/80 pt-2 text-[11px] leading-relaxed text-slate-600 dark:border-white/10 dark:text-slate-300">
                      <strong>Assumptions:</strong> {rec.expectedImpact.assumptions}
                    </p>
                  </div>
                </div>

                {/* Implementation Plan */}
                <div className="mt-5 border-t border-slate-100 pt-4 dark:border-white/10">
                  <h4 className="text-xs font-semibold text-[#0F2238] dark:text-white">
                    Implementation Plan (30 / 60 / 90 Days)
                  </h4>
                  <div className="mt-2.5 grid grid-cols-1 gap-3 md:grid-cols-3">
                    {rec.implementationPlan.map((step) => (
                      <div
                        key={step.stepNumber}
                        className="rounded-xl border border-slate-200/70 p-3 text-xs dark:border-white/10"
                      >
                        <div className="flex items-center justify-between font-mono text-[11px] text-[#0FA696] dark:text-[#26E6D0]">
                          <span>Step {step.stepNumber}</span>
                          <span>Day {step.timelineDays}</span>
                        </div>
                        <p className="mt-1 font-medium text-[#0F2238] dark:text-white">{step.action}</p>
                        <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                          Owner: {step.ownerRole} · Resources: {step.resources}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Measurable KPIs & Risks */}
                <div className="mt-5 grid grid-cols-1 gap-5 border-t border-slate-100 pt-4 dark:border-white/10 lg:grid-cols-12">
                  <div className="lg:col-span-7">
                    <h4 className="mb-2 text-xs font-semibold text-[#0F2238] dark:text-white">
                      Measurable KPIs
                    </h4>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="border-b border-slate-200 text-slate-500 dark:border-white/10 dark:text-slate-400">
                            <th className="py-1.5 pr-3">Metric</th>
                            <th className="py-1.5 pr-3">Baseline</th>
                            <th className="py-1.5 pr-3">Target</th>
                            <th className="py-1.5 pr-3">Cadence</th>
                            <th className="py-1.5">Review</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                          {rec.kpis.map((k, idx) => (
                            <tr key={idx}>
                              <td className="py-1.5 pr-3 font-medium text-[#0F2238] dark:text-white">
                                {k.metric}
                              </td>
                              <td className="py-1.5 pr-3 font-mono tabular-nums text-slate-600 dark:text-slate-300">
                                {k.baseline}
                              </td>
                              <td className="py-1.5 pr-3 font-mono font-semibold tabular-nums text-[#0FA696] dark:text-[#26E6D0]">
                                {k.target}
                              </td>
                              <td className="py-1.5 pr-3 text-slate-500 dark:text-slate-400">{k.frequency}</td>
                              <td className="py-1.5 font-mono text-slate-500 dark:text-slate-400">
                                {k.reviewDate}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="lg:col-span-5">
                    <h4 className="mb-2 text-xs font-semibold text-[#0F2238] dark:text-white">
                      Risks &amp; Mitigations
                    </h4>
                    <div className="space-y-2 text-xs">
                      {rec.risks.map((rk, idx) => (
                        <div key={idx} className="text-slate-600 dark:text-slate-300">
                          <span className="font-semibold text-[#0F2238] dark:text-white">Risk:</span>{' '}
                          {rk.risk} <span aria-hidden="true">→</span>{' '}
                          <span className="text-[#0FA696] dark:text-[#26E6D0]">{rk.mitigation}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  );
};
