import React, { useMemo, useState } from 'react';
import { PinOff } from 'lucide-react';
import {
  Area,
  Bar,
  BarChart,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { AllModelResults, FactSale, GlobalFilters, PinnedInsight } from '../types/sales';
import {
  aggregateCategories,
  aggregateChannelAndPaymentMix,
  aggregateMonthlyTrend,
  aggregateProductPareto,
  computeExecutiveKpis,
  formatCAD,
  formatMonthLabel,
  formatNumber,
  formatPct,
} from '../lib/analytics/calculations';
import { CHART_PALETTE, ChartCard } from '../components/ChartCard';
import { KpiCard } from '../components/KpiCard';

interface ExecutiveOverviewProps {
  allFacts: FactSale[];
  filteredFacts: FactSale[];
  filters: GlobalFilters;
  models: AllModelResults;
  pinnedInsights: PinnedInsight[];
  onUnpinInsight: (id: string) => void;
  onCrossFilter: (field: 'categories' | 'products' | 'channels', value: string) => void;
}

export const ExecutiveOverview: React.FC<ExecutiveOverviewProps> = ({
  allFacts,
  filteredFacts,
  filters,
  models,
  pinnedInsights,
  onUnpinInsight,
  onCrossFilter,
}) => {
  const [showYoY, setShowYoY] = useState(false);
  const [showForecast, setShowForecast] = useState(true);
  const useRecomp = filters.useRecomputedFinancials;

  const kpis = useMemo(
    () => computeExecutiveKpis(allFacts, filteredFacts, filters),
    [allFacts, filteredFacts, filters]
  );

  const monthlyData = useMemo(() => {
    const base = aggregateMonthlyTrend(filteredFacts, useRecomp).map((m) => ({
      ...m,
      forecastSales: null as number | null,
    }));
    if (showForecast && models.forecast?.sufficientData) {
      const future = models.forecast.points.filter((p) => p.isForecast);
      for (const fp of future) {
        base.push({
          yearMonth: fp.yearMonth,
          label: formatMonthLabel(fp.yearMonth),
          sales: 0,
          grossSales: 0,
          discountAmount: 0,
          discountPct: 0,
          quantity: fp.quantityPredicted ?? 0,
          orders: 0,
          aov: 0,
          momPct: null,
          yoyPct: null,
          yoySales: null,
          rolling3m: null,
          forecastSales: fp.predicted ?? null,
        });
      }
    }
    return base;
  }, [filteredFacts, useRecomp, showForecast, models.forecast]);

  const categories = useMemo(
    () => aggregateCategories(filteredFacts, useRecomp),
    [filteredFacts, useRecomp]
  );

  const topProducts = useMemo(
    () => aggregateProductPareto(filteredFacts, useRecomp).slice(0, 8),
    [filteredFacts, useRecomp]
  );

  const channelPayment = useMemo(
    () => aggregateChannelAndPaymentMix(filteredFacts, useRecomp),
    [filteredFacts, useRecomp]
  );

  const axisStyle = { fontSize: 11, fill: '#94A3B8' };

  return (
    <div className="space-y-6">
      {/* KPI Grid (5 columns on xl, 2 on sm, 1 on mobile) */}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-5">
        {kpis.map((kpi) => (
          <KpiCard
            key={kpi.id}
            metric={kpi}
            invertDeltaColor={kpi.id === 'total_discounts'}
          />
        ))}
      </div>

      {/* Primary Hero Chart: Monthly Trend Combo + Forecast Extension */}
      <ChartCard
        title="Monthly Revenue & Unit Volume Trend"
        subtitle="Net Sales (CAD) area vs Quantity line · Toggle YoY overlay or trained forecast horizon"
        exportName="monthly_sales_trend"
        isEmpty={monthlyData.length === 0}
        minHeight={320}
        tableData={monthlyData.map((m) => ({
          Month: m.yearMonth,
          'Sales (CAD)': m.sales || m.forecastSales || 0,
          Quantity: m.quantity,
          Orders: m.orders,
          'MoM %': m.momPct !== null ? `${(m.momPct * 100).toFixed(1)}%` : '—',
          'YoY %': m.yoyPct !== null ? `${(m.yoyPct * 100).toFixed(1)}%` : '—',
        }))}
        headerRight={
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowYoY((v) => !v)}
              className={`rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
                showYoY
                  ? 'border-[#B740DE] bg-[#B740DE]/15 text-[#B740DE]'
                  : 'border-slate-300 text-slate-600 dark:border-white/15 dark:text-slate-300'
              }`}
            >
              YoY Overlay
            </button>
            {models.forecast?.sufficientData && (
              <button
                type="button"
                onClick={() => setShowForecast((v) => !v)}
                className={`rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
                  showForecast
                    ? 'border-[#26E6D0] bg-[#26E6D0]/15 text-[#0FA696] dark:text-[#26E6D0]'
                    : 'border-slate-300 text-slate-600 dark:border-white/15 dark:text-slate-300'
                }`}
              >
                Forecast
              </button>
            )}
          </div>
        }
      >
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={monthlyData} margin={{ top: 10, right: 16, left: 6, bottom: 8 }}>
            <defs>
              <linearGradient id="execSalesGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#26E6D0" stopOpacity={0.45} />
                <stop offset="95%" stopColor="#B740DE" stopOpacity={0.04} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="label"
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
              tickFormatter={(v) => formatNumber(Number(v))}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#0F2238',
                borderColor: 'rgba(255,255,255,0.14)',
                borderRadius: 12,
                fontSize: 12,
                color: '#F1F5F9',
              }}
              formatter={(value: unknown, name?: string | number) => {
                const n = Number(value);
                const label = String(name ?? '');
                if (label.includes('Sales') || label.includes('YoY') || label.includes('Forecast')) {
                  return [formatCAD(n), label];
                }
                return [formatNumber(n), label];
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Area
              yAxisId="left"
              type="monotone"
              dataKey="sales"
              name="Net Sales (CAD)"
              stroke="#26E6D0"
              strokeWidth={2.5}
              fill="url(#execSalesGrad)"
              animationDuration={320}
            />
            {showYoY && (
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="yoySales"
                name="Prior Year Sales (CAD)"
                stroke="#64748B"
                strokeDasharray="4 4"
                strokeWidth={2}
                dot={false}
                connectNulls
                animationDuration={320}
              />
            )}
            {showForecast && models.forecast?.sufficientData && (
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="forecastSales"
                name="ML Forecast (CAD)"
                stroke="#B740DE"
                strokeDasharray="6 3"
                strokeWidth={2.5}
                dot={{ r: 3, fill: '#B740DE' }}
                connectNulls
                animationDuration={320}
              />
            )}
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="quantity"
              name="Units Sold"
              stroke="#D07AEF"
              strokeWidth={2}
              dot={false}
              animationDuration={320}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Secondary Row: Category Donut + Top Products Pareto */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <ChartCard
          className="lg:col-span-5"
          title="Sales Share by Category"
          subtitle="Click a slice to cross-filter across all dashboards"
          exportName="category_share"
          isEmpty={categories.length === 0}
          tableData={categories.map((c) => ({
            Category: c.category,
            'Sales (CAD)': c.sales,
            'Share %': `${(c.sharePct * 100).toFixed(1)}%`,
            Quantity: c.quantity,
            'Discount %': `${(c.discountPct * 100).toFixed(1)}%`,
          }))}
        >
          <div className="flex flex-col items-center gap-4 sm:flex-row">
            <div className="h-64 w-full sm:w-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={categories}
                    dataKey="sales"
                    nameKey="category"
                    cx="50%"
                    cy="50%"
                    innerRadius={56}
                    outerRadius={88}
                    paddingAngle={2}
                    animationDuration={320}
                    onClick={(entry) => {
                      const cat = (entry as unknown as { category?: string; payload?: { category?: string } }).category ??
                        (entry as unknown as { payload?: { category?: string } }).payload?.category;
                      if (cat) onCrossFilter('categories', cat);
                    }}
                    className="cursor-pointer"
                  >
                    {categories.map((entry, idx) => (
                      <Cell key={entry.category} fill={CHART_PALETTE[idx % CHART_PALETTE.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0F2238',
                      borderColor: 'rgba(255,255,255,0.14)',
                      borderRadius: 12,
                      fontSize: 12,
                      color: '#F1F5F9',
                    }}
                    formatter={(value: unknown) => [formatCAD(Number(value)), 'Net Sales']}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="w-full flex-1 space-y-2.5 text-xs">
              {categories.map((c, idx) => (
                <button
                  key={c.category}
                  type="button"
                  onClick={() => onCrossFilter('categories', c.category)}
                  className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-slate-100 dark:hover:bg-white/5"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-sm"
                      style={{ backgroundColor: CHART_PALETTE[idx % CHART_PALETTE.length] }}
                    />
                    <span className="truncate font-medium text-[#0F2238] dark:text-slate-100">
                      {c.category}
                    </span>
                  </div>
                  <div className="shrink-0 text-right font-mono tabular-nums">
                    <span className="font-semibold text-[#0F2238] dark:text-white">
                      {formatCAD(c.sales, true)}
                    </span>
                    <span className="ml-2 text-slate-500 dark:text-slate-400">
                      {formatPct(c.sharePct)}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </ChartCard>

        <ChartCard
          className="lg:col-span-7"
          title="Top Products Pareto"
          subtitle="Net Sales (CAD) bars with cumulative % share curve · Click any product to filter"
          exportName="top_products_pareto"
          isEmpty={topProducts.length === 0}
          tableData={topProducts.map((p) => ({
            Rank: p.rank,
            Product: p.product,
            Category: p.category,
            'Sales (CAD)': p.sales,
            'Cumulative %': `${(p.cumulativePct * 100).toFixed(1)}%`,
          }))}
        >
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart
              data={topProducts.map((p) => ({
                ...p,
                shortName: p.product.length > 20 ? `${p.product.slice(0, 19)}…` : p.product,
                cumPctNum: Number((p.cumulativePct * 100).toFixed(1)),
              }))}
              margin={{ top: 10, right: 16, left: 6, bottom: 26 }}
            >
              <XAxis
                dataKey="shortName"
                tick={axisStyle}
                angle={-22}
                textAnchor="end"
                interval={0}
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
                domain={[0, 100]}
                tick={axisStyle}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `${v}%`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#0F2238',
                  borderColor: 'rgba(255,255,255,0.14)',
                  borderRadius: 12,
                  fontSize: 12,
                  color: '#F1F5F9',
                }}
                formatter={(val: unknown, name?: string | number) => {
                  const label = String(name ?? '');
                  return label === 'Cumulative %' ? [`${val}%`, label] : [formatCAD(Number(val)), label];
                }}
              />
              <Bar
                yAxisId="left"
                dataKey="sales"
                name="Net Sales (CAD)"
                fill="#26E6D0"
                radius={[6, 6, 0, 0]}
                animationDuration={320}
                className="cursor-pointer"
                onClick={(entry) => {
                  const prod = (entry as unknown as { product?: string; payload?: { product?: string } }).product ??
                    (entry as unknown as { payload?: { product?: string } }).payload?.product;
                  if (prod) onCrossFilter('products', prod);
                }}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="cumPctNum"
                name="Cumulative %"
                stroke="#B740DE"
                strokeWidth={2.5}
                dot={{ r: 3, fill: '#B740DE' }}
                animationDuration={320}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Channel & Payment 100% Mix */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <ChartCard
          title="Sales Channel Mix by Quarter (100% Stacked)"
          subtitle="Share of quarterly net revenue across sales channels"
          exportName="channel_mix_stacked"
          isEmpty={channelPayment.stackedChannelByQuarter.length === 0}
          tableData={channelPayment.stackedChannelByQuarter}
          minHeight={240}
        >
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={channelPayment.stackedChannelByQuarter} margin={{ top: 8, right: 10, left: 0, bottom: 4 }}>
              <XAxis
                dataKey="quarter"
                tick={axisStyle}
                axisLine={{ stroke: 'rgba(148,163,184,0.28)' }}
                tickLine={false}
              />
              <YAxis
                domain={[0, 100]}
                tick={axisStyle}
                axisLine={{ stroke: 'rgba(148,163,184,0.28)' }}
                tickLine={false}
                tickFormatter={(v) => `${v}%`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#0F2238',
                  borderColor: 'rgba(255,255,255,0.14)',
                  borderRadius: 12,
                  fontSize: 12,
                  color: '#F1F5F9',
                }}
                formatter={(v: unknown) => [`${v}%`, 'Share']}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {channelPayment.channelNames.map((ch, idx) => (
                <Bar
                  key={ch}
                  dataKey={ch}
                  stackId="a"
                  fill={CHART_PALETTE[idx % CHART_PALETTE.length]}
                  animationDuration={320}
                  className="cursor-pointer"
                  onClick={() => onCrossFilter('channels', ch)}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Payment Method Distribution (100% Mix)"
          subtitle="Net revenue share and order volume by payment tender"
          exportName="payment_mix"
          isEmpty={channelPayment.payments.length === 0}
          tableData={channelPayment.payments.map((p) => ({
            'Payment Method': p.name,
            'Sales (CAD)': p.sales,
            'Share %': `${(p.pct * 100).toFixed(1)}%`,
            Orders: p.orders,
          }))}
          minHeight={240}
        >
          <div className="flex h-full flex-col justify-center space-y-4">
            <div className="flex h-6 w-full overflow-hidden rounded-lg">
              {channelPayment.payments.map((p, idx) => (
                <div
                  key={p.name}
                  style={{
                    width: `${Math.max(2, p.pct * 100)}%`,
                    backgroundColor: CHART_PALETTE[idx % CHART_PALETTE.length],
                  }}
                  title={`${p.name}: ${formatPct(p.pct)}`}
                />
              ))}
            </div>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {channelPayment.payments.map((p, idx) => (
                <div
                  key={p.name}
                  className="flex items-center justify-between rounded-xl border border-slate-200/80 px-3 py-2.5 text-xs dark:border-white/10"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="h-3 w-3 rounded-sm"
                      style={{ backgroundColor: CHART_PALETTE[idx % CHART_PALETTE.length] }}
                    />
                    <span className="font-medium text-[#0F2238] dark:text-slate-100">{p.name}</span>
                  </div>
                  <div className="text-right font-mono tabular-nums">
                    <div className="font-semibold text-[#0F2238] dark:text-white">
                      {formatPct(p.pct)}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {formatCAD(p.sales, true)} · {formatNumber(p.orders)} ord
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </ChartCard>
      </div>

      {/* Pinned AI Analyst Insights */}
      {pinnedInsights.length > 0 && (
        <section className="space-y-3">
          <h3 className="font-display text-base font-semibold text-[#0F2238] dark:text-white">
            Pinned AI Analyst Insights
          </h3>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {pinnedInsights.map((pin) => (
              <div
                key={pin.id}
                className="rounded-[16px] border border-slate-200/90 bg-white p-4 dark:border-white/10 dark:bg-[#16314D]"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h4 className="font-display text-sm font-semibold text-[#0F2238] dark:text-white">
                      {pin.title}
                    </h4>
                    <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                      {pin.filtersUsed} · {pin.createdAt.slice(0, 10)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onUnpinInsight(pin.id)}
                    title="Unpin from dashboard"
                    className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-rose-500 dark:hover:bg-white/10"
                  >
                    <PinOff className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
                <p className="mt-2.5 whitespace-pre-line text-xs leading-relaxed text-slate-700 dark:text-slate-200">
                  {pin.summary}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
