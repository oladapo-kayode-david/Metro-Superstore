import React, { useMemo } from 'react';
import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import {
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';
import type { FactSale, GlobalFilters } from '../types/sales';
import {
  aggregateSalespeople,
  formatCAD,
  formatCADExact,
  formatNumber,
  formatPct,
} from '../lib/analytics/calculations';
import { ChartCard } from '../components/ChartCard';
import { VirtualTable, type VirtualColumn } from '../components/VirtualTable';

interface SalespersonViewProps {
  filteredFacts: FactSale[];
  filters: GlobalFilters;
  onCrossFilter: (field: 'salespeople', value: string) => void;
}

export const SalespersonView: React.FC<SalespersonViewProps> = ({
  filteredFacts,
  filters,
  onCrossFilter,
}) => {
  const useRecomp = filters.useRecomputedFinancials;

  const reps = useMemo(
    () => aggregateSalespeople(filteredFacts, useRecomp),
    [filteredFacts, useRecomp]
  );

  const maxRepSales = useMemo(() => Math.max(...reps.map((r) => r.sales), 1), [reps]);

  const quartileSummary = useMemo(() => {
    const groups: Array<'Q1 (Top)' | 'Q2' | 'Q3' | 'Q4 (Bottom)'> = [
      'Q1 (Top)',
      'Q2',
      'Q3',
      'Q4 (Bottom)',
    ];
    return groups.map((q) => {
      const members = reps.filter((r) => r.quartile === q);
      const totalSales = members.reduce((a, r) => a + r.sales, 0);
      const avgAov = members.length > 0 ? members.reduce((a, r) => a + r.aov, 0) / members.length : 0;
      const avgDisc =
        members.length > 0 ? members.reduce((a, r) => a + r.discountPct, 0) / members.length : 0;
      return { quartile: q, count: members.length, totalSales, avgAov, avgDisc };
    });
  }, [reps]);

  const axisStyle = { fontSize: 11, fill: '#94A3B8' };

  const leaderboardCols: Array<VirtualColumn<Record<string, unknown>>> = [
    { key: 'rank', label: 'Rank', align: 'right', width: '58px' },
    {
      key: 'rankChange',
      label: 'Shift',
      align: 'right',
      width: '68px',
      render: (r) => {
        const ch = Number(r.rankChange ?? 0);
        if (ch > 0) {
          return (
            <span className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-[#26E6D0]">
              <ArrowUp className="h-3 w-3" aria-hidden="true" />+{ch}
            </span>
          );
        }
        if (ch < 0) {
          return (
            <span className="inline-flex items-center gap-0.5 text-rose-500">
              <ArrowDown className="h-3 w-3" aria-hidden="true" />
              {ch}
            </span>
          );
        }
        return (
          <span className="inline-flex items-center text-slate-400">
            <Minus className="h-3 w-3" aria-hidden="true" />
          </span>
        );
      },
    },
    { key: 'salesperson', label: 'Salesperson' },
    { key: 'primaryStore', label: 'Primary Store' },
    {
      key: 'sales',
      label: 'Net Sales (CAD)',
      align: 'right',
      width: '190px',
      render: (r) => {
        const val = Number(r.sales);
        const pct = Math.max(4, Math.round((val / maxRepSales) * 100));
        return (
          <div className="flex items-center justify-end gap-2.5">
            <div className="hidden h-2 w-20 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10 sm:block">
              <div className="h-full rounded-full brand-gradient" style={{ width: `${pct}%` }} />
            </div>
            <span className="font-mono font-semibold tabular-nums">{formatCAD(val)}</span>
          </div>
        );
      },
    },
    {
      key: 'quantity',
      label: 'Units',
      align: 'right',
      render: (r) => formatNumber(Number(r.quantity)),
    },
    { key: 'orders', label: 'Orders', align: 'right' },
    {
      key: 'aov',
      label: 'AOV (CAD)',
      align: 'right',
      render: (r) => formatCADExact(Number(r.aov)),
    },
    {
      key: 'discountPct',
      label: 'Discount %',
      align: 'right',
      render: (r) => formatPct(Number(r.discountPct)),
    },
    {
      key: 'growthPct',
      label: 'Growth',
      align: 'right',
      render: (r) => {
        const g = r.growthPct as number | null;
        if (g === null || g === undefined) return '—';
        return (
          <span className={g >= 0 ? 'text-emerald-600 dark:text-[#26E6D0]' : 'text-rose-500'}>
            {g >= 0 ? '+' : ''}
            {(g * 100).toFixed(1)}%
          </span>
        );
      },
    },
    { key: 'quartile', label: 'Quartile' },
  ];

  return (
    <div className="space-y-6">
      {/* Quartile View Summary Strip */}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        {quartileSummary.map((q) => (
          <div
            key={q.quartile}
            className="rounded-[16px] border border-slate-200/90 bg-white p-4 dark:border-white/10 dark:bg-[#16314D]"
          >
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span className="font-semibold text-[#0F2238] dark:text-white">{q.quartile}</span>
              <span>{q.count} reps</span>
            </div>
            <div className="mt-2 font-mono text-xl font-bold text-[#0F2238] tabular-nums dark:text-[#26E6D0]">
              {formatCAD(q.totalSales, true)}
            </div>
            <div className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
              Avg AOV <span className="font-mono text-[#0F2238] dark:text-slate-200">{formatCADExact(q.avgAov)}</span>
              {' · '}
              Disc <span className="font-mono text-[#0F2238] dark:text-slate-200">{formatPct(q.avgDisc)}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Orders vs AOV Bubble Scatter (Bubble Size = Sales) */}
      <ChartCard
        title="Salesperson Efficiency: Orders vs Average Order Value"
        subtitle="Bubble size represents Total Net Sales (CAD) · Click any bubble to filter"
        exportName="salesperson_orders_aov_scatter"
        isEmpty={reps.length === 0}
        minHeight={320}
        tableData={reps.map((r) => ({
          Salesperson: r.salesperson,
          Orders: r.orders,
          'AOV (CAD)': Number(r.aov.toFixed(2)),
          'Sales (CAD)': r.sales,
          'Discount %': `${(r.discountPct * 100).toFixed(1)}%`,
          Quartile: r.quartile,
        }))}
      >
        <ResponsiveContainer width="100%" height={320}>
          <ScatterChart margin={{ top: 14, right: 24, left: 10, bottom: 16 }}>
            <XAxis
              type="number"
              dataKey="orders"
              name="Orders"
              tick={axisStyle}
              axisLine={{ stroke: 'rgba(148,163,184,0.28)' }}
              tickLine={false}
              label={{ value: 'Distinct Orders', position: 'insideBottom', offset: -8, fill: '#94A3B8', fontSize: 11 }}
            />
            <YAxis
              type="number"
              dataKey="aov"
              name="AOV (CAD)"
              tick={axisStyle}
              axisLine={{ stroke: 'rgba(148,163,184,0.28)' }}
              tickLine={false}
              tickFormatter={(v) => formatCAD(Number(v))}
              label={{ value: 'AOV (CAD)', angle: -90, position: 'insideLeft', fill: '#94A3B8', fontSize: 11 }}
            />
            <ZAxis type="number" dataKey="sales" range={[90, 900]} name="Net Sales" />
            <Tooltip
              cursor={{ strokeDasharray: '3 3', stroke: 'rgba(148,163,184,0.4)' }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload as (typeof reps)[number];
                return (
                  <div className="rounded-xl border border-white/15 bg-[#0F2238] p-3 text-xs text-slate-100 shadow-lg">
                    <div className="font-display font-semibold text-white">{d.salesperson}</div>
                    <div className="text-[11px] text-slate-400">
                      {d.primaryStore} · {d.quartile}
                    </div>
                    <div className="mt-2 space-y-1 font-mono tabular-nums">
                      <div>Sales: {formatCAD(d.sales)}</div>
                      <div>Orders: {d.orders}</div>
                      <div>AOV: {formatCADExact(d.aov)}</div>
                      <div>Discount: {formatPct(d.discountPct)}</div>
                    </div>
                  </div>
                );
              }}
            />
            <Scatter
              name="Top Half (Q1–Q2)"
              data={reps.filter((r) => r.quartile === 'Q1 (Top)' || r.quartile === 'Q2')}
              fill="#26E6D0"
              fillOpacity={0.85}
              animationDuration={320}
              className="cursor-pointer"
              onClick={(node) => {
                const rep = (node as unknown as { salesperson?: string; payload?: { salesperson?: string } }).salesperson ??
                  (node as unknown as { payload?: { salesperson?: string } }).payload?.salesperson;
                if (rep) onCrossFilter('salespeople', rep);
              }}
            />
            <Scatter
              name="Bottom Half (Q3–Q4)"
              data={reps.filter((r) => r.quartile === 'Q3' || r.quartile === 'Q4 (Bottom)')}
              fill="#B740DE"
              fillOpacity={0.85}
              animationDuration={320}
              className="cursor-pointer"
              onClick={(node) => {
                const rep = (node as unknown as { salesperson?: string; payload?: { salesperson?: string } }).salesperson ??
                  (node as unknown as { payload?: { salesperson?: string } }).payload?.salesperson;
                if (rep) onCrossFilter('salespeople', rep);
              }}
            />
          </ScatterChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Leaderboard Table with in-cell bars */}
      <section className="rounded-[16px] border border-slate-200/90 bg-white p-5 dark:border-white/10 dark:bg-[#16314D]">
        <div className="mb-3">
          <h3 className="font-display text-base font-semibold text-[#0F2238] dark:text-white">
            Salesperson Performance Leaderboard
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Click any representative row to filter all dashboards to their transactions
          </p>
        </div>
        <VirtualTable
          rows={reps as unknown as Array<Record<string, unknown>>}
          columns={leaderboardCols}
          exportName="salesperson_leaderboard"
          onRowClick={(r) => onCrossFilter('salespeople', String(r.salesperson))}
        />
      </section>
    </div>
  );
};
