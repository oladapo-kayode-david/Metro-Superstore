import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Layers,
  Play,
  Sparkles,
} from 'lucide-react';
import {
  Area,
  Bar,
  BarChart,
  ComposedChart,
  Legend,
  Line,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { AllModelResults, DimDate, FactSale, GlobalFilters } from '../types/sales';
import {
  computeEngineeredFeaturesSummary,
  formatCAD,
  formatMonthLabel,
} from '../lib/analytics/calculations';
import {
  trainAnomalyDetectionModel,
  trainBasketAffinityModel,
  trainDiscountImpactModel,
  trainSalesForecastModel,
  trainSegmentationModel,
} from '../lib/ml/models';
import { getPaletteColor, getSemanticColors } from '../lib/theme/chartTheme';
import { ChartCard } from '../components/ChartCard';

interface ModelLabViewProps {
  filteredFacts: FactSale[];
  dimDates: DimDate[];
  filters: GlobalFilters;
  models: AllModelResults;
  theme: 'dark' | 'light';
  onUpdateModels: (updater: (prev: AllModelResults) => AllModelResults) => void;
  onNotify: (msg: string, tone?: 'success' | 'error' | 'info') => void;
}

type ModelSubTab = 'forecast' | 'anomalies' | 'discount' | 'segmentation' | 'basket' | 'features';

export const ModelLabView: React.FC<ModelLabViewProps> = ({
  filteredFacts,
  dimDates,
  filters,
  models,
  theme,
  onUpdateModels,
  onNotify,
}) => {
  const semantic = getSemanticColors(theme);
  const primaryTeal = getPaletteColor(0, theme);
  const secondaryPurple = getPaletteColor(1, theme);
  const [activeModel, setActiveModel] = useState<ModelSubTab>('forecast');
  const [trainingKey, setTrainingKey] = useState<string | null>(null);

  // Forecast controls
  const [horizon, setHorizon] = useState<3 | 6 | 12>(6);
  const [scopeType, setScopeType] = useState<'overall' | 'store' | 'category'>('overall');
  const [scopeValue, setScopeValue] = useState<string>('');
  const [useLstm, setUseLstm] = useState<boolean>(false);
  const [segEntityType, setSegEntityType] = useState<'store' | 'salesperson'>('store');

  const storeList = useMemo(
    () => Array.from(new Set(filteredFacts.map((f) => f.store))).sort(),
    [filteredFacts]
  );
  const categoryList = useMemo(
    () => Array.from(new Set(filteredFacts.map((f) => f.category))).sort(),
    [filteredFacts]
  );

  const engineeredFeatures = useMemo(
    () => computeEngineeredFeaturesSummary(filteredFacts, dimDates, filters.useRecomputedFinancials),
    [filteredFacts, dimDates, filters.useRecomputedFinancials]
  );

  const runForecast = async () => {
    setTrainingKey('forecast');
    try {
      const effectiveVal =
        scopeType === 'store'
          ? scopeValue || storeList[0]
          : scopeType === 'category'
          ? scopeValue || categoryList[0]
          : undefined;
      const res = await trainSalesForecastModel({
        facts: filteredFacts,
        horizonMonths: horizon,
        scopeType,
        scopeValue: effectiveVal,
        useLstm,
        useRecomputed: filters.useRecomputedFinancials,
      });
      onUpdateModels((prev) => ({ ...prev, forecast: res }));
      onNotify(
        res.sufficientData
          ? `Sales Forecast trained (${res.method})`
          : res.insufficientReason || 'Insufficient data for forecast',
        res.sufficientData ? 'success' : 'info'
      );
    } finally {
      setTrainingKey(null);
    }
  };

  const runAnomalies = () => {
    setTrainingKey('anomalies');
    setTimeout(() => {
      const res = trainAnomalyDetectionModel(filteredFacts, filters.useRecomputedFinancials);
      onUpdateModels((prev) => ({ ...prev, anomalies: res }));
      onNotify(`Anomaly Detection complete: ${res.flaggedCount} events flagged`, 'success');
      setTrainingKey(null);
    }, 30);
  };

  const runDiscount = () => {
    setTrainingKey('discount');
    setTimeout(() => {
      const res = trainDiscountImpactModel(filteredFacts, filters.useRecomputedFinancials);
      onUpdateModels((prev) => ({ ...prev, discountImpact: res }));
      onNotify('Discount Elasticity model trained', 'success');
      setTrainingKey(null);
    }, 30);
  };

  const runSegmentation = () => {
    setTrainingKey('segmentation');
    setTimeout(() => {
      const res = trainSegmentationModel(filteredFacts, segEntityType, filters.useRecomputedFinancials);
      onUpdateModels((prev) =>
        segEntityType === 'store'
          ? { ...prev, storeSegmentation: res }
          : { ...prev, repSegmentation: res }
      );
      onNotify(
        `${segEntityType === 'store' ? 'Store' : 'Salesperson'} K-Means segmentation complete (k=${res.optimalK})`,
        'success'
      );
      setTrainingKey(null);
    }, 30);
  };

  const runBasket = () => {
    setTrainingKey('basket');
    setTimeout(() => {
      const res = trainBasketAffinityModel(filteredFacts);
      onUpdateModels((prev) => ({ ...prev, basketAffinity: res }));
      onNotify(`Basket Affinity discovered ${res.rules.length} association rules`, 'success');
      setTrainingKey(null);
    }, 30);
  };

  const trainAllModels = async () => {
    setTrainingKey('all');
    try {
      const fc = await trainSalesForecastModel({
        facts: filteredFacts,
        horizonMonths: horizon,
        scopeType: 'overall',
        useLstm: false,
        useRecomputed: filters.useRecomputedFinancials,
      });
      const anom = trainAnomalyDetectionModel(filteredFacts, filters.useRecomputedFinancials);
      const disc = trainDiscountImpactModel(filteredFacts, filters.useRecomputedFinancials);
      const storeSeg = trainSegmentationModel(filteredFacts, 'store', filters.useRecomputedFinancials);
      const repSeg = trainSegmentationModel(filteredFacts, 'salesperson', filters.useRecomputedFinancials);
      const basket = trainBasketAffinityModel(filteredFacts);
      onUpdateModels(() => ({
        forecast: fc,
        anomalies: anom,
        discountImpact: disc,
        storeSegmentation: storeSeg,
        repSegmentation: repSeg,
        basketAffinity: basket,
      }));
      onNotify('All 5 in-browser ML models trained and evaluated', 'success');
    } finally {
      setTrainingKey(null);
    }
  };

  const axisStyle = { fontSize: 11, fill: theme === 'dark' ? '#94A3B8' : '#475569' };

  const renderGovernanceFooter = (params: {
    trainedAt: string;
    rowCount: number;
    beatsBaseline: boolean;
    baselineLabel: string;
    baselineComparison: string;
    plainEnglish: string;
    featureImportance: Array<{ feature: string; importance: number }>;
    assumptions: string[];
    limitations: string[];
  }) => (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      {/* Baseline Comparison & Plain-English Explanation */}
      <div className="space-y-4 rounded-[16px] border border-slate-200/90 bg-white p-5 dark:border-white/10 dark:bg-[#16314D] lg:col-span-7">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3 dark:border-white/10">
          <div className="flex items-center gap-2">
            {params.beatsBaseline ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-500 dark:text-[#26E6D0]" aria-hidden="true" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-amber-500" aria-hidden="true" />
            )}
            <span className="font-display text-sm font-semibold text-[#0F2238] dark:text-white">
              {params.beatsBaseline
                ? 'Beats Naive Baseline — Validated for Decision Support'
                : 'Did Not Beat Naive Baseline — Use With Caution'}
            </span>
          </div>
          <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
            Trained {params.trainedAt.slice(0, 16).replace('T', ' ')} · {params.rowCount.toLocaleString()} rows
          </span>
        </div>

        <div className="text-xs text-slate-600 dark:text-slate-300">
          <span className="font-semibold text-[#0F2238] dark:text-white">Baseline ({params.baselineLabel}): </span>
          {params.baselineComparison}
        </div>

        <p className="text-sm leading-relaxed text-[#0F2238] dark:text-slate-100">
          {params.plainEnglish}
        </p>

        <div className="grid grid-cols-1 gap-3 pt-1 sm:grid-cols-2">
          <div>
            <h5 className="text-xs font-semibold text-[#0F2238] dark:text-white">Key Assumptions</h5>
            <ul className="mt-1.5 list-disc space-y-1 pl-4 text-xs text-slate-600 dark:text-slate-300">
              {params.assumptions.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </div>
          <div>
            <h5 className="text-xs font-semibold text-[#0F2238] dark:text-white">Limitations</h5>
            <ul className="mt-1.5 list-disc space-y-1 pl-4 text-xs text-slate-600 dark:text-slate-300">
              {params.limitations.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Feature Importance / Drivers */}
      <div className="rounded-[16px] border border-slate-200/90 bg-white p-5 dark:border-white/10 dark:bg-[#16314D] lg:col-span-5">
        <h4 className="font-display text-sm font-semibold text-[#0F2238] dark:text-white">
          Feature Importance & Key Drivers
        </h4>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          Relative contribution to model predictions
        </p>
        <div className="mt-4 space-y-3">
          {params.featureImportance.map((fi) => (
            <div key={fi.feature}>
              <div className="flex justify-between text-xs">
                <span className="text-[#0F2238] dark:text-slate-200">{fi.feature}</span>
                <span className="font-mono tabular-nums text-slate-500 dark:text-slate-300">
                  {fi.importance}%
                </span>
              </div>
              <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                <div
                  className="h-full rounded-full brand-gradient"
                  style={{ width: `${Math.min(100, Math.max(4, fi.importance))}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const activeSeg =
    segEntityType === 'store' ? models.storeSegmentation : models.repSegmentation;

  const radarData = useMemo(() => {
    if (!activeSeg?.sufficientData) return [];
    const axes = [
      { metric: 'Growth', key: 'growthScore' as const },
      { metric: 'Consistency', key: 'consistencyScore' as const },
      { metric: 'AOV', key: 'aovScore' as const },
      { metric: 'Discount Discipline', key: 'discountDiscipline' as const },
      { metric: 'Category Mix', key: 'mixDiversity' as const },
    ];
    return axes.map((ax) => {
      const row: Record<string, string | number> = { metric: ax.metric };
      activeSeg.clusterProfiles.forEach((cp) => {
        row[cp.tier] = cp[ax.key];
      });
      return row;
    });
  }, [activeSeg]);

  return (
    <div className="space-y-6">
      {/* Header & Model Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-[16px] border border-slate-200/90 bg-white p-4 dark:border-white/10 dark:bg-[#16314D]">
        <div className="flex flex-wrap items-center gap-1.5">
          {([
            { id: 'forecast', label: '1. Sales Forecast', ready: Boolean(models.forecast?.sufficientData) },
            { id: 'anomalies', label: '2. Anomaly Detection', ready: Boolean(models.anomalies?.sufficientData) },
            { id: 'discount', label: '3. Discount Impact', ready: Boolean(models.discountImpact?.sufficientData) },
            { id: 'segmentation', label: '4. Segmentation', ready: Boolean(models.storeSegmentation?.sufficientData || models.repSegmentation?.sufficientData) },
            { id: 'basket', label: '5. Basket Affinity', ready: Boolean(models.basketAffinity?.sufficientData) },
            { id: 'features', label: 'Engineered Features', ready: true },
          ] as const).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveModel(tab.id)}
              className={`whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                activeModel === tab.id
                  ? 'brand-gradient text-[#0F2238] font-semibold'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10'
              }`}
            >
              {tab.label}
              {tab.id !== 'features' && tab.ready ? ' ✓' : ''}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={trainAllModels}
          disabled={trainingKey !== null || filteredFacts.length === 0}
          className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg brand-gradient px-4 py-2 text-xs font-semibold text-[#0F2238] transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <Cpu className="h-4 w-4" aria-hidden="true" />
          {trainingKey === 'all' ? 'Training All Models…' : 'Train All 5 Models'}
        </button>
      </div>

      {/* MODEL 1: SALES FORECAST */}
      {activeModel === 'forecast' && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-slate-200/90 bg-white p-4 dark:border-white/10 dark:bg-[#16314D]">
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <label className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                Horizon
                <select
                  value={horizon}
                  onChange={(e) => setHorizon(Number(e.target.value) as 3 | 6 | 12)}
                  className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-[#0F2238] dark:border-white/15 dark:bg-[#0F2238] dark:text-white"
                >
                  <option value={3}>Next 3 Months</option>
                  <option value={6}>Next 6 Months</option>
                  <option value={12}>Next 12 Months</option>
                </select>
              </label>

              <label className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                Scope
                <select
                  value={scopeType}
                  onChange={(e) => {
                    const next = e.target.value as 'overall' | 'store' | 'category';
                    setScopeType(next);
                    setScopeValue(next === 'store' ? storeList[0] ?? '' : next === 'category' ? categoryList[0] ?? '' : '');
                  }}
                  className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-[#0F2238] dark:border-white/15 dark:bg-[#0F2238] dark:text-white"
                >
                  <option value="overall">Overall Network</option>
                  <option value="store">By Store</option>
                  <option value="category">By Category</option>
                </select>
              </label>

              {scopeType !== 'overall' && (
                <select
                  value={scopeValue}
                  onChange={(e) => setScopeValue(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-[#0F2238] dark:border-white/15 dark:bg-[#0F2238] dark:text-white"
                >
                  {(scopeType === 'store' ? storeList : categoryList).map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              )}

              <label className="inline-flex cursor-pointer items-center gap-2 text-slate-600 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={useLstm}
                  onChange={(e) => setUseLstm(e.target.checked)}
                  className="rounded accent-[#26E6D0]"
                />
                Enable TF.js LSTM Blend (≥ 18 months)
              </label>
            </div>

            <button
              type="button"
              onClick={runForecast}
              disabled={trainingKey !== null}
              className="inline-flex items-center gap-2 rounded-lg brand-gradient px-4 py-2 text-xs font-semibold text-[#0F2238] disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
              {trainingKey === 'forecast' ? 'Training…' : 'Train Forecast Model'}
            </button>
          </div>

          {models.forecast ? (
            models.forecast.sufficientData ? (
              <>
                <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
                  {[
                    { label: 'MAE (Holdout)', val: formatCAD(models.forecast.metrics.mae) },
                    { label: 'RMSE (Holdout)', val: formatCAD(models.forecast.metrics.rmse) },
                    { label: 'MAPE', val: `${models.forecast.metrics.mape}%` },
                    { label: 'Validation R²', val: String(models.forecast.metrics.r2) },
                  ].map((m) => (
                    <div
                      key={m.label}
                      className="rounded-[16px] border border-slate-200/90 bg-white p-4 dark:border-white/10 dark:bg-[#16314D]"
                    >
                      <div className="text-xs text-slate-500 dark:text-slate-400">{m.label}</div>
                      <div className="mt-1.5 font-mono text-xl font-bold text-[#0F2238] tabular-nums dark:text-[#26E6D0]">
                        {m.val}
                      </div>
                    </div>
                  ))}
                </div>

                <ChartCard
                  title={`Sales Forecast Backtest & ${models.forecast.horizonMonths}-Month Projection`}
                  subtitle={`${models.forecast.method} · ${models.forecast.scope} · Shaded 80% & 95% confidence intervals`}
                  exportName="ml_sales_forecast"
                  minHeight={340}
                  tableData={models.forecast.points.map((p) => ({
                    Month: p.yearMonth,
                    Type: p.isForecast ? 'Forecast' : 'Historical',
                    'Actual (CAD)': p.actual ?? '',
                    'Predicted (CAD)': p.predicted ?? '',
                    'Lower 80%': p.lower80 ?? '',
                    'Upper 80%': p.upper80 ?? '',
                    'Lower 95%': p.lower95 ?? '',
                    'Upper 95%': p.upper95 ?? '',
                    'Predicted Qty': p.quantityPredicted ?? '',
                  }))}
                >
                  <ResponsiveContainer width="100%" height={340}>
                    <ComposedChart
                      data={models.forecast.points.map((p) => ({
                        ...p,
                        label: formatMonthLabel(p.yearMonth),
                        band95: p.lower95 !== undefined && p.upper95 !== undefined ? [p.lower95, p.upper95] : undefined,
                        band80: p.lower80 !== undefined && p.upper80 !== undefined ? [p.lower80, p.upper80] : undefined,
                      }))}
                      margin={{ top: 10, right: 18, left: 6, bottom: 8 }}
                    >
                      <XAxis
                        dataKey="label"
                        tick={axisStyle}
                        axisLine={{ stroke: 'rgba(148,163,184,0.28)' }}
                        tickLine={false}
                      />
                      <YAxis
                        tick={axisStyle}
                        axisLine={{ stroke: 'rgba(148,163,184,0.28)' }}
                        tickLine={false}
                        tickFormatter={(v) => formatCAD(Number(v), true)}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#0F2238',
                          borderColor: 'rgba(255,255,255,0.14)',
                          borderRadius: 12,
                          fontSize: 12,
                          color: '#F1F5F9',
                        }}
                        formatter={(v: unknown, name?: string | number) => {
                          const label = String(name ?? '');
                          if (Array.isArray(v)) {
                            return [`${formatCAD(Number(v[0]))} – ${formatCAD(Number(v[1]))}`, label];
                          }
                          return [formatCAD(Number(v)), label];
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Area
                        type="monotone"
                        dataKey="band95"
                        name="95% Confidence Band"
                        stroke="none"
                        fill={secondaryPurple}
                        fillOpacity={0.14}
                        animationDuration={320}
                      />
                      <Area
                        type="monotone"
                        dataKey="band80"
                        name="80% Confidence Band"
                        stroke="none"
                        fill={primaryTeal}
                        fillOpacity={0.22}
                        animationDuration={320}
                      />
                      <Line
                        type="monotone"
                        dataKey="actual"
                        name="Actual Sales"
                        stroke={primaryTeal}
                        strokeWidth={2.5}
                        dot={{ r: 2.5 }}
                        animationDuration={320}
                      />
                      <Line
                        type="monotone"
                        dataKey="predicted"
                        name="Model Fit / Forecast"
                        stroke={secondaryPurple}
                        strokeWidth={2.5}
                        strokeDasharray="5 3"
                        dot={{ r: 2.5 }}
                        animationDuration={320}
                      />
                      <Line
                        type="monotone"
                        dataKey="naive"
                        name="Naive Baseline (Holdout)"
                        stroke={semantic.neutral}
                        strokeWidth={1.8}
                        strokeDasharray="3 3"
                        dot={false}
                        connectNulls
                        animationDuration={320}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </ChartCard>

                {renderGovernanceFooter({
                  trainedAt: models.forecast.trainedAt,
                  rowCount: models.forecast.rowCount,
                  beatsBaseline: models.forecast.naiveBaseline.beatsBaseline,
                  baselineLabel: models.forecast.naiveBaseline.label,
                  baselineComparison: `Baseline RMSE ${formatCAD(models.forecast.naiveBaseline.rmse)} (MAPE ${models.forecast.naiveBaseline.mape}%) vs Model RMSE ${formatCAD(models.forecast.metrics.rmse)} (MAPE ${models.forecast.metrics.mape}%).`,
                  plainEnglish: models.forecast.plainEnglish,
                  featureImportance: models.forecast.featureImportance,
                  assumptions: models.forecast.assumptions,
                  limitations: models.forecast.limitations,
                })}
              </>
            ) : (
              <div className="rounded-[16px] border border-amber-500/30 bg-amber-500/10 p-6 text-sm text-amber-800 dark:text-amber-200">
                {models.forecast.insufficientReason}
              </div>
            )
          ) : (
            <div className="rounded-[16px] border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500 dark:border-white/15 dark:text-slate-400">
              Click <strong>Train Forecast Model</strong> to run chronological backtesting and project the next {horizon} months.
            </div>
          )}
        </div>
      )}

      {/* MODEL 2: ANOMALY DETECTION */}
      {activeModel === 'anomalies' && (
        <div className="space-y-5">
          <div className="flex items-center justify-between rounded-[16px] border border-slate-200/90 bg-white p-4 dark:border-white/10 dark:bg-[#16314D]">
            <div className="text-xs text-slate-600 dark:text-slate-300">
              Detects unusual daily sales spikes/drops, unit price deviations (&gt;±25%), deep discounting, and salesperson peer outliers.
            </div>
            <button
              type="button"
              onClick={runAnomalies}
              disabled={trainingKey !== null}
              className="inline-flex items-center gap-2 rounded-lg brand-gradient px-4 py-2 text-xs font-semibold text-[#0F2238]"
            >
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
              Train Anomaly Detector
            </button>
          </div>

          {models.anomalies?.sufficientData ? (
            <>
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
                <div className="rounded-[16px] border border-slate-200/90 bg-white p-4 dark:border-white/10 dark:bg-[#16314D]">
                  <div className="text-xs text-slate-500 dark:text-slate-400">Anomalies Flagged</div>
                  <div className="mt-1 font-mono text-2xl font-bold text-[#0F2238] tabular-nums dark:text-[#26E6D0]">
                    {models.anomalies.flaggedCount}
                  </div>
                </div>
                <div className="rounded-[16px] border border-slate-200/90 bg-white p-4 dark:border-white/10 dark:bg-[#16314D]">
                  <div className="text-xs text-slate-500 dark:text-slate-400">Precision Proxy</div>
                  <div className="mt-1 font-mono text-2xl font-bold text-[#0F2238] tabular-nums dark:text-[#B740DE]">
                    {models.anomalies.precisionProxy}%
                  </div>
                </div>
                <div className="rounded-[16px] border border-slate-200/90 bg-white p-4 dark:border-white/10 dark:bg-[#16314D]">
                  <div className="text-xs text-slate-500 dark:text-slate-400">Naive Daily ±3σ Baseline</div>
                  <div className="mt-1 font-mono text-2xl font-bold text-[#0F2238] tabular-nums dark:text-white">
                    {models.anomalies.naiveBaseline.flaggedCount} events
                  </div>
                </div>
              </div>

              <ChartCard
                title="Top Detected Anomalies"
                subtitle="Sorted by composite anomaly score (0 to 1)"
                exportName="ml_anomalies"
                tableData={models.anomalies.anomalies as unknown as Array<Record<string, unknown>>}
              >
                <div className="max-h-80 overflow-auto">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead className="sticky top-0 bg-slate-100 text-slate-600 dark:bg-[#0F2238] dark:text-slate-300">
                      <tr>
                        <th className="px-3 py-2">Date</th>
                        <th className="px-3 py-2">Category</th>
                        <th className="px-3 py-2">Entity</th>
                        <th className="px-3 py-2 text-right">Observed</th>
                        <th className="px-3 py-2 text-right">Expected</th>
                        <th className="px-3 py-2 text-right">Score</th>
                        <th className="px-3 py-2">Explanation</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                      {models.anomalies.anomalies.slice(0, 20).map((a) => (
                        <tr key={a.id} className="hover:bg-slate-50 dark:hover:bg-white/5">
                          <td className="whitespace-nowrap px-3 py-2 font-mono">{a.date}</td>
                          <td className="whitespace-nowrap px-3 py-2 capitalize">{a.type.replace('_', ' ')}</td>
                          <td className="px-3 py-2 font-medium text-[#0F2238] dark:text-white">{a.entity}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">{a.observed}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-500">{a.expected}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">
                            <span
                              style={{
                                color: a.severity === 'High' ? semantic.negative : semantic.warning,
                              }}
                              className="font-semibold"
                            >
                              {a.score.toFixed(2)} ({a.severity})
                            </span>
                          </td>
                          <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{a.explanation}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </ChartCard>

              {renderGovernanceFooter({
                trainedAt: models.anomalies.trainedAt,
                rowCount: models.anomalies.rowCount,
                beatsBaseline: models.anomalies.naiveBaseline.beatsBaseline,
                baselineLabel: models.anomalies.naiveBaseline.label,
                baselineComparison: models.anomalies.naiveBaseline.note,
                plainEnglish: models.anomalies.plainEnglish,
                featureImportance: models.anomalies.featureImportance,
                assumptions: models.anomalies.assumptions,
                limitations: models.anomalies.limitations,
              })}
            </>
          ) : (
            <div className="rounded-[16px] border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500 dark:border-white/15 dark:text-slate-400">
              Click <strong>Train Anomaly Detector</strong> to score daily sales, pricing, discounts, and salesperson outliers.
            </div>
          )}
        </div>
      )}

      {/* MODEL 3: DISCOUNT IMPACT */}
      {activeModel === 'discount' && (
        <div className="space-y-5">
          <div className="flex items-center justify-between rounded-[16px] border border-slate-200/90 bg-white p-4 dark:border-white/10 dark:bg-[#16314D]">
            <div className="text-xs text-slate-600 dark:text-slate-300">
              Fits a log-log elasticity regression estimating how Discount Rate drives Quantity and Net Revenue realization.
            </div>
            <button
              type="button"
              onClick={runDiscount}
              disabled={trainingKey !== null}
              className="inline-flex items-center gap-2 rounded-lg brand-gradient px-4 py-2 text-xs font-semibold text-[#0F2238]"
            >
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
              Train Elasticity Model
            </button>
          </div>

          {models.discountImpact?.sufficientData ? (
            <>
              <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
                <div className="rounded-[16px] border border-slate-200/90 bg-white p-4 dark:border-white/10 dark:bg-[#16314D]">
                  <div className="text-xs text-slate-500 dark:text-slate-400">Quantity Elasticity</div>
                  <div className="mt-1 font-mono text-2xl font-bold text-[#0F2238] tabular-nums dark:text-[#26E6D0]">
                    {models.discountImpact.quantityElasticity}
                  </div>
                </div>
                <div className="rounded-[16px] border border-slate-200/90 bg-white p-4 dark:border-white/10 dark:bg-[#16314D]">
                  <div className="text-xs text-slate-500 dark:text-slate-400">Revenue Elasticity</div>
                  <div className="mt-1 font-mono text-2xl font-bold text-[#0F2238] tabular-nums dark:text-white">
                    {models.discountImpact.revenueElasticity}
                  </div>
                </div>
                <div className="rounded-[16px] border border-slate-200/90 bg-white p-4 dark:border-white/10 dark:bg-[#16314D]">
                  <div className="text-xs text-slate-500 dark:text-slate-400">Log-Log R²</div>
                  <div className="mt-1 font-mono text-2xl font-bold text-[#0F2238] tabular-nums dark:text-[#B740DE]">
                    {models.discountImpact.r2}
                  </div>
                </div>
                <div className="rounded-[16px] border border-slate-200/90 bg-white p-4 dark:border-white/10 dark:bg-[#16314D]">
                  <div className="text-xs text-slate-500 dark:text-slate-400">Optimal Discount Band</div>
                  <div className="mt-1 font-display text-lg font-bold text-[#0F2238] dark:text-[#26E6D0]">
                    {models.discountImpact.optimalDiscountBand}
                  </div>
                </div>
              </div>

              <ChartCard
                title="Discount Band Net Revenue vs Model Curve"
                subtitle="Observed Net Revenue (CAD) vs Avg Units/Transaction across discount bands"
                exportName="ml_discount_elasticity"
                tableData={models.discountImpact.bands as unknown as Array<Record<string, unknown>>}
              >
                <ResponsiveContainer width="100%" height={300}>
                  <ComposedChart data={models.discountImpact.bands} margin={{ top: 10, right: 16, left: 6, bottom: 8 }}>
                    <XAxis
                      dataKey="band"
                      tick={axisStyle}
                      axisLine={{ stroke: 'rgba(148,163,184,0.28)' }}
                      tickLine={false}
                    />
                    <YAxis
                      yAxisId="left"
                      tick={axisStyle}
                      axisLine={{ stroke: 'rgba(148,163,184,0.28)' }}
                      tickLine={false}
                      tickFormatter={(v) => formatCAD(Number(v), true)}
                    />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      tick={axisStyle}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0F2238',
                        borderColor: 'rgba(255,255,255,0.14)',
                        borderRadius: 12,
                        fontSize: 12,
                        color: '#F1F5F9',
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar
                      yAxisId="left"
                      dataKey="netRevenue"
                      name="Actual Net Revenue (CAD)"
                      fill={primaryTeal}
                      radius={[6, 6, 0, 0]}
                      animationDuration={320}
                    />
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="avgUnits"
                      name="Avg Units / Txn"
                      stroke={secondaryPurple}
                      strokeWidth={2.5}
                      dot={{ r: 3.5 }}
                      animationDuration={320}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </ChartCard>

              {renderGovernanceFooter({
                trainedAt: models.discountImpact.trainedAt,
                rowCount: models.discountImpact.rowCount,
                beatsBaseline: models.discountImpact.naiveBaseline.beatsBaseline,
                baselineLabel: models.discountImpact.naiveBaseline.label,
                baselineComparison: `Model R² = ${models.discountImpact.r2} vs constant-mean baseline R² = 0.00.`,
                plainEnglish: models.discountImpact.plainEnglish,
                featureImportance: models.discountImpact.featureImportance,
                assumptions: models.discountImpact.assumptions,
                limitations: models.discountImpact.limitations,
              })}
            </>
          ) : (
            <div className="rounded-[16px] border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500 dark:border-white/15 dark:text-slate-400">
              Click <strong>Train Elasticity Model</strong> to quantify volume and net revenue response to discounting.
            </div>
          )}
        </div>
      )}

      {/* MODEL 4: PERFORMANCE SEGMENTATION */}
      {activeModel === 'segmentation' && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-slate-200/90 bg-white p-4 dark:border-white/10 dark:bg-[#16314D]">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500 dark:text-slate-400">Cluster Entity:</span>
              <div className="flex rounded-lg border border-slate-300 p-0.5 dark:border-white/15">
                {(['store', 'salesperson'] as const).map((et) => (
                  <button
                    key={et}
                    type="button"
                    onClick={() => setSegEntityType(et)}
                    className={`rounded-md px-3 py-1 text-xs font-medium capitalize ${
                      segEntityType === et
                        ? 'brand-gradient text-[#0F2238] font-semibold'
                        : 'text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {et === 'store' ? 'Stores' : 'Salespeople'}
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={runSegmentation}
              disabled={trainingKey !== null}
              className="inline-flex items-center gap-2 rounded-lg brand-gradient px-4 py-2 text-xs font-semibold text-[#0F2238]"
            >
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
              Train K-Means ({segEntityType === 'store' ? 'Stores' : 'Salespeople'})
            </button>
          </div>

          {activeSeg?.sufficientData ? (
            <>
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
                <ChartCard
                  className="lg:col-span-6"
                  title={`Tier Radar Profile (k = ${activeSeg.optimalK}, Silhouette = ${activeSeg.silhouetteScore})`}
                  subtitle="Normalized 0–100 score across Growth, Consistency, AOV, Discount Discipline & Category Mix"
                  exportName={`ml_segmentation_${segEntityType}`}
                  minHeight={310}
                >
                  <ResponsiveContainer width="100%" height={310}>
                    <RadarChart data={radarData}>
                      <PolarGrid stroke="rgba(148,163,184,0.25)" />
                      <PolarAngleAxis dataKey="metric" tick={{ fill: '#94A3B8', fontSize: 11 }} />
                      <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                      {activeSeg.clusterProfiles.map((cp, idx) => (
                        <Radar
                          key={cp.tier}
                          name={`${cp.tier} (${cp.count})`}
                          dataKey={cp.tier}
                          stroke={getPaletteColor(idx, theme)}
                          fill={getPaletteColor(idx, theme)}
                          fillOpacity={0.22}
                          animationDuration={320}
                        />
                      ))}
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#0F2238',
                          borderColor: 'rgba(255,255,255,0.14)',
                          borderRadius: 12,
                          fontSize: 12,
                          color: '#F1F5F9',
                        }}
                      />
                    </RadarChart>
                  </ResponsiveContainer>
                </ChartCard>

                <ChartCard
                  className="lg:col-span-6"
                  title={`${segEntityType === 'store' ? 'Store' : 'Salesperson'} Tier Assignments`}
                  subtitle="Star, Core, Developing, and At-Risk assignments"
                  exportName={`ml_tiers_${segEntityType}`}
                  tableData={activeSeg.entities as unknown as Array<Record<string, unknown>>}
                  minHeight={310}
                >
                  <div className="max-h-72 overflow-auto">
                    <table className="w-full border-collapse text-left text-xs">
                      <thead className="sticky top-0 bg-slate-100 text-slate-600 dark:bg-[#0F2238] dark:text-slate-300">
                        <tr>
                          <th className="px-3 py-2">Name</th>
                          <th className="px-3 py-2">Tier</th>
                          <th className="px-3 py-2 text-right">Sales</th>
                          <th className="px-3 py-2 text-right">Growth</th>
                          <th className="px-3 py-2 text-right">Disc %</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                        {activeSeg.entities.map((e) => (
                          <tr key={e.name}>
                            <td className="px-3 py-2 font-medium text-[#0F2238] dark:text-white">{e.name}</td>
                            <td className="px-3 py-2 font-semibold">
                              <span
                                style={{
                                  color:
                                    e.tier === 'Star'
                                      ? semantic.positive
                                      : e.tier === 'At-Risk'
                                      ? semantic.negative
                                      : e.tier === 'Developing'
                                      ? semantic.warning
                                      : semantic.neutral,
                                }}
                              >
                                {e.tier}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums">{formatCAD(e.sales, true)}</td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums">
                              {e.growthPct >= 0 ? '+' : ''}
                              {e.growthPct}%
                            </td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums">{e.discountRate}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </ChartCard>
              </div>

              {renderGovernanceFooter({
                trainedAt: activeSeg.trainedAt,
                rowCount: activeSeg.rowCount,
                beatsBaseline: activeSeg.naiveBaseline.beatsBaseline,
                baselineLabel: activeSeg.naiveBaseline.label,
                baselineComparison: `K-Means silhouette ${activeSeg.silhouetteScore} vs revenue-only split silhouette ${activeSeg.naiveBaseline.silhouetteScore}.`,
                plainEnglish: activeSeg.plainEnglish,
                featureImportance: activeSeg.featureImportance,
                assumptions: activeSeg.assumptions,
                limitations: activeSeg.limitations,
              })}
            </>
          ) : (
            <div className="rounded-[16px] border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500 dark:border-white/15 dark:text-slate-400">
              Click <strong>Train K-Means</strong> to cluster {segEntityType === 'store' ? 'stores' : 'salespeople'} automatically by silhouette score.
            </div>
          )}
        </div>
      )}

      {/* MODEL 5: BASKET AFFINITY */}
      {activeModel === 'basket' && (
        <div className="space-y-5">
          <div className="flex items-center justify-between rounded-[16px] border border-slate-200/90 bg-white p-4 dark:border-white/10 dark:bg-[#16314D]">
            <div className="text-xs text-slate-600 dark:text-slate-300">
              Mines Apriori-style association rules grouped by Order ID to discover high-lift product bundles.
            </div>
            <button
              type="button"
              onClick={runBasket}
              disabled={trainingKey !== null}
              className="inline-flex items-center gap-2 rounded-lg brand-gradient px-4 py-2 text-xs font-semibold text-[#0F2238]"
            >
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
              Mine Basket Rules
            </button>
          </div>

          {models.basketAffinity?.sufficientData ? (
            <>
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
                <ChartCard
                  className="lg:col-span-5"
                  title="Top Association Rules by Lift"
                  subtitle={`Mined from ${models.basketAffinity.multiItemOrders.toLocaleString()} multi-item orders`}
                  exportName="ml_basket_lift"
                  minHeight={300}
                >
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart
                      layout="vertical"
                      data={models.basketAffinity.rules.slice(0, 8).map((r) => ({
                        pair: `${r.antecedent.slice(0, 14)} → ${r.consequent.slice(0, 14)}`,
                        lift: r.lift,
                      }))}
                      margin={{ top: 8, right: 16, left: 10, bottom: 8 }}
                    >
                      <XAxis
                        type="number"
                        tick={axisStyle}
                        axisLine={{ stroke: 'rgba(148,163,184,0.28)' }}
                        tickLine={false}
                      />
                      <YAxis
                        type="category"
                        dataKey="pair"
                        width={175}
                        tick={axisStyle}
                        axisLine={{ stroke: 'rgba(148,163,184,0.28)' }}
                        tickLine={false}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#0F2238',
                          borderColor: 'rgba(255,255,255,0.14)',
                          borderRadius: 12,
                          fontSize: 12,
                          color: '#F1F5F9',
                        }}
                        formatter={(v: unknown) => [`${v}x`, 'Lift']}
                      />
                      <Bar dataKey="lift" fill={secondaryPurple} radius={[0, 6, 6, 0]} animationDuration={320} />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>

                <ChartCard
                  className="lg:col-span-7"
                  title="Top 15 Association Rules (Support · Confidence · Lift)"
                  subtitle="If a customer buys Antecedent, likelihood they also buy Consequent in the same Order ID"
                  exportName="ml_basket_rules_top15"
                  tableData={models.basketAffinity.rules as unknown as Array<Record<string, unknown>>}
                  minHeight={300}
                >
                  <div className="max-h-72 overflow-auto">
                    <table className="w-full border-collapse text-left text-xs">
                      <thead className="sticky top-0 bg-slate-100 text-slate-600 dark:bg-[#0F2238] dark:text-slate-300">
                        <tr>
                          <th className="px-3 py-2">Antecedent (If Bought)</th>
                          <th className="px-3 py-2">Consequent (Also Bought)</th>
                          <th className="px-3 py-2 text-right">Support</th>
                          <th className="px-3 py-2 text-right">Confidence</th>
                          <th className="px-3 py-2 text-right">Lift</th>
                          <th className="px-3 py-2 text-right">Orders</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                        {models.basketAffinity.rules.map((r) => (
                          <tr key={r.id}>
                            <td className="px-3 py-2 font-medium text-[#0F2238] dark:text-white">{r.antecedent}</td>
                            <td className="px-3 py-2 text-[#0FA696] dark:text-[#26E6D0]">{r.consequent}</td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums">{r.support}%</td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums">{r.confidence}%</td>
                            <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums text-[#B740DE]">
                              {r.lift}x
                            </td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums">{r.coOccurrences}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </ChartCard>
              </div>

              {renderGovernanceFooter({
                trainedAt: models.basketAffinity.trainedAt,
                rowCount: models.basketAffinity.rowCount,
                beatsBaseline: models.basketAffinity.naiveBaseline.beatsBaseline,
                baselineLabel: models.basketAffinity.naiveBaseline.label,
                baselineComparison: `Discovered rules average ${
                  models.basketAffinity.rules.length
                    ? (
                        models.basketAffinity.rules.reduce((a, r) => a + r.lift, 0) /
                        models.basketAffinity.rules.length
                      ).toFixed(2)
                    : '1.00'
                }x lift vs independence baseline 1.00x.`,
                plainEnglish: models.basketAffinity.plainEnglish,
                featureImportance: models.basketAffinity.featureImportance,
                assumptions: models.basketAffinity.assumptions,
                limitations: models.basketAffinity.limitations,
              })}
            </>
          ) : (
            <div className="rounded-[16px] border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500 dark:border-white/15 dark:text-slate-400">
              Click <strong>Mine Basket Rules</strong> to discover frequently co-purchased product pairs by Order ID.
            </div>
          )}
        </div>
      )}

      {/* AUTOMATIC FEATURE ENGINEERING DOCUMENTATION PANEL */}
      {activeModel === 'features' && (
        <section className="rounded-[16px] border border-slate-200/90 bg-white p-5 dark:border-white/10 dark:bg-[#16314D]">
          <div className="mb-4 flex items-center gap-2">
            <Layers className="h-5 w-5 text-[#26E6D0]" aria-hidden="true" />
            <div>
              <h3 className="font-display text-base font-semibold text-[#0F2238] dark:text-white">
                Automatic Feature Engineering Pipeline
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Features derived automatically from cleaned Fact_Sales & Dim_Date for forecasting, anomaly scoring, elasticity, and clustering
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 lg:grid-cols-3">
            {engineeredFeatures.map((f) => (
              <div
                key={f.name}
                className="rounded-xl border border-slate-200/80 p-4 dark:border-white/10"
              >
                <div className="text-[11px] font-medium text-[#0FA696] dark:text-[#26E6D0]">
                  {f.category}
                </div>
                <h4 className="mt-1 font-display text-sm font-semibold text-[#0F2238] dark:text-white">
                  {f.name}
                </h4>
                <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-300">{f.formula}</p>
                <div className="mt-3 border-t border-slate-100 pt-2 font-mono text-xs text-[#0F2238] tabular-nums dark:border-white/10 dark:text-slate-200">
                  Observed: {f.sampleValue}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
