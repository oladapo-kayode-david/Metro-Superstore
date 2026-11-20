import React, { useMemo, useState } from 'react';
import {
  Area,
  Bar,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { AllModelResults, FactSale, GlobalFilters } from '../types/sales';
import {
  aggregateDayOfWeekByMonthHeatmap,
  aggregateDiscountBands,
  aggregateMonthlyTrend,
  formatCAD,
  formatMonthLabel,
  formatNumber,
} from '../lib/analytics/calculations';
import { ChartCard } from '../components/ChartCard';

interface TrendsViewProps {
  filteredFacts: FactSale[];
  filters: GlobalFilters;
  models: AllModelResults;
}

export const TrendsView: React.FC<TrendsViewProps> = ({ filteredFacts, filters, models }) => {
  const [overlayMode, setOverlayMode] = useState<'quantity' | 'mom' | 'yoy'>('quantity');
  const useRecomp = filters.useRecomputedFinancials;

  const monthly = useMemo(() => {
    const rows = aggregateMonthlyTrend(filteredFacts, useRecomp).map((m) => ({
      ...m,
      momPctDisplay: m.momPct !== null ? Number((m.momPct * 100).toFixed(1)) : null,
      yoyPctDisplay: m.yoyPct !== null ? Number((m.yoyPct * 100).toFixed(1)) : null,
      forecast: null as number | null,
    }));
    if (models.forecast?.sufficientData) {
      models.forecast.points
        .filter((p) => p.isForecast)
        .forEach((p) =>
          rows.push({
            yearMonth: p.yearMonth,
            label: formatMonthLabel(p.yearMonth),
            sales: 0,
            grossSales: 0,
            discountAmount: 0,
            discountPct: 0,
            quantity: p.quantityPredicted ?? 0,
            orders: 0,
            aov: 0,
            momPct: null,
            yoyPct: null,
            yoySales: null,
            rolling3m: null,
            momPctDisplay: null,
            yoyPctDisplay: null,
            forecast: p.predicted ?? null,
          })
        );
    }
    return rows;
  }, [filteredFacts, useRecomp, models.forecast]);

  const dowHeatmap = useMemo(
    () => aggregateDayOfWeekByMonthHeatmap(filteredFacts, useRecomp),
    [filteredFacts, useRecomp]
  );

  const discountBands = useMemo(
    () => aggregateDiscountBands(filteredFacts, useRecomp),
    [filteredFacts, useRecomp]
  );

  const axisStyle = { fontSize: 11, fill: '#94A3B8' };

  return (
    <div className="space-y-6">
      <ChartCard
        title="Monthly Sales Performance & Growth Dynamics"
        subtitle="Switch right-axis overlay between Units Sold, MoM % Growth, and YoY % Growth"
        exportName="trends_monthly_growth"
        isEmpty={monthly.length === 0}
        minHeight={340}
        tableData={monthly.map((m) => ({
          Month: m.yearMonth,
          'Sales (CAD)': m.sales,
          'Rolling 3M Avg': m.rolling3m ?? '',
          Quantity: m.quantity,
          'MoM %': m.momPctDisplay ?? '',
          'YoY %': m.yoyPctDisplay ?? '',
          'Forecast (CAD)': m.forecast ?? '',
        }))}
        headerRight={
          <div className="flex items-center rounded-lg border border-slate-300 p-0.5 dark:border-white/15">
            {([
              { id: 'quantity', label: 'Units' },
              { id: 'mom', label: 'MoM %' },
              { id: 'yoy', label: 'YoY %' },
            ] as const).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setOverlayMode(tab.id)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                  overlayMode === tab.id
                    ? 'brand-gradient text-[#0F2238] font-semibold'
                    : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        }
      >
        <ResponsiveContainer width="100%" height={340}>
          <ComposedChart data={monthly} margin={{ top: 12, right: 18, left: 6, bottom: 8 }}>
            <defs>
              <linearGradient id="trendAreaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#26E6D0" stopOpacity={0.42} />
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
              tickFormatter={(v) => (overlayMode === 'quantity' ? formatNumber(Number(v)) : `${v}%`)}
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
            <Area
              yAxisId="left"
              type="monotone"
              dataKey="sales"
              name="Net Sales (CAD)"
              stroke="#26E6D0"
              strokeWidth={2.5}
              fill="url(#trendAreaGrad)"
              animationDuration={320}
            />
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="rolling3m"
              name="3-Month Rolling Avg"
              stroke="#63F0DF"
              strokeWidth={1.8}
              strokeDasharray="4 4"
              dot={false}
              connectNulls
              animationDuration={320}
            />
            {models.forecast?.sufficientData && (
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="forecast"
                name="ML Forecast (CAD)"
                stroke="#B740DE"
                strokeWidth={2.5}
                strokeDasharray="6 3"
                dot={{ r: 3, fill: '#B740DE' }}
                connectNulls
                animationDuration={320}
              />
            )}
            {overlayMode === 'quantity' && (
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
            )}
            {overlayMode === 'mom' && (
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="momPctDisplay"
                name="MoM Growth %"
                stroke="#B740DE"
                strokeWidth={2}
                dot={{ r: 2.5 }}
                connectNulls
                animationDuration={320}
              />
            )}
            {overlayMode === 'yoy' && (
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="yoyPctDisplay"
                name="YoY Growth %"
                stroke="#B740DE"
                strokeWidth={2}
                dot={{ r: 2.5 }}
                connectNulls
                animationDuration={320}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </ChartCard>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Discount Depth vs Units & Net Revenue */}
        <ChartCard
          title="Discount Depth vs Units & Net Revenue"
          subtitle="Evaluate whether deeper discounting expands net revenue or erodes realization"
          exportName="discount_depth_impact"
          isEmpty={discountBands.every((d) => d.transactions === 0)}
          tableData={discountBands.map((b) => ({
            'Discount Band': b.band,
            Transactions: b.transactions,
            'Total Units': b.units,
            'Avg Units/Txn': b.avgUnits,
            'Net Revenue (CAD)': b.netRevenue,
            'Discount Cost (CAD)': b.discountCost,
          }))}
        >
          <ResponsiveContainer width="100%" height={290}>
            <ComposedChart data={discountBands} margin={{ top: 10, right: 16, left: 4, bottom: 8 }}>
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
                formatter={(v: unknown, name?: string | number) => {
                  const label = String(name ?? '');
                  return label.includes('Revenue') ? [formatCAD(Number(v)), label] : [String(v ?? ''), label];
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar
                yAxisId="left"
                dataKey="netRevenue"
                name="Net Revenue (CAD)"
                fill="#26E6D0"
                radius={[6, 6, 0, 0]}
                animationDuration={320}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="avgUnits"
                name="Avg Units / Txn"
                stroke="#B740DE"
                strokeWidth={2.5}
                dot={{ r: 3.5, fill: '#B740DE' }}
                animationDuration={320}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Day-of-Week x Month Heatmap */}
        <ChartCard
          title="Day-of-Week × Month Sales Heatmap"
          subtitle="Net Sales (CAD) intensity across calendar days and months"
          exportName="dow_month_heatmap"
          isEmpty={dowHeatmap.maxVal === 0}
          tableData={dowHeatmap.days.map((d) => ({
            Day: d,
            ...dowHeatmap.matrix[d],
          }))}
        >
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-1 text-center text-[11px]">
              <thead>
                <tr>
                  <th className="px-1.5 py-1 text-left font-medium text-slate-500 dark:text-slate-400">
                    Day
                  </th>
                  {dowHeatmap.monthNames.map((m) => (
                    <th key={m} className="px-1 py-1 font-medium text-slate-500 dark:text-slate-400">
                      {m}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dowHeatmap.days.map((day) => (
                  <tr key={day}>
                    <td className="pr-2 text-left font-medium text-[#0F2238] dark:text-slate-200">
                      {day}
                    </td>
                    {dowHeatmap.monthNames.map((m) => {
                      const val = dowHeatmap.matrix[day][m] ?? 0;
                      const ratio = dowHeatmap.maxVal > 0 ? val / dowHeatmap.maxVal : 0;
                      const bg =
                        ratio <= 0.02
                          ? 'rgba(148,163,184,0.12)'
                          : ratio < 0.55
                          ? `rgba(38, 230, 208, ${0.18 + ratio * 0.9})`
                          : `rgba(183, 64, 222, ${0.35 + (ratio - 0.5) * 1.1})`;
                      return (
                        <td
                          key={m}
                          title={`${day} in ${m}: ${formatCAD(val)}`}
                          style={{ backgroundColor: bg }}
                          className="h-8 rounded-md font-mono text-[10px] tabular-nums text-[#0F2238] dark:text-white"
                        >
                          {val > 0 ? formatCAD(val, true).replace('CA$', '') : '—'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ChartCard>
      </div>
    </div>
  );
};
